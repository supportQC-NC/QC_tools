import { apiSlice } from "./apiSlice";
import { TASKS_URL } from "../constants";

export const taskApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getTasks: builder.query({
      query: (params = {}) => {
        const qs = new URLSearchParams();
        if (params.statut) qs.set("statut", params.statut);
        if (params.equipe) qs.set("equipe", params.equipe);
        if (params.assigneA) qs.set("assigneA", params.assigneA);
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
  }),
});

export const {
  useGetTasksQuery,
  useCreateTaskMutation,
  useUpdateTaskMutation,
  useUpdateTaskStatutMutation,
  useDeleteTaskMutation,
} = taskApiSlice;
