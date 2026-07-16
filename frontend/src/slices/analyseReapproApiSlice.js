// src/slices/analyseReapproApiSlice.js
import { apiSlice } from "./apiSlice";

const URL = "/api/analyse-reappro";

export const analyseReapproApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getAnalyseReappro: builder.query({
      query: (nomDossierDBF) => ({ url: `${URL}/${nomDossierDBF}` }),
      keepUnusedDataFor: 60,
    }),
  }),
});

export const { useGetAnalyseReapproQuery } = analyseReapproApiSlice;