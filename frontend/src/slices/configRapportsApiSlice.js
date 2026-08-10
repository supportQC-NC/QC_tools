import { apiSlice } from "./apiSlice";

const URL = "/api/config-rapports";

// CRUD générique du socle « config rapports ». `resource` = nom d'URL
// (abonnements, groupes-prioritaires, …). Cache taggé par ressource.
export const configRapportsApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getConfigResource: builder.query({
      query: ({ resource, entrepriseId }) => ({
        url: `${URL}/${resource}`,
        params: entrepriseId ? { entrepriseId } : undefined,
      }),
      providesTags: (result, error, arg) => [
        { type: "ConfigRapports", id: arg.resource },
      ],
    }),
    createConfigResource: builder.mutation({
      query: ({ resource, body }) => ({
        url: `${URL}/${resource}`,
        method: "POST",
        body,
      }),
      invalidatesTags: (result, error, arg) => [
        { type: "ConfigRapports", id: arg.resource },
      ],
    }),
    updateConfigResource: builder.mutation({
      query: ({ resource, id, body }) => ({
        url: `${URL}/${resource}/${id}`,
        method: "PUT",
        body,
      }),
      invalidatesTags: (result, error, arg) => [
        { type: "ConfigRapports", id: arg.resource },
      ],
    }),
    deleteConfigResource: builder.mutation({
      query: ({ resource, id }) => ({
        url: `${URL}/${resource}/${id}`,
        method: "DELETE",
      }),
      invalidatesTags: (result, error, arg) => [
        { type: "ConfigRapports", id: arg.resource },
      ],
    }),
    // Import initial NON-DESTRUCTIF (bouton prod).
    seedConfigRapports: builder.mutation({
      query: () => ({ url: `${URL}/seed`, method: "POST" }),
      invalidatesTags: [
        { type: "ConfigRapports", id: "abonnements" },
        { type: "ConfigRapports", id: "groupes-prioritaires" },
        { type: "ConfigRapports", id: "groupes-speciaux" },
        { type: "ConfigRapports", id: "mails-compta" },
        { type: "ConfigRapports", id: "factures-auto" },
      ],
    }),
    // Complète les groupes prioritaires depuis article.dbf d'une société
    // (non destructif : n'ajoute que les codes GROUPE manquants).
    syncGroupesPrioritaires: builder.mutation({
      query: ({ entrepriseId }) => ({
        url: `${URL}/groupes-prioritaires/sync-articles`,
        method: "POST",
        body: { entrepriseId },
      }),
      invalidatesTags: [{ type: "ConfigRapports", id: "groupes-prioritaires" }],
    }),

    // Import Excel d'une ressource (complète les libellés / ajoute en masse).
    // `file` est un File ; fetchBaseQuery envoie le FormData tel quel.
    importConfigResource: builder.mutation({
      query: ({ resource, file, entrepriseId }) => {
        const form = new FormData();
        form.append("file", file);
        if (entrepriseId) form.append("entrepriseId", entrepriseId);
        return { url: `${URL}/${resource}/import`, method: "POST", body: form };
      },
      invalidatesTags: (result, error, arg) => [
        { type: "ConfigRapports", id: arg.resource },
      ],
    }),
  }),
});

export const {
  useSyncGroupesPrioritairesMutation,
  useImportConfigResourceMutation,
  useGetConfigResourceQuery,
  useCreateConfigResourceMutation,
  useUpdateConfigResourceMutation,
  useDeleteConfigResourceMutation,
  useSeedConfigRapportsMutation,
} = configRapportsApiSlice;
