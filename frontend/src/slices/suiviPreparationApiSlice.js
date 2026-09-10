// src/slices/suiviPreparationApiSlice.js
//
// Suivi des préparations de commande : le serveur fusionne les préparations
// scannées au collecteur et les fiches manuelles, et ne renvoie que des
// compteurs (jamais les lignes d'une proforma).
import { apiSlice } from "./apiSlice";

const URL = "/api/suivi-preparations";

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
    }),
  }),
});

export const { useGetSuiviPreparationsQuery } = suiviPreparationApiSlice;
