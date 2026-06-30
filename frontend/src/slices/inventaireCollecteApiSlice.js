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
  }),
});

export const { useGetRecapZonesQuery } = inventaireCollecteApiSlice;