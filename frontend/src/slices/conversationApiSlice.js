// src/slices/conversationApiSlice.js
//
// Discussions de l'Espace équipe (liste unifiée global/équipes/users).
import { apiSlice } from "./apiSlice";

const CONV_URL = "/api/conversations";

// URL de la photo d'un groupe (cache-bustée par photoUpdatedAt).
export const convPhotoUrl = (id, v) =>
  `${CONV_URL}/${id}/photo${v ? `?v=${encodeURIComponent(v)}` : ""}`;

export const conversationApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getConversations: builder.query({
      query: () => ({ url: CONV_URL }),
      providesTags: ["Conversation"],
      keepUnusedDataFor: 30,
    }),
    // Membres d'un salon (pour le panneau « Participants »). room = "global" |
    // "team:<id>" | "conv:<id>" | "task:<id>".
    getRoomMembers: builder.query({
      query: (room) => ({ url: `${CONV_URL}/members`, params: { room } }),
      keepUnusedDataFor: 60,
    }),
    createConversation: builder.mutation({
      query: (data) => ({ url: CONV_URL, method: "POST", body: data }),
      invalidatesTags: ["Conversation"],
    }),
    deleteConversation: builder.mutation({
      query: (id) => ({ url: `${CONV_URL}/${id}`, method: "DELETE" }),
      invalidatesTags: ["Conversation"],
    }),
    leaveConversation: builder.mutation({
      query: (id) => ({ url: `${CONV_URL}/${id}/leave`, method: "POST" }),
      invalidatesTags: ["Conversation"],
    }),
    uploadConversationPhoto: builder.mutation({
      query: ({ id, file }) => {
        const fd = new FormData();
        fd.append("photo", file);
        return { url: `${CONV_URL}/${id}/photo`, method: "POST", body: fd };
      },
      invalidatesTags: ["Conversation"],
    }),
    deleteConversationPhoto: builder.mutation({
      query: (id) => ({ url: `${CONV_URL}/${id}/photo`, method: "DELETE" }),
      invalidatesTags: ["Conversation"],
    }),
  }),
});

export const {
  useGetConversationsQuery,
  useGetRoomMembersQuery,
  useCreateConversationMutation,
  useDeleteConversationMutation,
  useLeaveConversationMutation,
  useUploadConversationPhotoMutation,
  useDeleteConversationPhotoMutation,
} = conversationApiSlice;
