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
      // La ZONE est choisie dans l'écran et vaut pour toute la sélection ;
      // `items` ne porte plus que les numéros (et l'agent si on le surcharge).
      // `mode` : inventaire | deduction.
      query: ({ entrepriseId, zoneCode, emplacement, items, mode }) => ({
        url: `${BASE}/${entrepriseId}/import-proformas`,
        method: "POST",
        body: { zoneCode, emplacement, items, mode },
      }),
      // La session porte les phases : un import peut les cocher automatiquement.
      invalidatesTags: ["Bipage", "InventaireZone"],
    }),

    // ─── Import depuis un fichier Excel ───────────────────────────────────
    // Le nom du fichier n'a plus aucun rôle fonctionnel : zone, emplacement et
    // mode voyagent en query (et non en champs de formulaire), ils restent
    // lisibles côté serveur quel que soit l'ordre des parties du multipart.
    importExcelBipage: builder.mutation({
      query: ({ entrepriseId, file, mode, zoneCode, emplacement }) => {
        const formData = new FormData();
        formData.append("file", file, file.name);
        const params = new URLSearchParams({
          mode: mode === "deduction" ? "deduction" : "inventaire",
          zoneCode: zoneCode || "",
        });
        if (emplacement) params.set("emplacement", emplacement);
        return {
          url: `${BASE}/${entrepriseId}/import-excel?${params.toString()}`,
          method: "POST",
          body: formData,
        };
      },
      invalidatesTags: ["Bipage", "InventaireZone"],
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