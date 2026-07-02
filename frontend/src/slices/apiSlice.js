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
        // ========== TAGS PROFORMAS ==========
    "Fournisseurs",
    // ====================================
        // ========== TAGS Facture ==========
    "Factures",
    // ====================================
    "Collecteur",
    "AppRelease"
  ],
  endpoints: (builder) => ({}),
});