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
    },
    allEntreprises: {
      type: Boolean,
      default: false,
    },
    allModules: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  },
);

permissionSchema.index({ user: 1 });

const Permission = mongoose.model("Permission", permissionSchema);

export default Permission;
