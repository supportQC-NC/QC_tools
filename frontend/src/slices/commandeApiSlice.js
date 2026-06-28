// src/slices/commandeApiSlice.js
import { apiSlice } from "./apiSlice";
import { COMMANDES_URL } from "../constants";

export const commandeApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    // ==========================================
    // ENTÊTES DE COMMANDES (cmdref.dbf)
    // ==========================================

    // Liste des commandes avec pagination et filtres avancés
    getCommandes: builder.query({
      query: ({
        nomDossierDBF,
        page,
        limit,
        // Filtres textuels
        search,
        numcde,
        fourn,
        bateau,
        cdvise,
        // Filtres booléens
        verrou,
        hasFacture,
        groupage,
        // Filtre numérique
        etat,
        // Filtres de dates
        dateDebut,
        dateFin,
      }) => ({
        url: `${COMMANDES_URL}/${nomDossierDBF}`,
        params: {
          page,
          limit,
          // Filtres textuels - ne pas envoyer si vide
          ...(search && { search }),
          ...(numcde && { numcde }),
          ...(fourn && { fourn }),
          ...(bateau && { bateau }),
          ...(cdvise && { cdvise }),
          // Filtres booléens (OUI -> "true")
          ...(verrou === "OUI" && { verrou: "true" }),
          ...(hasFacture === "OUI" && { hasFacture: "true" }),
          ...(groupage === "OUI" && { groupage: "true" }),
          // Filtre numérique - état
          ...(etat !== undefined && etat !== "" && etat !== "TOUT" && { etat }),
          // Filtres de dates
          ...(dateDebut && { dateDebut }),
          ...(dateFin && { dateFin }),
        },
      }),
      providesTags: ["Commande"],
      keepUnusedDataFor: 60,
    }),

    // Commande par numéro (entête + détails liés)
    getCommandeByNumcde: builder.query({
      query: ({ nomDossierDBF, numcde }) => ({
        url: `${COMMANDES_URL}/${nomDossierDBF}/code/${numcde}`,
      }),
      providesTags: ["Commande"],
    }),

    // Commandes d'un fournisseur
    getCommandesByFournisseur: builder.query({
      query: ({ nomDossierDBF, fourn, page, limit }) => ({
        url: `${COMMANDES_URL}/${nomDossierDBF}/fournisseur/${fourn}`,
        params: {
          ...(page && { page }),
          ...(limit && { limit }),
        },
      }),
      providesTags: ["Commande"],
    }),

    // Commandes contenant un article (recherche par NART dans cmdetail)
    getCommandesByArticle: builder.query({
      query: ({ nomDossierDBF, nart, page, limit }) => ({
        url: `${COMMANDES_URL}/${nomDossierDBF}/article/${nart}`,
        params: {
          ...(page && { page }),
          ...(limit && { limit }),
        },
      }),
      providesTags: ["Commande"],
    }),

    // Navigation entre commandes (prev/next)
    getAdjacentCommandes: builder.query({
      query: ({ nomDossierDBF, numcde }) => ({
        url: `${COMMANDES_URL}/${nomDossierDBF}/adjacent/${numcde}`,
      }),
      providesTags: ["Commande"],
      keepUnusedDataFor: 60,
    }),

    // Recherche de commandes
    searchCommandes: builder.query({
      query: ({ nomDossierDBF, q, field, limit }) => ({
        url: `${COMMANDES_URL}/${nomDossierDBF}/search`,
        params: { q, field, limit },
      }),
      providesTags: ["Commande"],
    }),

    // ==========================================
    // DÉTAILS DE COMMANDES (cmdetail.dbf)
    // ==========================================

    // Détails (lignes) d'une commande spécifique
    getCommandeDetails: builder.query({
      query: ({ nomDossierDBF, numcde }) => ({
        url: `${COMMANDES_URL}/${nomDossierDBF}/details/${numcde}`,
      }),
      providesTags: ["CommandeDetail"],
    }),

    // ==========================================
    // LISTES / UTILITAIRES
    // ==========================================

    // Liste des fournisseurs ayant des commandes
    getFournisseursCommandes: builder.query({
      query: (nomDossierDBF) => ({
        url: `${COMMANDES_URL}/${nomDossierDBF}/fournisseurs`,
      }),
      providesTags: ["Commande"],
      keepUnusedDataFor: 300, // Cache 5 min car change rarement
    }),

    // Liste des bateaux distincts
    getBateaux: builder.query({
      query: (nomDossierDBF) => ({
        url: `${COMMANDES_URL}/${nomDossierDBF}/bateaux`,
      }),
      providesTags: ["Commande"],
      keepUnusedDataFor: 300,
    }),

    // Liste des états distincts
    getEtatsCommandes: builder.query({
      query: (nomDossierDBF) => ({
        url: `${COMMANDES_URL}/${nomDossierDBF}/etats`,
      }),
      providesTags: ["Commande"],
      keepUnusedDataFor: 300,
    }),

    // Structure des fichiers DBF (cmdref + cmdetail)
    getCommandesStructure: builder.query({
      query: (nomDossierDBF) => ({
        url: `${COMMANDES_URL}/${nomDossierDBF}/structure`,
      }),
      providesTags: ["Commande"],
      keepUnusedDataFor: 600, // Cache 10 min
    }),

    // ==========================================
    // ADMIN
    // ==========================================

    // Invalider le cache des commandes (admin)
    invalidateCommandeCache: builder.mutation({
      query: (nomDossierDBF) => ({
        url: `${COMMANDES_URL}/${nomDossierDBF}/invalidate-cache`,
        method: "POST",
      }),
      invalidatesTags: ["Commande", "CommandeDetail"],
    }),

    // Statistiques du cache commandes (admin)
    getCommandeCacheStats: builder.query({
      query: () => ({
        url: `${COMMANDES_URL}/cache-stats`,
      }),
      keepUnusedDataFor: 30,
    }),
  }),
});

export const {
  // Entêtes
  useGetCommandesQuery,
  useGetCommandeByNumcdeQuery,
  useGetCommandesByFournisseurQuery,
  useGetCommandesByArticleQuery,
  useGetAdjacentCommandesQuery,
  useSearchCommandesQuery,
  // Détails
  useGetCommandeDetailsQuery,
  // Listes / Utilitaires
  useGetFournisseursCommandesQuery,
  useGetBateauxQuery,
  useGetEtatsCommandesQuery,
  useGetCommandesStructureQuery,
  // Admin
  useInvalidateCommandeCacheMutation,
  useGetCommandeCacheStatsQuery,
} = commandeApiSlice;