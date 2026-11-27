// frontend/src/slices/localisationInventaireApiSlice.js
//
// Module Localisation inventaire : où trouver un article en magasin, d'après
// les bipages d'un inventaire (actif ou archivé).
import { apiSlice } from "./apiSlice";

const BASE = "/api/localisation-inventaire";

export const localisationInventaireApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    // Inventaires interrogeables (actif + archivés, avec année et nb de lignes)
    getInventairesLocalisation: builder.query({
      query: (entrepriseId) => `${BASE}/${entrepriseId}/inventaires`,
      providesTags: ["LocalisationInventaire"],
    }),

    // Emplacements (types des fiches d'inventaire) d'un inventaire donné
    getEmplacementsLocalisation: builder.query({
      query: ({ entrepriseId, sessionId }) =>
        `${BASE}/${entrepriseId}/inventaires/${sessionId}/emplacements`,
    }),

    // Localiser un code (NART ou gencod) : zones + voisins de séquence
    rechercherLocalisation: builder.query({
      query: ({ entrepriseId, sessionId, code, emplacement }) => ({
        url: `${BASE}/${entrepriseId}/inventaires/${sessionId}/recherche`,
        params: { code, ...(emplacement ? { emplacement } : {}) },
      }),
    }),

    // Suggestions de la barre de recherche : code partiel OU mots de la
    // désignation (« marteau »), avec les zones de chaque article proposé.
    // `keepUnusedDataFor` court : la frappe produit une requête par saisie
    // stabilisée, inutile de garder longtemps des résultats intermédiaires.
    getSuggestionsLocalisation: builder.query({
      query: ({ entrepriseId, sessionId, q }) => ({
        url: `${BASE}/${entrepriseId}/inventaires/${sessionId}/suggestions`,
        params: { q },
      }),
      keepUnusedDataFor: 30,
    }),

    // Plan schématique de l'inventaire : emplacements → allées → zones
    getPlanLocalisation: builder.query({
      query: ({ entrepriseId, sessionId }) =>
        `${BASE}/${entrepriseId}/inventaires/${sessionId}/plan`,
      providesTags: ["LocalisationInventaire"],
    }),

    // Renommer un inventaire (nom d'affichage seulement, jamais le slug)
    renommerInventaireLocalisation: builder.mutation({
      query: ({ entrepriseId, sessionId, nom }) => ({
        url: `${BASE}/${entrepriseId}/inventaires/${sessionId}/nom`,
        method: "PATCH",
        body: { nom },
      }),
      invalidatesTags: ["LocalisationInventaire", "InventaireZone"],
    }),
  }),
});

export const {
  useGetInventairesLocalisationQuery,
  useGetEmplacementsLocalisationQuery,
  useLazyRechercherLocalisationQuery,
  useGetSuggestionsLocalisationQuery,
  useGetPlanLocalisationQuery,
  useRenommerInventaireLocalisationMutation,
} = localisationInventaireApiSlice;
