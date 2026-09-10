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
    // Suivi : une ligne par demande + compteurs. Le serveur agrège, il ne
    // renvoie jamais les tableaux d'articles (une demande « groupe » peut en
    // porter plusieurs milliers).
    getSuiviDemandesBipage: builder.query({
      query: ({ nomDossierDBF, statut, jours }) => ({
        url: `${URL}/${nomDossierDBF}/suivi`,
        params: {
          ...(statut ? { statut } : {}),
          ...(jours !== undefined ? { jours } : {}),
        },
      }),
      keepUnusedDataFor: 30,
    }),
    // Détail d'un bipage (articles bipés), demande OU bipage libre.
    getLignesBipage: builder.query({
      query: ({ nomDossierDBF, type, id }) =>
        `${URL}/${nomDossierDBF}/suivi/${type}/${id}/lignes`,
      keepUnusedDataFor: 15,
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
    createDemandeBipageGroupe: builder.mutation({
      query: ({
        nomDossierDBF,
        groupes,
        avecStockSeulement,
        priorite,
        commentaire,
      }) => ({
        url: `${URL}/${nomDossierDBF}/groupe`,
        method: "POST",
        body: { groupes, avecStockSeulement, priorite, commentaire },
      }),
    }),
    createDemandeBipagePanier: builder.mutation({
      // `libelle` : une sélection venue de la liste « rayon vide » doit se
      // reconnaître sur le collecteur, pas s'appeler « Sélection manuelle ».
      query: ({ nomDossierDBF, articles, priorite, commentaire, libelle }) => ({
        url: `${URL}/${nomDossierDBF}/panier`,
        method: "POST",
        body: { articles, priorite, commentaire, libelle },
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
  useGetSuiviDemandesBipageQuery,
  useLazyGetLignesBipageQuery,
  useCreateDemandeBipageProformaMutation,
  useCreateDemandeBipageGisementMutation,
  useCreateDemandeBipageGroupeMutation,
  useCreateDemandeBipagePanierMutation,
  useLazyGetArticleBipageQuery,
  useDeleteDemandeBipageMutation,
} = demandeBipageApiSlice;
