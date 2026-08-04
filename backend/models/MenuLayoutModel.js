// backend/models/MenuLayoutModel.js
//
// Organisation de la sidebar définie par l'admin (source de vérité en base).
// Document UNIQUE (singleton) : la liste ordonnée des chapitres et, pour chacun,
// la liste ordonnée des `path` d'onglets qu'il contient, plus les onglets masqués.
// Le code ne fournit que le CATALOGUE des onglets disponibles (libellé/icône/permission).
import mongoose from "mongoose";

const chapitreSchema = new mongoose.Schema(
  {
    key: { type: String, required: true }, // identifiant stable du chapitre
    label: { type: String, default: "" },
    icon: { type: String, default: "" }, // nom d'icône (map côté front), vide = défaut
    items: { type: [String], default: [] }, // paths d'onglets, dans l'ordre
  },
  { _id: false },
);

const menuLayoutSchema = new mongoose.Schema(
  {
    // Discriminant du singleton (toujours "default").
    scope: { type: String, default: "default", unique: true },
    chapitres: { type: [chapitreSchema], default: [] },
    masques: { type: [String], default: [] }, // paths masqués partout
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true },
);

const MenuLayout = mongoose.model("MenuLayout", menuLayoutSchema);

export default MenuLayout;
