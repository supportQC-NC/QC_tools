import { apiSlice } from "./apiSlice";

const URL = "/api/commercial";

// ESPACE COMMERCIAL — API du portefeuille personnel d'un commercial.
// Toutes les données sont filtrées côté serveur sur le couple
// SOCIÉTÉ + CODE VENDEUR (REPRES) de l'utilisateur connecté : aucun paramètre
// de code n'est envoyé depuis le front (et n'y serait pas pris en compte).
export const commercialApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    // Sociétés + codes vendeur rattachés à l'utilisateur.
    getMonProfilCommercial: builder.query({
      query: () => `${URL}/profil`,
      providesTags: ["CommercialProfil"],
    }),

    // Dashboard : toutes ses sociétés (dossier omis) ou une seule.
    getCommercialDashboard: builder.query({
      query: ({ dossier, joursRelance, joursInactif } = {}) => ({
        url: `${URL}/dashboard`,
        params: { dossier, joursRelance, joursInactif },
      }),
      providesTags: ["CommercialDashboard"],
    }),

    // Volet CA du dashboard : requête SÉPARÉE car elle dépend du cache des
    // factures (plusieurs minutes à froid). Le dashboard s'affiche sans elle.
    getCommercialDashboardCa: builder.query({
      query: ({ dossier, joursInactif } = {}) => ({
        url: `${URL}/dashboard/ca`,
        params: { dossier, joursInactif },
      }),
      providesTags: ["CommercialDashboard"],
    }),

    // Portefeuille clients (clients.REPRES).
    getCommercialClients: builder.query({
      query: ({ dossier, ...params }) => ({
        url: `${URL}/${dossier}/clients`,
        params,
      }),
      providesTags: ["CommercialClients"],
    }),

    // Fiche client 360°.
    getCommercialClient: builder.query({
      query: ({ dossier, tiers }) => `${URL}/${dossier}/clients/${tiers}`,
      providesTags: ["CommercialClients"],
    }),

    // Proformas / réservations / commandes spéciales (proforma.REPRES + ETAT).
    getCommercialProformas: builder.query({
      query: ({ dossier, ...params }) => ({
        url: `${URL}/${dossier}/proformas`,
        params,
      }),
      providesTags: ["CommercialProformas"],
    }),

    // Réservations & commandes spéciales : facture.dbf TYPFACT="R"
    // (≠ proformas). ETAT 1 = réservation, 2 = commande spéciale.
    getCommercialReservations: builder.query({
      query: ({ dossier, ...params }) => ({
        url: `${URL}/${dossier}/reservations`,
        params,
      }),
      providesTags: ["CommercialProformas"],
    }),

    // Entrée en stock des réservations (statut par document).
    // ⚠️ Requête SÉPARÉE de la liste : elle croise detail.dbf × entrees.dbf et
    // peut prendre plusieurs dizaines de secondes à froid. Le front affiche la
    // liste d'abord, puis complète la colonne « Stock » quand elle arrive.
    getCommercialReservationsDisponibilites: builder.query({
      query: ({ dossier, fenetreMois }) => ({
        url: `${URL}/${dossier}/reservations/disponibilites`,
        params: { fenetreMois },
      }),
      providesTags: ["CommercialReservationsDispo"],
    }),

    // Lignes d'une réservation + disponibilité article par article.
    getCommercialReservationLignes: builder.query({
      query: ({ dossier, numfact }) =>
        `${URL}/${dossier}/reservations/${numfact}/lignes`,
      providesTags: ["CommercialReservationsDispo"],
    }),

    // « J'ai prévenu le client que sa réservation est arrivée. »
    marquerClientPrevenu: builder.mutation({
      query: ({ dossier, numfact, ...body }) => ({
        url: `${URL}/${dossier}/reservations/${numfact}/prevenu`,
        method: "POST",
        body,
      }),
      invalidatesTags: ["CommercialProformas", "CommercialReservationsDispo"],
    }),

    annulerClientPrevenu: builder.mutation({
      query: ({ dossier, numfact }) => ({
        url: `${URL}/${dossier}/reservations/${numfact}/prevenu`,
        method: "DELETE",
      }),
      invalidatesTags: ["CommercialProformas", "CommercialReservationsDispo"],
    }),

    getCommercialProformaLignes: builder.query({
      query: ({ dossier, numfact }) =>
        `${URL}/${dossier}/proformas/${numfact}/lignes`,
      providesTags: ["CommercialProformas"],
    }),

    // Factures (facture.REPRES).
    getCommercialFactures: builder.query({
      query: ({ dossier, ...params }) => ({
        url: `${URL}/${dossier}/factures`,
        params,
      }),
      providesTags: ["CommercialFactures"],
    }),

    // ── Analyse (portage du rapport Power BI) ────────────────────────────────
    getCommercialAnalyse: builder.query({
      query: ({ dossier, ...params }) => ({
        url: `${URL}/${dossier}/analyse`,
        params,
      }),
      providesTags: ["CommercialAnalyse"],
    }),

    getCommercialAnalyseFiltres: builder.query({
      query: ({ dossier }) => `${URL}/${dossier}/analyse/filtres`,
      providesTags: ["CommercialAnalyse"],
    }),

    // ── Prime (paramétrée par chaque commercial) ─────────────────────────────
    getCommercialPrime: builder.query({
      query: ({ dossier, annee, mois }) => ({
        url: `${URL}/${dossier}/prime`,
        params: { annee, mois },
      }),
      providesTags: ["CommercialPrime"],
    }),

    getCommercialPrimeConfig: builder.query({
      query: ({ dossier }) => `${URL}/${dossier}/prime/config`,
      providesTags: ["CommercialPrime"],
    }),

    updateCommercialPrimeConfig: builder.mutation({
      query: ({ dossier, ...body }) => ({
        url: `${URL}/${dossier}/prime/config`,
        method: "PUT",
        body,
      }),
      invalidatesTags: ["CommercialPrime"],
    }),

    // Alertes « commande spéciale / réservation disponible » (entrée en stock).
    // ⚠️ Premier appel long (scan DBF) : à charger à part du dashboard.
    getCommercialAlertes: builder.query({
      query: ({ dossier, jours }) => ({
        url: `${URL}/${dossier}/alertes`,
        params: { jours },
      }),
      providesTags: ["CommercialAlertes"],
    }),

    marquerAlertesVues: builder.mutation({
      query: ({ dossier, cles }) => ({
        url: `${URL}/${dossier}/alertes/vues`,
        method: "POST",
        body: { cles },
      }),
      invalidatesTags: ["CommercialAlertes"],
    }),

    // Relances clients sur proformas.
    getCommercialRelances: builder.query({
      query: ({ dossier }) => `${URL}/${dossier}/relances`,
      providesTags: ["CommercialRelances"],
    }),

    enregistrerRelance: builder.mutation({
      query: ({ dossier, ...body }) => ({
        url: `${URL}/${dossier}/relances`,
        method: "POST",
        body,
      }),
      invalidatesTags: [
        "CommercialRelances",
        "CommercialProformas",
        "CommercialDashboard",
      ],
    }),

    enregistrerRelancesLot: builder.mutation({
      query: ({ dossier, ...body }) => ({
        url: `${URL}/${dossier}/relances/lot`,
        method: "POST",
        body,
      }),
      invalidatesTags: [
        "CommercialRelances",
        "CommercialProformas",
        "CommercialDashboard",
      ],
    }),

    supprimerRelance: builder.mutation({
      query: ({ dossier, numfact }) => ({
        url: `${URL}/${dossier}/relances/${numfact}`,
        method: "DELETE",
      }),
      invalidatesTags: [
        "CommercialRelances",
        "CommercialProformas",
        "CommercialDashboard",
      ],
    }),
  }),
});

export const {
  useGetMonProfilCommercialQuery,
  useGetCommercialDashboardQuery,
  useGetCommercialDashboardCaQuery,
  useGetCommercialClientsQuery,
  useGetCommercialClientQuery,
  useGetCommercialProformasQuery,
  useGetCommercialReservationsQuery,
  useGetCommercialReservationsDisponibilitesQuery,
  useGetCommercialReservationLignesQuery,
  useMarquerClientPrevenuMutation,
  useAnnulerClientPrevenuMutation,
  useGetCommercialProformaLignesQuery,
  useGetCommercialFacturesQuery,
  useGetCommercialAnalyseQuery,
  useGetCommercialAnalyseFiltresQuery,
  useGetCommercialPrimeQuery,
  useGetCommercialPrimeConfigQuery,
  useUpdateCommercialPrimeConfigMutation,
  useGetCommercialAlertesQuery,
  useMarquerAlertesVuesMutation,
  useGetCommercialRelancesQuery,
  useEnregistrerRelanceMutation,
  useEnregistrerRelancesLotMutation,
  useSupprimerRelanceMutation,
} = commercialApiSlice;
