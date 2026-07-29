// src/slices/aiApiSlice.js
//
// Assistant IA : sociétés accessibles (sélecteur) + conversations (par user).
// Le CHAT est streamé (SSE) via fetch dans l'écran, avec le périmètre (scope).
import { apiSlice } from "./apiSlice";

const AI_URL = "/api/ai";

export const aiApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getAiCompanies: builder.query({
      query: () => ({ url: `${AI_URL}/companies` }),
    }),
    getAiConversations: builder.query({
      query: () => ({ url: `${AI_URL}/conversations` }),
      providesTags: ["AiConversation"],
    }),
    getAiConversation: builder.query({
      query: (id) => ({ url: `${AI_URL}/conversations/${id}` }),
    }),
    createAiConversation: builder.mutation({
      query: () => ({ url: `${AI_URL}/conversations`, method: "POST" }),
      invalidatesTags: ["AiConversation"],
    }),
    deleteAiConversation: builder.mutation({
      query: (id) => ({ url: `${AI_URL}/conversations/${id}`, method: "DELETE" }),
      invalidatesTags: ["AiConversation"],
    }),
  }),
});

export const {
  useGetAiCompaniesQuery,
  useGetAiConversationsQuery,
  useGetAiConversationQuery,
  useCreateAiConversationMutation,
  useDeleteAiConversationMutation,
} = aiApiSlice;
