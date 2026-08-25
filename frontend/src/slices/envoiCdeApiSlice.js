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
      query: ({ nomDossierDBF, search, fourn, bateau }) => ({
        url: `${ENVOI_CDE_URL}/${nomDossierDBF}/commandes`,
        params: {
          ...(search && { search }),
          ...(fourn && { fourn }),
          ...(bateau && { bateau }),
        },
      }),
      providesTags: ["EnvoiCdeCommande"],
      keepUnusedDataFor: 30,
    }),

    importReference: builder.mutation({
      query: (nomDossierDBF) => ({
        url: `${ENVOI_CDE_URL}/${nomDossierDBF}/import-reference`,
        method: "POST",
      }),
      invalidatesTags: ["FournisseurEmail", "MessageFournisseur", "ResponsableCc"],
    }),

    importReferenceGlobal: builder.mutation({
      query: () => ({
        url: `${ENVOI_CDE_URL}/import-reference-global`,
        method: "POST",
      }),
      invalidatesTags: ["FournisseurEmail", "MessageFournisseur", "ResponsableCc"],
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

    // ─── Relance des commandes déjà envoyées (onglet Historique) ─────────
    // L'aperçu est une mutation (POST) : la liste de commandes cochées passe
    // dans le corps, pas dans l'URL.
    apercuRelance: builder.mutation({
      query: ({ nomDossierDBF, numcdes }) => ({
        url: `${ENVOI_CDE_URL}/${nomDossierDBF}/relance/apercu`,
        method: "POST",
        body: { numcdes },
      }),
    }),

    envoyerRelance: builder.mutation({
      query: ({ nomDossierDBF, numcdes, avecPieces }) => ({
        url: `${ENVOI_CDE_URL}/${nomDossierDBF}/relance`,
        method: "POST",
        body: { numcdes, avecPieces },
      }),
      invalidatesTags: ["EnvoiCdeHistorique"],
    }),

    // ─── Demande de facture (commandes dont l'AR est confirmé) ───────────
    apercuDemandeFacture: builder.mutation({
      query: ({ nomDossierDBF, numcdes }) => ({
        url: `${ENVOI_CDE_URL}/${nomDossierDBF}/facture/apercu`,
        method: "POST",
        body: { numcdes },
      }),
    }),

    envoyerDemandeFacture: builder.mutation({
      query: ({ nomDossierDBF, numcdes, avecPieces }) => ({
        url: `${ENVOI_CDE_URL}/${nomDossierDBF}/facture`,
        method: "POST",
        body: { numcdes, avecPieces },
      }),
      // La liste des AR affiche « facture demandée le… » : elle doit se rafraîchir.
      invalidatesTags: ["EnvoiCdeHistorique", "EnvoiCdeAr"],
    }),

    // ─── Accusés de réception (onglet dédié) ─────────────────────────────
    getListeAr: builder.query({
      query: ({ nomDossierDBF, statut, search, page, limit }) => ({
        url: `${ENVOI_CDE_URL}/${nomDossierDBF}/ar`,
        params: {
          ...(statut && { statut }),
          ...(search && { search }),
          ...(page && { page }),
          ...(limit && { limit }),
        },
      }),
      providesTags: ["EnvoiCdeAr"],
      keepUnusedDataFor: 30,
    }),

    // Aperçu = mutation (POST) : les montants retenus voyagent dans le corps.
    apercuAr: builder.mutation({
      query: ({ nomDossierDBF, commandes }) => ({
        url: `${ENVOI_CDE_URL}/${nomDossierDBF}/ar/apercu`,
        method: "POST",
        body: { commandes },
      }),
    }),

    confirmerAr: builder.mutation({
      query: ({ nomDossierDBF, commandes, envoyerMail }) => ({
        url: `${ENVOI_CDE_URL}/${nomDossierDBF}/ar/confirmer`,
        method: "POST",
        body: { commandes, envoyerMail },
      }),
      invalidatesTags: ["EnvoiCdeAr", "EnvoiCdeHistorique"],
    }),

    annulerAr: builder.mutation({
      query: ({ nomDossierDBF, numcdes }) => ({
        url: `${ENVOI_CDE_URL}/${nomDossierDBF}/ar/annuler`,
        method: "POST",
        body: { numcdes },
      }),
      invalidatesTags: ["EnvoiCdeAr"],
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

    // Import Excel (multipart) — le fichier est envoyé dans un FormData.
    importEmailsExcel: builder.mutation({
      query: ({ nomDossierDBF, file }) => {
        const formData = new FormData();
        formData.append("file", file);
        return {
          url: `${ENVOI_CDE_URL}/${nomDossierDBF}/emails/import-excel`,
          method: "POST",
          body: formData,
        };
      },
      invalidatesTags: ["FournisseurEmail"],
    }),

    // Suppression en masse : ids (sélection) ou all (tout).
    deleteEmailsBulk: builder.mutation({
      query: ({ nomDossierDBF, ids, all }) => ({
        url: `${ENVOI_CDE_URL}/${nomDossierDBF}/emails/delete-bulk`,
        method: "POST",
        body: { ids, all },
      }),
      invalidatesTags: ["FournisseurEmail"],
    }),

    // ─── Envoi en masse (vœux / annonces) ────────────────────────────────
    compterMasse: builder.query({
      query: ({ nomDossierDBF, cible, fournIds }) => ({
        url: `${ENVOI_CDE_URL}/${nomDossierDBF}/masse/compter`,
        params: {
          cible,
          ...(fournIds && fournIds.length ? { fournIds: fournIds.join(",") } : {}),
        },
      }),
    }),

    envoyerMasse: builder.mutation({
      query: ({ nomDossierDBF, ...body }) => ({
        url: `${ENVOI_CDE_URL}/${nomDossierDBF}/masse`,
        method: "POST",
        body,
      }),
      invalidatesTags: ["EnvoiCdeHistorique"],
    }),

    // ─── Modèles de message ──────────────────────────────────────────────
    getMessagesFournisseur: builder.query({
      query: (nomDossierDBF) => ({
        url: `${ENVOI_CDE_URL}/${nomDossierDBF}/messages`,
      }),
      providesTags: ["MessageFournisseur"],
    }),

    upsertMessageFournisseur: builder.mutation({
      query: ({ nomDossierDBF, type, langue, message, sujet }) => ({
        url: `${ENVOI_CDE_URL}/${nomDossierDBF}/messages`,
        method: "PUT",
        body: { type, langue, message, sujet },
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
      query: ({ nomDossierDBF, page, limit, type, search }) => ({
        url: `${ENVOI_CDE_URL}/${nomDossierDBF}/historique`,
        params: {
          ...(page && { page }),
          ...(limit && { limit }),
          ...(type && { type }),
          ...(search && { search }),
        },
      }),
      providesTags: ["EnvoiCdeHistorique"],
    }),
  }),
});

export const {
  useGetCommandesPrepareesQuery,
  useImportReferenceMutation,
  useImportReferenceGlobalMutation,
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
  useImportEmailsExcelMutation,
  useDeleteEmailsBulkMutation,
  useCompterMasseQuery,
  useEnvoyerMasseMutation,
  useApercuRelanceMutation,
  useEnvoyerRelanceMutation,
  useApercuDemandeFactureMutation,
  useEnvoyerDemandeFactureMutation,
  useGetListeArQuery,
  useApercuArMutation,
  useConfirmerArMutation,
  useAnnulerArMutation,
  useGetMessagesFournisseurQuery,
  useUpsertMessageFournisseurMutation,
  useGetResponsableCcQuery,
  useUpsertResponsableCcMutation,
  useGetEnvoiHistoriqueQuery,
} = envoiCdeApiSlice;
