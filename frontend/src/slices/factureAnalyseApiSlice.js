// src/slices/factureAnalyseApiSlice.js
import { apiSlice } from "./apiSlice";

const URL = "/api/facture-analyse";

export const factureAnalyseApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getFactureAnalyse: builder.query({
      query: ({ nomDossierDBF, dateDebut, dateFin }) => ({
        url: `${URL}/${nomDossierDBF}`,
        params: { dateDebut, dateFin },
      }),
      keepUnusedDataFor: 60,
    }),
  }),
});

export const { useGetFactureAnalyseQuery, useLazyGetFactureAnalyseQuery } =
  factureAnalyseApiSlice;