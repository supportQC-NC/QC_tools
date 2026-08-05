// backend/models/UserMenuLayoutModel.js
//
// Organisation PERSONNELLE de la sidebar, propre à un utilisateur.
// Un document par utilisateur (clé unique `user`). Même forme que MenuLayout
// (chapitres ordonnés + onglets rangés + masqués), plus un flag `useCustom`
// qui pilote le switch « Défaut / Perso » de la sidebar.
// Ne touche jamais la config globale (MenuLayout, scope "default").
import mongoose from "mongoose";

const chapitreSchema = new mongoose.Schema(
  {
    key: { type: String, required: true },
    label: { type: String, default: "" },
    icon: { type: String, default: "" },
    items: { type: [String], default: [] },
  },
  { _id: false },
);

const userMenuLayoutSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    // Switch sidebar : true => on affiche la config perso, false => la config admin.
    useCustom: { type: Boolean, default: false },
    chapitres: { type: [chapitreSchema], default: [] },
    masques: { type: [String], default: [] },
  },
  { timestamps: true },
);

const UserMenuLayout = mongoose.model("UserMenuLayout", userMenuLayoutSchema);

export default UserMenuLayout;
