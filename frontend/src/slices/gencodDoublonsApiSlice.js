// src/slices/gencodDoublonsApiSlice.js
import { apiSlice } from "./apiSlice";

const URL = "/api/gencod-doublons";

export const gencodDoublonsApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getGencodDoublons: builder.query({
      query: (nomDossierDBF) => ({ url: `${URL}/${nomDossierDBF}` }),
      keepUnusedDataFor: 300,
    }),
    refreshGencodDoublons: builder.mutation({
      query: (nomDossierDBF) => ({
        url: `${URL}/${nomDossierDBF}/refresh`,
        method: "POST",
      }),
    }),
  }),
});

export const { useGetGencodDoublonsQuery, useRefreshGencodDoublonsMutation } =
  gencodDoublonsApiSlice;