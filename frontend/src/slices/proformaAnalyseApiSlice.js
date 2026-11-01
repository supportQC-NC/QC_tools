// src/slices/proformaAnalyseApiSlice.js
import { apiSlice } from "./apiSlice";

const URL = "/api/proforma-analyse";

export const proformaAnalyseApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getProformaAnalyse: builder.query({
      query: ({ nomDossierDBF, dateDebut, dateFin, vendeur }) => ({
        url: `${URL}/${nomDossierDBF}`,
        params: { dateDebut, dateFin, vendeur: vendeur || "" },
      }),
      keepUnusedDataFor: 60,
    }),
  }),
});

export const { useGetProformaAnalyseQuery } = proformaAnalyseApiSlice;
