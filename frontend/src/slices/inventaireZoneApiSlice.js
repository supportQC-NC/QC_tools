// frontend/src/slices/inventaireZoneApiSlice.js
import { apiSlice } from "./apiSlice";

const BASE = "/api/inventaires-zones";

export const inventaireZoneApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    // Initialiser un inventaire (archive l'actif précédent)
    // `filtreProformas` = plage de dates + clients du « comptage sans
    // collecteur », saisis UNE FOIS au démarrage de l'inventaire.
    // `destination` = où vit le dossier de l'inventaire : "rcommun" (partage
    // STOCK, défaut) ou "collect_sec" (chemin d'export de la société).
    initInventaireZone: builder.mutation({
      query: ({ entrepriseId, nom, filtreProformas, destination }) => ({
        url: `${BASE}/init/${entrepriseId}`,
        method: "POST",
        body: {
          nom,
          ...(filtreProformas && { filtreProformas }),
          ...(destination && { destination }),
        },
      }),
      // L'init archive la session courante (les bipages sont CONSERVÉS par
      // session depuis le 24/11/2026, plus purgés) : sans « Bipage » et
      // « SuiviBipage », l'écran Détail des bipages ressert son cache d'avant
      // l'initialisation au lieu de basculer sur le nouvel inventaire vierge.
      invalidatesTags: [
        "InventaireZone",
        "Bipage",
        "SuiviBipage",
        "LocalisationInventaire",
      ],
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
      // Même raison que l'init : table rase des bipages de CETTE session →
      // tous les écrans qui les affichent doivent refetcher.
      invalidatesTags: [
        "InventaireZone",
        "Bipage",
        "SuiviBipage",
        "LocalisationInventaire",
      ],
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

    // Neutraliser / réactiver une zone (rayon qui n'existe plus physiquement).
    // Sans `confirmer`, le serveur répond `action: "confirmation_requise"`
    // (avec le travail déjà porté par la zone) au lieu d'écrire : c'est à
    // l'écran d'afficher la confirmation puis de rappeler avec confirmer=true.
    setZoneNeutralisee: builder.mutation({
      query: ({ entrepriseId, code, emplacement, neutralisee, confirmer }) => ({
        url: `${BASE}/${entrepriseId}/zone/${encodeURIComponent(code)}/neutraliser`,
        method: "PUT",
        body: {
          neutralisee,
          emplacement: emplacement ?? "",
          ...(confirmer && { confirmer: true }),
        },
      }),
      invalidatesTags: ["InventaireZone"],
    }),

    // Supprimer une session archivée. ⚠️ Cascade complète depuis le
    // 24/11/2026 : ses collectes, LigneBipage, fiches et bilan partent avec —
    // l'inventaire disparaît aussi de la Localisation et du suivi bipage.
    deleteZoneSession: builder.mutation({
      query: ({ entrepriseId, id }) => ({
        url: `${BASE}/${entrepriseId}/${id}`,
        method: "DELETE",
      }),
      invalidatesTags: [
        "InventaireZone",
        "InventaireBilan",
        "Bipage",
        "SuiviBipage",
        "LocalisationInventaire",
      ],
    }),

    // ─── Bilans de clôture ───────────────────────────────────────────────
    // Figer le bilan de l'inventaire actif (+ clôture optionnelle : la
    // session passe en archive sans rien purger).
    genererBilanInventaire: builder.mutation({
      query: ({ entrepriseId, cloturer }) => ({
        url: `${BASE}/${entrepriseId}/bilan`,
        method: "POST",
        body: { ...(cloturer && { cloturer: true }) },
      }),
      invalidatesTags: ["InventaireBilan", "InventaireZone"],
    }),

    getBilansInventaire: builder.query({
      query: (entrepriseId) => `${BASE}/${entrepriseId}/bilans`,
      providesTags: ["InventaireBilan"],
    }),

    // Comparaison inter-inventaires par zone (rayons chroniquement faux).
    getComparaisonBilans: builder.query({
      query: (entrepriseId) => `${BASE}/${entrepriseId}/bilans/comparaison`,
      providesTags: ["InventaireBilan"],
    }),

    getBilanInventaire: builder.query({
      query: ({ entrepriseId, id }) => `${BASE}/${entrepriseId}/bilans/${id}`,
      providesTags: ["InventaireBilan"],
    }),

    deleteBilanInventaire: builder.mutation({
      query: ({ entrepriseId, id }) => ({
        url: `${BASE}/${entrepriseId}/bilans/${id}`,
        method: "DELETE",
      }),
      invalidatesTags: ["InventaireBilan"],
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
  useSetZoneNeutraliseeMutation,
  useDeleteZoneSessionMutation,
  useGenererBilanInventaireMutation,
  useGetBilansInventaireQuery,
  useGetComparaisonBilansQuery,
  useGetBilanInventaireQuery,
  useDeleteBilanInventaireMutation,
} = inventaireZoneApiSlice;