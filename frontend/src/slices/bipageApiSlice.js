// frontend/src/slices/bipageApiSlice.js
import { apiSlice } from "./apiSlice";

const BASE = "/api/bipages";

/** URL d'export CSV (relative à BASE_URL). Inclut zone, type et search. */
export const getBipagesCsvUrl = (entrepriseId, { zone, type, search } = {}) => {
  const params = new URLSearchParams();
  if (zone) params.set("zone", zone);
  if (type) params.set("type", type);
  if (search) params.set("search", search);
  const qs = params.toString();
  return `${BASE}/${entrepriseId}/export${qs ? `?${qs}` : ""}`;
};

export const bipageApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getBipages: builder.query({
      query: ({ entrepriseId, zone, type, search }) => {
        const params = new URLSearchParams();
        if (zone) params.set("zone", zone);
        if (type) params.set("type", type);
        if (search) params.set("search", search);
        const qs = params.toString();
        return `${BASE}/${entrepriseId}${qs ? `?${qs}` : ""}`;
      },
      providesTags: ["Bipage"],
    }),

    updateBipage: builder.mutation({
      query: ({ entrepriseId, id, body }) => ({
        url: `${BASE}/${entrepriseId}/${id}`,
        method: "PUT",
        body,
      }),
      // pas d'invalidation globale : on met à jour la ligne localement
    }),

    // « Recommencer » une zone : efface lignes + statut imprimé + fichiers .DAT/PDF,
    // et réautorise le re-bipage. Invalide la liste pour rafraîchir l'écran.
    recommencerZone: builder.mutation({
      query: ({ entrepriseId, zoneCode }) => ({
        url: `${BASE}/${entrepriseId}/recommencer`,
        method: "POST",
        body: { zoneCode },
      }),
      invalidatesTags: ["Bipage"],
    }),
  }),
});

export const {
  useGetBipagesQuery,
  useUpdateBipageMutation,
  useRecommencerZoneMutation,
} = bipageApiSlice;