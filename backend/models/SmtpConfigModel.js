// backend/models/SmtpConfigModel.js
//
// Surcharges SMTP enregistrées en base. Le .env reste TOUJOURS le défaut (dev &
// prod) ; un document ici PREND LE DESSUS pour son `scope`.
//   scope = "global"  -> s'applique à tous les envois (sauf surcharge module)
//   scope = clé module (ex. "envoi_cde_fournisseur", "mailing", "rapports",
//           "comptes") -> s'applique aux envois de ce module.
// Résolution : .env < global < module. Un champ vide = hérité du niveau inférieur.
import mongoose from "mongoose";

const smtpConfigSchema = new mongoose.Schema(
  {
    scope: { type: String, required: true, unique: true, trim: true },
    host: { type: String, default: "" },
    port: { type: String, default: "" }, // "" = hérité
    // "" = hérité, "ssl" = secure(465), "tls" = STARTTLS(587)
    secure: { type: String, enum: ["", "ssl", "tls"], default: "" },
    user: { type: String, default: "" },
    password: { type: String, default: "" },
    fromName: { type: String, default: "" },
    fromEmail: { type: String, default: "" },
    actif: { type: Boolean, default: true },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true },
);

const SmtpConfig = mongoose.model("SmtpConfig", smtpConfigSchema);

export default SmtpConfig;
