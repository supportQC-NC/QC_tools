// src/slices/menuLayoutApiSlice.js
//
// Organisation de la sidebar :
// - config GLOBALE : lecture (tous) + sauvegarde (admin)
// - config PERSONNELLE (/me) : lecture + sauvegarde + bascule du switch + reset
import { apiSlice } from "./apiSlice";
import { MENU_LAYOUT_URL } from "../constants";

export const menuLayoutApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getMenuLayout: builder.query({
      query: () => ({ url: MENU_LAYOUT_URL }),
      providesTags: ["MenuLayout"],
      keepUnusedDataFor: 300,
    }),
    saveMenuLayout: builder.mutation({
      query: ({ chapitres, masques }) => ({
        url: MENU_LAYOUT_URL,
        method: "PUT",
        body: { chapitres, masques },
      }),
      invalidatesTags: ["MenuLayout"],
    }),

    // ── Config personnelle ────────────────────────────────────────────────
    getMyMenuLayout: builder.query({
      query: () => ({ url: `${MENU_LAYOUT_URL}/me` }),
      providesTags: ["MyMenuLayout"],
      keepUnusedDataFor: 300,
    }),
    saveMyMenuLayout: builder.mutation({
      query: ({ chapitres, masques, useCustom }) => ({
        url: `${MENU_LAYOUT_URL}/me`,
        method: "PUT",
        body: { chapitres, masques, useCustom },
      }),
      invalidatesTags: ["MyMenuLayout"],
    }),
    setMyMenuMode: builder.mutation({
      query: ({ useCustom }) => ({
        url: `${MENU_LAYOUT_URL}/me/mode`,
        method: "PATCH",
        body: { useCustom },
      }),
      invalidatesTags: ["MyMenuLayout"],
    }),
    resetMyMenuLayout: builder.mutation({
      query: () => ({ url: `${MENU_LAYOUT_URL}/me`, method: "DELETE" }),
      invalidatesTags: ["MyMenuLayout"],
    }),
  }),
});

export const {
  useGetMenuLayoutQuery,
  useSaveMenuLayoutMutation,
  useGetMyMenuLayoutQuery,
  useSaveMyMenuLayoutMutation,
  useSetMyMenuModeMutation,
  useResetMyMenuLayoutMutation,
} = menuLayoutApiSlice;
