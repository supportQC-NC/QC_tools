// backend/models/ReceptionModel.js
import mongoose from "mongoose";

/**
 * Module « Réception de marchandises » (contrôle SANS réappro).
 *
 * Une session de réception compare les quantités réceptionnées (X) aux quantités
 * commandées dans Stock XL (Y). Toutes les données vivent en Mongo (aucune écriture DBF).
 * Le livrable final est un rapport PDF déposé sur RCOMMUN + envoyé par email au service Achats.
 *
 * Cycle de vie (status) :
 *   en_cours        -> phase de scan/comptage terrain
 *   analyse_ecarts  -> phase finale (articles non trouvés + écarts du dernier au premier)
 *   termine         -> écarts validés, commentaire saisi, rapport généré
 */

// ---------------------------------------------------------------------------
// Snapshot d'une LIGNE DE COMMANDE (référence "Y" pour le calcul des écarts).
// Figé à la création de la session pour rester stable même si le DBF évolue.
// ---------------------------------------------------------------------------
const ligneCommandeSchema = new mongoose.Schema(
  {
    nl: { type: Number, default: 0 }, // NL (ordre de la commande)
    nart: { type: String, default: "" }, // code article
    designation: { type: String, default: "" },
    refer: { type: String, default: "" }, // référence fournisseur
    gencod: { type: String, default: "" }, // gencode de référence (base article) si résolu
    qteCommandee: { type: Number, default: 0 }, // QTE de cmdetail
    estNouveau: { type: Boolean, default: false }, // nouveauté (V1..V12 tous = 0)
  },
  { _id: false },
);

// ---------------------------------------------------------------------------
// Proposition d'association d'un NOUVEAU GENCODE (pour le service Achats).
// Renseignée lorsqu'un gencode inconnu au bipage est identifié via un autre
// canal (code article, référence fournisseur, sélection dans la liste, ou
// bipage de confirmation en phase finale).
// ---------------------------------------------------------------------------
const nouveauGencodeSchema = new mongoose.Schema(
  {
    gencode: { type: String, default: "" }, // gencode scanné à associer
    methode: {
      type: String,
      enum: ["code_article", "ref_fourn", "liste", "bipage_final", ""],
      default: "",
    },
  },
  { _id: false },
);

// ---------------------------------------------------------------------------
// Ligne COMPTÉE pendant la réception (mesure "X").
// Une ligne peut être : un article de la commande, un article hors commande,
// ou un gencode inconnu laissé non identifié (isInconnu = true, nart vide).
// ---------------------------------------------------------------------------
const comptageSchema = new mongoose.Schema(
  {
    nart: { type: String, default: "" }, // vide si gencode inconnu non identifié
    gencod: { type: String, default: "" }, // gencode de référence de l'article (base)
    designation: { type: String, default: "" },
    refer: { type: String, default: "" },

    // Ce qui a réellement été bipé (peut différer du gencode de référence,
    // notamment pour les associations de nouveaux gencodes).
    gencodeScanne: { type: String, default: "" },

    // Cumul des quantités saisies pendant le scan.
    qteComptee: { type: Number, default: 0, min: 0 },

    // Quantité validée en phase finale (écarts). Reste null tant qu'aucun
    // recomptage n'a eu lieu ; à l'édition du rapport, on retient
    // qteValidee ?? qteComptee.
    qteValidee: { type: Number, default: null },

    dansCommande: { type: Boolean, default: false }, // présent dans la commande ?
    isInconnu: { type: Boolean, default: false }, // gencode inconnu non identifié

    // Proposition d'association d'un nouveau gencode (null si aucune).
    nouveauGencode: { type: nouveauGencodeSchema, default: null },

    // Signalements (placeholders : règle de détection à définir ultérieurement).
    enReservation: { type: Boolean, default: false },
    nbReservations: { type: Number, default: 0 }, // article.RESERV (nb de réservations)
    estNouveau: { type: Boolean, default: false },

    // Stocks au moment du scan (historique).
    stocksSnapshot: {
      S1: { type: Number, default: 0 },
      S2: { type: Number, default: 0 },
      S3: { type: Number, default: 0 },
      S4: { type: Number, default: 0 },
      S5: { type: Number, default: 0 },
    },

    // True si la ligne a été (re)trouvée pendant la phase finale d'analyse.
    trouveEnPhaseFinale: { type: Boolean, default: false },

    scannedAt: { type: Date, default: Date.now },
    validatedAt: { type: Date, default: null },
  },
  { _id: true },
);

// ---------------------------------------------------------------------------
// SESSION DE RÉCEPTION
// ---------------------------------------------------------------------------
const receptionSchema = new mongoose.Schema(
  {
    entreprise: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Entreprise",
      required: true,
    },
    nomDossierDBF: {
      type: String,
      required: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    // Commande contrôlée (lien sur cmdref.NUMCDE)
    numcde: {
      type: String,
      required: true,
      trim: true,
    },

    // Mode de contrôle (seul "sans_reappro" est implémenté pour l'instant)
    mode: {
      type: String,
      enum: ["sans_reappro", "avec_reappro"],
      default: "sans_reappro",
    },

    status: {
      type: String,
      enum: ["en_cours", "analyse_ecarts", "termine"],
      default: "en_cours",
    },

    // Snapshot de l'entête de commande (cmdref) au moment du contrôle
    commandeInfo: {
      fourn: { type: Number, default: null },
      fournisseurNom: { type: String, default: "" },
      bateau: { type: String, default: "" }, // BATEAU (nom / arrivée prévue, texte)
      arrivee: { type: Date, default: null }, // ARRIVEE (date d'arrivée / ETA)
      datcde: { type: Date, default: null },
      observ: { type: String, default: "" },
      etat: { type: Number, default: null },
    },

    // Référence "Y" : lignes de la commande figées à la création
    lignesCommande: [ligneCommandeSchema],

    // Mesure "X" : comptage terrain
    comptages: [comptageSchema],

    // Commentaire libre de fin de contrôle (§9)
    commentaire: { type: String, default: "" },

    // Rapport PDF généré (§10)
    rapport: {
      fileName: { type: String, default: "" },
      filePath: { type: String, default: "" },
      generatedAt: { type: Date, default: null },
      emailTo: { type: [String], default: [] },
      emailSentAt: { type: Date, default: null },
      emailError: { type: String, default: "" },
    },

    controleDebutAt: { type: Date, default: Date.now },
    controleFinAt: { type: Date, default: null },

    // Totaux dénormalisés (recalculés à chaque mutation des comptages)
    totalComptes: { type: Number, default: 0 },
    totalQuantiteComptee: { type: Number, default: 0 },
  },
  {
    timestamps: true,
  },
);

// Index pour recherche rapide
receptionSchema.index({ entreprise: 1, user: 1, status: 1 });
receptionSchema.index({ entreprise: 1, user: 1, numcde: 1, status: 1 });
receptionSchema.index({ nomDossierDBF: 1 });

// Recalcule les totaux à partir des comptages.
receptionSchema.methods.recalcTotaux = function () {
  this.totalComptes = this.comptages.length;
  this.totalQuantiteComptee = this.comptages.reduce(
    (sum, c) => sum + (Number(c.qteComptee) || 0),
    0,
  );
};

const Reception = mongoose.model("Reception", receptionSchema);

export default Reception;