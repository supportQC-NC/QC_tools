// src/slices/appReleaseApiSlice.js
import { apiSlice } from "./apiSlice";

const URL = "/api/app-release";

export const appReleaseApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getCurrentAppRelease: builder.query({
      query: () => ({ url: `${URL}/current` }),
      providesTags: ["AppRelease"],
    }),
    getAppReleases: builder.query({
      query: () => ({ url: URL }),
      providesTags: ["AppRelease"],
    }),
    createAppRelease: builder.mutation({
      query: (data) => ({ url: URL, method: "POST", body: data }),
      invalidatesTags: ["AppRelease"],
    }),
  }),
});

export const {
  useGetCurrentAppReleaseQuery,
  useGetAppReleasesQuery,
  useCreateAppReleaseMutation,
} = appReleaseApiSlice;