// backend/models/AiSalesSnapshotModel.js
//
// Snapshot PRÉ-CALCULÉ des ventes d'une société (12 derniers mois) pour rendre
// l'assistant IA INSTANTANÉ sur « chiffre d'affaires » / « meilleures ventes »
// (l'agrégation live des factures est lourde). Rafraîchi par un cron nocturne.
// Un doc par société (upsert).
import mongoose from "mongoose";

const snapshotSchema = new mongoose.Schema(
  {
    entreprise: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Entreprise",
      required: true,
      unique: true,
    },
    debut: { type: String, default: "" }, // AAAA-MM-JJ
    fin: { type: String, default: "" },
    totaux: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
    topCa: { type: [mongoose.Schema.Types.Mixed], default: [] }, // top 25 par CA
    topQte: { type: [mongoose.Schema.Types.Mixed], default: [] }, // top 25 par quantité
    computedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

const AiSalesSnapshot = mongoose.model("AiSalesSnapshot", snapshotSchema);
export default AiSalesSnapshot;
