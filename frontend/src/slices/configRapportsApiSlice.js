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
  }),
});

export const {
  useGetConfigResourceQuery,
  useCreateConfigResourceMutation,
  useUpdateConfigResourceMutation,
  useDeleteConfigResourceMutation,
  useSeedConfigRapportsMutation,
} = configRapportsApiSlice;
