// src/slices/proformaApiSlice.js
import { apiSlice } from "./apiSlice";

const PROFORMAS_URL = "/api/proformas";

export const proformaApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    // Liste des proformas avec pagination et filtres
    getProformas: builder.query({
      query: ({
        nomDossierDBF,
        page,
        limit,
        search,
        tiers,
        repres,
        etat,
        dateDebut,
        dateFin,
      }) => ({
        url: `${PROFORMAS_URL}/${nomDossierDBF}`,
        params: {
          page,
          limit,
          ...(search && { search }),
          ...(tiers && { tiers }),
          ...(repres && { repres }),
          ...(etat !== undefined && etat !== "" && etat !== "TOUT" && { etat }),
          ...(dateDebut && { dateDebut }),
          ...(dateFin && { dateFin }),
        },
      }),
      providesTags: ["Proforma"],
      keepUnusedDataFor: 60,
    }),

    // Détail d'une proforma par NUMFACT (entête + lignes détail enrichies)
    getProformaByNumfact: builder.query({
      query: ({ nomDossierDBF, numfact }) => ({
        url: `${PROFORMAS_URL}/${nomDossierDBF}/${numfact}`,
      }),
      providesTags: ["Proforma"],
    }),

    // Recherche de proformas
    searchProformas: builder.query({
      query: ({ nomDossierDBF, q, limit }) => ({
        url: `${PROFORMAS_URL}/${nomDossierDBF}/search`,
        params: { q, limit },
      }),
      providesTags: ["Proforma"],
    }),

    // Proformas par tiers/client
    getProformasByTiers: builder.query({
      query: ({ nomDossierDBF, tiers, page, limit }) => ({
        url: `${PROFORMAS_URL}/${nomDossierDBF}/tiers/${tiers}`,
        params: { page, limit },
      }),
      providesTags: ["Proforma"],
      keepUnusedDataFor: 60,
    }),

    // Liste des représentants distincts
    getRepresentants: builder.query({
      query: (nomDossierDBF) => ({
        url: `${PROFORMAS_URL}/${nomDossierDBF}/representants`,
      }),
      providesTags: ["Proforma"],
      keepUnusedDataFor: 300,
    }),

    // Structure des fichiers DBF (proforma + prodet)
    getProformasStructure: builder.query({
      query: (nomDossierDBF) => ({
        url: `${PROFORMAS_URL}/${nomDossierDBF}/structure`,
      }),
      providesTags: ["Proforma"],
      keepUnusedDataFor: 600,
    }),

    // Invalider le cache proformas (admin)
    invalidateProformaCache: builder.mutation({
      query: (nomDossierDBF) => ({
        url: `${PROFORMAS_URL}/${nomDossierDBF}/invalidate-cache`,
        method: "POST",
      }),
      invalidatesTags: ["Proforma"],
    }),

    // Statistiques du cache proformas (admin)
    getProformaCacheStats: builder.query({
      query: () => ({
        url: `${PROFORMAS_URL}/cache-stats`,
      }),
      keepUnusedDataFor: 30,
    }),

    // =============================================
// À AJOUTER dans proformaApiSlice.js
// =============================================

// Ajouter ce endpoint dans les endpoints:
//
//   // Enregistrer un .dat sur le serveur
  saveProformaDat: builder.mutation({
    query: ({ nomDossierDBF, numfact, datContent }) => ({
      url: `${PROFORMAS_URL}/${nomDossierDBF}/${numfact}/save-dat`,
      method: "POST",
      body: { datContent },
    }),
  }),

 
  }),
});

export const {
  useGetProformasQuery,
  useGetProformaByNumfactQuery,
  useSaveProformaDatMutation,
  useSearchProformasQuery,
  useGetProformasByTiersQuery,
  useGetRepresentantsQuery,
  useGetProformasStructureQuery,
  useInvalidateProformaCacheMutation,
  useGetProformaCacheStatsQuery,
} = proformaApiSlice;