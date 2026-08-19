// backend/models/MessageFournisseurModel.js
//
// Modèles de corps de mail par société + TYPE + langue — équivalent de la table
// Access tblMessage, étendu.
//
// Deux types de message coexistent pour une même société :
//   - "commande" : le mail qui accompagne l'envoi d'une commande préparée
//                  (sujet calculé, fidèle à l'Access — le champ `sujet` est ignoré) ;
//   - "relance"  : le mail de relance envoyé depuis l'onglet Historique
//                  (sujet éditable, variables {{commandes}}, {{fournisseur}}…) ;
//   - "ar"       : le mail de confirmation d'accusé de réception, envoyé depuis
//                  l'onglet « Accusés de réception » quand le fournisseur a
//                  confirmé la commande (sujet éditable, variable {{montant_total}}).
//
// Le HTML est envoyé tel quel comme corps de l'email (une signature société y est
// ajoutée à l'envoi). Il est saisi via un éditeur visuel côté web : personne n'a
// besoin d'écrire du HTML.
import mongoose from "mongoose";

const messageFournisseurSchema = new mongoose.Schema(
  {
    entreprise: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Entreprise",
      required: true,
    },
    // Type de message. Défaut "commande" = comportement historique du module.
    type: {
      type: String,
      enum: ["commande", "relance", "ar"],
      default: "commande",
      required: true,
    },
    langue: { type: String, enum: ["F", "A"], required: true },
    // Sujet du mail — utilisé par les relances et les AR (le sujet d'une
    // commande reste calculé à l'envoi pour rester fidèle à l'Access).
    sujet: { type: String, default: "" },
    // Corps HTML du message.
    message: { type: String, default: "" },
  },
  { timestamps: true },
);

// Un seul modèle par (société, type, langue).
messageFournisseurSchema.index({ entreprise: 1, type: 1, langue: 1 }, { unique: true });

const MessageFournisseur = mongoose.model(
  "MessageFournisseur",
  messageFournisseurSchema,
);

// ────────────────────────────────────────────────────────────────────────────
// MIGRATION PARESSEUSE (appelée avant toute lecture/écriture de modèle)
//
// Les documents créés avant l'ajout du champ `type` n'en ont pas, et l'ancien
// index unique (entreprise, langue) interdirait de créer un modèle de relance
// pour une langue déjà utilisée par un modèle de commande. On corrige les deux
// une seule fois par processus.
// ────────────────────────────────────────────────────────────────────────────
let _migre = false;

export const assurerSchemaMessages = async () => {
  if (_migre) return;
  _migre = true;
  try {
    await MessageFournisseur.updateMany(
      { type: { $exists: false } },
      { $set: { type: "commande" } },
    );
    const index = await MessageFournisseur.collection.indexes();
    if (index.some((i) => i.name === "entreprise_1_langue_1")) {
      await MessageFournisseur.collection.dropIndex("entreprise_1_langue_1");
    }
  } catch (err) {
    // On retentera au prochain appel plutôt que de bloquer l'écran.
    _migre = false;
    console.error(
      "[envoi-cde] migration des modèles de message :",
      err.message,
    );
  }
};

export default MessageFournisseur;
