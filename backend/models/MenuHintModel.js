// backend/models/MenuHintModel.js
//
// Infobulles personnalisées des onglets de la sidebar. Chaque document redéfinit
// le texte affiché au survol d'un onglet (identifié par son `path`). Absence de
// document => on retombe sur le texte par défaut (DEFAULT_MENU_HINTS côté front).
import mongoose from "mongoose";

const menuHintSchema = new mongoose.Schema(
  {
    // Chemin de l'onglet (ex. "/admin/articles") — clé unique.
    path: { type: String, required: true, unique: true, trim: true },
    // Texte de l'infobulle (phrase courte).
    hint: { type: String, default: "" },
    // Ordre d'affichage dans son groupe (null = ordre par défaut du code).
    ordre: { type: Number, default: null },
    // Onglet masqué dans la sidebar.
    masque: { type: Boolean, default: false },
    // Traçabilité de la dernière modification.
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true },
);

const MenuHint = mongoose.model("MenuHint", menuHintSchema);

export default MenuHint;
