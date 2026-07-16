// src/slices/receptionSuiviApiSlice.js
import { apiSlice } from "./apiSlice";

const URL = "/api/reception-suivi";

export const receptionSuiviApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getReceptionsSuivi: builder.query({
      query: () => ({ url: `${URL}/en-cours` }),
      keepUnusedDataFor: 30,
    }),
  }),
});

export const { useGetReceptionsSuiviQuery } = receptionSuiviApiSlice;