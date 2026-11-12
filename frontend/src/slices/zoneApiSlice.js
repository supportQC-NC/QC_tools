// frontend/src/slices/zoneApiSlice.js
import { apiSlice } from "./apiSlice";

const ZONES_URL = "/api/zones";

export const zoneApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    // Import CSV (remplacement total) — multipart/form-data, champ "fichier"
    importZones: builder.mutation({
      query: ({ entrepriseId, fichier }) => {
        const formData = new FormData();
        formData.append("fichier", fichier);
        return {
          url: `${ZONES_URL}/import/${entrepriseId}`,
          method: "POST",
          body: formData,
          // Ne pas définir Content-Type : le navigateur ajoute la boundary multipart
        };
      },
      invalidatesTags: ["Zone"],
    }),

    // Génération des fiches rayons depuis le dictionnaire des rayons (remplacement total)
    genererZonesDepuisDictionnaire: builder.mutation({
      query: ({ entrepriseId }) => ({
        url: `${ZONES_URL}/generer-dictionnaire/${entrepriseId}`,
        method: "POST",
      }),
      invalidatesTags: ["Zone"],
    }),

    // État du dictionnaire des rayons de la société (disponible ? combien de
    // rayons parents ?) — sert à annoncer « aucun dictionnaire disponible pour
    // cette entreprise » avant que l'utilisateur ne tente la génération.
    getZonesDictionnaire: builder.query({
      query: ({ entrepriseId }) => `${ZONES_URL}/${entrepriseId}/dictionnaire`,
      providesTags: ["Zone"],
    }),

    // EMPLACEMENTS (types de zone) de la société : ceux du dictionnaire des
    // rayons + ceux des fiches de zone (donc les zones ajoutées à la main).
    // Remplace la liste en dur « MAGASIN / DOCK / S3 / S4 / S5 », qui décrivait
    // les dépôts de stock de l'ERP et non le magasin réel.
    getZonesEmplacements: builder.query({
      query: ({ entrepriseId }) => `${ZONES_URL}/${entrepriseId}/emplacements`,
      providesTags: ["Zone"],
    }),

    // Liste des zones d'une entreprise (recherche serveur optionnelle via ?search=)
    getZones: builder.query({
      query: ({ entrepriseId, search }) => ({
        url: `${ZONES_URL}/${entrepriseId}`,
        params: search ? { search } : undefined,
      }),
      providesTags: ["Zone"],
    }),

    getZoneByCode: builder.query({
      query: ({ entrepriseId, code }) =>
        `${ZONES_URL}/${entrepriseId}/code/${encodeURIComponent(code)}`,
      providesTags: ["Zone"],
    }),

    // ⚠️ Les trois saisies unitaires invalident aussi « InventaireZone » : côté
    // serveur elles font rejoindre / quitter le snapshot de l'inventaire ACTIF
    // (zoneController), donc l'écran Progression doit refetcher plutôt
    // qu'attendre son prochain poll.
    createZone: builder.mutation({
      query: ({ entrepriseId, ...data }) => ({
        url: `${ZONES_URL}/${entrepriseId}`,
        method: "POST",
        body: data,
      }),
      invalidatesTags: ["Zone", "InventaireZone"],
    }),

    updateZone: builder.mutation({
      query: ({ entrepriseId, id, ...data }) => ({
        url: `${ZONES_URL}/${entrepriseId}/${id}`,
        method: "PUT",
        body: data,
      }),
      invalidatesTags: ["Zone", "InventaireZone"],
    }),

    deleteZone: builder.mutation({
      query: ({ entrepriseId, id }) => ({
        url: `${ZONES_URL}/${entrepriseId}/${id}`,
        method: "DELETE",
      }),
      invalidatesTags: ["Zone", "InventaireZone"],
    }),

    deleteAllZones: builder.mutation({
      query: ({ entrepriseId }) => ({
        url: `${ZONES_URL}/${entrepriseId}`,
        method: "DELETE",
      }),
      invalidatesTags: ["Zone"],
    }),
  }),
});

export const {
  useImportZonesMutation,
  useGenererZonesDepuisDictionnaireMutation,
  useGetZonesDictionnaireQuery,
  useGetZonesEmplacementsQuery,
  useGetZonesQuery,
  useLazyGetZonesQuery,
  useGetZoneByCodeQuery,
  useCreateZoneMutation,
  useUpdateZoneMutation,
  useDeleteZoneMutation,
  useDeleteAllZonesMutation,
} = zoneApiSlice;