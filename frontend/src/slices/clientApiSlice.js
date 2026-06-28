// src/slices/clientApiSlice.js
import { apiSlice } from "./apiSlice";

const CLIENTS_URL = "/api/clients";

export const clientApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    // Liste des clients avec pagination et TOUS les filtres
    getClients: builder.query({
      query: ({ nomDossierDBF, page, limit, search, repres, catcli, type, categorie, groupe, banque, codtarif, cltva, ecotaxe, sav, fdm, compte }) => ({
        url: `${CLIENTS_URL}/${nomDossierDBF}`,
        params: {
          page,
          limit,
          ...(search && { search }),
          ...(repres && { repres }),
          ...(catcli && catcli !== "TOUT" && { catcli }),
          ...(type && type !== "TOUT" && { type }),
          ...(categorie && categorie !== "TOUT" && { categorie }),
          ...(groupe && groupe !== "TOUT" && { groupe }),
          ...(banque && banque !== "TOUT" && { banque }),
          ...(codtarif && codtarif !== "TOUT" && { codtarif }),
          ...(cltva && cltva !== "TOUT" && { cltva }),
          ...(ecotaxe && ecotaxe !== "TOUT" && { ecotaxe }),
          ...(sav && sav !== "TOUT" && { sav }),
          ...(fdm && fdm !== "TOUT" && { fdm }),
          ...(compte && compte !== "TOUT" && { compte }),
        },
      }),
      providesTags: ["Client"],
      keepUnusedDataFor: 60,
    }),

    // Détail d'un client par TIERS
    getClientByTiers: builder.query({
      query: ({ nomDossierDBF, tiers }) => ({
        url: `${CLIENTS_URL}/${nomDossierDBF}/${tiers}`,
      }),
      providesTags: ["Client"],
    }),

    // Cross-entreprise
    getClientCrossEntreprise: builder.query({
      query: ({ nomDossierDBF, tiers }) => ({
        url: `${CLIENTS_URL}/${nomDossierDBF}/${tiers}/cross-entreprise`,
      }),
      providesTags: ["Client"],
      keepUnusedDataFor: 120,
    }),

    // Recherche
    searchClients: builder.query({
      query: ({ nomDossierDBF, q, limit }) => ({
        url: `${CLIENTS_URL}/${nomDossierDBF}/search`,
        params: { q, limit },
      }),
      providesTags: ["Client"],
    }),

    // TOUTES les valeurs de filtres en un seul appel
    getClientFilterValues: builder.query({
      query: (nomDossierDBF) => ({
        url: `${CLIENTS_URL}/${nomDossierDBF}/filter-values`,
      }),
      providesTags: ["Client"],
      keepUnusedDataFor: 300,
    }),

    // Structure DBF
    getClientsStructure: builder.query({
      query: (nomDossierDBF) => ({
        url: `${CLIENTS_URL}/${nomDossierDBF}/structure`,
      }),
      providesTags: ["Client"],
      keepUnusedDataFor: 600,
    }),

    // Invalider le cache (admin)
    invalidateClientCache: builder.mutation({
      query: (nomDossierDBF) => ({
        url: `${CLIENTS_URL}/${nomDossierDBF}/invalidate-cache`,
        method: "POST",
      }),
      invalidatesTags: ["Client"],
    }),

    // Stats du cache (admin)
    getClientCacheStats: builder.query({
      query: () => ({
        url: `${CLIENTS_URL}/cache-stats`,
      }),
      keepUnusedDataFor: 30,
    }),
  }),
});

export const {
  useGetClientsQuery,
  useGetClientByTiersQuery,
  useGetClientCrossEntrepriseQuery,
  useSearchClientsQuery,
  useGetClientFilterValuesQuery,
  useGetClientsStructureQuery,
  useInvalidateClientCacheMutation,
  useGetClientCacheStatsQuery,
} = clientApiSlice;