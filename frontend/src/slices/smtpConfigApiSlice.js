// src/slices/smtpConfigApiSlice.js
//
// Administration SMTP (global + par module). Admin uniquement côté serveur.
import { apiSlice } from "./apiSlice";
import { SMTP_CONFIG_URL } from "../constants";

export const smtpConfigApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getSmtpConfigs: builder.query({
      query: () => ({ url: SMTP_CONFIG_URL }),
      providesTags: ["SmtpConfig"],
    }),
    saveSmtpConfig: builder.mutation({
      query: ({ scope, ...body }) => ({
        url: `${SMTP_CONFIG_URL}/${scope}`,
        method: "PUT",
        body,
      }),
      invalidatesTags: ["SmtpConfig"],
    }),
    resetSmtpConfig: builder.mutation({
      query: (scope) => ({
        url: `${SMTP_CONFIG_URL}/${scope}`,
        method: "DELETE",
      }),
      invalidatesTags: ["SmtpConfig"],
    }),
    testSmtpConfig: builder.mutation({
      query: ({ scope, email }) => ({
        url: `${SMTP_CONFIG_URL}/${scope}/test`,
        method: "POST",
        body: { email },
      }),
    }),
  }),
});

export const {
  useGetSmtpConfigsQuery,
  useSaveSmtpConfigMutation,
  useResetSmtpConfigMutation,
  useTestSmtpConfigMutation,
} = smtpConfigApiSlice;
