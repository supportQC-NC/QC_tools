import { apiSlice } from "./apiSlice";
import { ENTREPRISES_URL } from "../constants";

export const entrepriseApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    // Admin
    getEntreprises: builder.query({
      query: () => ({
        url: ENTREPRISES_URL,
      }),
      providesTags: ["Entreprise"],
      keepUnusedDataFor: 5,
    }),
    getEntrepriseById: builder.query({
      query: (id) => ({
        url: `${ENTREPRISES_URL}/${id}`,
      }),
      providesTags: ["Entreprise"],
    }),
    getEntrepriseByDossier: builder.query({
      query: (nomDossierDBF) => ({
        url: `${ENTREPRISES_URL}/dossier/${nomDossierDBF}`,
      }),
      providesTags: ["Entreprise"],
      keepUnusedDataFor: 300, // Cache 5 min car le mapping change rarement
    }),
    createEntreprise: builder.mutation({
      query: (data) => ({
        url: ENTREPRISES_URL,
        method: "POST",
        body: data,
      }),
      invalidatesTags: ["Entreprise"],
    }),
    updateEntreprise: builder.mutation({
      query: ({ id, ...data }) => ({
        url: `${ENTREPRISES_URL}/${id}`,
        method: "PUT",
        body: data,
      }),
      invalidatesTags: ["Entreprise"],
    }),
    deleteEntreprise: builder.mutation({
      query: (id) => ({
        url: `${ENTREPRISES_URL}/${id}`,
        method: "DELETE",
      }),
      invalidatesTags: ["Entreprise"],
    }),
    toggleEntrepriseActive: builder.mutation({
      query: (id) => ({
        url: `${ENTREPRISES_URL}/${id}/toggle-active`,
        method: "PATCH",
      }),
      invalidatesTags: ["Entreprise"],
    }),

    // User
    getMyEntreprises: builder.query({
      query: () => ({
        url: `${ENTREPRISES_URL}/my-entreprises`,
      }),
      providesTags: ["Entreprise"],
    }),
  }),
});

export const {
  useGetEntreprisesQuery,
  useGetEntrepriseByIdQuery,
  useGetEntrepriseByDossierQuery,
  useCreateEntrepriseMutation,
  useUpdateEntrepriseMutation,
  useDeleteEntrepriseMutation,
  useToggleEntrepriseActiveMutation,
  useGetMyEntreprisesQuery,
} = entrepriseApiSlice;