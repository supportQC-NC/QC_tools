// src/slices/executableApiSlice.js
import { apiSlice } from "./apiSlice";

const EXECUTABLES_URL = "/api/executables";

// URLs de téléchargement direct (le cookie JWT httpOnly est envoyé
// automatiquement en same-origin — pas besoin de passer par RTK Query).
export const executableDownloadUrl = (id) =>
  `${EXECUTABLES_URL}/${id}/download`;
export const executableDocumentUrl = (id, docId) =>
  `${EXECUTABLES_URL}/${id}/documents/${docId}`;

export const executableApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    // Liste des exécutables (métadonnées).
    getExecutables: builder.query({
      query: () => ({ url: EXECUTABLES_URL }),
      providesTags: ["Executable"],
    }),

    // Création (multipart : binaire + documents + champs texte).
    createExecutable: builder.mutation({
      query: ({ name, version, description, githubLink, executable, documents }) => {
        const formData = new FormData();
        formData.append("name", name);
        formData.append("version", version);
        if (description) formData.append("description", description);
        if (githubLink) formData.append("githubLink", githubLink);
        if (executable) formData.append("executable", executable);
        (documents || []).forEach((f) => formData.append("documents", f));
        return {
          url: EXECUTABLES_URL,
          method: "POST",
          body: formData,
          // Pas de Content-Type : le navigateur pose la boundary multipart.
        };
      },
      invalidatesTags: ["Executable"],
    }),

    // Mise à jour des métadonnées.
    updateExecutable: builder.mutation({
      query: ({ id, ...body }) => ({
        url: `${EXECUTABLES_URL}/${id}`,
        method: "PATCH",
        body,
      }),
      invalidatesTags: ["Executable"],
    }),

    // Ajout de documents à un exécutable existant.
    addExecutableDocuments: builder.mutation({
      query: ({ id, documents }) => {
        const formData = new FormData();
        (documents || []).forEach((f) => formData.append("documents", f));
        return {
          url: `${EXECUTABLES_URL}/${id}/documents`,
          method: "POST",
          body: formData,
        };
      },
      invalidatesTags: ["Executable"],
    }),

    // Suppression d'un document.
    deleteExecutableDocument: builder.mutation({
      query: ({ id, docId }) => ({
        url: `${EXECUTABLES_URL}/${id}/documents/${docId}`,
        method: "DELETE",
      }),
      invalidatesTags: ["Executable"],
    }),

    // Suppression d'un exécutable.
    deleteExecutable: builder.mutation({
      query: (id) => ({
        url: `${EXECUTABLES_URL}/${id}`,
        method: "DELETE",
      }),
      invalidatesTags: ["Executable"],
    }),
  }),
});

export const {
  useGetExecutablesQuery,
  useCreateExecutableMutation,
  useUpdateExecutableMutation,
  useAddExecutableDocumentsMutation,
  useDeleteExecutableDocumentMutation,
  useDeleteExecutableMutation,
} = executableApiSlice;
