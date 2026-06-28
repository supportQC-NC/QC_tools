// frontend/src/slices/reapproApiSlice.js
import { apiSlice } from "./apiSlice";

export const reapproApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    // Créer un nouveau réappro
    createReappro: builder.mutation({
      query: (data) => ({
        url: "/api/reappros",
        method: "POST",
        body: data,
      }),
      invalidatesTags: ["Reappro"],
    }),

    // Obtenir le réappro en cours pour une entreprise
    getReapproEnCours: builder.query({
      query: (entrepriseId) => `/api/reappros/en-cours/${entrepriseId}`,
      providesTags: ["Reappro"],
    }),

    // Obtenir un réappro par ID
    getReapproById: builder.query({
      query: (reapproId) => `/api/reappros/${reapproId}`,
      providesTags: ["Reappro"],
    }),

    // Scanner un article (affiche les infos et stocks)
    scanArticleReappro: builder.mutation({
      query: ({ reapproId, code }) => ({
        url: `/api/reappros/${reapproId}/scan`,
        method: "POST",
        body: { code },
      }),
    }),

    // Ajouter une ligne au réappro (après confirmation et saisie quantité)
    addLigneReappro: builder.mutation({
      query: ({ reapproId, ...data }) => ({
        url: `/api/reappros/${reapproId}/lignes`,
        method: "POST",
        body: data,
      }),
      invalidatesTags: ["Reappro"],
    }),

    // Modifier la quantité d'une ligne
    updateLigneReappro: builder.mutation({
      query: ({ reapproId, ligneId, quantite }) => ({
        url: `/api/reappros/${reapproId}/lignes/${ligneId}`,
        method: "PUT",
        body: { quantite },
      }),
      invalidatesTags: ["Reappro"],
    }),

    // Supprimer une ligne
    deleteLigneReappro: builder.mutation({
      query: ({ reapproId, ligneId }) => ({
        url: `/api/reappros/${reapproId}/lignes/${ligneId}`,
        method: "DELETE",
      }),
      invalidatesTags: ["Reappro"],
    }),

    // Exporter sur serveur (retourne JSON)
    exportReappro: builder.mutation({
      query: ({ reapproId, nomReappro, cheminDestination }) => ({
        url: `/api/reappros/${reapproId}/export`,
        method: "POST",
        body: { nomReappro, cheminDestination },
      }),
      invalidatesTags: ["Reappro"],
    }),

    // Télécharger le fichier (retourne le fichier texte brut)
    downloadReappro: builder.mutation({
      query: ({ reapproId, nomReappro }) => ({
        url: `/api/reappros/${reapproId}/download`,
        method: "POST",
        body: { nomReappro },
        responseHandler: (response) => response.text(),
      }),
      invalidatesTags: ["Reappro"],
    }),

    // Supprimer un réappro
    deleteReappro: builder.mutation({
      query: (reapproId) => ({
        url: `/api/reappros/${reapproId}`,
        method: "DELETE",
      }),
      invalidatesTags: ["Reappro"],
    }),

    // Historique des réappros
    getHistoriqueReappro: builder.query({
      query: (entrepriseId) =>
        `/api/reappros/historique${entrepriseId ? `?entrepriseId=${entrepriseId}` : ""}`,
      providesTags: ["Reappro"],
    }),
  }),
});

export const {
  useCreateReapproMutation,
  useGetReapproEnCoursQuery,
  useGetReapproByIdQuery,
  useScanArticleReapproMutation,
  useAddLigneReapproMutation,
  useUpdateLigneReapproMutation,
  useDeleteLigneReapproMutation,
  useExportReapproMutation,
  useDownloadReapproMutation,
  useDeleteReapproMutation,
  useGetHistoriqueReapproQuery,
} = reapproApiSlice;
