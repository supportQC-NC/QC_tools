import { apiSlice } from "./apiSlice";

const URL = "/api/historique-pachat";

// Module « Historique prix d'achat » : évolution du PACHAT d'un article dans le
// temps (dérivée des commandes cmdetail/cmdref).
export const pachatHistoriqueApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getPachatHistorique: builder.query({
      // { nomDossierDBF, nart }
      query: ({ nomDossierDBF, nart }) => ({
        url: `${URL}/${nomDossierDBF}/article/${encodeURIComponent(nart)}`,
      }),
      providesTags: ["PachatHistorique"],
    }),

    // Liste des fournisseurs présents dans les commandes (sélecteur).
    getPachatFournisseurs: builder.query({
      query: ({ nomDossierDBF }) => ({
        url: `${URL}/${nomDossierDBF}/fournisseurs`,
      }),
      providesTags: ["PachatHistorique"],
    }),

    // Classement des évolutions de prix d'achat (hausses d'abord par défaut).
    getPachatEvolutions: builder.query({
      // { nomDossierDBF, fourn?, sens? }
      query: ({ nomDossierDBF, fourn, sens }) => ({
        url: `${URL}/${nomDossierDBF}/evolutions`,
        params: {
          ...(fourn ? { fourn } : {}),
          ...(sens ? { sens } : {}),
        },
      }),
      providesTags: ["PachatHistorique"],
    }),

    // Historisation globale (toutes sociétés) — admin. Rafraîchit les vues.
    historiserPachat: builder.mutation({
      query: () => ({
        url: `${URL}/historiser`,
        method: "POST",
      }),
      invalidatesTags: ["PachatHistorique"],
    }),
  }),
});

export const {
  useGetPachatHistoriqueQuery,
  useLazyGetPachatHistoriqueQuery,
  useGetPachatFournisseursQuery,
  useGetPachatEvolutionsQuery,
  useHistoriserPachatMutation,
} = pachatHistoriqueApiSlice;
