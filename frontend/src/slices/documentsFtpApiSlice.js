// src/slices/documentsFtpApiSlice.js
import { apiSlice } from "./apiSlice";

const URL = "/api/documents-ftp";

export const documentsFtpApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getDocumentsFtp: builder.query({
      query: ({ nomDossierDBF, chemin }) => ({
        url: `${URL}/${nomDossierDBF}`,
        params: { chemin: chemin || "" },
      }),
      keepUnusedDataFor: 30,
    }),
  }),
});

export const { useGetDocumentsFtpQuery } = documentsFtpApiSlice;
