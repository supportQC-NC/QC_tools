// backend/models/masterConfig/ListEnvoiFactAutoModel.js
//
// Clients en envoi automatique de facture — équivalent Access tblListEnvoiFactAuto.
// Scopé par entreprise ; destinataires + copies + maintenance.
import mongoose from "mongoose";

const listEnvoiFactAutoSchema = new mongoose.Schema(
  {
    entreprise: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Entreprise",
      required: true,
    },
    idClient: { type: String, default: "" },
    client: { type: String, default: "" },
    mails: { type: [String], default: [] },
    mailsCC: { type: [String], default: [] },
    mailsMaintenance: { type: [String], default: [] },
    // Rattachement OPTIONNEL à un utilisateur de l'app (facultatif).
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true },
);

export default mongoose.model("ListEnvoiFactAuto", listEnvoiFactAutoSchema);
