// frontend/src/slices/inventaireApiSlice.js
import { apiSlice } from "./apiSlice";

export const inventaireApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    createInventaire: builder.mutation({
      query: (data) => ({
        url: "/api/inventaires",
        method: "POST",
        body: data,
      }),
      invalidatesTags: ["Inventaire"],
    }),

    getInventaireEnCours: builder.query({
      query: (entrepriseId) => `/api/inventaires/en-cours/${entrepriseId}`,
      providesTags: ["Inventaire"],
    }),

    scanArticle: builder.mutation({
      query: ({ inventaireId, code }) => ({
        url: `/api/inventaires/${inventaireId}/scan`,
        method: "POST",
        body: { code },
      }),
    }),

    addLigne: builder.mutation({
      query: ({ inventaireId, ...data }) => ({
        url: `/api/inventaires/${inventaireId}/lignes`,
        method: "POST",
        body: data,
      }),
      invalidatesTags: ["Inventaire"],
    }),

    updateLigne: builder.mutation({
      query: ({ inventaireId, ligneId, quantite }) => ({
        url: `/api/inventaires/${inventaireId}/lignes/${ligneId}`,
        method: "PUT",
        body: { quantite },
      }),
      invalidatesTags: ["Inventaire"],
    }),

    deleteLigne: builder.mutation({
      query: ({ inventaireId, ligneId }) => ({
        url: `/api/inventaires/${inventaireId}/lignes/${ligneId}`,
        method: "DELETE",
      }),
      invalidatesTags: ["Inventaire"],
    }),

    // Export sur serveur (retourne JSON)
    exportInventaire: builder.mutation({
      query: ({ inventaireId, nomInventaire, cheminDestination }) => ({
        url: `/api/inventaires/${inventaireId}/export`,
        method: "POST",
        body: { nomInventaire, cheminDestination },
      }),
      invalidatesTags: ["Inventaire"],
    }),

    // Téléchargement fichier (retourne le fichier texte brut)
    downloadInventaire: builder.mutation({
      query: ({ inventaireId, nomInventaire }) => ({
        url: `/api/inventaires/${inventaireId}/download`,
        method: "POST",
        body: { nomInventaire },
        responseHandler: (response) => response.text(),
      }),
      invalidatesTags: ["Inventaire"],
    }),

    deleteInventaire: builder.mutation({
      query: (inventaireId) => ({
        url: `/api/inventaires/${inventaireId}`,
        method: "DELETE",
      }),
      invalidatesTags: ["Inventaire"],
    }),

    getHistorique: builder.query({
      query: (entrepriseId) =>
        `/api/inventaires/historique${entrepriseId ? `?entrepriseId=${entrepriseId}` : ""}`,
      providesTags: ["Inventaire"],
    }),
  }),
});

export const {
  useCreateInventaireMutation,
  useGetInventaireEnCoursQuery,
  useScanArticleMutation,
  useAddLigneMutation,
  useUpdateLigneMutation,
  useDeleteLigneMutation,
  useExportInventaireMutation,
  useDownloadInventaireMutation,
  useDeleteInventaireMutation,
  useGetHistoriqueQuery,
} = inventaireApiSlice;
