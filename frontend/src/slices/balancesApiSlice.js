import { apiSlice } from "./apiSlice";

const URL = "/api/balances-clients";

// Module « Balances / clients à bloquer ». Le tableau passe par RTK Query ;
// l'Excel est téléchargé via fetch (réponse binaire) dans l'écran.
export const balancesApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getBalancesReport: builder.query({
      query: (nomDossierDBF) => ({ url: `${URL}/${nomDossierDBF}` }),
      providesTags: ["Balances"],
    }),
  }),
});

export const { useGetBalancesReportQuery } = balancesApiSlice;
