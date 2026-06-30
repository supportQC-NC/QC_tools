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
  }),
});

export const {
  useGetGlobalDashboardQuery,
  useGetEntrepriseDashboardQuery,
} = dashboardApiSlice;