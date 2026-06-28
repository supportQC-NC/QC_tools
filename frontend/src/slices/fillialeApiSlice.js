// frontend/src/slices/filialeApiSlice.js
import { apiSlice } from "./apiSlice";

const FILIALES_URL = "/api/filiales";

export const filialeApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    // Obtenir les données filiales pour un article
    getArticleFilialeData: builder.query({
      query: ({ nomDossierDBF, nart }) => ({
        url: `${FILIALES_URL}/${nomDossierDBF}/article/${encodeURIComponent(nart)}`,
      }),
      providesTags: ["Filiale"],
      keepUnusedDataFor: 300, // Cache 5 minutes
    }),

    // Obtenir les données filiales pour plusieurs articles
    getMultipleArticlesFilialeData: builder.mutation({
      query: ({ nomDossierDBF, narts }) => ({
        url: `${FILIALES_URL}/${nomDossierDBF}/articles`,
        method: "POST",
        body: { narts },
      }),
    }),

    // Invalider le cache (admin)
    invalidateFilialeCache: builder.mutation({
      query: (nomDossierDBF) => ({
        url: `${FILIALES_URL}/${nomDossierDBF}/invalidate-cache`,
        method: "POST",
      }),
      invalidatesTags: ["Filiale"],
    }),

    // Stats du cache (admin)
    getFilialesCacheStats: builder.query({
      query: () => ({
        url: `${FILIALES_URL}/cache-stats`,
      }),
      keepUnusedDataFor: 30,
    }),
  }),
});

export const {
  useGetArticleFilialeDataQuery,
  useGetMultipleArticlesFilialeDataMutation,
  useInvalidateFilialesCacheMutation,
  useGetFilialesCacheStatsQuery,
} = filialeApiSlice;
