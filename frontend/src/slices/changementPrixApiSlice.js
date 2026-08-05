import { apiSlice } from "./apiSlice";

const URL = "/api/changement-prix";

// Module « Changement de prix de vente » (mode manuel).
// Le tableau passe par RTK Query ; l'Excel et le PDF d'étiquettes sont
// téléchargés via fetch (réponses binaires) directement dans l'écran.
export const changementPrixApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getChangementsPrix: builder.query({
      // { nomDossierDBF, date } — date au format "YYYY-MM-DD".
      query: ({ nomDossierDBF, date }) => ({
        url: `${URL}/${nomDossierDBF}`,
        params: date ? { date } : undefined,
      }),
      providesTags: ["ChangementPrix"],
    }),
  }),
});

export const { useGetChangementsPrixQuery } = changementPrixApiSlice;
