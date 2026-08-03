// src/slices/envoiCdeApiSlice.js
//
// Endpoints RTK Query du module « Envoi Commande Fournisseur ».
// Toutes les routes sont scopées par société (nomDossierDBF).
import { apiSlice } from "./apiSlice";
import { ENVOI_CDE_URL } from "../constants";

export const envoiCdeApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    // ─── Commandes préparées + envoi ─────────────────────────────────────
    getCommandesPreparees: builder.query({
      query: ({ nomDossierDBF, search, fourn, page, limit }) => ({
        url: `${ENVOI_CDE_URL}/${nomDossierDBF}/commandes`,
        params: {
          ...(search && { search }),
          ...(fourn && { fourn }),
          ...(page && { page }),
          ...(limit && { limit }),
        },
      }),
      providesTags: ["EnvoiCdeCommande"],
      keepUnusedDataFor: 30,
    }),

    getCommandeDetail: builder.query({
      query: ({ nomDossierDBF, numcde }) => ({
        url: `${ENVOI_CDE_URL}/${nomDossierDBF}/commandes/${numcde}/detail`,
      }),
      keepUnusedDataFor: 30,
    }),

    getEnvoiParametres: builder.query({
      query: (nomDossierDBF) => ({
        url: `${ENVOI_CDE_URL}/${nomDossierDBF}/parametres`,
      }),
      providesTags: ["EnvoiCdeParametre"],
    }),

    updateEnvoiParametres: builder.mutation({
      query: ({ nomDossierDBF, testMode, testEmails }) => ({
        url: `${ENVOI_CDE_URL}/${nomDossierDBF}/parametres`,
        method: "PUT",
        body: { testMode, testEmails },
      }),
      invalidatesTags: ["EnvoiCdeParametre"],
    }),

    getApercuEnvoi: builder.query({
      query: ({ nomDossierDBF, numcde }) => ({
        url: `${ENVOI_CDE_URL}/${nomDossierDBF}/apercu/${numcde}`,
      }),
      keepUnusedDataFor: 10,
    }),

    verifierFournisseurs: builder.mutation({
      query: ({ nomDossierDBF, numcdes }) => ({
        url: `${ENVOI_CDE_URL}/${nomDossierDBF}/verifier`,
        method: "POST",
        body: { numcdes },
      }),
    }),

    envoyerCommandes: builder.mutation({
      query: ({ nomDossierDBF, numcdes }) => ({
        url: `${ENVOI_CDE_URL}/${nomDossierDBF}/envoyer`,
        method: "POST",
        body: { numcdes },
      }),
      invalidatesTags: ["EnvoiCdeHistorique"],
    }),

    // ─── Emails fournisseurs (CRUD) ──────────────────────────────────────
    getFournisseurEmails: builder.query({
      query: ({ nomDossierDBF, search }) => ({
        url: `${ENVOI_CDE_URL}/${nomDossierDBF}/emails`,
        params: { ...(search && { search }) },
      }),
      providesTags: ["FournisseurEmail"],
    }),

    createFournisseurEmail: builder.mutation({
      query: ({ nomDossierDBF, ...body }) => ({
        url: `${ENVOI_CDE_URL}/${nomDossierDBF}/emails`,
        method: "POST",
        body,
      }),
      invalidatesTags: ["FournisseurEmail"],
    }),

    updateFournisseurEmail: builder.mutation({
      query: ({ nomDossierDBF, id, ...body }) => ({
        url: `${ENVOI_CDE_URL}/${nomDossierDBF}/emails/${id}`,
        method: "PUT",
        body,
      }),
      invalidatesTags: ["FournisseurEmail"],
    }),

    deleteFournisseurEmail: builder.mutation({
      query: ({ nomDossierDBF, id }) => ({
        url: `${ENVOI_CDE_URL}/${nomDossierDBF}/emails/${id}`,
        method: "DELETE",
      }),
      invalidatesTags: ["FournisseurEmail"],
    }),

    // ─── Modèles de message ──────────────────────────────────────────────
    getMessagesFournisseur: builder.query({
      query: (nomDossierDBF) => ({
        url: `${ENVOI_CDE_URL}/${nomDossierDBF}/messages`,
      }),
      providesTags: ["MessageFournisseur"],
    }),

    upsertMessageFournisseur: builder.mutation({
      query: ({ nomDossierDBF, langue, message }) => ({
        url: `${ENVOI_CDE_URL}/${nomDossierDBF}/messages`,
        method: "PUT",
        body: { langue, message },
      }),
      invalidatesTags: ["MessageFournisseur"],
    }),

    // ─── Responsable / CC ────────────────────────────────────────────────
    getResponsableCc: builder.query({
      query: (nomDossierDBF) => ({
        url: `${ENVOI_CDE_URL}/${nomDossierDBF}/responsable`,
      }),
      providesTags: ["ResponsableCc"],
    }),

    upsertResponsableCc: builder.mutation({
      query: ({ nomDossierDBF, nom, emails }) => ({
        url: `${ENVOI_CDE_URL}/${nomDossierDBF}/responsable`,
        method: "PUT",
        body: { nom, emails },
      }),
      invalidatesTags: ["ResponsableCc"],
    }),

    // ─── Historique ──────────────────────────────────────────────────────
    getEnvoiHistorique: builder.query({
      query: ({ nomDossierDBF, page, limit }) => ({
        url: `${ENVOI_CDE_URL}/${nomDossierDBF}/historique`,
        params: { ...(page && { page }), ...(limit && { limit }) },
      }),
      providesTags: ["EnvoiCdeHistorique"],
    }),
  }),
});

export const {
  useGetCommandesPrepareesQuery,
  useGetCommandeDetailQuery,
  useGetEnvoiParametresQuery,
  useUpdateEnvoiParametresMutation,
  useGetApercuEnvoiQuery,
  useVerifierFournisseursMutation,
  useEnvoyerCommandesMutation,
  useGetFournisseurEmailsQuery,
  useCreateFournisseurEmailMutation,
  useUpdateFournisseurEmailMutation,
  useDeleteFournisseurEmailMutation,
  useGetMessagesFournisseurQuery,
  useUpsertMessageFournisseurMutation,
  useGetResponsableCcQuery,
  useUpsertResponsableCcMutation,
  useGetEnvoiHistoriqueQuery,
} = envoiCdeApiSlice;
