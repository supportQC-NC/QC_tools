// src/slices/analyseCaMensuelleApiSlice.js
//
// Analyse CA MENSUELLE : classeurs Excel du Rcommun (STOCK/doc_temp/CA_MENSUELLE),
// un par société et par mois. Lecture seule, cache serveur sur mtime.

import { apiSlice } from "./apiSlice";

const URL = "/api/analyse-ca-mensuelle";

export const analyseCaMensuelleApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    // Sociétés du périmètre ayant au moins un classeur + périodes disponibles.
    getAnalyseCaMensuelleSources: builder.query({
      query: () => ({ url: URL }),
      keepUnusedDataFor: 300,
    }),

    // Classeur complet d'une société pour une période (défaut : la plus récente).
    getAnalyseCaMensuelleClasseur: builder.query({
      query: ({ nomDossierDBF, periode }) => ({
        url: `${URL}/societe/${nomDossierDBF}`,
        params: periode ? { periode } : undefined,
      }),
      keepUnusedDataFor: 120,
    }),
  }),
});

export const {
  useGetAnalyseCaMensuelleSourcesQuery,
  useGetAnalyseCaMensuelleClasseurQuery,
} = analyseCaMensuelleApiSlice;
