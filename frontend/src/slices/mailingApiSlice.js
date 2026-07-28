// src/slices/mailingApiSlice.js
import { apiSlice } from "./apiSlice";

const MAIL_URL = "/api/mailing";

export const mailingApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    // Filtres clients (catégories, professions, nb avec email) d'une société.
    getMailFilters: builder.query({
      query: (nomDossierDBF) => ({ url: `${MAIL_URL}/${nomDossierDBF}/filters` }),
      keepUnusedDataFor: 30,
    }),
    getRecipientsCount: builder.query({
      query: ({ nomDossierDBF, categories = [], profes = [] }) => ({
        url: `${MAIL_URL}/${nomDossierDBF}/recipients/count`,
        params: { categories: categories.join(","), profes: profes.join(",") },
      }),
    }),

    getCampaigns: builder.query({
      query: () => ({ url: `${MAIL_URL}/campaigns` }),
      providesTags: ["MailCampaign"],
      keepUnusedDataFor: 10,
    }),
    createCampaign: builder.mutation({
      query: (data) => ({ url: `${MAIL_URL}/campaigns`, method: "POST", body: data }),
      invalidatesTags: ["MailCampaign"],
    }),
    updateCampaign: builder.mutation({
      query: ({ id, ...data }) => ({
        url: `${MAIL_URL}/campaigns/${id}`,
        method: "PUT",
        body: data,
      }),
      invalidatesTags: ["MailCampaign"],
    }),
    deleteCampaign: builder.mutation({
      query: (id) => ({ url: `${MAIL_URL}/campaigns/${id}`, method: "DELETE" }),
      invalidatesTags: ["MailCampaign"],
    }),
    testCampaign: builder.mutation({
      query: ({ id, emails }) => ({
        url: `${MAIL_URL}/campaigns/${id}/test`,
        method: "POST",
        body: { emails },
      }),
      invalidatesTags: ["MailCampaign"],
    }),
    launchCampaign: builder.mutation({
      query: (id) => ({ url: `${MAIL_URL}/campaigns/${id}/launch`, method: "POST" }),
      invalidatesTags: ["MailCampaign"],
    }),
    pauseCampaign: builder.mutation({
      query: (id) => ({ url: `${MAIL_URL}/campaigns/${id}/pause`, method: "POST" }),
      invalidatesTags: ["MailCampaign"],
    }),
    resumeCampaign: builder.mutation({
      query: (id) => ({ url: `${MAIL_URL}/campaigns/${id}/resume`, method: "POST" }),
      invalidatesTags: ["MailCampaign"],
    }),
    previewCampaign: builder.mutation({
      query: (design) => ({ url: `${MAIL_URL}/preview`, method: "POST", body: { design } }),
    }),
    uploadMailImage: builder.mutation({
      query: (file) => {
        const fd = new FormData();
        fd.append("image", file);
        return { url: `${MAIL_URL}/img`, method: "POST", body: fd };
      },
    }),
  }),
});

export const {
  useGetMailFiltersQuery,
  useGetRecipientsCountQuery,
  useGetCampaignsQuery,
  useCreateCampaignMutation,
  useUpdateCampaignMutation,
  useDeleteCampaignMutation,
  useTestCampaignMutation,
  useLaunchCampaignMutation,
  usePauseCampaignMutation,
  useResumeCampaignMutation,
  usePreviewCampaignMutation,
  useUploadMailImageMutation,
} = mailingApiSlice;
