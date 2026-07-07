// backend/models/PermissionModel.js
import mongoose from "mongoose";

const permissionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    entreprises: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Entreprise",
      },
    ],
    modules: {
      // Recherche Article
      stock: {
        read: { type: Boolean, default: false },
        write: { type: Boolean, default: false },
        delete: { type: Boolean, default: false },
      },
      // Inventaire
      inventaire: {
        read: { type: Boolean, default: false },
        write: { type: Boolean, default: false },
        delete: { type: Boolean, default: false },
      },
      // Reapro
      reapro: {
        read: { type: Boolean, default: false },
        write: { type: Boolean, default: false },
        delete: { type: Boolean, default: false },
      },
      // proforma
      proforma: {
        read: { type: Boolean, default: false },
        write: { type: Boolean, default: false },
        delete: { type: Boolean, default: false },
      },
      // CTRL Commandes
      ctr_commande: {
        read: { type: Boolean, default: false },
        write: { type: Boolean, default: false },
        delete: { type: Boolean, default: false },
      },
      // Réception de marchandises (contrôle sans réappro)
      reception: {
        read: { type: Boolean, default: false },
        write: { type: Boolean, default: false },
        delete: { type: Boolean, default: false },
      },
      // PREPA Commandes
      prep_commande: {
        read: { type: Boolean, default: false },
        write: { type: Boolean, default: false },
        delete: { type: Boolean, default: false },
      },
      // CTRL Infos Produit
      ctrl_info_produit: {
        read: { type: Boolean, default: false },
        write: { type: Boolean, default: false },
        delete: { type: Boolean, default: false },
      },
      releve: {
        read: { type: Boolean, default: false },
        write: { type: Boolean, default: false },
        delete: { type: Boolean, default: false },
      },
      // Générateur d'étiquettes
      etiquettes: {
        read: { type: Boolean, default: false },
        write: { type: Boolean, default: false },
        delete: { type: Boolean, default: false },
      },
    },
    allEntreprises: {
      type: Boolean,
      default: false,
    },
    allModules: {
      type: Boolean,
      default: false,
    },
    // Accès aux écrans d'ANALYSE, réglable écran par écran (admins ET users).
    // N'est PAS couvert par allModules : seul un super-admin (allEntreprises)
    // y accède d'office ; sinon il faut cocher chaque écran.
    analyse: {
      commerciaux: { type: Boolean, default: false },
      // Filiales : droit PAR RÉSEAU (DQ, QC, LD) — on peut n'en autoriser qu'un ou plusieurs.
      filiales: {
        DQ: { type: Boolean, default: false },
        QC: { type: Boolean, default: false },
        LD: { type: Boolean, default: false },
      },
      reapproLocal: { type: Boolean, default: false },
      debitComptant: { type: Boolean, default: false },
      doublonsGencode: { type: Boolean, default: false },
      factures: { type: Boolean, default: false },
      journalCaisse: { type: Boolean, default: false },
      topArticles: { type: Boolean, default: false },
    },
    // Commerciaux visibles PAR ENTREPRISE : { "<entrepriseId>": ["01","03"], ... }
    // Vide/absent pour une entreprise = AUCUN commercial (sauf super-admin = tout).
    // Codes = REPRES détectés par getRepresentantsCodes (facture.dbf).
    commerciauxScope: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
  },
);

permissionSchema.index({ user: 1 });

const Permission = mongoose.model("Permission", permissionSchema);

export default Permission;