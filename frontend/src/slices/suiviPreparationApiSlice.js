// src/slices/suiviPreparationApiSlice.js
//
// Suivi des préparations de commande : le serveur fusionne les préparations
// scannées au collecteur et les fiches manuelles, et ne renvoie que des
// compteurs (jamais les lignes d'une proforma).
//
// L'écran porte aussi la PRIORITÉ URGENTE (17/11/2026) : la liste des
// commandes à préparer (proformas ETAT = 2, la même que l'app mobile) avec un
// menu déroulant Normale/Urgente par commande. Une commande urgente sort en
// tête et en rouge sur le collecteur.
import { apiSlice } from "./apiSlice";

const URL = "/api/suivi-preparations";
const URL_PREPARATIONS = "/api/preparations";

export const suiviPreparationApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getSuiviPreparations: builder.query({
      query: ({ nomDossierDBF, etat, origine, jours }) => ({
        url: `${URL}/${nomDossierDBF}`,
        params: {
          ...(etat ? { etat } : {}),
          ...(origine ? { origine } : {}),
          ...(jours !== undefined ? { jours } : {}),
        },
      }),
      keepUnusedDataFor: 30,
      // Les lignes portent le badge urgent : refetch quand une urgence change.
      providesTags: ["PreparationUrgence"],
    }),

    // Commandes à préparer (ETAT = 2), urgentes en tête — la même liste que
    // l'app mobile, pour poser la priorité depuis le web.
    getProformasAPreparer: builder.query({
      query: ({ nomDossierDBF, search }) => ({
        url: `${URL_PREPARATIONS}/a-preparer/${nomDossierDBF}`,
        params: { limit: 200, ...(search ? { search } : {}) },
      }),
      keepUnusedDataFor: 30,
      providesTags: ["PreparationUrgence"],
    }),

    // Poser / lever l'urgence d'une commande (menu déroulant).
    setUrgencePreparation: builder.mutation({
      query: ({ entrepriseId, numpro, urgent }) => ({
        url: `${URL_PREPARATIONS}/urgence/${entrepriseId}`,
        method: "PUT",
        body: { numpro, urgent },
      }),
      invalidatesTags: ["PreparationUrgence"],
    }),
  }),
});

export const {
  useGetSuiviPreparationsQuery,
  useGetProformasAPreparerQuery,
  useSetUrgencePreparationMutation,
} = suiviPreparationApiSlice;
