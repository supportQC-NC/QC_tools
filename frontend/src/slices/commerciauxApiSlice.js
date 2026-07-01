// src/slices/commerciauxApiSlice.js
import { apiSlice } from "./apiSlice";

const COMMERCIAUX_URL = "/api/commerciaux";

export const commerciauxApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    // Liste des commerciaux + KPI agrégés
    getCommerciaux: builder.query({
      query: (nomDossierDBF) => ({
        url: `${COMMERCIAUX_URL}/${nomDossierDBF}`,
      }),
      keepUnusedDataFor: 120,
    }),

    // Détail d'un commercial (clients + comparaison portefeuille + mensuel)
    getCommercialDetail: builder.query({
      query: ({ nomDossierDBF, code }) => ({
        url: `${COMMERCIAUX_URL}/${nomDossierDBF}/${code}`,
      }),
      keepUnusedDataFor: 120,
    }),

    // Analyse complète avec clients (export Excel global) — chargée à la demande
    getCommerciauxFull: builder.query({
      query: (nomDossierDBF) => ({
        url: `${COMMERCIAUX_URL}/${nomDossierDBF}/full`,
      }),
      keepUnusedDataFor: 60,
    }),

    // Invalide le cache serveur
    refreshCommerciaux: builder.mutation({
      query: (nomDossierDBF) => ({
        url: `${COMMERCIAUX_URL}/${nomDossierDBF}/refresh`,
        method: "POST",
      }),
    }),
  }),
});

export const {
  useGetCommerciauxQuery,
  useGetCommercialDetailQuery,
  useLazyGetCommerciauxFullQuery,
  useRefreshCommerciauxMutation,
} = commerciauxApiSlice;