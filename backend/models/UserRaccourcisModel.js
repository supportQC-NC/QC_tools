// backend/models/UserRaccourcisModel.js
//
// Raccourcis du tableau de bord personnel : un document par utilisateur.
//
// Remplace l'ancien « tableau de bord composable » (widgets, tuiles KPI,
// graphiques, pages) retiré le 26/08/2026 : l'écran d'accueil est redevenu un
// simple lanceur, et la seule préférence à retenir est la LISTE des onglets que
// l'utilisateur veut voir en accès rapide.
//
// On ne stocke que des CHEMINS d'onglets (`/admin/articles`…), jamais de droits :
// le filtrage par permission est refait à chaque affichage côté client (mêmes
// règles que la sidebar), donc un raccourci vers un module perdu disparaît tout
// seul sans qu'il faille toucher au document.
import mongoose from "mongoose";

const userRaccourcisSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    // false = l'utilisateur n'a jamais choisi : l'écran affiche TOUS les onglets
    // auxquels il a accès. Sans ce drapeau, une sélection volontairement vide
    // serait indiscernable d'une absence de choix.
    personnalise: { type: Boolean, default: false },
    raccourcis: { type: [String], default: [] },
  },
  { timestamps: true },
);

export default mongoose.model("UserRaccourcis", userRaccourcisSchema);
