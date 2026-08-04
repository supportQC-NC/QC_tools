// src/slices/menuLayoutApiSlice.js
//
// Organisation de la sidebar (chapitres) : lecture (tous) + sauvegarde (admin).
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
  }),
});

export const { useGetMenuLayoutQuery, useSaveMenuLayoutMutation } =
  menuLayoutApiSlice;
