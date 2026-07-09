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
      // ══════════ GESTION (utilisateur + écrans données admin partagés) ══════════
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
      // Proformas
      proforma: {
        read: { type: Boolean, default: false },
        write: { type: Boolean, default: false },
        delete: { type: Boolean, default: false },
      },
      // Contrôle Commandes
      ctr_commande: {
        read: { type: Boolean, default: false },
        write: { type: Boolean, default: false },
        delete: { type: Boolean, default: false },
      },
      // Réception marchandises
      reception: {
        read: { type: Boolean, default: false },
        write: { type: Boolean, default: false },
        delete: { type: Boolean, default: false },
      },
      // Préparation Commandes
      prep_commande: {
        read: { type: Boolean, default: false },
        write: { type: Boolean, default: false },
        delete: { type: Boolean, default: false },
      },
      // Contrôle Infos Produit
      ctrl_info_produit: {
        read: { type: Boolean, default: false },
        write: { type: Boolean, default: false },
        delete: { type: Boolean, default: false },
      },
      // Relevé de prix
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
      // ══════════ DONNÉES (écrans admin) ══════════
      // Clients
      client: {
        read: { type: Boolean, default: false },
        write: { type: Boolean, default: false },
        delete: { type: Boolean, default: false },
      },
      // Commandes
      commandes: {
        read: { type: Boolean, default: false },
        write: { type: Boolean, default: false },
        delete: { type: Boolean, default: false },
      },
      // Factures
      facture: {
        read: { type: Boolean, default: false },
        write: { type: Boolean, default: false },
        delete: { type: Boolean, default: false },
      },
      // Bipages
      bipage: {
        read: { type: Boolean, default: false },
        write: { type: Boolean, default: false },
        delete: { type: Boolean, default: false },
      },
      // Concurrents
      concurrents: {
        read: { type: Boolean, default: false },
        write: { type: Boolean, default: false },
        delete: { type: Boolean, default: false },
      },
      // Inventaire Proforma
      inventaire_proforma_admin: {
        read: { type: Boolean, default: false },
        write: { type: Boolean, default: false },
        delete: { type: Boolean, default: false },
      },
      // Fiches de contrôle
      fiches_controle_admin: {
        read: { type: Boolean, default: false },
        write: { type: Boolean, default: false },
        delete: { type: Boolean, default: false },
      },
      // ══════════ ANALYSE (écrans admin) ══════════
      // Analyse Commerciaux
      commerciaux_admin: {
        read: { type: Boolean, default: false },
        write: { type: Boolean, default: false },
        delete: { type: Boolean, default: false },
      },
      // Analyse Filiales
      filiales_admin: {
        read: { type: Boolean, default: false },
        write: { type: Boolean, default: false },
        delete: { type: Boolean, default: false },
      },
      // Reappro Local
      reappro_local_admin: {
        read: { type: Boolean, default: false },
        write: { type: Boolean, default: false },
        delete: { type: Boolean, default: false },
      },
      // Débit / Comptant
      debit_comptant_admin: {
        read: { type: Boolean, default: false },
        write: { type: Boolean, default: false },
        delete: { type: Boolean, default: false },
      },
      // Doublons GENCODE
      gencod_doublons_admin: {
        read: { type: Boolean, default: false },
        write: { type: Boolean, default: false },
        delete: { type: Boolean, default: false },
      },
      // Analyse CA
      analyse_ca_admin: {
        read: { type: Boolean, default: false },
        write: { type: Boolean, default: false },
        delete: { type: Boolean, default: false },
      },
      // Performance Dock
      performance_dock_admin: {
        read: { type: Boolean, default: false },
        write: { type: Boolean, default: false },
        delete: { type: Boolean, default: false },
      },
      // Collecteurs
      collecteurs_admin: {
        read: { type: Boolean, default: false },
        write: { type: Boolean, default: false },
        delete: { type: Boolean, default: false },
      },
      // ══════════ ADMINISTRATION (dashboard, users, entreprises) ══════════
      // Tableau de bord
      dashboard_admin: {
        read: { type: Boolean, default: false },
        write: { type: Boolean, default: false },
        delete: { type: Boolean, default: false },
      },
      // Utilisateurs
      users_admin: {
        read: { type: Boolean, default: false },
        write: { type: Boolean, default: false },
        delete: { type: Boolean, default: false },
      },
      // Entreprises
      entreprises_admin: {
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