// src/slices/debitComptantApiSlice.js
import { apiSlice } from "./apiSlice";

const URL = "/api/debit-comptant";

export const debitComptantApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getDebitComptant: builder.query({
      query: ({ nomDossierDBF, dateFin, nbJours }) => ({
        url: `${URL}/${nomDossierDBF}`,
        params: { dateFin, nbJours },
      }),
      keepUnusedDataFor: 120,
    }),
    refreshDebitComptant: builder.mutation({
      query: (nomDossierDBF) => ({
        url: `${URL}/${nomDossierDBF}/refresh`,
        method: "POST",
      }),
    }),
  }),
});

export const { useGetDebitComptantQuery, useRefreshDebitComptantMutation } =
  debitComptantApiSlice;