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

    // Mise en ligne (multipart : fichiers + noms alignés + dossier cible).
    uploadMedias: builder.mutation({
      query: ({ fichiers, noms, dossier }) => {
        const formData = new FormData();
        (fichiers || []).forEach((f) => formData.append("fichiers", f));
        formData.append("noms", JSON.stringify(noms || []));
        if (dossier) formData.append("dossier", dossier);
        return {
          url: MEDIATHEQUE_URL,
          method: "POST",
          body: formData,
          // Pas de Content-Type : le navigateur pose la boundary multipart.
        };
      },
      invalidatesTags: ["Media", "MediaDossier"],
    }),

    // Renommage et/ou déplacement (le lien public ne change jamais).
    // `dossier` : id de dossier, ou "" / null pour remettre à la racine.
    updateMedia: builder.mutation({
      query: ({ id, ...body }) => ({
        url: `${MEDIATHEQUE_URL}/${id}`,
        method: "PATCH",
        body,
      }),
      invalidatesTags: ["Media", "MediaDossier"],
    }),

    // Suppression (le lien public cesse de fonctionner).
    deleteMedia: builder.mutation({
      query: (id) => ({
        url: `${MEDIATHEQUE_URL}/${id}`,
        method: "DELETE",
      }),
      invalidatesTags: ["Media", "MediaDossier"],
    }),

    // ===== Dossiers de classement =====
    getMediaDossiers: builder.query({
      query: () => ({ url: `${MEDIATHEQUE_URL}/dossiers` }),
      providesTags: ["MediaDossier"],
    }),

    createMediaDossier: builder.mutation({
      query: ({ nom }) => ({
        url: `${MEDIATHEQUE_URL}/dossiers`,
        method: "POST",
        body: { nom },
      }),
      invalidatesTags: ["MediaDossier"],
    }),

    updateMediaDossier: builder.mutation({
      query: ({ id, nom }) => ({
        url: `${MEDIATHEQUE_URL}/dossiers/${id}`,
        method: "PATCH",
        body: { nom },
      }),
      // Le nom du dossier apparaît aussi sur les cartes (media.dossier.nom).
      invalidatesTags: ["MediaDossier", "Media"],
    }),

    // Suppression d'un dossier : ses fichiers reviennent à la racine.
    deleteMediaDossier: builder.mutation({
      query: (id) => ({
        url: `${MEDIATHEQUE_URL}/dossiers/${id}`,
        method: "DELETE",
      }),
      invalidatesTags: ["MediaDossier", "Media"],
    }),
  }),
});

export const {
  useGetMediasQuery,
  useUploadMediasMutation,
  useUpdateMediaMutation,
  useDeleteMediaMutation,
  useGetMediaDossiersQuery,
  useCreateMediaDossierMutation,
  useUpdateMediaDossierMutation,
  useDeleteMediaDossierMutation,
} = mediathequeApiSlice;
