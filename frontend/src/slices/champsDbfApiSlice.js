// src/slices/champsDbfApiSlice.js
import { apiSlice } from "./apiSlice";

const URL = "/api/champs-dbf";

export const champsDbfApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    // Catalogue des tables DBF restreignables.
    getDbfTables: builder.query({
      query: () => `${URL}/tables`,
      keepUnusedDataFor: 600,
    }),

    // Champs réels d'une table, lus dans le DBF de la société de référence.
    getDbfChamps: builder.query({
      query: ({ table, nomDossierDBF }) => ({
        url: `${URL}/${table}/champs`,
        params: nomDossierDBF ? { nomDossierDBF } : undefined,
      }),
      keepUnusedDataFor: 600,
    }),

    // Configuration d'un utilisateur.
    getChampsDbfUtilisateur: builder.query({
      query: (userId) => `${URL}/utilisateur/${userId}`,
      providesTags: (r, e, userId) => [{ type: "ChampsDbf", id: userId }],
    }),

    setChampsDbfUtilisateur: builder.mutation({
      query: ({ userId, champsDbf, nomDossierDBF }) => ({
        url: `${URL}/utilisateur/${userId}`,
        method: "PUT",
        body: { champsDbf, nomDossierDBF },
      }),
      invalidatesTags: (r, e, arg) => [{ type: "ChampsDbf", id: arg.userId }],
    }),
  }),
});

export const {
  useGetDbfTablesQuery,
  useGetDbfChampsQuery,
  useGetChampsDbfUtilisateurQuery,
  useSetChampsDbfUtilisateurMutation,
} = champsDbfApiSlice;
