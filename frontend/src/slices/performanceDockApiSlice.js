// src/slices/performanceDockApiSlice.js
import { apiSlice } from "./apiSlice";

const URL = "/api/performance-dock";

export const performanceDockApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getPerformanceDock: builder.query({
      query: () => ({ url: URL }),
      keepUnusedDataFor: 300,
    }),
    refreshPerformanceDock: builder.mutation({
      query: () => ({ url: `${URL}/refresh`, method: "POST" }),
    }),
  }),
});

export const { useGetPerformanceDockQuery, useRefreshPerformanceDockMutation } =
  performanceDockApiSlice;