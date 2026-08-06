import { apiSlice } from "./apiSlice";

const URL = "/api/resa-entrees";

// Module « Entrées sur réservation ». La grille passe par RTK Query ; l'export
// Excel est téléchargé via fetch (réponse binaire) dans l'écran.
export const resaEntreesApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getResaEntrees: builder.query({
      // { nomDossierDBF, start, end } — dates "YYYY-MM-DD".
      query: ({ nomDossierDBF, start, end }) => ({
        url: `${URL}/${nomDossierDBF}`,
        params: { start, end },
      }),
      providesTags: ["ResaEntrees"],
    }),
  }),
});

export const { useGetResaEntreesQuery } = resaEntreesApiSlice;
