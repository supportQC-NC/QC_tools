// src/slices/raccourcisApiSlice.js
//
// Raccourcis du tableau de bord personnel (accueil « / »).
// Le serveur ne range qu'une liste de chemins : les libellés, icônes et droits
// viennent du catalogue de menu (config/menuConfig.js), côté client.
import { apiSlice } from "./apiSlice";

const URL = "/api/raccourcis";

export const raccourcisApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getMesRaccourcis: builder.query({
      query: () => `${URL}/me`,
      providesTags: ["Raccourcis"],
    }),

    setMesRaccourcis: builder.mutation({
      query: (raccourcis) => ({
        url: `${URL}/me`,
        method: "PUT",
        body: { raccourcis },
      }),
      invalidatesTags: ["Raccourcis"],
    }),

    // Retour à « tous mes onglets ».
    resetMesRaccourcis: builder.mutation({
      query: () => ({ url: `${URL}/me`, method: "DELETE" }),
      invalidatesTags: ["Raccourcis"],
    }),
  }),
});

export const {
  useGetMesRaccourcisQuery,
  useSetMesRaccourcisMutation,
  useResetMesRaccourcisMutation,
} = raccourcisApiSlice;
