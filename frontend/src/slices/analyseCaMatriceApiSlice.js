// src/slices/analyseCaMatriceApiSlice.js
//
// Analyse CA sur MATRICES Excel (Rcommun STOCK/doc_temp/CA). Lecture seule : les
// fichiers sont régénérés chaque jour côté serveur de fichiers, le backend
// les recharge sur mtime — un keepUnusedDataFor court suffit.

import { apiSlice } from "./apiSlice";

const URL = "/api/analyse-ca-matrices";

export const analyseCaMatriceApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    // Sources disponibles (sociétés du périmètre + groupes si admin).
    getAnalyseCaMatriceSources: builder.query({
      query: () => ({ url: URL }),
      keepUnusedDataFor: 300,
    }),

    // Matrice complète d'une société.
    getAnalyseCaMatriceSociete: builder.query({
      query: ({ nomDossierDBF, annee }) => ({
        url: `${URL}/societe/${nomDossierDBF}`,
        params: annee ? { annee } : undefined,
      }),
      keepUnusedDataFor: 120,
    }),

    // Matrice complète d'un groupe consolidé (admin).
    getAnalyseCaMatriceGroupe: builder.query({
      query: ({ groupeId, annee }) => ({
        url: `${URL}/groupe/${groupeId}`,
        params: annee ? { annee } : undefined,
      }),
      keepUnusedDataFor: 120,
    }),
  }),
});

export const {
  useGetAnalyseCaMatriceSourcesQuery,
  useGetAnalyseCaMatriceSocieteQuery,
  useGetAnalyseCaMatriceGroupeQuery,
} = analyseCaMatriceApiSlice;
