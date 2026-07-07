// src/slices/topArticlesApiSlice.js
import { apiSlice } from "./apiSlice";

const URL = "/api/top-articles";

export const topArticlesApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getTopArticles: builder.query({
      query: ({ nomDossierDBF, dateDebut, dateFin }) => ({
        url: `${URL}/${nomDossierDBF}`,
        params: { dateDebut, dateFin },
      }),
      keepUnusedDataFor: 60,
    }),
  }),
});

export const { useGetTopArticlesQuery } = topArticlesApiSlice;