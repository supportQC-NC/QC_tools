// src/slices/reportSubscriptionApiSlice.js
import { apiSlice } from "./apiSlice";
import { REPORT_SUBSCRIPTIONS_URL } from "../constants";

export const reportSubscriptionApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    // Rapports autorisés + entreprises accessibles (pour alimenter le formulaire).
    getReportOptions: builder.query({
      query: () => ({ url: `${REPORT_SUBSCRIPTIONS_URL}/available` }),
      providesTags: ["ReportSubscription"],
    }),

    // Abonnements du user courant.
    getMySubscriptions: builder.query({
      query: () => ({ url: REPORT_SUBSCRIPTIONS_URL }),
      providesTags: ["ReportSubscription"],
    }),

    // Test à la volée (sans créer d'abonnement).
    testConfig: builder.mutation({
      query: (data) => ({
        url: `${REPORT_SUBSCRIPTIONS_URL}/test`,
        method: "POST",
        body: data,
      }),
    }),

    createSubscription: builder.mutation({
      query: (data) => ({
        url: REPORT_SUBSCRIPTIONS_URL,
        method: "POST",
        body: data,
      }),
      invalidatesTags: ["ReportSubscription"],
    }),

    updateSubscription: builder.mutation({
      query: ({ id, ...data }) => ({
        url: `${REPORT_SUBSCRIPTIONS_URL}/${id}`,
        method: "PUT",
        body: data,
      }),
      invalidatesTags: ["ReportSubscription"],
    }),

    deleteSubscription: builder.mutation({
      query: (id) => ({
        url: `${REPORT_SUBSCRIPTIONS_URL}/${id}`,
        method: "DELETE",
      }),
      invalidatesTags: ["ReportSubscription"],
    }),

    // Envoi immédiat d'un abonnement existant.
    testSubscription: builder.mutation({
      query: (id) => ({
        url: `${REPORT_SUBSCRIPTIONS_URL}/${id}/test`,
        method: "POST",
      }),
      invalidatesTags: ["ReportSubscription"],
    }),
  }),
});

export const {
  useGetReportOptionsQuery,
  useGetMySubscriptionsQuery,
  useTestConfigMutation,
  useCreateSubscriptionMutation,
  useUpdateSubscriptionMutation,
  useDeleteSubscriptionMutation,
  useTestSubscriptionMutation,
} = reportSubscriptionApiSlice;