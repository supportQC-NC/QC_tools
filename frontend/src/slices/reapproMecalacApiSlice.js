// src/slices/reapproMecalacApiSlice.js
//
// Réappro « Mécalac » : entrepôts de la société, analyse d'un entrepôt vers le
// rayon, résolution d'un code saisi à la main, génération du .dat.
// Module SANS ÉTAT côté serveur : aucune donnée à invalider, donc aucun tag.
import { apiSlice } from "./apiSlice";

const URL = "/api/reappro-mecalac";

export const reapproMecalacApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    // Entrepôts sources S2..S5 (noms de la fiche société + volumes).
    getEntrepotsMecalac: builder.query({
      query: (entrepriseId) => `${URL}/${entrepriseId}/entrepots`,
      keepUnusedDataFor: 300,
    }),

    // Analyse à la demande : déclenchée par le bouton « Analyser », jamais au
    // chargement de l'écran — le balayage du catalogue coûte plusieurs secondes.
    analyserMecalac: builder.mutation({
      query: ({ entrepriseId, depot, fourn, limit }) => {
        const params = new URLSearchParams();
        params.set("depot", depot);
        if (fourn) params.set("fourn", fourn);
        if (limit) params.set("limit", String(limit));
        return { url: `${URL}/${entrepriseId}/analyse?${params.toString()}` };
      },
    }),

    resoudreArticleMecalac: builder.mutation({
      query: ({ entrepriseId, code, depot }) => ({
        url: `${URL}/${entrepriseId}/article`,
        method: "POST",
        body: { code, depot },
      }),
    }),

    genererDatMecalac: builder.mutation({
      query: ({ entrepriseId, depot, nom, lignes }) => ({
        url: `${URL}/${entrepriseId}/generer`,
        method: "POST",
        body: { depot, nom, lignes },
      }),
    }),
  }),
});

export const {
  useGetEntrepotsMecalacQuery,
  useAnalyserMecalacMutation,
  useResoudreArticleMecalacMutation,
  useGenererDatMecalacMutation,
} = reapproMecalacApiSlice;
