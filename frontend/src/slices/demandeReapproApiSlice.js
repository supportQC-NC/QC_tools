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
    deleteDemande: builder.mutation({
      query: (id) => ({ url: `${URL}/${id}`, method: "DELETE" }),
    }),
  }),
});

export const {
  useGetDemandesQuery,
  useCreateDemandesMutation,
  useDeleteDemandeMutation,
} = demandeReapproApiSlice;