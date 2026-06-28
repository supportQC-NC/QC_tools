// frontend/src/slices/inventaireZoneApiSlice.js
import { apiSlice } from "./apiSlice";

const BASE = "/api/inventaires-zones";

export const inventaireZoneApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    // Initialiser un inventaire (archive l'actif précédent)
    initInventaireZone: builder.mutation({
      query: ({ entrepriseId, nom }) => ({
        url: `${BASE}/init/${entrepriseId}`,
        method: "POST",
        body: { nom },
      }),
      invalidatesTags: ["InventaireZone"],
    }),

    // Biper un code-barres
    biperZone: builder.mutation({
      query: ({ entrepriseId, code }) => ({
        url: `${BASE}/${entrepriseId}/bip`,
        method: "POST",
        body: { code },
      }),
      invalidatesTags: ["InventaireZone"],
    }),

    // Session active détaillée
    getActiveSession: builder.query({
      query: (entrepriseId) => `${BASE}/${entrepriseId}/active`,
      providesTags: ["InventaireZone"],
    }),

    // Progression légère
    getZoneProgress: builder.query({
      query: (entrepriseId) => `${BASE}/${entrepriseId}/progress`,
      providesTags: ["InventaireZone"],
    }),

    // Historique des sessions archivées
    getZoneHistorique: builder.query({
      query: (entrepriseId) => `${BASE}/${entrepriseId}/historique`,
      providesTags: ["InventaireZone"],
    }),

    // Correction manuelle d'une phase
    setPhaseManuelle: builder.mutation({
      query: ({ entrepriseId, code, phase, fait }) => ({
        url: `${BASE}/${entrepriseId}/zone/${encodeURIComponent(code)}/${phase}`,
        method: "PUT",
        body: { fait },
      }),
      invalidatesTags: ["InventaireZone"],
    }),

    // Supprimer une session archivée
    deleteZoneSession: builder.mutation({
      query: ({ entrepriseId, id }) => ({
        url: `${BASE}/${entrepriseId}/${id}`,
        method: "DELETE",
      }),
      invalidatesTags: ["InventaireZone"],
    }),
  }),
});

export const {
  useInitInventaireZoneMutation,
  useBiperZoneMutation,
  useGetActiveSessionQuery,
  useGetZoneProgressQuery,
  useGetZoneHistoriqueQuery,
  useSetPhaseManuelleMutation,
  useDeleteZoneSessionMutation,
} = inventaireZoneApiSlice;