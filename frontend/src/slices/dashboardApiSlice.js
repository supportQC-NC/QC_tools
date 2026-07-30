// src/slices/dashboardApiSlice.js
import { apiSlice } from "./apiSlice";

const DASHBOARD_URL = "/api/dashboard";

export const dashboardApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    // KPI globaux (Mongo, toutes entreprises)
    getGlobalDashboard: builder.query({
      query: () => `${DASHBOARD_URL}/global`,
    }),
    // KPI d'une entreprise (DBF)
    getEntrepriseDashboard: builder.query({
      query: (nomDossierDBF) => `${DASHBOARD_URL}/entreprise/${nomDossierDBF}`,
    }),
    // Mon tableau de bord personnel (tout utilisateur connecté)
    getMyDashboard: builder.query({
      query: () => `${DASHBOARD_URL}/me`,
    }),
    // CA / meilleures ventes (snapshot) — réservé à l'analyse CA
    getCaDashboard: builder.query({
      query: (nomDossierDBF) => `${DASHBOARD_URL}/ca/${nomDossierDBF}`,
    }),
    // Comparaison CA entre sociétés — réservé à l'analyse CA
    getCaComparaison: builder.query({
      query: () => `${DASHBOARD_URL}/ca-comparaison`,
    }),
  }),
});

export const {
  useGetGlobalDashboardQuery,
  useGetEntrepriseDashboardQuery,
  useGetMyDashboardQuery,
  useGetCaDashboardQuery,
  useGetCaComparaisonQuery,
} = dashboardApiSlice;