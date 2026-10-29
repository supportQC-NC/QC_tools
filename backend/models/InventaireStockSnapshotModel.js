// backend/models/InventaireStockSnapshotModel.js
//
// PHOTO DU STOCK d'une session d'inventaire par zones (« figer le stock »,
// demande client du 29/10/2026) : au moment du gel, le stock total
// (S1+S2+S3+S4+S5) de chaque article est photographié ; la feuille d'écarts
// compare alors les comptages à CETTE photo et non au stock réel, qui continue
// de bouger (ventes, réceptions) pendant l'inventaire.
//
// Stockage PAR BLOCS (tableaux parallèles narts/stocks, TAILLE_BLOC articles
// par document) : ~90 000 articles chez QC tiendraient mal en un document
// (16 Mo max) et seraient lents en 90 000 documents individuels — en blocs de
// 2 000, la photo complète fait ~45 documents, écrits et relus en une fois.
// Seuls les articles à stock ≠ 0 sont photographiés : un article absent de la
// photo vaut stock 0 (c'est aussi ce qui rend la photo compacte).
//
// Cycle de vie : créée au « figer », supprimée au « défiger », à l'annulation
// et à la réinitialisation de l'inventaire ; « refiger » = suppression +
// nouvelle photo. L'état (actif, date, auteur) vit sur la session
// (`InventaireZoneSession.stockFige`).

import mongoose from "mongoose";

export const TAILLE_BLOC_SNAPSHOT = 2000;

const snapshotSchema = new mongoose.Schema(
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
    },
    ordre: { type: Number, required: true },
    // Tableaux PARALLÈLES : narts[i] a pour stock photographié stocks[i].
    // NART stocké TRIMMÉ EN MAJUSCULES (clé de recherche, cf. lookupNart).
    narts: [{ type: String }],
    stocks: [{ type: Number }],
  },
  { timestamps: true },
);

snapshotSchema.index({ session: 1, ordre: 1 }, { unique: true });

const InventaireStockSnapshot = mongoose.model(
  "InventaireStockSnapshot",
  snapshotSchema,
);

export default InventaireStockSnapshot;
