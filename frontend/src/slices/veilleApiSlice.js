// src/slices/veilleApiSlice.js
//
// Endpoints RTK Query du module « Veille ». Aucune notion de société : une
// veille est personnelle, le backend filtre sur l'utilisateur connecté.
import { apiSlice } from "./apiSlice";
import { VEILLE_URL } from "../constants";

export const veilleApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    // État du module (clés IA / recherche web présentes) + valeurs par défaut
    // du formulaire et trame du prompt.
    getVeilleEtat: builder.query({
      query: () => ({ url: `${VEILLE_URL}/etat` }),
    }),

    // ─── Mes veilles ─────────────────────────────────────────────────────
    getVeilleConfigs: builder.query({
      query: () => ({ url: `${VEILLE_URL}/configs` }),
      providesTags: ["VeilleConfig"],
    }),

    createVeilleConfig: builder.mutation({
      query: (body) => ({
        url: `${VEILLE_URL}/configs`,
        method: "POST",
        body,
      }),
      invalidatesTags: ["VeilleConfig"],
    }),

    updateVeilleConfig: builder.mutation({
      query: ({ id, ...body }) => ({
        url: `${VEILLE_URL}/configs/${id}`,
        method: "PUT",
        body,
      }),
      invalidatesTags: ["VeilleConfig"],
    }),

    deleteVeilleConfig: builder.mutation({
      query: (id) => ({
        url: `${VEILLE_URL}/configs/${id}`,
        method: "DELETE",
      }),
      invalidatesTags: ["VeilleConfig", "VeilleRapport"],
    }),

    // Le prompt exact qui partira au modèle, réglages appliqués.
    getVeilleApercuPrompt: builder.query({
      query: (id) => ({ url: `${VEILLE_URL}/configs/${id}/apercu-prompt` }),
      keepUnusedDataFor: 5,
    }),

    genererVeille: builder.mutation({
      query: (id) => ({
        url: `${VEILLE_URL}/configs/${id}/generer`,
        method: "POST",
      }),
      invalidatesTags: ["VeilleRapport"],
    }),

    // ─── Rapports ────────────────────────────────────────────────────────
    getVeilleRapports: builder.query({
      query: ({ configId, limit } = {}) => ({
        url: `${VEILLE_URL}/rapports`,
        params: { ...(configId && { configId }), ...(limit && { limit }) },
      }),
      providesTags: ["VeilleRapport"],
    }),

    deleteVeilleRapport: builder.mutation({
      query: (id) => ({
        url: `${VEILLE_URL}/rapports/${id}`,
        method: "DELETE",
      }),
      invalidatesTags: ["VeilleRapport"],
    }),
  }),
});

export const {
  useGetVeilleEtatQuery,
  useGetVeilleConfigsQuery,
  useCreateVeilleConfigMutation,
  useUpdateVeilleConfigMutation,
  useDeleteVeilleConfigMutation,
  useGetVeilleApercuPromptQuery,
  useGenererVeilleMutation,
  useGetVeilleRapportsQuery,
  useDeleteVeilleRapportMutation,
} = veilleApiSlice;
