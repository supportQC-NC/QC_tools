import { apiSlice } from "./apiSlice";

const URL = "/api/rapport-tgc";

// Module « Rapports TGC ». Le rapport passe par RTK Query ; l'export Excel est
// téléchargé via fetch (réponse binaire) directement dans l'écran.
export const rapportTgcApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getRapportTgc: builder.query({
      // { nomDossierDBF, year, month }
      query: ({ nomDossierDBF, year, month }) => ({
        url: `${URL}/${nomDossierDBF}`,
        params: year && month ? { year, month } : undefined,
      }),
      providesTags: ["RapportTgc"],
    }),
  }),
});

export const { useGetRapportTgcQuery } = rapportTgcApiSlice;
