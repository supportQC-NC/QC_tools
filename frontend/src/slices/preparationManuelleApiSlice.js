// frontend/src/slices/preparationManuelleApiSlice.js
//
// Module « Préparation de commande manuelle » : proformas à préparer (DBF) +
// suivi des fiches papier imprimées. Le PDF n'est PAS géré ici (téléchargement
// de blob via fetch direct dans l'écran, cf. PreparationManuelleScreen).
import { apiSlice } from "./apiSlice";

const URL = "/api/preparation-manuelle";

export const preparationManuelleApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    // Liste paginée des proformas à préparer (ETAT = 2) + statut de suivi
    getProformasAPreparerManuel: builder.query({
      query: ({
        nomDossierDBF,
        page = 1,
        limit = 50,
        search = "",
        statut = "",
      }) => ({
        url: `${URL}/${nomDossierDBF}/proformas`,
        params: {
          page,
          limit,
          ...(search ? { search } : {}),
          ...(statut ? { statut } : {}),
        },
      }),
      providesTags: ["PreparationManuelle"],
    }),

    // Détail d'une proforma (parcours dock puis magasin, avant impression)
    getProformaManuelDetails: builder.query({
      query: ({ nomDossierDBF, numfact }) =>
        `${URL}/${nomDossierDBF}/proformas/${encodeURIComponent(numfact)}`,
      providesTags: ["PreparationManuelle"],
    }),

    // Historique des fiches imprimées / préparées
    getHistoriqueFichesPreparation: builder.query({
      query: ({ nomDossierDBF, limit = 30 }) => ({
        url: `${URL}/${nomDossierDBF}/historique`,
        params: { limit },
      }),
      providesTags: ["PreparationManuelle"],
    }),

    // Statut de suivi (a_preparer | imprime | prepare)
    updateStatutFichePreparation: builder.mutation({
      query: ({ nomDossierDBF, numfact, statut, commentaire }) => ({
        url: `${URL}/${nomDossierDBF}/proformas/${encodeURIComponent(
          numfact,
        )}/statut`,
        method: "PUT",
        body: { statut, ...(commentaire !== undefined ? { commentaire } : {}) },
      }),
      invalidatesTags: ["PreparationManuelle"],
    }),

    // Remise à zéro du suivi d'une proforma
    resetSuiviFichePreparation: builder.mutation({
      query: ({ nomDossierDBF, numfact }) => ({
        url: `${URL}/${nomDossierDBF}/proformas/${encodeURIComponent(
          numfact,
        )}/suivi`,
        method: "DELETE",
      }),
      invalidatesTags: ["PreparationManuelle"],
    }),
  }),
});

export const {
  useGetProformasAPreparerManuelQuery,
  useGetProformaManuelDetailsQuery,
  useGetHistoriqueFichesPreparationQuery,
  useUpdateStatutFichePreparationMutation,
  useResetSuiviFichePreparationMutation,
} = preparationManuelleApiSlice;
