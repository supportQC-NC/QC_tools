// frontend/src/slices/concurrentApiSlice.js
import { apiSlice } from "./apiSlice";

const CONCURRENTS_URL = "/api/concurrents";

export const concurrentApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    // ==========================================
    // UTILISATEURS
    // ==========================================

    // Obtenir tous les concurrents
    getConcurrents: builder.query({
      query: ({ actifOnly } = {}) => ({
        url: CONCURRENTS_URL,
        params: actifOnly ? { actifOnly: "true" } : {},
      }),
      providesTags: ["Concurrent"],
      keepUnusedDataFor: 300, // Cache 5 minutes
    }),

    // Obtenir un concurrent par ID
    getConcurrentById: builder.query({
      query: (id) => ({
        url: `${CONCURRENTS_URL}/${id}`,
      }),
      providesTags: ["Concurrent"],
    }),

    // ==========================================
    // ADMIN
    // ==========================================

    // Créer un concurrent
    createConcurrent: builder.mutation({
      query: (data) => ({
        url: CONCURRENTS_URL,
        method: "POST",
        body: data,
      }),
      invalidatesTags: ["Concurrent"],
    }),

    // Modifier un concurrent
    updateConcurrent: builder.mutation({
      query: ({ id, ...data }) => ({
        url: `${CONCURRENTS_URL}/${id}`,
        method: "PUT",
        body: data,
      }),
      invalidatesTags: ["Concurrent"],
    }),

    // Supprimer un concurrent
    deleteConcurrent: builder.mutation({
      query: (id) => ({
        url: `${CONCURRENTS_URL}/${id}`,
        method: "DELETE",
      }),
      invalidatesTags: ["Concurrent"],
    }),

    // Activer/Désactiver un concurrent
    toggleConcurrentActive: builder.mutation({
      query: (id) => ({
        url: `${CONCURRENTS_URL}/${id}/toggle-active`,
        method: "PATCH",
      }),
      invalidatesTags: ["Concurrent"],
    }),

    // Statistiques des concurrents
    getConcurrentsStats: builder.query({
      query: () => ({
        url: `${CONCURRENTS_URL}/admin/stats`,
      }),
      keepUnusedDataFor: 60,
    }),
  }),
});

export const {
  useGetConcurrentsQuery,
  useGetConcurrentByIdQuery,
  useCreateConcurrentMutation,
  useUpdateConcurrentMutation,
  useDeleteConcurrentMutation,
  useToggleConcurrentActiveMutation,
  useGetConcurrentsStatsQuery,
} = concurrentApiSlice;
