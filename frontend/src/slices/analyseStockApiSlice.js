// src/slices/analyseStockApiSlice.js
//
// Analyse stock : classeurs analyse_stock_<trig>_<MM>_<AAAA>.xlsx du FTPS
// robot-documents (un par société et par mois, le cache serveur accumule
// l'historique). Lecture seule, cache serveur mtime.

import { apiSlice } from "./apiSlice";

const URL = "/api/analyse-stock";

export const analyseStockApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    // Sociétés du périmètre ayant au moins un classeur (+ leurs périodes).
    getAnalyseStockSources: builder.query({
      query: () => ({ url: URL }),
      keepUnusedDataFor: 300,
    }),

    // Synthèse société : KPI, répartition, évolution, rotation, tops.
    getAnalyseStockSynthese: builder.query({
      query: ({ nomDossierDBF, periode }) => ({
        url: `${URL}/societe/${nomDossierDBF}`,
        params: periode ? { periode } : undefined,
      }),
      keepUnusedDataFor: 300,
    }),

    // Explorateur d'articles (filtre + tri + pagination côté serveur).
    getAnalyseStockArticles: builder.query({
      query: ({ nomDossierDBF, ...params }) => ({
        url: `${URL}/societe/${nomDossierDBF}/articles`,
        params,
      }),
      keepUnusedDataFor: 120,
    }),
  }),
});

export const {
  useGetAnalyseStockSourcesQuery,
  useGetAnalyseStockSyntheseQuery,
  useGetAnalyseStockArticlesQuery,
} = analyseStockApiSlice;
