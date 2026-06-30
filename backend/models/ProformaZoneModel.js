// backend/models/ProformaZoneModel.js
//
// Affectation d'une proforma (NUMFACT) à un entrepôt/zone (S1..S5) pour
// l'export .DAT du mode « Inventaire Proforma ». Défaut = S1.
// Les proformas vivant dans le DBF (lecture seule), on mémorise ici uniquement
// le choix de zone par (entreprise, NUMFACT).

import mongoose from "mongoose";

const proformaZoneSchema = new mongoose.Schema(
  {
    entreprise: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Entreprise",
      required: true,
    },
    nomDossierDBF: { type: String, required: true },
    numfact: { type: String, required: true, trim: true },
    zone: {
      type: String,
      enum: ["S1", "S2", "S3", "S4", "S5"],
      default: "S1",
    },
  },
  { timestamps: true },
);

// Une seule affectation par proforma et par entreprise.
proformaZoneSchema.index({ entreprise: 1, numfact: 1 }, { unique: true });

const ProformaZone = mongoose.model("ProformaZone", proformaZoneSchema);

export default ProformaZone;