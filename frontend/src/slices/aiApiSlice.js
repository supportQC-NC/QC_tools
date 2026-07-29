// src/slices/aiApiSlice.js
//
// Assistant IA : gestion des conversations (liste, détail, création, suppression).
// Le CHAT est streamé (SSE) directement via fetch dans l'écran, pas via RTK Query.
import { apiSlice } from "./apiSlice";

const AI_URL = "/api/ai";

export const aiApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getAiConversations: builder.query({
      query: (nomDossierDBF) => ({
        url: `${AI_URL}/${nomDossierDBF}/conversations`,
      }),
      providesTags: ["AiConversation"],
    }),
    getAiConversation: builder.query({
      query: ({ nomDossierDBF, id }) => ({
        url: `${AI_URL}/${nomDossierDBF}/conversations/${id}`,
      }),
    }),
    createAiConversation: builder.mutation({
      query: (nomDossierDBF) => ({
        url: `${AI_URL}/${nomDossierDBF}/conversations`,
        method: "POST",
      }),
      invalidatesTags: ["AiConversation"],
    }),
    deleteAiConversation: builder.mutation({
      query: ({ nomDossierDBF, id }) => ({
        url: `${AI_URL}/${nomDossierDBF}/conversations/${id}`,
        method: "DELETE",
      }),
      invalidatesTags: ["AiConversation"],
    }),
  }),
});

export const {
  useGetAiConversationsQuery,
  useGetAiConversationQuery,
  useCreateAiConversationMutation,
  useDeleteAiConversationMutation,
} = aiApiSlice;
