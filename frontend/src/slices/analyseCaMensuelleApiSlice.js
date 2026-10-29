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

    // Résolution désignation -> NART (Top 3 promos cliquable vers la fiche
    // article). POST pour passer un lot de désignations, mais sémantique de
    // lecture : on le déclare en query pour profiter du cache RTK.
    resoudreNartsMensuelle: builder.query({
      query: ({ nomDossierDBF, designations }) => ({
        url: `${URL}/societe/${nomDossierDBF}/narts`,
        method: "POST",
        body: { designations },
      }),
      keepUnusedDataFor: 300,
    }),
  }),
});

export const {
  useGetAnalyseCaMensuelleSourcesQuery,
  useGetAnalyseCaMensuelleClasseurQuery,
  useResoudreNartsMensuelleQuery,
} = analyseCaMensuelleApiSlice;
