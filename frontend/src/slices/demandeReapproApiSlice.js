// src/slices/demandeReapproApiSlice.js
import { apiSlice } from "./apiSlice";

const URL = "/api/demande-reappro";

export const demandeReapproApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getDemandes: builder.query({
      query: ({ nomDossierDBF, statut }) => ({
        url: `${URL}/${nomDossierDBF}`,
        params: statut ? { statut } : undefined,
      }),
      keepUnusedDataFor: 30,
    }),
    createDemandes: builder.mutation({
      query: ({ nomDossierDBF, gisements, priorite, commentaire }) => ({
        url: `${URL}/${nomDossierDBF}`,
        method: "POST",
        body: { gisements, priorite, commentaire },
      }),
    }),
    createDemandePanier: builder.mutation({
      query: ({ nomDossierDBF, articles, priorite, commentaire }) => ({
        url: `${URL}/${nomDossierDBF}/panier`,
        method: "POST",
        body: { articles, priorite, commentaire },
      }),
    }),
    getArticleReappro: builder.query({
      query: ({ nomDossierDBF, nart }) => ({
        url: `${URL}/${nomDossierDBF}/article/${encodeURIComponent(nart)}`,
      }),
    }),
    deleteDemande: builder.mutation({
      query: (id) => ({ url: `${URL}/${id}`, method: "DELETE" }),
    }),
  }),
});

export const {
  useGetDemandesQuery,
  useCreateDemandesMutation,
  useCreateDemandePanierMutation,
  useLazyGetArticleReapproQuery,
  useDeleteDemandeMutation,
} = demandeReapproApiSlice;