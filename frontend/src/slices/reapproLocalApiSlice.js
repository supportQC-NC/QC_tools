// src/slices/reapproLocalApiSlice.js
import { apiSlice } from "./apiSlice";

const URL = "/api/reappro-local";

export const reapproLocalApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getReapproLocal: builder.query({
      query: (nomDossierDBF) => ({ url: `${URL}/${nomDossierDBF}` }),
      keepUnusedDataFor: 300,
    }),
    refreshReapproLocal: builder.mutation({
      query: (nomDossierDBF) => ({
        url: `${URL}/${nomDossierDBF}/refresh`,
        method: "POST",
      }),
    }),
  }),
});

export const { useGetReapproLocalQuery, useRefreshReapproLocalMutation } =
  reapproLocalApiSlice;