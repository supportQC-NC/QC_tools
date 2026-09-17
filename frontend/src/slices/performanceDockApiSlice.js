// src/slices/performanceDockApiSlice.js
import { apiSlice } from "./apiSlice";

const URL = "/api/performance-dock";

export const performanceDockApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    // Les critères (période, jours de semaine, tranche de ventes, fournisseur,
    // base de la moyenne) sont appliqués PAR LE SERVEUR : la série est lue dans
    // les photos quotidiennes `ReapproSnapshot`, le recalcul est donc quasi
    // gratuit, et l'écran ne peut pas diverger de l'export Excel qui partage le
    // même calcul.
    getPerformanceDock: builder.query({
      query: ({ societe, ...params }) => ({ url: `${URL}/${societe}`, params }),
      providesTags: ["PerformanceReappro"],
      keepUnusedDataFor: 300,
    }),
    // Relevé du jour à la demande (le planificateur le prend à 18:00).
    prendrePhotoReappro: builder.mutation({
      query: (societe) => ({ url: `${URL}/${societe}/photo`, method: "POST" }),
      invalidatesTags: ["PerformanceReappro"],
    }),
    // Rejoue les journées déjà archivées dans reapro_mag, même règle, pour que
    // la série ne démarre pas vide.
    rattraperHistoriqueReappro: builder.mutation({
      query: ({ societe, force = false }) => ({
        url: `${URL}/${societe}/rattrapage`,
        method: "POST",
        params: force ? { force: 1 } : undefined,
      }),
      invalidatesTags: ["PerformanceReappro"],
    }),
  }),
});

export const {
  useGetPerformanceDockQuery,
  usePrendrePhotoReapproMutation,
  useRattraperHistoriqueReapproMutation,
} = performanceDockApiSlice;
