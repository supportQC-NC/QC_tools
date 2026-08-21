// backend/models/LigneBipageModel.js
import mongoose from "mongoose";

/**
 * Une ligne bipée (issue d'un .DAT), stockée pour l'écran "Détail des bipages".
 * Éditable par l'admin : qteScan, nart, observation.
 * Champs dérivés (re-résolus si nart change) : designation, stock, found.
 */
const ligneBipageSchema = new mongoose.Schema(
  {
    entreprise: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Entreprise",
      required: true,
      index: true,
    },
    session: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "InventaireZoneSession",
      required: true,
      index: true,
    },
    datFileName: { type: String, default: "" },
    zoneCode: { type: String, default: "", index: true },
    // Emplacement de la zone (MAGASIN / DOCK / …) : indispensable pour
    // distinguer deux zones portant le MÊME code à des emplacements différents.
    zoneType: { type: String, default: "", index: true },
    ordre: { type: Number, default: 0 },

    // Code brut scanné, tel quel dans le .DAT
    eanArticle: { type: String, default: "" },

    // Éditables par l'admin
    qteScan: { type: Number, default: 0 },
    nart: { type: String, default: "" },
    observation: { type: String, default: "" },

    // Dérivés (article.DBF)
    designation: { type: String, default: "" },
    stock: { type: Number, default: null },
    found: { type: Boolean, default: false },

    // ── Provenance de la ligne ────────────────────────────────────────────
    // "dat" : fichier déposé par le collecteur (cas historique) ;
    // "proforma" : intégrée depuis une proforma de l'ERP ;
    // "excel" : importée depuis un fichier Excel.
    source: {
      type: String,
      enum: ["dat", "proforma", "excel"],
      default: "dat",
    },
    // N° de proforma ou nom du fichier Excel d'origine.
    sourceRef: { type: String, default: "" },

    // Mode de comptage :
    // "inventaire" : comptage normal, quantités positives ;
    // "deduction"  : quantités NÉGATIVES — les ventes réalisées dans une partie
    //                du magasin restée ouverte entre le début et la fin de
    //                l'inventaire, à retrancher du comptage.
    modeImport: {
      type: String,
      enum: ["inventaire", "deduction"],
      default: "inventaire",
    },

    // Agent qui a bipé : code vendeur (REPRES pour une proforma, bloc du nom de
    // fichier pour un Excel) et son identité au moment de l'import. Le .DAT du
    // collecteur ne porte pas cette information : elle y reste vide.
    agentCode: { type: String, default: "" },
    agentNom: { type: String, default: "" },
  },
  { timestamps: true },
);

ligneBipageSchema.index({ session: 1, zoneCode: 1 });
ligneBipageSchema.index({ session: 1, datFileName: 1 });

const LigneBipage = mongoose.model("LigneBipage", ligneBipageSchema);

export default LigneBipage;