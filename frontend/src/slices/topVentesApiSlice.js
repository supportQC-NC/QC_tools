// src/slices/topVentesApiSlice.js
//
// Endpoints RTK Query de l'outil « Top Ventes » (groupe Commerciaux).
import { apiSlice } from "./apiSlice";
import { TOP_VENTES_URL } from "../constants";

export const topVentesApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getTopVenteSynthese: builder.query({
      query: ({ nomDossierDBF, groupBy }) => ({
        url: `${TOP_VENTES_URL}/${nomDossierDBF}/synthese`,
        params: { groupBy },
      }),
      providesTags: ["TopVentes"],
      keepUnusedDataFor: 120,
    }),

    getTopVenteDetail: builder.query({
      query: ({ nomDossierDBF, type, code, search, sort, dir }) => ({
        url: `${TOP_VENTES_URL}/${nomDossierDBF}/detail`,
        params: {
          type,
          code,
          ...(search && { search }),
          ...(sort && { sort }),
          ...(dir && { dir }),
        },
      }),
      providesTags: ["TopVentes"],
      keepUnusedDataFor: 60,
    }),
  }),
});

export const { useGetTopVenteSyntheseQuery, useGetTopVenteDetailQuery } =
  topVentesApiSlice;
