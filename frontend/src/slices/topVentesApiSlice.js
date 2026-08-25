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
      query: ({ nomDossierDBF, type, code, search, sort, dir, renvoi }) => ({
        url: `${TOP_VENTES_URL}/${nomDossierDBF}/detail`,
        params: {
          type,
          code,
          ...(search && { search }),
          ...(sort && { sort }),
          ...(dir && { dir }),
          // "1" = uniquement les renvois, "0" = les exclure, absent = tout.
          ...(renvoi !== undefined && renvoi !== "" && { renvoi }),
        },
      }),
      providesTags: ["TopVentes"],
      keepUnusedDataFor: 60,
    }),
  }),
});

export const { useGetTopVenteSyntheseQuery, useGetTopVenteDetailQuery } =
  topVentesApiSlice;
