// frontend/src/slices/verificationInventaireApiSlice.js
//
// Module Vérification point rouge : balayage des scotchs sans point rouge en
// fin d'inventaire, rayon par rayon — l'agent bipe le QR du rayon puis chaque
// scotch, le croisement est STRICT sur le rayon bipé (26/11/2026).
import { apiSlice } from "./apiSlice";

const BASE = "/api/verification-inventaire";

export const verificationInventaireApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    // Allées de l'inventaire actif (état de contrôle) + compteurs du journal
    getContexteVerification: builder.query({
      query: (entrepriseId) => `${BASE}/${entrepriseId}/contexte`,
      providesTags: ["VerificationInventaire"],
    }),

    // Résolution du QR de rayon bipé vers une zone de l'allée (plusieurs
    // correspondances possibles sur un code brut : MAGASIN/DOCK à choisir)
    resoudreRayonVerification: builder.query({
      query: ({ entrepriseId, allee, code }) => ({
        url: `${BASE}/${entrepriseId}/rayon`,
        params: { allee, code },
      }),
    }),

    // Croisement d'un code bipé avec les bipages du rayon
    verifierCodeAllee: builder.query({
      query: ({ entrepriseId, allee, zoneCode, zoneType, code }) => ({
        url: `${BASE}/${entrepriseId}/verifier`,
        params: { allee, zoneCode, zoneType, code },
      }),
    }),

    // Conforme : point rouge oublié, on trace
    confirmerVerification: builder.mutation({
      query: ({ entrepriseId, allee, zoneCode, zoneType, code }) => ({
        url: `${BASE}/${entrepriseId}/confirmer`,
        method: "POST",
        body: { allee, zoneCode, zoneType, code },
      }),
      invalidatesTags: ["VerificationInventaire"],
    }),

    // Oubli / écart : la quantité du scotch fait foi → ligne au bipage,
    // rattachée au rayon bipé
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
  useLazyResoudreRayonVerificationQuery,
  useLazyVerifierCodeAlleeQuery,
  useConfirmerVerificationMutation,
  useAjouterAuBipageMutation,
} = verificationInventaireApiSlice;
