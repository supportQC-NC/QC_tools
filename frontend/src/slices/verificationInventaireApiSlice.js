// frontend/src/slices/verificationInventaireApiSlice.js
//
// Module Vérification point rouge : balayage des scotchs sans point rouge en
// fin d'inventaire, croisement avec les bipages de l'allée.
import { apiSlice } from "./apiSlice";

const BASE = "/api/verification-inventaire";

export const verificationInventaireApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    // Allées de l'inventaire actif (état de contrôle) + compteurs du journal
    getContexteVerification: builder.query({
      query: (entrepriseId) => `${BASE}/${entrepriseId}/contexte`,
      providesTags: ["VerificationInventaire"],
    }),

    // Croisement d'un code bipé avec les bipages de l'allée
    verifierCodeAllee: builder.query({
      query: ({ entrepriseId, allee, code }) => ({
        url: `${BASE}/${entrepriseId}/verifier`,
        params: { allee, code },
      }),
    }),

    // Conforme : point rouge oublié, on trace
    confirmerVerification: builder.mutation({
      query: ({ entrepriseId, allee, code }) => ({
        url: `${BASE}/${entrepriseId}/confirmer`,
        method: "POST",
        body: { allee, code },
      }),
      invalidatesTags: ["VerificationInventaire"],
    }),

    // Oubli / écart : la quantité du scotch fait foi → ligne au bipage
    ajouterAuBipage: builder.mutation({
      query: ({
        entrepriseId,
        allee,
        code,
        qteScotch,
        zoneCode,
        zoneType,
        observation,
      }) => ({
        url: `${BASE}/${entrepriseId}/ajouter`,
        method: "POST",
        body: { allee, code, qteScotch, zoneCode, zoneType, observation },
      }),
      // La ligne créée doit ressortir dans le Détail des bipages sans F5.
      invalidatesTags: ["VerificationInventaire", "Bipage"],
    }),
  }),
});

export const {
  useGetContexteVerificationQuery,
  useLazyVerifierCodeAlleeQuery,
  useConfirmerVerificationMutation,
  useAjouterAuBipageMutation,
} = verificationInventaireApiSlice;
