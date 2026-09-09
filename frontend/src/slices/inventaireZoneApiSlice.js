// frontend/src/slices/inventaireZoneApiSlice.js
import { apiSlice } from "./apiSlice";

const BASE = "/api/inventaires-zones";

export const inventaireZoneApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    // Initialiser un inventaire (archive l'actif précédent)
    // `filtreProformas` = plage de dates + clients du « comptage sans
    // collecteur », saisis UNE FOIS au démarrage de l'inventaire.
    initInventaireZone: builder.mutation({
      query: ({ entrepriseId, nom, filtreProformas }) => ({
        url: `${BASE}/init/${entrepriseId}`,
        method: "POST",
        body: { nom, ...(filtreProformas && { filtreProformas }) },
      }),
      invalidatesTags: ["InventaireZone"],
    }),

    // Correction de cette sélection en cours d'inventaire.
    setFiltreProformas: builder.mutation({
      query: ({ entrepriseId, dateDebut, dateFin, clients }) => ({
        url: `${BASE}/${entrepriseId}/filtre-proformas`,
        method: "PUT",
        body: { dateDebut, dateFin, clients },
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

    // Biper un code-barres.
    //
    // ⚠️ `previsualiser` DOIT être transmis : c'est lui qui fait du scan une
    // simple résolution du code, sans rien marquer, le temps de demander QUI a
    // fait le travail. Omis, le serveur valide la phase immédiatement au nom de
    // la personne connectée et la fenêtre de désignation ne s'ouvre jamais.
    // `agentUserId` = l'agent réellement crédité ; absent → la personne
    // connectée.
    biperZone: builder.mutation({
      query: ({ entrepriseId, code, agentUserId, previsualiser }) => ({
        url: `${BASE}/${entrepriseId}/bip`,
        method: "POST",
        body: {
          code,
          ...(agentUserId && { agentUserId }),
          ...(previsualiser && { previsualiser: true }),
        },
      }),
      // Une prévisualisation n'écrit rien : inutile de refaire tomber le cache
      // de la session à chaque scan.
      invalidatesTags: (result, error, arg) =>
        arg?.previsualiser ? [] : ["InventaireZone", "SuiviBipage"],
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
      // ⚠️ `emplacement` est INDISPENSABLE : le même code de zone existe au
      // MAGASIN et au DOCK, ce sont deux zones et deux comptages distincts.
      query: ({ entrepriseId, code, phase, fait, agentUserId, emplacement }) => ({
        url: `${BASE}/${entrepriseId}/zone/${encodeURIComponent(code)}/${phase}`,
        method: "PUT",
        body: {
          fait,
          ...(agentUserId && { agentUserId }),
          emplacement: emplacement ?? "",
        },
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
  useSetFiltreProformasMutation,
  useAnnulerInventaireZoneMutation,
  useBiperZoneMutation,
  useGetAgentsPossiblesQuery,
  useGetActiveSessionQuery,
  useGetZoneProgressQuery,
  useGetZoneHistoriqueQuery,
  useSetPhaseManuelleMutation,
  useDeleteZoneSessionMutation,
} = inventaireZoneApiSlice;