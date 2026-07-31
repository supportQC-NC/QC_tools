// src/slices/demandeBipageApiSlice.js
import { apiSlice } from "./apiSlice";

const URL = "/api/demande-bipage";

export const demandeBipageApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getDemandesBipage: builder.query({
      query: ({ nomDossierDBF, statut }) => ({
        url: `${URL}/${nomDossierDBF}`,
        params: statut ? { statut } : undefined,
      }),
      keepUnusedDataFor: 30,
    }),
    createDemandeBipageProforma: builder.mutation({
      query: ({ nomDossierDBF, numpro, priorite, commentaire }) => ({
        url: `${URL}/${nomDossierDBF}/proforma`,
        method: "POST",
        body: { numpro, priorite, commentaire },
      }),
    }),
    createDemandeBipageGisement: builder.mutation({
      query: ({ nomDossierDBF, gisements, priorite, commentaire }) => ({
        url: `${URL}/${nomDossierDBF}/gisement`,
        method: "POST",
        body: { gisements, priorite, commentaire },
      }),
    }),
    createDemandeBipagePanier: builder.mutation({
      query: ({ nomDossierDBF, articles, priorite, commentaire }) => ({
        url: `${URL}/${nomDossierDBF}/panier`,
        method: "POST",
        body: { articles, priorite, commentaire },
      }),
    }),
    getArticleBipage: builder.query({
      query: ({ nomDossierDBF, nart }) => ({
        url: `${URL}/${nomDossierDBF}/article/${encodeURIComponent(nart)}`,
      }),
    }),
    deleteDemandeBipage: builder.mutation({
      query: (id) => ({ url: `${URL}/${id}`, method: "DELETE" }),
    }),
  }),
});

export const {
  useGetDemandesBipageQuery,
  useCreateDemandeBipageProformaMutation,
  useCreateDemandeBipageGisementMutation,
  useCreateDemandeBipagePanierMutation,
  useLazyGetArticleBipageQuery,
  useDeleteDemandeBipageMutation,
} = demandeBipageApiSlice;
