// frontend/src/slices/receptionManuelleApiSlice.js
//
// Module « Contrôle réception manuel » : commandes à contrôler (DBF) + suivi
// des fiches papier imprimées. Le PDF n'est PAS géré ici (téléchargement de
// blob via fetch direct dans l'écran, cf. ReceptionManuelleScreen).
import { apiSlice } from "./apiSlice";

const URL = "/api/reception-manuelle";

export const receptionManuelleApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    // Liste paginée des commandes à contrôler + statut de suivi
    getCommandesAControlerManuel: builder.query({
      query: ({ nomDossierDBF, page = 1, limit = 50, search = "", statut = "" }) => ({
        url: `${URL}/${nomDossierDBF}/commandes`,
        params: { page, limit, ...(search ? { search } : {}), ...(statut ? { statut } : {}) },
      }),
      providesTags: ["ReceptionManuelle"],
    }),

    // Détail d'une commande (aperçu des lignes avant impression)
    getCommandeManuelDetails: builder.query({
      query: ({ nomDossierDBF, numcde }) =>
        `${URL}/${nomDossierDBF}/commandes/${encodeURIComponent(numcde)}`,
      providesTags: ["ReceptionManuelle"],
    }),

    // Historique des fiches imprimées / contrôlées
    getHistoriqueFichesReception: builder.query({
      query: ({ nomDossierDBF, limit = 30 }) => ({
        url: `${URL}/${nomDossierDBF}/historique`,
        params: { limit },
      }),
      providesTags: ["ReceptionManuelle"],
    }),

    // Statut de suivi (a_controler | imprime | controle)
    updateStatutFicheReception: builder.mutation({
      query: ({ nomDossierDBF, numcde, statut, commentaire }) => ({
        url: `${URL}/${nomDossierDBF}/commandes/${encodeURIComponent(numcde)}/statut`,
        method: "PUT",
        body: { statut, ...(commentaire !== undefined ? { commentaire } : {}) },
      }),
      invalidatesTags: ["ReceptionManuelle"],
    }),

    // Remise à zéro du suivi d'une commande
    resetSuiviFicheReception: builder.mutation({
      query: ({ nomDossierDBF, numcde }) => ({
        url: `${URL}/${nomDossierDBF}/commandes/${encodeURIComponent(numcde)}/suivi`,
        method: "DELETE",
      }),
      invalidatesTags: ["ReceptionManuelle"],
    }),
  }),
});

export const {
  useGetCommandesAControlerManuelQuery,
  useGetCommandeManuelDetailsQuery,
  useGetHistoriqueFichesReceptionQuery,
  useUpdateStatutFicheReceptionMutation,
  useResetSuiviFicheReceptionMutation,
} = receptionManuelleApiSlice;
