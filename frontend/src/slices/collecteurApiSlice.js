// src/slices/collecteurApiSlice.js
import { apiSlice } from "./apiSlice";

const URL = "/api/collecteurs";

export const collecteurApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getCollecteurs: builder.query({
      query: () => ({ url: URL }),
      providesTags: ["Collecteur"],
      keepUnusedDataFor: 60,
    }),
    getCollecteurById: builder.query({
      query: (id) => ({ url: `${URL}/${id}` }),
      providesTags: ["Collecteur"],
    }),
    createCollecteur: builder.mutation({
      query: (data) => ({ url: URL, method: "POST", body: data }),
      invalidatesTags: ["Collecteur"],
    }),
    updateCollecteur: builder.mutation({
      query: ({ id, ...data }) => ({
        url: `${URL}/${id}`,
        method: "PUT",
        body: data,
      }),
      invalidatesTags: ["Collecteur"],
    }),
    deleteCollecteur: builder.mutation({
      query: (id) => ({ url: `${URL}/${id}`, method: "DELETE" }),
      invalidatesTags: ["Collecteur"],
    }),
  }),
});

export const {
  useGetCollecteursQuery,
  useGetCollecteurByIdQuery,
  useCreateCollecteurMutation,
  useUpdateCollecteurMutation,
  useDeleteCollecteurMutation,
} = collecteurApiSlice;