// src/slices/derniereFacturationApiSlice.js
// Clients de la société + date de leur dernière facture.
import { apiSlice } from "./apiSlice";

const URL = "/api/derniere-facturation";

export const derniereFacturationApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getDerniereFacturation: builder.query({
      query: (nomDossierDBF) => ({ url: `${URL}/${nomDossierDBF}` }),
      // L'index facture côté serveur vit 10 min : inutile de refaire l'aller-retour
      // à chaque retour sur l'écran.
      keepUnusedDataFor: 300,
    }),
    refreshDerniereFacturation: builder.mutation({
      query: (nomDossierDBF) => ({
        url: `${URL}/${nomDossierDBF}/refresh`,
        method: "POST",
      }),
    }),
  }),
});

export const {
  useGetDerniereFacturationQuery,
  useRefreshDerniereFacturationMutation,
} = derniereFacturationApiSlice;
