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

    // Annuler l'inventaire actif (supprime dossier + session : table rase)
    annulerInventaireZone: builder.mutation({
      query: (entrepriseId) => ({
        url: `${BASE}/${entrepriseId}/annuler`,
        method: "POST",
      }),
      invalidatesTags: ["InventaireZone"],
    }),

    // Biper un code-barres. `agentUserId` = l'agent qui a réellement fait la
    // phase (le coupon ne porte aucune identité) ; absent → la personne
    // connectée est créditée.
    biperZone: builder.mutation({
      query: ({ entrepriseId, code, agentUserId }) => ({
        url: `${BASE}/${entrepriseId}/bip`,
        method: "POST",
        body: { code, ...(agentUserId && { agentUserId }) },
      }),
      invalidatesTags: ["InventaireZone", "SuiviBipage"],
    }),

    // Utilisateurs sélectionnables comme agent : TOUS les comptes actifs, pas
    // seulement ceux de la société (renforts d'une autre société du groupe).
    getAgentsPossibles: builder.query({
      query: (entrepriseId) => `${BASE}/${entrepriseId}/agents-possibles`,
      providesTags: ["AgentsInventaire"],
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
      query: ({ entrepriseId, code, phase, fait, agentUserId }) => ({
        url: `${BASE}/${entrepriseId}/zone/${encodeURIComponent(code)}/${phase}`,
        method: "PUT",
        body: { fait, ...(agentUserId && { agentUserId }) },
      }),
      invalidatesTags: ["InventaireZone", "SuiviBipage"],
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
  useAnnulerInventaireZoneMutation,
  useBiperZoneMutation,
  useGetAgentsPossiblesQuery,
  useGetActiveSessionQuery,
  useGetZoneProgressQuery,
  useGetZoneHistoriqueQuery,
  useSetPhaseManuelleMutation,
  useDeleteZoneSessionMutation,
} = inventaireZoneApiSlice;