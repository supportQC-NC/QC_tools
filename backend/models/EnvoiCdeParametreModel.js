// backend/models/EnvoiCdeParametreModel.js
//
// Paramètres du module « Envoi Commande Fournisseur » par société.
// Remplace la dépendance au .env pour le mode test : le mode test est désormais
// piloté depuis l'interface, par société.
//
// SÉCURITÉ : si aucun document n'existe pour une société, le mode test est
// considéré ACTIF (valeur sûre par défaut) — aucun envoi ne peut partir aux
// vrais fournisseurs tant qu'on ne l'a pas explicitement désactivé.
import mongoose from "mongoose";

const envoiCdeParametreSchema = new mongoose.Schema(
  {
    entreprise: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Entreprise",
      required: true,
      unique: true,
    },
    // true => tous les envois sont redirigés vers testEmails.
    testMode: { type: Boolean, default: true },
    // Adresses de test (repli sur ENVOI_CDE_TEST_EMAILS puis valeurs internes).
    testEmails: { type: [String], default: [] },
  },
  { timestamps: true },
);

const EnvoiCdeParametre = mongoose.model(
  "EnvoiCdeParametre",
  envoiCdeParametreSchema,
);

export default EnvoiCdeParametre;
