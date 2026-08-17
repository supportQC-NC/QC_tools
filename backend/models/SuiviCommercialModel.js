// backend/models/SuiviCommercialModel.js
//
// Suivi PERSONNEL d'un commercial sur des documents de l'ERP (lecture seule côté
// DBF). C'est la seule écriture du module : l'ERP n'est jamais modifié.
//
// Deux usages :
//   - type "relance"  : « j'ai relancé le client sur la proforma XXXXX le ... »
//                       -> sort la proforma de la liste « à relancer » pendant
//                          le délai de relance configuré.
//   - type "alerte"   : « j'ai vu l'alerte commande spéciale disponible XXXXX »
//                       -> l'alerte passe en « traitée » sur le dashboard.
//   - type "resa_prevenu" : « j'ai prévenu le client que sa réservation XXXXX
//                       est arrivée en stock » -> la réservation sort de la
//                       liste « à prévenir » de l'écran Réservations.
//
// `reference` = NUMFACT de la proforma (relance), NUMFACT de la réservation
// (resa_prevenu) ou clé d'alerte (voir services/commercialService.js ->
// cleAlerte).

import mongoose from "mongoose";

const suiviCommercialSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    entreprise: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Entreprise",
      required: true,
    },
    type: {
      type: String,
      enum: ["relance", "alerte", "resa_prevenu"],
      required: true,
    },
    reference: { type: String, required: true, trim: true },
    // Client concerné (code TIERS), pour l'historique et les statistiques.
    tiers: { type: String, default: "" },
    nomClient: { type: String, default: "" },
    // Date de l'action (relance effectuée / alerte acquittée).
    faitLe: { type: Date, default: Date.now },
    // Canal de la relance (téléphone, email, visite...) — libre.
    canal: { type: String, default: "" },
    note: { type: String, default: "" },
  },
  { timestamps: true },
);

// Un seul suivi courant par (utilisateur, société, type, document) : une nouvelle
// relance écrase la précédente (on garde la date la plus récente).
suiviCommercialSchema.index(
  { user: 1, entreprise: 1, type: 1, reference: 1 },
  { unique: true },
);

const SuiviCommercial = mongoose.model(
  "SuiviCommercial",
  suiviCommercialSchema,
);

export default SuiviCommercial;
