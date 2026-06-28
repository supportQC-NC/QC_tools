// frontend/src/slices/ficheControleApiSlice.js
import { apiSlice } from "./apiSlice";

const BASE = "/api/fiches-controle";

export const getFichePdfUrl = (entrepriseId, id) =>
  `${BASE}/${entrepriseId}/${id}/pdf`;

export const ficheControleApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getFiches: builder.query({
      query: (entrepriseId) => `${BASE}/${entrepriseId}`,
      providesTags: ["FicheControle"],
    }),

    scanFiches: builder.mutation({
      query: (entrepriseId) => ({
        url: `${BASE}/${entrepriseId}/scan`,
        method: "POST",
      }),
      invalidatesTags: ["FicheControle"],
    }),

    reprintFiche: builder.mutation({
      query: ({ entrepriseId, id }) => ({
        url: `${BASE}/${entrepriseId}/${id}/reprint`,
        method: "POST",
      }),
      invalidatesTags: ["FicheControle"],
    }),

    deleteFiche: builder.mutation({
      query: ({ entrepriseId, id }) => ({
        url: `${BASE}/${entrepriseId}/${id}`,
        method: "DELETE",
      }),
      invalidatesTags: ["FicheControle"],
    }),

    // Surveillance automatique (globale)
    getWatchStatus: builder.query({
      query: () => `${BASE}/watch/status`,
      providesTags: ["Surveillance"],
    }),

    startWatch: builder.mutation({
      query: () => ({ url: `${BASE}/watch/start`, method: "POST" }),
      invalidatesTags: ["Surveillance"],
    }),

    stopWatch: builder.mutation({
      query: () => ({ url: `${BASE}/watch/stop`, method: "POST" }),
      invalidatesTags: ["Surveillance"],
    }),
  }),
});

export const {
  useGetFichesQuery,
  useScanFichesMutation,
  useReprintFicheMutation,
  useDeleteFicheMutation,
  useGetWatchStatusQuery,
  useStartWatchMutation,
  useStopWatchMutation,
} = ficheControleApiSlice;