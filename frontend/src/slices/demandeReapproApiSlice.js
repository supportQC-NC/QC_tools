// src/slices/demandeReapproApiSlice.js
import { apiSlice } from "./apiSlice";

const URL = "/api/demande-reappro";

export const demandeReapproApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    // jours : fenêtre d'affichage (défaut serveur 15 j, 0 = tout l'historique)
    getDemandes: builder.query({
      query: ({ nomDossierDBF, statut, jours }) => ({
        url: `${URL}/${nomDossierDBF}`,
        params: {
          ...(statut ? { statut } : {}),
          ...(jours === undefined ? {} : { jours }),
        },
      }),
      providesTags: ["DemandeReappro"],
      keepUnusedDataFor: 30,
    }),
    getDemandeDetail: builder.query({
      query: (id) => ({ url: `${URL}/detail/${id}` }),
      providesTags: ["DemandeReappro"],
    }),
    createDemandes: builder.mutation({
      query: ({ nomDossierDBF, gisements, priorite, commentaire }) => ({
        url: `${URL}/${nomDossierDBF}`,
        method: "POST",
        body: { gisements, priorite, commentaire },
      }),
      invalidatesTags: ["DemandeReappro"],
    }),
    createDemandePanier: builder.mutation({
      query: ({ nomDossierDBF, articles, nom, rayon, priorite, commentaire }) => ({
        url: `${URL}/${nomDossierDBF}/panier`,
        method: "POST",
        body: { articles, nom, rayon, priorite, commentaire },
      }),
      invalidatesTags: ["DemandeReappro"],
    }),
    getArticleReappro: builder.query({
      query: ({ nomDossierDBF, nart }) => ({
        url: `${URL}/${nomDossierDBF}/article/${encodeURIComponent(nart)}`,
      }),
    }),
    // Performances de préparation par opérateur, sur une période.
    getStatsPreparateurs: builder.query({
      query: ({ nomDossierDBF, debut, fin }) => ({
        url: `${URL}/${nomDossierDBF}/stats`,
        params: { ...(debut ? { debut } : {}), ...(fin ? { fin } : {}) },
      }),
      providesTags: ["DemandeReappro"],
    }),
    // Déclenche tout de suite le balayage des proformas « reappro »
    // (le job serveur le fait aussi toutes les heures).
    importerProformas: builder.mutation({
      query: (nomDossierDBF) => ({
        url: `${URL}/${nomDossierDBF}/import-proformas`,
        method: "POST",
      }),
      invalidatesTags: ["DemandeReappro"],
    }),
    updateUrgenceDemande: builder.mutation({
      query: ({ id, priorite }) => ({
        url: `${URL}/${id}/urgence`,
        method: "PATCH",
        body: { priorite },
      }),
      invalidatesTags: ["DemandeReappro"],
    }),
    updateDemande: builder.mutation({
      query: ({ id, ...body }) => ({
        url: `${URL}/${id}`,
        method: "PATCH",
        body,
      }),
      invalidatesTags: ["DemandeReappro"],
    }),
    deleteDemande: builder.mutation({
      query: (id) => ({ url: `${URL}/${id}`, method: "DELETE" }),
      invalidatesTags: ["DemandeReappro"],
    }),
  }),
});

export const {
  useGetDemandesQuery,
  useGetDemandeDetailQuery,
  useLazyGetDemandeDetailQuery,
  useCreateDemandesMutation,
  useCreateDemandePanierMutation,
  useLazyGetArticleReapproQuery,
  useGetStatsPreparateursQuery,
  useImporterProformasMutation,
  useUpdateUrgenceDemandeMutation,
  useUpdateDemandeMutation,
  useDeleteDemandeMutation,
} = demandeReapproApiSlice;
