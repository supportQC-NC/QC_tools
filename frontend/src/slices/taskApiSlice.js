import { apiSlice } from "./apiSlice";
import { TASKS_URL } from "../constants";

// URL directe d'un document de tâche (téléchargement/affichage via fetch blob).
export const taskDocumentUrl = (id, docId) =>
  `${TASKS_URL}/${id}/documents/${docId}`;

export const taskApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getTasks: builder.query({
      query: (params = {}) => {
        const qs = new URLSearchParams();
        if (params.statut) qs.set("statut", params.statut);
        if (params.equipe) qs.set("equipe", params.equipe);
        if (params.assigneA) qs.set("assigneA", params.assigneA);
        if (params.mine) qs.set("mine", "true");
        const s = qs.toString();
        return { url: s ? `${TASKS_URL}?${s}` : TASKS_URL };
      },
      providesTags: ["Task"],
      keepUnusedDataFor: 5,
    }),
    createTask: builder.mutation({
      query: (data) => ({ url: TASKS_URL, method: "POST", body: data }),
      invalidatesTags: ["Task"],
    }),
    // Tâche personnelle (créée par l'utilisateur pour lui-même).
    createPersonalTask: builder.mutation({
      query: (data) => ({
        url: `${TASKS_URL}/perso`,
        method: "POST",
        body: data,
      }),
      invalidatesTags: ["Task"],
    }),
    updateTask: builder.mutation({
      query: ({ id, ...data }) => ({
        url: `${TASKS_URL}/${id}`,
        method: "PUT",
        body: data,
      }),
      invalidatesTags: ["Task"],
    }),
    updateTaskStatut: builder.mutation({
      query: ({ id, statut }) => ({
        url: `${TASKS_URL}/${id}/statut`,
        method: "PATCH",
        body: { statut },
      }),
      invalidatesTags: ["Task"],
    }),
    deleteTask: builder.mutation({
      query: (id) => ({ url: `${TASKS_URL}/${id}`, method: "DELETE" }),
      invalidatesTags: ["Task"],
    }),
    // Ajout de documents (multipart) à une tâche.
    addTaskDocuments: builder.mutation({
      query: ({ id, documents }) => {
        const formData = new FormData();
        (documents || []).forEach((f) => formData.append("documents", f));
        return {
          url: `${TASKS_URL}/${id}/documents`,
          method: "POST",
          body: formData,
        };
      },
      invalidatesTags: ["Task"],
    }),
    deleteTaskDocument: builder.mutation({
      query: ({ id, docId }) => ({
        url: `${TASKS_URL}/${id}/documents/${docId}`,
        method: "DELETE",
      }),
      invalidatesTags: ["Task"],
    }),
  }),
});

export const {
  useGetTasksQuery,
  useCreateTaskMutation,
  useCreatePersonalTaskMutation,
  useUpdateTaskMutation,
  useUpdateTaskStatutMutation,
  useDeleteTaskMutation,
  useAddTaskDocumentsMutation,
  useDeleteTaskDocumentMutation,
} = taskApiSlice;
