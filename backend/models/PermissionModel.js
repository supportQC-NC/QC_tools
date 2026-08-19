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
      // Listes de réappro (création, suivi, préparation collecteur)
      demande_reappro: {
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
      // Contrôle réception MANUEL (fiches papier à remplir à la main)
      reception_manuelle: {
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
      // Envoi Commande Fournisseur (envoi par email des commandes préparées)
      envoi_cde_fournisseur: {
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
      // Changement de prix de vente (verif.dbf : rapport + étiquettes)
      changement_prix: {
        read: { type: Boolean, default: false },
        write: { type: Boolean, default: false },
        delete: { type: Boolean, default: false },
      },
      // Historique prix d'achat (évolution du PACHAT par article, source commandes)
      historique_pachat: {
        read: { type: Boolean, default: false },
        write: { type: Boolean, default: false },
        delete: { type: Boolean, default: false },
      },
      // Édition Promo
      edition_promo: {
        read: { type: Boolean, default: false },
        write: { type: Boolean, default: false },
        delete: { type: Boolean, default: false },
      },
      // Mailing clients
      mailing: {
        read: { type: Boolean, default: false },
        write: { type: Boolean, default: false },
        delete: { type: Boolean, default: false },
      },
      // Communication client (catalogue nouveautés envoyé aux abonnés newsletter)
      communication_client: {
        read: { type: Boolean, default: false },
        write: { type: Boolean, default: false },
        delete: { type: Boolean, default: false },
      },
      // Assistant IA (chat métier branché sur les données DBF/Mongo)
      assistant_ia: {
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
      // Suivi des entrées (entrees.dbf : marchandises reçues du jour)
      suivi_entrees: {
        read: { type: Boolean, default: false },
        write: { type: Boolean, default: false },
        delete: { type: Boolean, default: false },
      },
      // Entrées sur réservation (articles réservés qui entrent en stock)
      resa_entrees: {
        read: { type: Boolean, default: false },
        write: { type: Boolean, default: false },
        delete: { type: Boolean, default: false },
      },
      // ══════════ COMMERCIAUX (boîte à outils commerciale — accès global) ══════════
      commerciaux_outils: {
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
      // Rapports TGC mensuels (déclaration fiscale depuis facture/detail.dbf)
      rapport_tgc: {
        read: { type: Boolean, default: false },
        write: { type: Boolean, default: false },
        delete: { type: Boolean, default: false },
      },
      // Fréquentation magasin (plages horaires depuis les factures éditées)
      frequentation_admin: {
        read: { type: Boolean, default: false },
        write: { type: Boolean, default: false },
        delete: { type: Boolean, default: false },
      },
      // Balances / clients à bloquer (encours depuis balances.dbf)
      balances_clients: {
        read: { type: Boolean, default: false },
        write: { type: Boolean, default: false },
        delete: { type: Boolean, default: false },
      },
      // Export Gisements (outil d'export Excel GISM1..GISM5)
      export_gisements_admin: {
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
      // Infobulles menu (édition des textes au survol des onglets)
      infobulles_admin: {
        read: { type: Boolean, default: false },
        write: { type: Boolean, default: false },
        delete: { type: Boolean, default: false },
      },
      // Paramètres Email / SMTP (global + par module)
      smtp_admin: {
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
    // ══════════ ANALYSE — droit d'accès PAR ÉCRAN d'analyse ══════════
    // Objet clé -> booléen (ex: { commerciaux: true, topArticles: false, ... }).
    // Cas particulier `filiales` : objet { DQ, QC, LD } (accès par réseau).
    // Voir middleware/accessControl.js (ANALYSE_KEYS, hasAnalyseAccess). Mixed
    // car hétérogène (booléens + sous-objet filiales) et lu par accès direct.
    analyse: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
    // ══════════ COMMERCIAUX — codes autorisés PAR ENTREPRISE ══════════
    // Objet entrepriseId(string) -> tableau de codes commerciaux (strings).
    // Voir middleware/accessControl.js (getCommerciauxCodes).
    commerciauxScope: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
    // ══════════ PROFIL COMMERCIAL — espace dédié « mes clients » ══════════
    // Un utilisateur marqué commercial accède à /commercial/* : son dashboard,
    // son portefeuille clients, ses proformas, réservations, commandes spéciales.
    // Le rattachement est le couple SOCIÉTÉ + CODE VENDEUR (REPRES) : un même
    // commercial a un code DIFFÉRENT selon la société (QC=12, KQ=08, DQ=15...).
    // Plusieurs codes pour une même société sont autorisés (une ligne par code).
    // Toutes les données de l'espace sont filtrées sur ce couple — jamais sur le
    // seul code (voir middleware/commercialAccess.js).
    commercial: {
      actif: { type: Boolean, default: false },
      codes: {
        type: [
          new mongoose.Schema(
            {
              entreprise: {
                type: mongoose.Schema.Types.ObjectId,
                ref: "Entreprise",
                required: true,
              },
              code: { type: String, trim: true, default: "" },
            },
            { _id: false },
          ),
        ],
        default: () => [],
      },
    },
    // ══════════ CHAMPS DBF VISIBLES — par table de l'ERP ══════════
    // Objet table(string) -> { mode: "tous" | "liste", champs: [String] }.
    //   "tous"  : aucune restriction (défaut, comportement historique)
    //   "liste" : SEULS les champs listés sont renvoyés à cet utilisateur
    // Tables déclarées dans config/dbfTables.js.
    //
    // ATTENTION : le masquage s'applique PAR NOM DE CHAMP sur toutes les
    // réponses de l'API (voir middleware/masquerChampsDbf.js). Un champ retiré
    // sur une table est donc masqué partout où ce nom apparaît — le filtrage
    // est volontairement plus strict que fin, pour ne jamais laisser fuir une
    // donnée par un écran oublié.
    champsDbf: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
  },
  {
    timestamps: true,
  },
);

permissionSchema.index({ user: 1 });

const Permission = mongoose.model("Permission", permissionSchema);

export default Permission;