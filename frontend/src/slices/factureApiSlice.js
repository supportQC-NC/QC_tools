// src/slices/factureApiSlice.js
import { apiSlice } from "./apiSlice";

const FACTURES_URL = "/api/factures";

export const factureApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    // Liste des factures avec pagination et filtres
    getFactures: builder.query({
      query: ({
        nomDossierDBF,
        page,
        limit,
        search,
        tiers,
        repres,
        etat,
        typfact,
        dateDebut,
        dateFin,
      }) => ({
        url: `${FACTURES_URL}/${nomDossierDBF}`,
        params: {
          page,
          limit,
          ...(search && { search }),
          ...(tiers && { tiers }),
          ...(repres && { repres }),
          ...(etat !== undefined && etat !== "" && etat !== "TOUT" && { etat }),
          ...(typfact && typfact !== "TOUT" && { typfact }),
          ...(dateDebut && { dateDebut }),
          ...(dateFin && { dateFin }),
        },
      }),
      providesTags: ["Facture"],
      keepUnusedDataFor: 60,
    }),

    // Détail d'une facture par NUMFACT
    getFactureByNumfact: builder.query({
      query: ({ nomDossierDBF, numfact }) => ({
        url: `${FACTURES_URL}/${nomDossierDBF}/${numfact}`,
      }),
      providesTags: ["Facture"],
    }),

    // Recherche
    searchFactures: builder.query({
      query: ({ nomDossierDBF, q, limit }) => ({
        url: `${FACTURES_URL}/${nomDossierDBF}/search`,
        params: { q, limit },
      }),
      providesTags: ["Facture"],
    }),

    // Factures par tiers
    getFacturesByTiers: builder.query({
      query: ({ nomDossierDBF, tiers, page, limit }) => ({
        url: `${FACTURES_URL}/${nomDossierDBF}/tiers/${tiers}`,
        params: { page, limit },
      }),
      providesTags: ["Facture"],
      keepUnusedDataFor: 60,
    }),

    // Représentants distincts
    getFactureRepresentants: builder.query({
      query: (nomDossierDBF) => ({
        url: `${FACTURES_URL}/${nomDossierDBF}/representants`,
      }),
      providesTags: ["Facture"],
      keepUnusedDataFor: 300,
    }),

    // Structure DBF
    getFacturesStructure: builder.query({
      query: (nomDossierDBF) => ({
        url: `${FACTURES_URL}/${nomDossierDBF}/structure`,
      }),
      providesTags: ["Facture"],
      keepUnusedDataFor: 600,
    }),

    // Enregistrer .dat sur le serveur
    saveFactureDat: builder.mutation({
      query: ({ nomDossierDBF, numfact, datContent, fileName }) => ({
        url: `${FACTURES_URL}/${nomDossierDBF}/${numfact}/save-dat`,
        method: "POST",
        body: { datContent, fileName },
      }),
    }),

    // Invalider le cache (admin)
    invalidateFactureCache: builder.mutation({
      query: (nomDossierDBF) => ({
        url: `${FACTURES_URL}/${nomDossierDBF}/invalidate-cache`,
        method: "POST",
      }),
      invalidatesTags: ["Facture"],
    }),

    // Stats du cache (admin)
    getFactureCacheStats: builder.query({
      query: () => ({
        url: `${FACTURES_URL}/cache-stats`,
      }),
      keepUnusedDataFor: 30,
    }),
  }),
});

export const {
  useGetFacturesQuery,
  useGetFactureByNumfactQuery,
  useSearchFacturesQuery,
  useGetFacturesByTiersQuery,
  useGetFactureRepresentantsQuery,
  useGetFacturesStructureQuery,
  useSaveFactureDatMutation,
  useInvalidateFactureCacheMutation,
  useGetFactureCacheStatsQuery,
} = factureApiSlice;