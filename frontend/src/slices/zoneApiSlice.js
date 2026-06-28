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

    createZone: builder.mutation({
      query: ({ entrepriseId, ...data }) => ({
        url: `${ZONES_URL}/${entrepriseId}`,
        method: "POST",
        body: data,
      }),
      invalidatesTags: ["Zone"],
    }),

    updateZone: builder.mutation({
      query: ({ entrepriseId, id, ...data }) => ({
        url: `${ZONES_URL}/${entrepriseId}/${id}`,
        method: "PUT",
        body: data,
      }),
      invalidatesTags: ["Zone"],
    }),

    deleteZone: builder.mutation({
      query: ({ entrepriseId, id }) => ({
        url: `${ZONES_URL}/${entrepriseId}/${id}`,
        method: "DELETE",
      }),
      invalidatesTags: ["Zone"],
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
  useGetZonesQuery,
  useLazyGetZonesQuery,
  useGetZoneByCodeQuery,
  useCreateZoneMutation,
  useUpdateZoneMutation,
  useDeleteZoneMutation,
  useDeleteAllZonesMutation,
} = zoneApiSlice;