import { apiSlice } from "./apiSlice";

const URL = "/api/communication-client";

// Module « Communication client — catalogue nouveautés ».
export const communicationClientApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getNouveautes: builder.query({
      // { nomDossierDBF, start, end } — dates "YYYY-MM-DD".
      query: ({ nomDossierDBF, start, end }) => ({
        url: `${URL}/${nomDossierDBF}`,
        params: { start, end },
      }),
      providesTags: ["Nouveautes"],
    }),
    // Envoi du catalogue : { nomDossierDBF, start, end, mode: "test"|"abonnes" }
    sendCatalog: builder.mutation({
      query: ({ nomDossierDBF, ...body }) => ({
        url: `${URL}/${nomDossierDBF}/send`,
        method: "POST",
        body,
      }),
    }),
  }),
});

export const { useGetNouveautesQuery, useSendCatalogMutation } =
  communicationClientApiSlice;
