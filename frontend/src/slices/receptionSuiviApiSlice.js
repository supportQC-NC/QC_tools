// src/slices/receptionSuiviApiSlice.js
import { apiSlice } from "./apiSlice";

export const receptionSuiviApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    // Même source que le module Réception mobile (commandes ETAT >= 4).
    getCommandesAControler: builder.query({
      query: (nomDossierDBF) => ({
        url: `/api/receptions/a-controler/${nomDossierDBF}`,
        params: { limit: 300 },
      }),
      keepUnusedDataFor: 30,
    }),
    // Progression des contrôles en cours (indexée par numcde) à superposer.
    getReceptionProgress: builder.query({
      query: (nomDossierDBF) => ({
        url: `/api/reception-suivi/progress/${nomDossierDBF}`,
      }),
      keepUnusedDataFor: 15,
    }),
    // Agrégats par commande : nb articles distincts, total unités, nouveautés.
    getCommandesAgregats: builder.query({
      query: (nomDossierDBF) => ({
        url: `/api/reception-suivi/agregats/${nomDossierDBF}`,
      }),
      keepUnusedDataFor: 60,
    }),
  }),
});

export const {
  useGetCommandesAControlerQuery,
  useGetReceptionProgressQuery,
  useGetCommandesAgregatsQuery,
} = receptionSuiviApiSlice;