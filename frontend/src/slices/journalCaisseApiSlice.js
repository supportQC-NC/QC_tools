// src/slices/journalCaisseApiSlice.js
import { apiSlice } from "./apiSlice";

const URL = "/api/journal-caisse";

export const journalCaisseApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getJournalCaisse: builder.query({
      query: ({ nomDossierDBF, date }) => ({
        url: `${URL}/${nomDossierDBF}`,
        params: { date },
      }),
      keepUnusedDataFor: 60,
    }),
  }),
});

export const { useGetJournalCaisseQuery } = journalCaisseApiSlice;