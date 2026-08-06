import { apiSlice } from "./apiSlice";

const URL = "/api/suivi-entrees";

// Module « Suivi des entrées ». La grille passe par RTK Query ; l'export Excel
// est téléchargé via fetch (réponse binaire) directement dans l'écran.
export const suiviEntreesApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getSuiviEntrees: builder.query({
      // { nomDossierDBF, date } — date au format "YYYY-MM-DD".
      query: ({ nomDossierDBF, date }) => ({
        url: `${URL}/${nomDossierDBF}`,
        params: date ? { date } : undefined,
      }),
      providesTags: ["SuiviEntrees"],
    }),
    // Flag Résa chargé À PART (scan detail.dbf lourd) -> { date, narts:[...] }.
    getReservationsEntrees: builder.query({
      query: ({ nomDossierDBF, date }) => ({
        url: `${URL}/${nomDossierDBF}/reservations`,
        params: date ? { date } : undefined,
      }),
      providesTags: ["SuiviEntrees"],
    }),
  }),
});

export const { useGetSuiviEntreesQuery, useGetReservationsEntreesQuery } =
  suiviEntreesApiSlice;
