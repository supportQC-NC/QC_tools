// backend/models/DemandeReapproModel.js
//
// LISTE DE RÉAPPRO (ex « demande de réappro magasin »).
//
// Une liste = un lot d'articles à aller chercher au dock/réserve, poussé par
// quelqu'un et préparé par un opérateur sur le collecteur. Les sources sont
// multiples et évolutives (`source`) :
//   - "manuel"   : saisie à la volée (écran Listes de réappro / analyse réappro)
//   - "proforma" : proforma dont l'observation (TEXTE) commence par « Reappro »
//   - "rapport"  : à venir (que dock, réappro rayon…)
//
// Le cycle de vie est : en_attente (« À faire ») -> en_cours (un opérateur a
// ouvert la liste sur le collecteur, elle lui est VERROUILLÉE) -> realisee
// (« Terminé », même s'il reste des écarts). Aucune écriture DBF : l'ERP reste
// en lecture seule, la sortie est un fichier de transfert .dat (collect_sec).
import mongoose from "mongoose";

const articleSnapSchema = new mongoose.Schema(
  {
    nart: String,
    design: String,
    fourn: String,
    fournNom: String,
    gencod: String,
    refer: String, // référence fournisseur (identification d'un code inconnu)
    s1: Number,
    s2: Number,
    s3: Number,
    s4: Number,
    s5: Number,
    stock: Number, // stock total (ΣS1..S5)
    quantiteDemandee: Number, // quantité demandée par l'utilisateur
    vteMoyMois: Number,

    // ---- Suivi de préparation (collecteur) ----
    // Renseigné ligne par ligne : sert à la progression (%) ET au calcul du
    // temps ACTIF (intervalles entre `traiteAt`, pauses longues exclues).
    quantitePrise: { type: Number, default: 0 },
    statutLigne: {
      type: String,
      enum: ["a_faire", "prise", "introuvable"],
      default: "a_faire",
    },
    traiteAt: { type: Date, default: null },
  },
  { _id: false },
);

// Trace des changements d'urgence (ex. « pas faite depuis 1 semaine »).
const changementUrgenceSchema = new mongoose.Schema(
  {
    de: String,
    vers: String,
    par: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    parNom: String,
    at: { type: Date, default: Date.now },
  },
  { _id: false },
);

// Ligne réellement réassortie par l'agent (quantité prise au réassort).
const ligneRealiseeSchema = new mongoose.Schema(
  { nart: String, quantite: Number },
  { _id: false },
);

const demandeReapproSchema = new mongoose.Schema(
  {
    entreprise: { type: String, index: true }, // nomDossierDBF
    type: { type: String, default: "magasin" }, // magasin (seul type pour l'instant)
    gisement: { type: String, index: true }, // GISM1

    // ---- Identité de la liste ----
    nom: { type: String, default: "" }, // libellé donné par le créateur
    rayon: { type: String, default: "" }, // facultatif (libellé libre)
    source: {
      type: String,
      enum: ["manuel", "proforma", "rapport"],
      default: "manuel",
      index: true,
    },
    sourceRef: { type: String, default: "" }, // proforma : NUMFACT d'origine

    priorite: {
      type: String,
      enum: ["urgent", "a_faire", "normal"],
      default: "a_faire",
    },

    // Nommage du fichier de transfert .dat déposé dans collect_sec.
    // Le CONTENU du fichier ne dépend jamais de ce choix (format Stock XL figé) :
    // seule la partie variable du nom change.
    //   gisement (défaut, comportement historique) | proforma (NUMFACT) | libre
    nommageTransfert: {
      type: String,
      enum: ["gisement", "proforma", "libre"],
      default: "gisement",
    },
    nomTransfertLibre: { type: String, default: "" },
    statut: {
      type: String,
      enum: ["en_attente", "en_cours", "realisee"],
      default: "en_attente",
      index: true,
    },
    articles: [articleSnapSchema],
    nbArticles: { type: Number, default: 0 },
    totalQuantite: { type: Number, default: 0 }, // Σ quantiteDemandee
    commentaire: { type: String, default: "" }, // « observation » côté écran

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    createdByNom: { type: String, default: "" },

    // ---- Préparation (collecteur) ----
    // Verrou : la liste appartient au premier opérateur qui l'ouvre, elle
    // disparaît de la sélection des autres tant qu'elle n'est pas terminée.
    operateur: {
      user: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      nom: { type: String, default: "" },
      debutAt: { type: Date, default: null },
    },
    lignesTraitees: { type: Number, default: 0 },
    tempsActifMs: { type: Number, default: 0 }, // pauses longues exclues
    derniereActiviteAt: { type: Date, default: null },

    historiqueUrgence: [changementUrgenceSchema],

    realisedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    realisedByNom: { type: String, default: "" },
    realisedAt: { type: Date },
    lignesRealisees: [ligneRealiseeSchema],
    transfertFichier: { type: String, default: "" },
  },
  { timestamps: true },
);

// Une demande est "active" (bloque un doublon) tant qu'elle n'est pas réalisée.
demandeReapproSchema.statics.ACTIVE_STATUTS = ["en_attente", "en_cours"];

// Anti-doublon des listes importées : une proforma ne doit donner qu'UNE liste.
demandeReapproSchema.index(
  { entreprise: 1, source: 1, sourceRef: 1 },
  { unique: true, partialFilterExpression: { source: "proforma" } },
);

// Recalcule les compteurs dérivés (totaux + avancement).
demandeReapproSchema.methods.calculerTotaux = function () {
  const arts = this.articles || [];
  this.nbArticles = arts.length;
  this.totalQuantite = arts.reduce(
    (s, a) => s + (Number(a.quantiteDemandee) || 0),
    0,
  );
  this.lignesTraitees = arts.filter((a) => a.statutLigne !== "a_faire").length;
};

const DemandeReappro = mongoose.model("DemandeReappro", demandeReapproSchema);
export default DemandeReappro;