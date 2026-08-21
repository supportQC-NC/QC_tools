// frontend/src/slices/bipageApiSlice.js
import { apiSlice } from "./apiSlice";

const BASE = "/api/bipages";

/** URL d'export CSV (relative à BASE_URL). Inclut zone, type et search. */
export const getBipagesCsvUrl = (entrepriseId, { zone, type, search } = {}) => {
  const params = new URLSearchParams();
  if (zone) params.set("zone", zone);
  if (type) params.set("type", type);
  if (search) params.set("search", search);
  const qs = params.toString();
  return `${BASE}/${entrepriseId}/export${qs ? `?${qs}` : ""}`;
};

export const bipageApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getBipages: builder.query({
      query: ({ entrepriseId, zone, type, search }) => {
        const params = new URLSearchParams();
        if (zone) params.set("zone", zone);
        if (type) params.set("type", type);
        if (search) params.set("search", search);
        const qs = params.toString();
        return `${BASE}/${entrepriseId}${qs ? `?${qs}` : ""}`;
      },
      providesTags: ["Bipage"],
    }),

    updateBipage: builder.mutation({
      query: ({ entrepriseId, id, body }) => ({
        url: `${BASE}/${entrepriseId}/${id}`,
        method: "PUT",
        body,
      }),
      // pas d'invalidation globale : on met à jour la ligne localement
    }),

    // « Recommencer » une zone : efface lignes + statut imprimé + fichiers .DAT/PDF,
    // et réautorise le re-bipage. Invalide la liste pour rafraîchir l'écran.
    recommencerZone: builder.mutation({
      query: ({ entrepriseId, zoneCode }) => ({
        url: `${BASE}/${entrepriseId}/recommencer`,
        method: "POST",
        body: { zoneCode },
      }),
      invalidatesTags: ["Bipage"],
    }),

    // ─── Import depuis les proformas de l'ERP ──────────────────────────────
    getProformasBipage: builder.query({
      query: ({ entrepriseId, dateDebut, dateFin, clients }) => {
        const params = new URLSearchParams();
        if (dateDebut) params.set("dateDebut", dateDebut);
        if (dateFin) params.set("dateFin", dateFin);
        if (clients) params.set("clients", clients);
        const qs = params.toString();
        return `${BASE}/${entrepriseId}/proformas${qs ? `?${qs}` : ""}`;
      },
      keepUnusedDataFor: 30,
    }),

    importProformasBipage: builder.mutation({
      query: ({ entrepriseId, numfacts }) => ({
        url: `${BASE}/${entrepriseId}/import-proformas`,
        method: "POST",
        body: { numfacts },
      }),
      invalidatesTags: ["Bipage"],
    }),

    // ─── Import depuis un fichier Excel ───────────────────────────────────
    // ⚠️ Le NOM du fichier porte l'agent / la zone / l'emplacement : on le
    // transmet tel quel dans le FormData.
    // `mode` voyage en query (pas en champ de formulaire) : il reste lisible
    // côté serveur quel que soit l'ordre des parties du multipart.
    importExcelBipage: builder.mutation({
      query: ({ entrepriseId, file, mode }) => {
        const formData = new FormData();
        formData.append("file", file, file.name);
        return {
          url: `${BASE}/${entrepriseId}/import-excel?mode=${mode === "deduction" ? "deduction" : "inventaire"}`,
          method: "POST",
          body: formData,
        };
      },
      invalidatesTags: ["Bipage"],
    }),
  }),
});

/** URL du modèle Excel d'import (relative à BASE_URL). */
export const getModeleExcelBipageUrl = (entrepriseId) =>
  `${BASE}/${entrepriseId}/modele-excel`;

export const {
  useGetBipagesQuery,
  useUpdateBipageMutation,
  useRecommencerZoneMutation,
  useLazyGetProformasBipageQuery,
  useImportProformasBipageMutation,
  useImportExcelBipageMutation,
} = bipageApiSlice;