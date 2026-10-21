// src/slices/mediathequeApiSlice.js
//
// Médiathèque : banque d'images / pages HTML en ligne (signatures mail).
// Le lien PUBLIC d'un média est `media.url` (relatif) — pour le coller dans
// une signature, le préfixer par l'origine : mediaLienAbsolu(media).

import { apiSlice } from "./apiSlice";

const MEDIATHEQUE_URL = "/api/mediatheque";

// Lien public absolu, tel qu'on le colle dans Gmail/Outlook.
export const mediaLienAbsolu = (media) =>
  `${window.location.origin}${media?.url || ""}`;

export const mediathequeApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    // Liste des médias (métadonnées + lien public).
    getMedias: builder.query({
      query: () => ({ url: MEDIATHEQUE_URL }),
      providesTags: ["Media"],
    }),

    // Mise en ligne (multipart : fichiers + noms alignés).
    uploadMedias: builder.mutation({
      query: ({ fichiers, noms }) => {
        const formData = new FormData();
        (fichiers || []).forEach((f) => formData.append("fichiers", f));
        formData.append("noms", JSON.stringify(noms || []));
        return {
          url: MEDIATHEQUE_URL,
          method: "POST",
          body: formData,
          // Pas de Content-Type : le navigateur pose la boundary multipart.
        };
      },
      invalidatesTags: ["Media"],
    }),

    // Renommage (nom d'affichage seul : le lien public ne change jamais).
    updateMedia: builder.mutation({
      query: ({ id, nom }) => ({
        url: `${MEDIATHEQUE_URL}/${id}`,
        method: "PATCH",
        body: { nom },
      }),
      invalidatesTags: ["Media"],
    }),

    // Suppression (le lien public cesse de fonctionner).
    deleteMedia: builder.mutation({
      query: (id) => ({
        url: `${MEDIATHEQUE_URL}/${id}`,
        method: "DELETE",
      }),
      invalidatesTags: ["Media"],
    }),
  }),
});

export const {
  useGetMediasQuery,
  useUploadMediasMutation,
  useUpdateMediaMutation,
  useDeleteMediaMutation,
} = mediathequeApiSlice;
