// src/slices/etiquetteTemplateApiSlice.js
//
// Templates d'étiquettes personnalisées, scopés par société (nomDossierDBF).
import { apiSlice } from "./apiSlice";

const URL = "/api/etiquettes";

export const etiquetteTemplateApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getEtiquetteTemplates: builder.query({
      query: (nomDossierDBF) => ({ url: `${URL}/${nomDossierDBF}/templates` }),
      providesTags: ["EtiquetteTemplate"],
      keepUnusedDataFor: 30,
    }),
    createEtiquetteTemplate: builder.mutation({
      query: ({ nomDossierDBF, ...data }) => ({
        url: `${URL}/${nomDossierDBF}/templates`,
        method: "POST",
        body: data,
      }),
      invalidatesTags: ["EtiquetteTemplate"],
    }),
    updateEtiquetteTemplate: builder.mutation({
      query: ({ nomDossierDBF, id, ...data }) => ({
        url: `${URL}/${nomDossierDBF}/templates/${id}`,
        method: "PUT",
        body: data,
      }),
      invalidatesTags: ["EtiquetteTemplate"],
    }),
    deleteEtiquetteTemplate: builder.mutation({
      query: ({ nomDossierDBF, id }) => ({
        url: `${URL}/${nomDossierDBF}/templates/${id}`,
        method: "DELETE",
      }),
      invalidatesTags: ["EtiquetteTemplate"],
    }),
  }),
});

export const {
  useGetEtiquetteTemplatesQuery,
  useCreateEtiquetteTemplateMutation,
  useUpdateEtiquetteTemplateMutation,
  useDeleteEtiquetteTemplateMutation,
} = etiquetteTemplateApiSlice;
