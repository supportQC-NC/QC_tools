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

    // Statistiques d'une campagne (ouvertures / clics).
    getCampaignStats: builder.query({
      query: (id) => ({ url: `${MAIL_URL}/campaigns/${id}/stats` }),
    }),
    getAutomationStats: builder.query({
      query: (id) => ({ url: `${MAIL_URL}/automations/${id}/stats` }),
    }),

    // Segments de clients.
    getSegments: builder.query({
      query: (entrepriseId) => ({ url: `${MAIL_URL}/segments`, params: { entrepriseId } }),
      providesTags: ["MailSegment"],
    }),
    getSegmentCount: builder.query({
      query: (id) => ({ url: `${MAIL_URL}/segments/${id}/count` }),
    }),
    createSegment: builder.mutation({
      query: (data) => ({ url: `${MAIL_URL}/segments`, method: "POST", body: data }),
      invalidatesTags: ["MailSegment"],
    }),
    updateSegment: builder.mutation({
      query: ({ id, ...data }) => ({ url: `${MAIL_URL}/segments/${id}`, method: "PUT", body: data }),
      invalidatesTags: ["MailSegment"],
    }),
    deleteSegment: builder.mutation({
      query: (id) => ({ url: `${MAIL_URL}/segments/${id}`, method: "DELETE" }),
      invalidatesTags: ["MailSegment"],
    }),

    // Automatisations.
    getAutomations: builder.query({
      query: (entrepriseId) => ({ url: `${MAIL_URL}/automations`, params: { entrepriseId } }),
      providesTags: ["MailAutomation"],
    }),
    createAutomation: builder.mutation({
      query: (data) => ({ url: `${MAIL_URL}/automations`, method: "POST", body: data }),
      invalidatesTags: ["MailAutomation"],
    }),
    updateAutomation: builder.mutation({
      query: ({ id, ...data }) => ({ url: `${MAIL_URL}/automations/${id}`, method: "PUT", body: data }),
      invalidatesTags: ["MailAutomation"],
    }),
    deleteAutomation: builder.mutation({
      query: (id) => ({ url: `${MAIL_URL}/automations/${id}`, method: "DELETE" }),
      invalidatesTags: ["MailAutomation"],
    }),
    activateAutomation: builder.mutation({
      query: (id) => ({ url: `${MAIL_URL}/automations/${id}/activate`, method: "POST" }),
      invalidatesTags: ["MailAutomation"],
    }),
    deactivateAutomation: builder.mutation({
      query: (id) => ({ url: `${MAIL_URL}/automations/${id}/deactivate`, method: "POST" }),
      invalidatesTags: ["MailAutomation"],
    }),
    testAutomation: builder.mutation({
      query: ({ id, emails }) => ({ url: `${MAIL_URL}/automations/${id}/test`, method: "POST", body: { emails } }),
    }),
    addAutomationContacts: builder.mutation({
      query: ({ id, contacts }) => ({ url: `${MAIL_URL}/automations/${id}/contacts`, method: "POST", body: { contacts } }),
      invalidatesTags: ["MailAutomation"],
    }),
    importAutomationContacts: builder.mutation({
      query: ({ id, file }) => {
        const fd = new FormData();
        fd.append("file", file);
        return { url: `${MAIL_URL}/automations/${id}/import`, method: "POST", body: fd };
      },
      invalidatesTags: ["MailAutomation"],
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
  useGetCampaignStatsQuery,
  useGetSegmentsQuery,
  useGetSegmentCountQuery,
  useCreateSegmentMutation,
  useUpdateSegmentMutation,
  useDeleteSegmentMutation,
  useGetAutomationsQuery,
  useCreateAutomationMutation,
  useUpdateAutomationMutation,
  useDeleteAutomationMutation,
  useActivateAutomationMutation,
  useDeactivateAutomationMutation,
  useTestAutomationMutation,
  useAddAutomationContactsMutation,
  useImportAutomationContactsMutation,
  useGetAutomationStatsQuery,
} = mailingApiSlice;
