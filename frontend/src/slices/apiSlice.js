// src/slices/apiSlice.js
import { createApi, fetchBaseQuery } from "@reduxjs/toolkit/query/react";
import { BASE_URL } from "../constants";

export const apiSlice = createApi({
  baseQuery: fetchBaseQuery({
    baseUrl: BASE_URL,
    credentials: "include", // Important pour les cookies JWT
  }),
  tagTypes: [
    "User",
    "Entreprise",
    "Article",
    "Inventaire",
    "Zone",
    "InventaireZone",
    "FicheControle",
    "Surveillance",
    "Bipage",
    "Reappro",
    "ArticlePhoto",
    "Filiale",
    "Concurrent",
    "Releve",
    // ========== TAGS COMMANDES ==========
    "Commande",
    "CommandeDetail",
    // ====================================
    // ========== TAGS PROFORMAS ==========
    "Proforma",
    // ====================================
    // ========== TAGS FOURNISSEURS ==========
    "Fournisseurs",
    // ====================================
    // ========== TAGS FACTURE ==========
    "Factures",
    // ====================================
    "Collecteur",
    "AppRelease",
    // ========== TAGS ABONNEMENTS RAPPORTS ==========
    "ReportSubscription",
    // ========== TAGS ÉQUIPES ==========
    "Team",
    // ========== TAGS TÂCHES ==========
    "Task",
    // ========== TAGS EXÉCUTABLES ==========
    "Executable",
    // ========== TAGS NOTIFICATIONS (badges sidebar) ==========
    "Notif",
    // ========== TAGS CONVERSATIONS (Espace équipe) ==========
    "Conversation",
    // ========== TAGS MAILING ==========
    "MailCampaign",
    "MailSegment",
    "MailAutomation",
    "MailTemplate",
    // ========== TAGS ÉTIQUETTES ==========
    "EtiquetteTemplate",
    // ========== TAGS CHANGEMENT DE PRIX ==========
    "ChangementPrix",
    // ========== TAGS SUIVI DES ENTREES ==========
    "SuiviEntrees",
    // ========== TAGS ENTREES SUR RESERVATION ==========
    "ResaEntrees",
    // ========== TAGS RAPPORT TGC ==========
    "RapportTgc",
    // ========== TAGS BALANCES CLIENTS ==========
    "Balances",
    // ========== TAGS COMMUNICATION CLIENT (nouveautés) ==========
    "Nouveautes",
    // ========== TAGS CONFIG RAPPORTS (master report) ==========
    "ConfigRapports",
    // ========== TAGS ASSISTANT IA ==========
    "AiConversation",
    // ========== TAGS ENVOI CDE FOURNISSEUR ==========
    "EnvoiCdeCommande",
    "FournisseurEmail",
    "MessageFournisseur",
    "ResponsableCc",
    "EnvoiCdeHistorique",
    "EnvoiCdeParametre",
    // ========== TAGS COMMERCIAUX ==========
    "TopVentes",
    // ========== TAGS INFOBULLES MENU ==========
    "MenuHint",
    "MenuLayout",
    "MyMenuLayout",
    "SmtpConfig",
  ],
  endpoints: (builder) => ({}),
});