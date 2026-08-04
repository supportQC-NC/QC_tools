// src/slices/menuHintsApiSlice.js
//
// Infobulles des onglets sidebar : lecture (tous) + mise à jour (admin).
import { apiSlice } from "./apiSlice";
import { MENU_HINTS_URL } from "../constants";

export const menuHintsApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getMenuHints: builder.query({
      query: () => ({ url: MENU_HINTS_URL }),
      providesTags: ["MenuHint"],
      keepUnusedDataFor: 300,
    }),
    upsertMenuHint: builder.mutation({
      query: ({ path, hint, masque }) => ({
        url: MENU_HINTS_URL,
        method: "PUT",
        body: {
          path,
          ...(hint !== undefined && { hint }),
          ...(masque !== undefined && { masque }),
        },
      }),
      invalidatesTags: ["MenuHint"],
    }),
    reorderMenu: builder.mutation({
      query: ({ paths }) => ({
        url: `${MENU_HINTS_URL}/reorder`,
        method: "PUT",
        body: { paths },
      }),
      invalidatesTags: ["MenuHint"],
    }),
  }),
});

export const {
  useGetMenuHintsQuery,
  useUpsertMenuHintMutation,
  useReorderMenuMutation,
} = menuHintsApiSlice;
