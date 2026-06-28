// frontend/src/slices/inventaireProformaApiSlice.js
import { apiSlice } from "./apiSlice";

const URL = "/api/inventaire-proforma";

export const inventaireProformaApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    // Liste des tiers présents dans les proformas (code + nom)
    getProformaTiers: builder.query({
      query: (nomDossierDBF) => ({
        url: `${URL}/${nomDossierDBF}/tiers`,
      }),
      keepUnusedDataFor: 120,
    }),

    // Proformas d'un tiers (+ filtre date), groupées par NUMFACT, triées par NL
    getInventaireProformaByTiers: builder.query({
      query: ({ nomDossierDBF, tiers, dateDebut, dateFin }) => ({
        url: `${URL}/${nomDossierDBF}/tiers/${tiers}`,
        params: {
          ...(dateDebut && { dateDebut }),
          ...(dateFin && { dateFin }),
        },
      }),
      keepUnusedDataFor: 60,
    }),
  }),
});

export const {
  useGetProformaTiersQuery,
  useGetInventaireProformaByTiersQuery,
} = inventaireProformaApiSlice;