// backend/models/HistoriquePachatModel.js
//
// Historisation des prix d'achat par ligne de commande (module « Historique
// prix d'achat »). Les .dbf de commandes (cmdref/cmdetail) ne conservent que
// l'ANNÉE EN COURS (archivage annuel de l'ERP) : on persiste donc chaque ligne
// ici pour reconstituer l'évolution sur PLUSIEURS ANNÉES.
//
// Alimenté par historiserPachatCommandes() (services/pachatHistoriqueService.js)
// — upsert idempotent : rejouer le job n'ajoute que le nouveau et met à jour le
// prix d'une ligne re-lue (ex. PACHAT valorisé après réception).
import mongoose from "mongoose";

const historiquePachatSchema = new mongoose.Schema(
  {
    entreprise: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Entreprise",
      required: true,
    },
    nart: { type: String, required: true },
    numcde: { type: String, default: "" },
    nl: { type: Number, default: 0 },
    dateCommande: { type: Date, default: null },
    fournCode: { type: Number, default: null },
    fournisseur: { type: String, default: "" }, // nom dénormalisé (snapshot)
    devise: { type: String, default: "XPF" },
    prix: { type: Number, required: true },
    source: { type: String, default: "commande" }, // "rendu" | "commande"
    qte: { type: Number, default: null },
    design: { type: String, default: "" },
    numfact: { type: String, default: "" },
    arrivee: { type: Date, default: null },
    etat: { type: Number, default: null },
  },
  { timestamps: true },
);

// Lecture : par article et par fournisseur, scopée société.
historiquePachatSchema.index({ entreprise: 1, nart: 1 });
historiquePachatSchema.index({ entreprise: 1, fournCode: 1 });
// Identité d'une ligne de commande (dateCommande incluse pour tolérer une
// éventuelle réutilisation annuelle des numéros de commande par l'ERP).
historiquePachatSchema.index(
  { entreprise: 1, numcde: 1, nl: 1, nart: 1, dateCommande: 1 },
  { unique: true },
);

const HistoriquePachat = mongoose.model(
  "HistoriquePachat",
  historiquePachatSchema,
);

export default HistoriquePachat;
