// src/slices/messageApiSlice.js
//
// Envoi de messages AVEC fichiers (multipart) et suppression. Le texte pur passe
// par le socket (voir ChatPanel) ; ici c'est le chemin REST pour les pièces
// jointes et la modération.
import { apiSlice } from "./apiSlice";

const MESSAGES_URL = "/api/messages";

// URL d'un fichier attaché (pour <img> ou triggerDownload/openInNewTab).
export const messageFileUrl = (messageId, fileId) =>
  `${MESSAGES_URL}/${messageId}/files/${fileId}`;

export const messageApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    // Envoi avec fichiers : le FormData laisse le navigateur poser le boundary.
    sendMessageWithFiles: builder.mutation({
      query: ({ room, texte, files, replyTo, mentions }) => {
        const fd = new FormData();
        fd.append("room", room);
        if (texte) fd.append("texte", texte);
        if (replyTo) fd.append("replyTo", replyTo);
        if (mentions && mentions.length)
          fd.append("mentions", JSON.stringify(mentions));
        (files || []).forEach((f) => fd.append("files", f));
        return { url: MESSAGES_URL, method: "POST", body: fd };
      },
    }),
    deleteMessage: builder.mutation({
      query: (id) => ({ url: `${MESSAGES_URL}/${id}`, method: "DELETE" }),
    }),
    reactToMessage: builder.mutation({
      query: ({ id, type }) => ({
        url: `${MESSAGES_URL}/${id}/react`,
        method: "POST",
        body: { type },
      }),
    }),
    // Fichiers & médias partagés d'un salon (galerie du panneau latéral).
    getRoomMedia: builder.query({
      query: (room) => ({ url: `${MESSAGES_URL}/media`, params: { room } }),
      keepUnusedDataFor: 30,
    }),
    editMessage: builder.mutation({
      query: ({ id, texte }) => ({
        url: `${MESSAGES_URL}/${id}`,
        method: "PUT",
        body: { texte },
      }),
    }),
    pinMessage: builder.mutation({
      query: (id) => ({ url: `${MESSAGES_URL}/${id}/pin`, method: "POST" }),
    }),
  }),
});

export const {
  useSendMessageWithFilesMutation,
  useDeleteMessageMutation,
  useReactToMessageMutation,
  useGetRoomMediaQuery,
  useEditMessageMutation,
  usePinMessageMutation,
} = messageApiSlice;
