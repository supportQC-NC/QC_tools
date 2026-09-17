// src/slices/performanceDockApiSlice.js
import { apiSlice } from "./apiSlice";

const URL = "/api/performance-dock";

export const performanceDockApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    // Les critères (période, jours de semaine, seuils, base de la moyenne) sont
    // appliqués PAR LE SERVEUR : la lecture des classeurs y est cachée, le
    // recalcul est donc quasi gratuit, et l'écran ne peut pas diverger de
    // l'export Excel qui utilise le même calcul.
    getPerformanceDock: builder.query({
      query: (params = {}) => ({ url: URL, params }),
      keepUnusedDataFor: 300,
    }),
    refreshPerformanceDock: builder.mutation({
      query: () => ({ url: `${URL}/refresh`, method: "POST" }),
    }),
  }),
});

export const { useGetPerformanceDockQuery, useRefreshPerformanceDockMutation } =
  performanceDockApiSlice;
