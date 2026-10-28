// src/slices/statsCommerciauxApiSlice.js
//
// Stats commerciaux : classeurs stats_<TRIG>.xlsx du FTPS robot-documents
// (un par société, régénérés chaque soir). Lecture seule, cache serveur mtime.

import { apiSlice } from "./apiSlice";

const URL = "/api/stats-commerciaux";

export const statsCommerciauxApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    // Sociétés du périmètre ayant un classeur stats.
    getStatsCommerciauxSources: builder.query({
      query: () => ({ url: URL }),
      keepUnusedDataFor: 300,
    }),

    // Synthèse société : totaux + agrégats par commercial + catégories.
    getStatsCommerciauxSynthese: builder.query({
      query: ({ nomDossierDBF }) => ({ url: `${URL}/societe/${nomDossierDBF}` }),
      keepUnusedDataFor: 120,
    }),

    // Portefeuille clients d'un commercial ("GLOBAL" = toute la société).
    getStatsCommerciauxClients: builder.query({
      query: ({ nomDossierDBF, commercial }) => ({
        url: `${URL}/societe/${nomDossierDBF}/clients`,
        params: { commercial },
      }),
      keepUnusedDataFor: 120,
    }),
  }),
});

export const {
  useGetStatsCommerciauxSourcesQuery,
  useGetStatsCommerciauxSyntheseQuery,
  useGetStatsCommerciauxClientsQuery,
} = statsCommerciauxApiSlice;
