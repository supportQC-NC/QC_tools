// src/slices/filialesApiSlice.js
import { apiSlice } from "./apiSlice";

const FILIALES_URL = "/api/filiales";

export const filialesApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getReseaux: builder.query({
      query: () => ({ url: FILIALES_URL }),
      keepUnusedDataFor: 300,
    }),
    getReseau: builder.query({
      query: (reseau) => ({ url: `${FILIALES_URL}/${reseau}` }),
      keepUnusedDataFor: 300,
    }),
    refreshReseau: builder.mutation({
      query: (reseau) => ({
        url: `${FILIALES_URL}/${reseau}/refresh`,
        method: "POST",
      }),
    }),
  }),
});

export const {
  useGetReseauxQuery,
  useGetReseauQuery,
  useRefreshReseauMutation,
} = filialesApiSlice;