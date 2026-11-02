// src/slices/historiquePromosApiSlice.js
// Historique promos : lecture seule des JSON mensuels du FTPS robot-documents.
import { apiSlice } from "./apiSlice";

const URL = "/api/historique-promos";

export const historiquePromosApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getHistoriquePromosSources: builder.query({
      query: () => ({ url: URL }),
      keepUnusedDataFor: 120,
    }),
    getHistoriquePromos: builder.query({
      query: ({ nomDossierDBF }) => ({
        url: `${URL}/societe/${nomDossierDBF}`,
      }),
      keepUnusedDataFor: 120,
    }),
  }),
});

export const {
  useGetHistoriquePromosSourcesQuery,
  useGetHistoriquePromosQuery,
} = historiquePromosApiSlice;
