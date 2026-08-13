// frontend/src/slices/frequentationApiSlice.js
//
// Module « Fréquentation magasin » : agrégats horaires calculés depuis les
// factures éditées. L'export Excel se fait par fetch direct (blob) dans l'écran.
import { apiSlice } from "./apiSlice";

const URL = "/api/frequentation";
const CTX = "/api/frequentation-contexte";

export const frequentationApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    // ── Analyse ──────────────────────────────────────────────────────────────
    getFrequentation: builder.query({
      query: ({ nomDossierDBF, du, au, pas, jour }) => ({
        url: `${URL}/${nomDossierDBF}`,
        params: { du, au, pas, ...(jour === null || jour === undefined ? {} : { jour }) },
      }),
      providesTags: ["Frequentation"],
    }),

    // ── Vacances scolaires ───────────────────────────────────────────────────
    getVacances: builder.query({
      query: () => `${CTX}/vacances`,
      providesTags: ["FrequentationVacances"],
    }),
    createVacances: builder.mutation({
      query: (body) => ({ url: `${CTX}/vacances`, method: "POST", body }),
      invalidatesTags: ["FrequentationVacances", "Frequentation"],
    }),
    updateVacances: builder.mutation({
      query: ({ id, ...body }) => ({
        url: `${CTX}/vacances/${id}`,
        method: "PUT",
        body,
      }),
      invalidatesTags: ["FrequentationVacances", "Frequentation"],
    }),
    deleteVacances: builder.mutation({
      query: (id) => ({ url: `${CTX}/vacances/${id}`, method: "DELETE" }),
      invalidatesTags: ["FrequentationVacances", "Frequentation"],
    }),

    // ── Événements spéciaux ──────────────────────────────────────────────────
    getEvenementTypes: builder.query({
      query: () => `${CTX}/evenements/types`,
    }),
    getEvenements: builder.query({
      query: () => `${CTX}/evenements`,
      providesTags: ["FrequentationEvenements"],
    }),
    createEvenement: builder.mutation({
      query: (body) => ({ url: `${CTX}/evenements`, method: "POST", body }),
      invalidatesTags: ["FrequentationEvenements", "Frequentation"],
    }),
    updateEvenement: builder.mutation({
      query: ({ id, ...body }) => ({
        url: `${CTX}/evenements/${id}`,
        method: "PUT",
        body,
      }),
      invalidatesTags: ["FrequentationEvenements", "Frequentation"],
    }),
    deleteEvenement: builder.mutation({
      query: (id) => ({ url: `${CTX}/evenements/${id}`, method: "DELETE" }),
      invalidatesTags: ["FrequentationEvenements", "Frequentation"],
    }),
    // Génère les jours fériés NC d'une année (idempotent).
    genererFeries: builder.mutation({
      query: (body) => ({
        url: `${CTX}/evenements/feries`,
        method: "POST",
        body,
      }),
      invalidatesTags: ["FrequentationEvenements", "Frequentation"],
    }),

    // ── Météo ────────────────────────────────────────────────────────────────
    getMeteo: builder.query({
      query: ({ lieu, du, au }) => ({ url: `${CTX}/meteo`, params: { lieu, du, au } }),
      providesTags: ["FrequentationMeteo"],
    }),
    collecterMeteo: builder.mutation({
      query: (body) => ({ url: `${CTX}/meteo/collecte`, method: "POST", body }),
      invalidatesTags: ["FrequentationMeteo", "Frequentation"],
    }),
    updateMeteoJour: builder.mutation({
      query: ({ lieu, date, ...body }) => ({
        url: `${CTX}/meteo/${lieu}/${date}`,
        method: "PUT",
        body,
      }),
      invalidatesTags: ["FrequentationMeteo", "Frequentation"],
    }),
    deverrouillerMeteoJour: builder.mutation({
      query: ({ lieu, date }) => ({
        url: `${CTX}/meteo/${lieu}/${date}/verrou`,
        method: "DELETE",
      }),
      invalidatesTags: ["FrequentationMeteo", "Frequentation"],
    }),
  }),
});

export const {
  useGetFrequentationQuery,
  useLazyGetFrequentationQuery,
  useGetVacancesQuery,
  useCreateVacancesMutation,
  useUpdateVacancesMutation,
  useDeleteVacancesMutation,
  useGetEvenementTypesQuery,
  useGetEvenementsQuery,
  useCreateEvenementMutation,
  useUpdateEvenementMutation,
  useDeleteEvenementMutation,
  useGenererFeriesMutation,
  useGetMeteoQuery,
  useCollecterMeteoMutation,
  useUpdateMeteoJourMutation,
  useDeverrouillerMeteoJourMutation,
} = frequentationApiSlice;
