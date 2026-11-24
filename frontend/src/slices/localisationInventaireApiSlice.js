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
  useRenommerInventaireLocalisationMutation,
} = localisationInventaireApiSlice;
