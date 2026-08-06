import mongoose from "mongoose";
import path from "path";

// Chemins pilotables par variables d'environnement (bascule dev/prod AUTOMATIQUE) :
//  - en dev (Windows)  : NE PAS définir DBF_BASE_PATH / RCOMMON_STOCK_ROOT
//                        -> les valeurs UNC stockées en base sont utilisées telles quelles.
//  - en prod (Ubuntu)  : DBF_BASE_PATH=/mnt/bases
//                        RCOMMON_STOCK_ROOT=/mnt/rcommun/STOCK
//    -> cheminBase est remplacé par DBF_BASE_PATH ;
//    -> cheminExportInventaire est TRADUIT : on garde le dernier dossier
//       (collect_sec, collect_sec_aw, collect_AVB, ...) PROPRE À CHAQUE ENTREPRISE,
//       mais sous la racine Linux montée. Aucune migration en base nécessaire.
const DEFAULT_BASE = "\\\\serveur\\Bases";
const DEFAULT_COLLECT = "\\\\192.168.0.250\\Rcommun\\STOCK\\collect_sec";

// BASE « collecteur » où sont déposés les livrables du module RÉCEPTION.
// L'arborescence complète est construite en code (voir utils/receptionPaths.js) :
//   <base collecteur>/<TRIGRAMME>/controle_cmd/<NUMCDE>_<date>_<fournisseur>/
//       - le rapport PDF de contrôle
//       - les photos de signalement (problèmes articles)
// NB (migration) : ce champ pointait auparavant sur "...\STOCK\controle commande"
// (dépôt à plat du PDF). Il désigne désormais la base "collecteur". Les entreprises
// déjà en base doivent voir leur valeur mise à jour vers "...\STOCK\collecteur".
const DEFAULT_BASE_COLLECTEUR =
  "\\\\192.168.0.250\\Rcommun\\STOCK\\collecteur";

// Traduit un chemin d'export stocké (UNC Windows) vers le montage Linux,
// en conservant le DERNIER segment (le dossier propre à l'entreprise / au module).
//   "\\192.168.0.250\Rcommun\STOCK\collect_sec_aw"  ->  "<root>/collect_sec_aw"
//   "\\192.168.0.250\Rcommun\STOCK\collecteur"       ->  "<root>/collecteur"
// En dev (RCOMMON_STOCK_ROOT non défini) : renvoie la valeur stockée inchangée.
const traduireCheminExport = (v) => {
  const root = process.env.RCOMMON_STOCK_ROOT;
  if (!root || !v) return v;
  const segments = String(v).split(/[\\/]+/).filter(Boolean);
  const dernier = segments[segments.length - 1];
  return dernier ? `${root.replace(/[\\/]+$/, "")}/${dernier}` : root;
};

// Sous-document : code vendeur (REPRES, 2 chiffres) -> identité.
const vendeurSchema = new mongoose.Schema(
  {
    code: { type: String, trim: true, default: "" }, // code REPRES (ex: "05")
    nom: { type: String, default: "" },
    prenom: { type: String, default: "" },
    email: { type: String, default: "" },
    type: {
      type: String,
      enum: ["commercial", "vendeur", "autre"],
      default: "vendeur",
    },
  },
  { _id: false },
);

// Paramètres du module ANALYSE CA — équivalents de config.py, PAR ENTREPRISE.
// Les DÉFAUTS reprennent la configuration QC d'origine du pipeline Python.
const analyseCaSchema = new mongoose.Schema(
  {
    // Seuil au-delà duquel un tiers est considéré INTERNE
    seuilTiersInterne: { type: Number, default: 9905 },
    // Tiers internes AUTORISÉS dans l'analyse interne (Client_Interne)
    tiersInternesAutorises: {
      type: [Number],
      default: () => [9994, 9915, 9913, 9925, 9914, 9910, 9916, 9905, 9920, 9912, 9998, 9995],
    },
    // Tiers exclus COMPLÈTEMENT du CA (ex: 2226 = BON DE CAISSE)
    tiersExclusCA: { type: [Number], default: () => [2226] },
    // Tiers forcés en catégorie AUTRE malgré un code < seuil
    tiersForcerAutre: { type: [Number], default: () => [] },
    // Préfixes d'articles exclus de toutes les analyses (ex: 08 = ECOPART)
    articlesExclusPrefixes: { type: [String], default: () => ["08"] },
    // Codes articles exclus exacts (ex: 000001 = PROFORMA)
    articlesExclusExacts: { type: [String], default: () => ["000001"] },
    // Seuil PVTE aberrante : ligne exclue si PVTE > catalogue × ce facteur
    seuilPvteAberrante: { type: Number, default: 100 },
    // Noms des classes (préfixe NART par dizaines -> libellé)
    nomsClasses: {
      type: Map,
      of: String,
      default: () =>
        new Map([
          ["10", "Visserie / Boulonnerie"],
          ["20", "Outillage"],
          ["30", "Quincaillerie"],
          ["40", "Électricité"],
          ["50", "Peinture"],
          ["60", "Plomberie / Sanitaire"],
          ["70", "Jardin / Extérieur"],
          ["80", "Divers"],
          ["90", "Matériaux"],
        ]),
    },
    // Noms des SOUS-CLASSES (préfixe NART 2 chiffres -> libellé)
    nomsSousClasses: { type: Map, of: String, default: () => new Map() },
    // Noms des locates (code GROUPE -> libellé lisible)
    nomsLocates: { type: Map, of: String, default: () => new Map() },
    // Normalisation des catégories clients (variante -> catégorie canonique)
    normalisationCategories: {
      type: Map,
      of: String,
      default: () =>
        new Map([
          ["PRO DEBIT EXPORT", "PRO DEBIT"],
          ["PRO DEBIT*", "PRO DEBIT"],
          ["PRO DEBIT MINE", "PRO DEBIT"],
          ["PARTICULER", "PARTICULIER"],
          ["COMPTANT", "PRO COMPTANT"],
          ["EMPLOYEE", "EMPLOYE"],
          ["ADMINISTRATIF", "ADMINISTRATION"],
          ["AGRICULTEUR                             PRO COMPTANT", "AGRICULTEUR"],
          ["COMPTE FERME", "AUTRE"],
          ["INTERNE", "INTERNE"],
        ]),
    },
  },
  { _id: false },
);

const entrepriseSchema = new mongoose.Schema(
  {
    nomDossierDBF: {
      type: String,
      required: [true, "Nom du dossier DBF requis"],
      unique: true,
      trim: true,
    },
    trigramme: {
      type: String,
      required: [true, "Trigramme requis"],
      unique: true,
      uppercase: true,
      trim: true,
      minlength: [2, "Trigramme minimum 2 caractères"],
      maxlength: [5, "Trigramme maximum 5 caractères"],
    },
    nomComplet: {
      type: String,
      required: [true, "Nom complet requis"],
      trim: true,
    },
    description: {
      type: String,
      default: "",
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    // Chemin vers le dossier DBF.
    // En prod, DBF_BASE_PATH (ex: /opt/dbf_local) prime sur la valeur stockée
    // => bascule automatique dev (UNC) / prod (montage) SANS toucher aux contrôleurs.
    cheminBase: {
      type: String,
      default: DEFAULT_BASE,
      get: (v) => process.env.DBF_BASE_PATH || v,
    },
    // Chemin vers le dossier des photos articles
    cheminPhotos: {
      type: String,
      default: "",
    },
    // Chemin d'export des fichiers inventaire/réappro (.dat) — Rcommun.
    // En prod, le chemin est TRADUIT vers le montage Linux en gardant le
    // dossier collect_xxx propre à CHAQUE entreprise (bascule auto).
    cheminExportInventaire: {
      type: String,
      default: DEFAULT_COLLECT,
      get: (v) => traduireCheminExport(v),
    },
    // BASE « collecteur » du module RÉCEPTION (dépôt du PDF + photos de signalement).
    // Traduit comme cheminExportInventaire (garde le dernier segment "collecteur").
    // L'arborescence <trigramme>/controle_cmd/<commande> est ajoutée en code.
    cheminRapportReception: {
      type: String,
      default: DEFAULT_BASE_COLLECTEUR,
      get: (v) => traduireCheminExport(v),
    },
    // Destinataires de l'EMAIL D'ALERTE du rapport de réception (réservé à ce rapport).
    // Liste d'adresses email (service Achats, chef de dépôt, ...).
    emailsRapportReception: {
      type: [String],
      default: [],
    },
    // Destinataires de l'EMAIL du rapport de PRÉPARATION de commande.
    // Liste d'adresses email (préparateurs, service commercial, ...).
    emailsRapportPreparation: {
      type: [String],
      default: [],
    },
    // Chemin du LOGO utilisé sur les étiquettes pleine page (module etiquettes).
    // Chemin lisible par le serveur (UNC en dev Windows, chemin Linux en prod).
    // Lu tel quel ; si vide ou illisible, aucun logo n'est dessiné.
    cheminLogoEtiquettes: {
      type: String,
      default: "",
    },
    // ---- Apparence de marque (réutilisable pour rapports PDF et étiquettes) ----
    // Couleur primaire (ex: bandeaux, titres). Format hex "#RRGGBB".
    couleurPrimaire: {
      type: String,
      default: "#4F46E5",
    },
    // Couleur secondaire (ex: accents, encadrés). Format hex "#RRGGBB".
    couleurSecondaire: {
      type: String,
      default: "#10B981",
    },
    // Logo UPLOADÉ, stocké en base64 (data URL "data:image/png;base64,....").
    // Réutilisable directement dans les PDF (pdfkit accepte le Buffer décodé)
    // et dans les étiquettes/aperçus front (balise <img src>). Vide = aucun logo.
    logo: {
      type: String,
      default: "",
    },
    // Codes vendeurs (REPRES) : code 2 chiffres -> identité + type.
    vendeurs: {
      type: [vendeurSchema],
      default: [],
    },
    // Paramètres ANALYSE CA de l'entreprise (défauts = config QC).
    analyseCA: {
      type: analyseCaSchema,
      default: () => ({}),
    },
    // Mapping des noms d'entrepôts (S1, S2, S3, S4, S5)
    mappingEntrepots: {
      S1: { type: String, default: "Magasin" },
      S2: { type: String, default: "S2" },
      S3: { type: String, default: "S3" },
      S4: { type: String, default: "S4" },
      S5: { type: String, default: "S5" },
    },
    // Mapping des états de commande (personnalisable par entreprise)
    mappingEtatsCommande: {
      type: Map,
      of: String,
      default: () =>
        new Map([
          ["0", "Brouillon"],
          ["1", "A Préparer"],
          ["2", "Proforma"],
          ["3", "Reliquat"],
          ["4", "Envoyée"],
          ["5", "Confirmée"],
          ["6", "Transit"],
          ["7", "Bateau"],
          ["8", "Avion"],
          ["9", "Commande locale"],
        ]),
    },
    // Mapping des états de FACTURE (personnalisable par entreprise, codes 0-9).
    // Libellés vides par défaut (à remplir par l'admin).
    mappingEtatsFacture: {
      type: Map,
      of: String,
      default: () => new Map(),
    },
    // Mapping des états de PROFORMA (personnalisable par entreprise, codes 0-9).
    mappingEtatsProforma: {
      type: Map,
      of: String,
      default: () => new Map(),
    },
    // Mapping des états de RÉSERVATION (portage master report tblEtatReservation).
    mappingEtatsReservation: {
      type: Map,
      of: String,
      default: () => new Map(),
    },
    // ---- Destinataires d'emails de rapports (master report) ----
    // Alerte « changement de prix de vente » (tblParametres.mailChgtPrixVente).
    emailsChgtPrixVente: {
      type: [String],
      default: [],
    },
    // Proposition de réappro (tblParametres.mailPropoReappro).
    emailsPropoReappro: {
      type: [String],
      default: [],
    },
    // Contact COMPTA de la société (tblParametres.mailCompta/nomCompta).
    // `userCompta` : rattachement OPTIONNEL à un utilisateur existant.
    mailCompta: { type: [String], default: [] },
    nomCompta: { type: String, default: "" },
    userCompta: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  {
    timestamps: true,
  },
);

// Virtuel: chemin complet vers le dossier DBF.
// path.join => séparateur correct selon l'OS (\ sous Windows, / sous Linux).
entrepriseSchema.virtual("cheminComplet").get(function () {
  return path.join(this.cheminBase || "", this.nomDossierDBF || "");
});

// Inclure les virtuels dans JSON (les getters NE sont volontairement PAS activés
// dans toJSON : l'écran admin continue d'afficher la valeur UNC stockée).
entrepriseSchema.set("toJSON", { virtuals: true });
entrepriseSchema.set("toObject", { virtuals: true });

const Entreprise = mongoose.model("Entreprise", entrepriseSchema);

export default Entreprise;