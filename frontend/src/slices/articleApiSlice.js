// src/slices/articleApiSlice.js
import { apiSlice } from "./apiSlice";
import { ARTICLES_URL } from "../constants";

// URL pour les photos
const PHOTOS_URL = "/api/photos";

export const articleApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    // Liste des articles avec pagination et filtres avancés côté serveur
    getArticles: builder.query({
      query: ({
        nomDossierDBF,
        page,
        limit,
        // Filtres textuels
        search,
        nart,
        groupe,
        fourn,
        gisement,
        // Filtres énumérés (TOUT, OUI, NON ou POSITIF, NUL, NEGATIF)
        stock,
        gencod,
        promo,
        deprec,
        web,
        photo,
        reappro,
        // Filtre numérique
        tgc,
      }) => ({
        url: `${ARTICLES_URL}/${nomDossierDBF}`,
        params: {
          page,
          limit,
          // Filtres textuels - ne pas envoyer si vide
          ...(search && { search }),
          ...(nart && { nart }),
          ...(groupe && { groupe }),
          ...(fourn && { fourn }),
          ...(gisement && { gisement }),
          // Convertir les filtres OUI/NON en booléens pour le backend
          // Stock: POSITIF = enStock:true, autres valeurs non supportées actuellement
          ...(stock === "POSITIF" && { enStock: "true" }),
          // Gencod: OUI = hasGencod:true, NON = hasGencod:false (pas supporté)
          ...(gencod === "OUI" && { hasGencod: "true" }),
          // Promo: OUI = hasPromo:true
          ...(promo === "OUI" && { hasPromo: "true" }),
          // Deprec: OUI = hasDeprec:true
          ...(deprec === "OUI" && { hasDeprec: "true" }),
          // Web: OUI = isWeb:true
          ...(web === "OUI" && { isWeb: "true" }),
          // Photo: OUI = hasPhoto:true
          ...(photo === "OUI" && { hasPhoto: "true" }),
          // Reappro: OUI = reapproMag:true
          ...(reappro === "OUI" && { reapproMag: "true" }),
          // TGC - filtre numérique
          ...(tgc && tgc !== "TOUT" && { tgc }),
        },
      }),
      providesTags: ["Article"],
      keepUnusedDataFor: 60,
    }),

    // Article par code NART
    getArticleByNart: builder.query({
      query: ({ nomDossierDBF, nart }) => ({
        url: `${ARTICLES_URL}/${nomDossierDBF}/code/${nart}`,
      }),
      providesTags: ["Article"],
    }),

    // Article par code barre GENCOD
    getArticleByGencod: builder.query({
      query: ({ nomDossierDBF, gencod }) => ({
        url: `${ARTICLES_URL}/${nomDossierDBF}/gencod/${gencod}`,
      }),
      providesTags: ["Article"],
    }),

    // ==========================================
    // NOUVEAU: Navigation entre articles (prev/next)
    // ==========================================
    getAdjacentArticles: builder.query({
      query: ({ nomDossierDBF, nart }) => ({
        url: `${ARTICLES_URL}/${nomDossierDBF}/adjacent/${nart}`,
      }),
      providesTags: ["Article"],
      keepUnusedDataFor: 60,
    }),

    // Recherche d'articles
    searchArticles: builder.query({
      query: ({ nomDossierDBF, q, field, limit }) => ({
        url: `${ARTICLES_URL}/${nomDossierDBF}/search`,
        params: { q, field, limit },
      }),
      providesTags: ["Article"],
    }),

    // Liste des groupes/familles
    getGroupes: builder.query({
      query: (nomDossierDBF) => ({
        url: `${ARTICLES_URL}/${nomDossierDBF}/groupes`,
      }),
      providesTags: ["Article"],
      keepUnusedDataFor: 300, // Cache 5 min car change rarement
    }),

    // Liste des taux TGC distincts
    getTgcRates: builder.query({
      query: (nomDossierDBF) => ({
        url: `${ARTICLES_URL}/${nomDossierDBF}/tgc-rates`,
      }),
      providesTags: ["Article"],
      keepUnusedDataFor: 300, // Cache 5 min car change rarement
    }),

    // Structure du fichier DBF
    getArticlesStructure: builder.query({
      query: (nomDossierDBF) => ({
        url: `${ARTICLES_URL}/${nomDossierDBF}/structure`,
      }),
      providesTags: ["Article"],
      keepUnusedDataFor: 600, // Cache 10 min
    }),

    // ==========================================
    // PHOTOS
    // ==========================================

    // Obtenir l'URL de la photo d'un article
    getArticlePhoto: builder.query({
      query: ({ trigramme, nart }) => ({
        url: `${PHOTOS_URL}/${trigramme}/${nart}`,
        responseHandler: async (response) => {
          // Retourner l'URL de la photo si elle existe
          if (response.ok) {
            return { exists: true, url: `${PHOTOS_URL}/${trigramme}/${nart}` };
          }
          return { exists: false, url: null };
        },
      }),
      providesTags: ["ArticlePhoto"],
      keepUnusedDataFor: 3600, // Cache 1 heure
    }),

    // Vérifier si une photo existe (HEAD request)
    checkPhotoExists: builder.query({
      query: ({ trigramme, nart }) => ({
        url: `${PHOTOS_URL}/${trigramme}/${nart}`,
        method: "HEAD",
      }),
      transformResponse: (response, meta) => {
        return { exists: meta?.response?.ok ?? false };
      },
      transformErrorResponse: () => {
        return { exists: false };
      },
      providesTags: ["ArticlePhoto"],
      keepUnusedDataFor: 3600,
    }),

    // Invalider le cache des articles (admin)
    invalidateArticleCache: builder.mutation({
      query: (nomDossierDBF) => ({
        url: `${ARTICLES_URL}/${nomDossierDBF}/invalidate-cache`,
        method: "POST",
      }),
      invalidatesTags: ["Article"],
    }),

    // Statistiques du cache (admin)
    getCacheStats: builder.query({
      query: () => ({
        url: `${ARTICLES_URL}/cache-stats`,
      }),
      keepUnusedDataFor: 30,
    }),
  }),
});

export const {
  useGetArticlesQuery,
  useGetArticleByNartQuery,
  useGetArticleByGencodQuery,
  useGetAdjacentArticlesQuery, // NOUVEAU
  useSearchArticlesQuery,
  useGetGroupesQuery,
  useGetTgcRatesQuery,
  useGetArticlesStructureQuery,
  useGetArticlePhotoQuery,
  useCheckPhotoExistsQuery,
  useInvalidateArticleCacheMutation,
  useGetCacheStatsQuery,
} = articleApiSlice;

// Helper pour construire l'URL de la photo
export const getPhotoUrl = (trigramme, nart) => {
  if (!trigramme || !nart) return null;
  return `${PHOTOS_URL}/${trigramme}/${nart.trim()}`;
};
