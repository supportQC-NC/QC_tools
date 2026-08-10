// src/slices/dashboardLayoutApiSlice.js
import { apiSlice } from "./apiSlice";

const URL = "/api/dashboard-layout";

export const dashboardLayoutApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    // Widgets + datasets RÉELLEMENT autorisés pour l'utilisateur connecté.
    getDashboardCatalogue: builder.query({
      query: () => `${URL}/catalogue`,
      providesTags: [{ type: "DashboardLayout", id: "CATALOGUE" }],
      keepUnusedDataFor: 600,
    }),

    // Ma disposition (par défaut tant que je n'ai rien composé).
    getMonDashboard: builder.query({
      query: () => `${URL}/me`,
      providesTags: [{ type: "DashboardLayout", id: "ME" }],
    }),

    setMonDashboard: builder.mutation({
      query: (blocs) => ({ url: `${URL}/me`, method: "PUT", body: { blocs } }),
      invalidatesTags: [{ type: "DashboardLayout", id: "ME" }],
    }),

    resetMonDashboard: builder.mutation({
      query: () => ({ url: `${URL}/me`, method: "DELETE" }),
      invalidatesTags: [{ type: "DashboardLayout", id: "ME" }],
    }),

    // Valeurs des tuiles KPI. Non mis en cache par tag : la société active
    // change la réponse, on passe donc nomDossierDBF dans le corps.
    evaluerKpis: builder.query({
      query: ({ blocs, nomDossierDBF }) => ({
        url: `${URL}/evaluer`,
        method: "POST",
        body: { blocs, nomDossierDBF },
      }),
      keepUnusedDataFor: 60,
    }),
  }),
});

export const {
  useGetDashboardCatalogueQuery,
  useGetMonDashboardQuery,
  useSetMonDashboardMutation,
  useResetMonDashboardMutation,
  useEvaluerKpisQuery,
} = dashboardLayoutApiSlice;
