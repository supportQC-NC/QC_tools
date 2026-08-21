// frontend/src/slices/inventaireCollecteApiSlice.js
import { apiSlice } from "./apiSlice";

const BASE = "/api/inventaires-collecte";

export const inventaireCollecteApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    // Récap de la session ACTIVE, regroupé par zone, avec écarts
    // (quantité bipée − stock théorique S1+S2+S3+S4+S5).
    getRecapZones: builder.query({
      query: (entrepriseId) => `${BASE}/recap-zones/${entrepriseId}`,
      providesTags: ["InventaireZone"],
    }),

    // ─── Suivi bipage ────────────────────────────────────────────────────
    // Qui a bipé quelle zone, quand, combien de temps, avec quelles
    // observations (agent sur le collecteur + suivi depuis le web).
    getSuiviBipage: builder.query({
      query: ({ entrepriseId, session, statut, search }) => ({
        url: `${BASE}/suivi-bipage/${entrepriseId}`,
        params: {
          ...(session && { session }),
          ...(statut && { statut }),
          ...(search && { search }),
        },
      }),
      providesTags: ["SuiviBipage"],
    }),

    updateObservationBipage: builder.mutation({
      query: ({ entrepriseId, id, observation }) => ({
        url: `${BASE}/suivi-bipage/${entrepriseId}/${id}/observation`,
        method: "PATCH",
        body: { observation },
      }),
      invalidatesTags: ["SuiviBipage"],
    }),
  }),
});

export const {
  useGetRecapZonesQuery,
  useGetSuiviBipageQuery,
  useUpdateObservationBipageMutation,
} = inventaireCollecteApiSlice;
