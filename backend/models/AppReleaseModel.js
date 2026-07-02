// backend/models/AppReleaseModel.js
// Versions publiées de l'app collecteur : chaque upload de QR = une release,
// avec version auto-incrémentée. La release courante = la plus récente.
import mongoose from "mongoose";

const appReleaseSchema = new mongoose.Schema(
  {
    // Version (ex: "1.0.1", "1.0.2", ...)
    version: { type: String, required: true, trim: true },
    // QR code d'installation, image en base64 (data URL "data:image/png;base64,…")
    qr: { type: String, required: true },
    // Note / changelog optionnel
    note: { type: String, default: "" },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

const AppRelease = mongoose.model("AppRelease", appReleaseSchema);

export default AppRelease;