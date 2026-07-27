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
      query: ({ room, texte, files }) => {
        const fd = new FormData();
        fd.append("room", room);
        if (texte) fd.append("texte", texte);
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
  }),
});

export const {
  useSendMessageWithFilesMutation,
  useDeleteMessageMutation,
  useReactToMessageMutation,
} = messageApiSlice;
