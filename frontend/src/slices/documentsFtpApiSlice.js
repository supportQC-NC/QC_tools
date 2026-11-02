// src/slices/documentsFtpApiSlice.js
import { apiSlice } from "./apiSlice";

const URL = "/api/documents-ftp";

export const documentsFtpApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getDocumentsFtp: builder.query({
      query: ({ nomDossierDBF, chemin }) => ({
        url: `${URL}/${nomDossierDBF}`,
        params: { chemin: chemin || "" },
      }),
      providesTags: ["DocumentsFtp"],
      keepUnusedDataFor: 30,
    }),
    // Téléversement de fichiers dans le dossier courant (multipart).
    uploadDocumentsFtp: builder.mutation({
      query: ({ nomDossierDBF, chemin, fichiers }) => {
        const body = new FormData();
        body.append("chemin", chemin || "");
        fichiers.forEach((f) => body.append("fichiers", f));
        return { url: `${URL}/${nomDossierDBF}/televerser`, method: "POST", body };
      },
      invalidatesTags: ["DocumentsFtp"],
    }),
    // Suppression d'UN fichier (chemin relatif sous la racine société).
    deleteDocumentFtp: builder.mutation({
      query: ({ nomDossierDBF, chemin }) => ({
        url: `${URL}/${nomDossierDBF}`,
        method: "DELETE",
        params: { chemin },
      }),
      invalidatesTags: ["DocumentsFtp"],
    }),
  }),
});

export const {
  useGetDocumentsFtpQuery,
  useUploadDocumentsFtpMutation,
  useDeleteDocumentFtpMutation,
} = documentsFtpApiSlice;
