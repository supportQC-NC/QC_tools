// frontend/src/slices/releveApiSlice.js
import { apiSlice } from "./apiSlice";

const RELEVES_URL = "/api/releves";

export const releveApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    // ==========================================
    // CRÉATION ET RÉCUPÉRATION
    // ==========================================

    // Créer un nouveau relevé
    createReleve: builder.mutation({
      query: (data) => ({
        url: RELEVES_URL,
        method: "POST",
        body: data,
      }),
      invalidatesTags: ["Releve"],
    }),

    // Obtenir tous les relevés en cours pour une entreprise
    getRelevesEnCoursParEntreprise: builder.query({
      query: (entrepriseId) => `${RELEVES_URL}/en-cours/${entrepriseId}`,
      providesTags: ["Releve"],
    }),

    // Obtenir le relevé en cours pour une entreprise et un concurrent
    getReleveEnCours: builder.query({
      query: ({ entrepriseId, concurrentId }) =>
        `${RELEVES_URL}/en-cours/${entrepriseId}/${concurrentId}`,
      providesTags: ["Releve"],
    }),

    // Obtenir un relevé par ID
    getReleveById: builder.query({
      query: (releveId) => `${RELEVES_URL}/${releveId}`,
      providesTags: ["Releve"],
    }),

    // Historique des relevés
    getHistoriqueReleves: builder.query({
      query: ({ entrepriseId, concurrentId } = {}) => {
        const params = new URLSearchParams();
        if (entrepriseId) params.append("entrepriseId", entrepriseId);
        if (concurrentId) params.append("concurrentId", concurrentId);
        const queryString = params.toString();
        return `${RELEVES_URL}/historique${queryString ? `?${queryString}` : ""}`;
      },
      providesTags: ["Releve"],
    }),

    // ==========================================
    // OPÉRATIONS SUR LE RELEVÉ
    // ==========================================

    // Scanner un article par GENCOD
    scanArticleReleve: builder.mutation({
      query: ({ releveId, gencod }) => ({
        url: `${RELEVES_URL}/${releveId}/scan`,
        method: "POST",
        body: { gencod },
      }),
    }),

    // Ajouter une ligne au relevé
    addLigneReleve: builder.mutation({
      query: ({ releveId, ...data }) => ({
        url: `${RELEVES_URL}/${releveId}/lignes`,
        method: "POST",
        body: data,
      }),
      invalidatesTags: ["Releve"],
    }),

    // Modifier une ligne du relevé
    updateLigneReleve: builder.mutation({
      query: ({ releveId, ligneId, prixReleve }) => ({
        url: `${RELEVES_URL}/${releveId}/lignes/${ligneId}`,
        method: "PUT",
        body: { prixReleve },
      }),
      invalidatesTags: ["Releve"],
    }),

    // Supprimer une ligne du relevé
    deleteLigneReleve: builder.mutation({
      query: ({ releveId, ligneId }) => ({
        url: `${RELEVES_URL}/${releveId}/lignes/${ligneId}`,
        method: "DELETE",
      }),
      invalidatesTags: ["Releve"],
    }),

    // Supprimer un relevé
    deleteReleve: builder.mutation({
      query: (releveId) => ({
        url: `${RELEVES_URL}/${releveId}`,
        method: "DELETE",
      }),
      invalidatesTags: ["Releve"],
    }),

    // ==========================================
    // EXPORT
    // ==========================================

    // Télécharger le fichier Excel
    downloadReleve: builder.mutation({
      query: ({ releveId, nomReleve }) => ({
        url: `${RELEVES_URL}/${releveId}/download`,
        method: "POST",
        body: { nomReleve },
        responseHandler: async (response) => {
          // Récupérer le blob pour le téléchargement
          const blob = await response.blob();
          return blob;
        },
        cache: "no-cache",
      }),
      invalidatesTags: ["Releve"],
    }),

    // ==========================================
    // ADMIN
    // ==========================================

    // Statistiques des relevés
    getRelevesStats: builder.query({
      query: () => `${RELEVES_URL}/stats`,
      keepUnusedDataFor: 60,
    }),
  }),
});

export const {
  useCreateReleveMutation,
  useGetRelevesEnCoursParEntrepriseQuery,
  useGetReleveEnCoursQuery,
  useGetReleveByIdQuery,
  useGetHistoriqueRelevesQuery,
  useScanArticleReleveMutation,
  useAddLigneReleveMutation,
  useUpdateLigneReleveMutation,
  useDeleteLigneReleveMutation,
  useDeleteReleveMutation,
  useDownloadReleveMutation,
  useGetRelevesStatsQuery,
} = releveApiSlice;
