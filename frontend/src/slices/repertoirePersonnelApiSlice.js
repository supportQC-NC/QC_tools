// src/slices/repertoirePersonnelApiSlice.js
import { apiSlice } from "./apiSlice";

const URL = "/api/repertoire-personnel";

export const repertoirePersonnelApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getRepertoires: builder.query({
      query: () => ({ url: URL }),
      providesTags: ["RepertoirePersonnel"],
    }),
    updateRepertoire: builder.mutation({
      query: ({ entrepriseId, ...body }) => ({
        url: `${URL}/${entrepriseId}`,
        method: "PUT",
        body,
      }),
      invalidatesTags: ["RepertoirePersonnel"],
    }),
  }),
});

export const { useGetRepertoiresQuery, useUpdateRepertoireMutation } =
  repertoirePersonnelApiSlice;
