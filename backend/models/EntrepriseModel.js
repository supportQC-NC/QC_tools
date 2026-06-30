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
// Dossier commun où sont déposés les rapports PDF de réception (controle commande).
const DEFAULT_RAPPORT_RECEPTION =
  "\\\\192.168.0.250\\Rcommun\\STOCK\\controle commande";

// Traduit un chemin d'export stocké (UNC Windows) vers le montage Linux,
// en conservant le DERNIER segment (le dossier propre à l'entreprise / au module).
//   "\\192.168.0.250\Rcommun\STOCK\collect_sec_aw"  ->  "<root>/collect_sec_aw"
//   "\\192.168.0.250\Rcommun\STOCK\controle commande" -> "<root>/controle commande"
// En dev (RCOMMON_STOCK_ROOT non défini) : renvoie la valeur stockée inchangée.
const traduireCheminExport = (v) => {
  const root = process.env.RCOMMON_STOCK_ROOT;
  if (!root || !v) return v;
  const segments = String(v).split(/[\\/]+/).filter(Boolean);
  const dernier = segments[segments.length - 1];
  return dernier ? `${root.replace(/[\\/]+$/, "")}/${dernier}` : root;
};

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
    // Chemin de dépôt des RAPPORTS PDF de RÉCEPTION (module reception) — Rcommun.
    // Traduit comme cheminExportInventaire (garde le dernier segment "controle commande").
    cheminRapportReception: {
      type: String,
      default: DEFAULT_RAPPORT_RECEPTION,
      get: (v) => traduireCheminExport(v),
    },
    // Destinataires de l'EMAIL D'ALERTE du rapport de réception (réservé à ce rapport).
    // Liste d'adresses email (service Achats, chef de dépôt, ...).
    emailsRapportReception: {
      type: [String],
      default: [],
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