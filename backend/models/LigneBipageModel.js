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

    // Dérivés (article.DBF) — re-résolus dès que `nart` change.
    // ⚠️ `gencod` est le CODE-BARRES de l'article du catalogue ; à ne pas
    // confondre avec `eanArticle`, qui est le code BRUT scanné par le
    // collecteur (souvent un NART quand l'article n'a pas de code-barres).
    gencod: { type: String, default: "" },
    designation: { type: String, default: "" },
    stock: { type: Number, default: null },
    found: { type: Boolean, default: false },

    // ── Provenance de la ligne ────────────────────────────────────────────
    // "dat" : fichier déposé par le collecteur (cas historique) ;
    // "proforma" : intégrée depuis une proforma de l'ERP ;
    // "excel" : importée depuis un fichier Excel.
    // "manuel" : ligne AJOUTEE a la main depuis l'ecran, pour une zone deja
    // filtree (code + emplacement) — elle ne vient d'aucun fichier.
    source: {
      type: String,
      enum: ["dat", "proforma", "excel", "manuel"],
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

    // ---- Correction depuis l'ecran « Detail des bipages » ----------------
    // Une ligne corrigee a la main ne porte plus ce qu'a compte l'agent : on le
    // signale a l'ecran plutot que de laisser croire que tout vient du terrain.
    // Seuls le NART et la QUANTITE marquent la ligne : une observation ajoutee
    // ne change pas le comptage.
    modifie: { type: Boolean, default: false },
    modifieAt: { type: Date, default: null },
    modifiePar: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    modifieParNom: { type: String, default: "" },
    // Valeurs d'ORIGINE, figees a la PREMIERE correction (et jamais reecrites
    // ensuite) : sans elles on sait qu'il y a eu correction, mais plus ce que
    // l'agent avait reellement compte. `null` = jamais corrige.
    qteScanOrigine: { type: Number, default: null },
    nartOrigine: { type: String, default: null },

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