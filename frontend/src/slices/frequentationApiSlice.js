// frontend/src/slices/frequentationApiSlice.js
//
// Module « Fréquentation magasin » : agrégats horaires calculés depuis les
// factures éditées. L'export Excel se fait par fetch direct (blob) dans l'écran.
import { apiSlice } from "./apiSlice";

const URL = "/api/frequentation";

export const frequentationApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getFrequentation: builder.query({
      query: ({ nomDossierDBF, du, au, pas }) => ({
        url: `${URL}/${nomDossierDBF}`,
        params: { du, au, pas },
      }),
      providesTags: ["Frequentation"],
    }),
  }),
});

export const {
  useGetFrequentationQuery,
  useLazyGetFrequentationQuery,
} = frequentationApiSlice;
