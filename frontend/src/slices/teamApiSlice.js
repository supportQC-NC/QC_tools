import { apiSlice } from "./apiSlice";
import { TEAMS_URL } from "../constants";

export const teamApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getTeams: builder.query({
      query: () => ({ url: TEAMS_URL }),
      providesTags: ["Team"],
      keepUnusedDataFor: 5,
    }),
    getTeamById: builder.query({
      query: (id) => ({ url: `${TEAMS_URL}/${id}` }),
      providesTags: ["Team"],
      keepUnusedDataFor: 5,
    }),
    createTeam: builder.mutation({
      query: (data) => ({
        url: TEAMS_URL,
        method: "POST",
        body: data,
      }),
      invalidatesTags: ["Team"],
    }),
    updateTeam: builder.mutation({
      query: ({ id, ...data }) => ({
        url: `${TEAMS_URL}/${id}`,
        method: "PUT",
        body: data,
      }),
      invalidatesTags: ["Team"],
    }),
    deleteTeam: builder.mutation({
      query: (id) => ({
        url: `${TEAMS_URL}/${id}`,
        method: "DELETE",
      }),
      invalidatesTags: ["Team"],
    }),
    addTeamMembers: builder.mutation({
      query: ({ id, userIds }) => ({
        url: `${TEAMS_URL}/${id}/membres`,
        method: "POST",
        body: { userIds },
      }),
      invalidatesTags: ["Team"],
    }),
    removeTeamMember: builder.mutation({
      query: ({ id, userId }) => ({
        url: `${TEAMS_URL}/${id}/membres/${userId}`,
        method: "DELETE",
      }),
      invalidatesTags: ["Team"],
    }),
  }),
});

export const {
  useGetTeamsQuery,
  useGetTeamByIdQuery,
  useCreateTeamMutation,
  useUpdateTeamMutation,
  useDeleteTeamMutation,
  useAddTeamMembersMutation,
  useRemoveTeamMemberMutation,
} = teamApiSlice;
