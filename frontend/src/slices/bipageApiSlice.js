// frontend/src/slices/bipageApiSlice.js
import { apiSlice } from "./apiSlice";

const BASE = "/api/bipages";

// Invalidations CIBLÉES par société (27/11/2026) : le tag nu "Bipage"
// refetchait TOUTES les queries du module (liste + chaque combinaison de
// filtres en cache + feuille d'écarts + stats + contexte contrôle), sur un
// backend où chacune coûte cher. Chaque facette porte un id par société ;
// une invalidation du TYPE nu (init/annulation d'inventaire, vérification
// point rouge) continue de tout rafraîchir — c'est voulu, c'est une table
// rase. `updateBipage` reste SANS invalidation (mise à jour locale).
const tagsBipage = (entrepriseId, ...facettes) =>
  facettes.map((f) => ({ type: "Bipage", id: `${f}-${entrepriseId}` }));

/** URL d'export CSV (relative à BASE_URL). Inclut zone, type et search. */
export const getBipagesCsvUrl = (
  entrepriseId,
  { zone, type, search, marque } = {},
) => {
  const params = new URLSearchParams();
  if (zone) params.set("zone", zone);
  if (type) params.set("type", type);
  if (search) params.set("search", search);
  // L'export suit le filtre affiché : exporter « tout » depuis un écran filtré
  // sur les lignes corrigées serait un piège.
  if (marque) params.set("marque", marque);
  const qs = params.toString();
  return `${BASE}/${entrepriseId}/export${qs ? `?${qs}` : ""}`;
};

export const bipageApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getBipages: builder.query({
      query: ({ entrepriseId, zone, type, search, marque, surstock }) => {
        const params = new URLSearchParams();
        if (zone) params.set("zone", zone);
        if (type) params.set("type", type);
        if (search) params.set("search", search);
        if (marque) params.set("marque", marque);
        // Sur-comptage : somme bipée par article > stock théorique.
        if (surstock) params.set("surstock", "1");
        const qs = params.toString();
        return `${BASE}/${entrepriseId}${qs ? `?${qs}` : ""}`;
      },
      providesTags: (r, e, arg) => [
        { type: "Bipage", id: `LISTE-${arg.entrepriseId}` },
      ],
    }),

    // Classement des zones les plus retouchées à la main, par emplacement.
    // `tout` : renvoie TOUTES les zones (listing complet) au lieu des seules
    // zones à problème. Le tableau de bord n'en a pas besoin — lui envoyer les
    // 622 zones à chaque chargement serait du gâchis.
    getStatsZonesRetouchees: builder.query({
      query: ({ entrepriseId, tout = false }) =>
        `${BASE}/${entrepriseId}/stats-zones${tout ? "?tout=1" : ""}`,
      providesTags: (r, e, arg) => [
        { type: "Bipage", id: `STATS-${arg.entrepriseId}` },
      ],
    }),

    // Proformas intégrées par zone sur l'inventaire actif (tableau de bord).
    getStatsProformasZones: builder.query({
      query: ({ entrepriseId }) => `${BASE}/${entrepriseId}/stats-proformas-zones`,
      providesTags: (r, e, arg) => [
        { type: "Bipage", id: `STATS-${arg.entrepriseId}` },
      ],
    }),

    updateBipage: builder.mutation({
      query: ({ entrepriseId, id, body }) => ({
        url: `${BASE}/${entrepriseId}/${id}`,
        method: "PUT",
        body,
      }),
      // pas d'invalidation globale : on met à jour la ligne localement
    }),

    // Ajout d'une ligne A LA MAIN dans la zone filtree. La zone et
    // l'emplacement viennent du filtre de l'ecran, jamais d'une saisie.
    // Invalide la liste : la nouvelle ligne doit apparaître a sa place dans le
    // tri du serveur, pas être poussée a la main en fin de tableau.
    ajouterLigneBipage: builder.mutation({
      query: ({ entrepriseId, body }) => ({
        url: `${BASE}/${entrepriseId}/ligne`,
        method: "POST",
        body,
      }),
      invalidatesTags: (r, e, arg) =>
        tagsBipage(arg.entrepriseId, "LISTE", "ECARTS", "STATS"),
    }),

    // ─── Ajout contrôle inventaire ────────────────────────────────────────
    // Contexte du formulaire : session active, zones de l'inventaire et
    // emplacements (mêmes types que le filtre du Détail des bipages).
    getContexteControle: builder.query({
      query: (entrepriseId) => `${BASE}/${entrepriseId}/controle-contexte`,
      providesTags: (r, e, entrepriseId) => [
        { type: "Bipage", id: `CONTEXTE-${entrepriseId}` },
      ],
    }),

    // Résolution dynamique du code saisi (NART ou gencode, renvois GENDOUBL
    // suivis vers la fiche active) : désignation, NART, gencode, stock.
    resoudreArticleControle: builder.query({
      query: ({ entrepriseId, code }) =>
        `${BASE}/${entrepriseId}/resoudre-article?code=${encodeURIComponent(code)}`,
      keepUnusedDataFor: 30,
    }),

    // Ajout d'une ligne de bipage « contrôle » (zone facultative → CONTROLE).
    // Invalide la liste : la ligne doit apparaître dans le Détail des bipages
    // et dans le calcul des écarts.
    ajouterLigneControle: builder.mutation({
      query: ({ entrepriseId, body }) => ({
        url: `${BASE}/${entrepriseId}/ligne-controle`,
        method: "POST",
        body,
      }),
      invalidatesTags: (r, e, arg) =>
        tagsBipage(arg.entrepriseId, "LISTE", "ECARTS", "STATS"),
    }),

    // Correction d'un ajout de contrôle saisi par erreur (code re-résolu,
    // zone/emplacement/quantité/observation) — lignes « controle » seulement,
    // sans marquage « corrigée ».
    modifierLigneControle: builder.mutation({
      query: ({ entrepriseId, id, body }) => ({
        url: `${BASE}/${entrepriseId}/ligne-controle/${id}`,
        method: "PUT",
        body,
      }),
      invalidatesTags: (r, e, arg) =>
        tagsBipage(arg.entrepriseId, "LISTE", "ECARTS", "STATS"),
    }),

    // Suppression d'un ajout de contrôle saisi par erreur.
    supprimerLigneControle: builder.mutation({
      query: ({ entrepriseId, id }) => ({
        url: `${BASE}/${entrepriseId}/ligne-controle/${id}`,
        method: "DELETE",
      }),
      invalidatesTags: (r, e, arg) =>
        tagsBipage(arg.entrepriseId, "LISTE", "ECARTS", "STATS"),
    }),

    // « Recommencer » une zone : efface lignes + statut imprimé + fichiers .DAT/PDF,
    // et réautorise le re-bipage. Invalide la liste pour rafraîchir l'écran.
    recommencerZone: builder.mutation({
      query: ({ entrepriseId, zoneCode }) => ({
        url: `${BASE}/${entrepriseId}/recommencer`,
        method: "POST",
        body: { zoneCode },
      }),
      invalidatesTags: (r, e, arg) =>
        tagsBipage(arg.entrepriseId, "LISTE", "ECARTS", "STATS"),
    }),

    // Figer / défiger / reprendre le stock : photo de la base article pour que
    // la feuille d'écarts compare à un stock STABLE pendant l'inventaire.
    // `mode` : "figer" (photo NEUVE, remplace la précédente), "defiger"
    // (retour au stock live, la photo est CONSERVÉE), "reprendre" (réactive la
    // photo conservée telle quelle). `actif` est envoyé en plus pour un
    // backend antérieur au mode « reprendre » (figer/défiger seulement).
    setStockFige: builder.mutation({
      query: ({ entrepriseId, mode }) => ({
        url: `${BASE}/${entrepriseId}/stock-fige`,
        method: "POST",
        body: { mode, actif: mode !== "defiger" },
      }),
      invalidatesTags: (r, e, arg) =>
        tagsBipage(arg.entrepriseId, "LISTE", "ECARTS"),
    }),

    // Mode « Calcul des écarts » : la feuille d'écarts en JSON (mêmes filtres
    // et mêmes groupes que le document imprimé), pour relecture et correction
    // à l'écran avant impression. `ordre` : tri dans les groupes (nart|design).
    getEcartsBipage: builder.query({
      query: ({
        entrepriseId,
        groupBy,
        seuil,
        perimetre,
        ordre,
        anomalie,
        zone,
        type,
        search,
        marque,
      }) => {
        const params = new URLSearchParams({ format: "json" });
        if (groupBy) params.set("groupBy", groupBy);
        if (seuil) params.set("seuil", seuil);
        if (perimetre) params.set("perimetre", perimetre);
        if (ordre) params.set("ordre", ordre);
        // Type d'anomalie : manquant | excedent | multizone | inconnu.
        if (anomalie) params.set("anomalie", anomalie);
        if (zone) params.set("zone", zone);
        if (type) params.set("type", type);
        if (search) params.set("search", search);
        if (marque) params.set("marque", marque);
        return `${BASE}/${entrepriseId}/ecarts?${params.toString()}`;
      },
      providesTags: (r, e, arg) => [
        { type: "Bipage", id: `ECARTS-${arg.entrepriseId}` },
      ],
    }),

    // Correction du TOTAL bipé d'un article dans UN gisement (mode « Calcul
    // des écarts ») : la différence est appliquée à la ligne la plus récente
    // du couple article × gisement, avec la traçabilité d'une correction.
    setEcartQteZone: builder.mutation({
      query: ({ entrepriseId, cle, zoneCode, zoneType, qte }) => ({
        url: `${BASE}/${entrepriseId}/ecarts/qte`,
        method: "PUT",
        body: { cle, zoneCode, zoneType, qte },
      }),
      invalidatesTags: (r, e, arg) =>
        tagsBipage(arg.entrepriseId, "LISTE", "ECARTS", "STATS"),
    }),

    // Attributs artplus (groupe/famille/sous-famille) de la société :
    // conditionne les options « Regrouper par » de la feuille d'écarts.
    // Tout à false quand la société n'a pas d'artplus.dbf.
    getArtplusGroupes: builder.query({
      query: (entrepriseId) => `${BASE}/${entrepriseId}/artplus-groupes`,
      keepUnusedDataFor: 600,
    }),

    // Purge de l'affichage « corrigé » de la feuille d'écarts : les lignes
    // corrigées (affichées même sous le seuil) redeviennent soumises aux
    // filtres normaux. Portée = les filtres COURANTS de l'écran. La trace de
    // correction (repère du mode lignes, valeurs d'origine) est conservée.
    purgerCorrectionsEcarts: builder.mutation({
      query: ({ entrepriseId, zone, type, search, marque }) => {
        const params = new URLSearchParams();
        if (zone) params.set("zone", zone);
        if (type) params.set("type", type);
        if (search) params.set("search", search);
        if (marque) params.set("marque", marque);
        const qs = params.toString();
        return {
          url: `${BASE}/${entrepriseId}/ecarts/purger-corrections${qs ? `?${qs}` : ""}`,
          method: "POST",
        };
      },
      invalidatesTags: (r, e, arg) =>
        tagsBipage(arg.entrepriseId, "LISTE", "ECARTS"),
    }),

    // Gisements d'un emplacement, lus dans la fiche article (zones proposées
    // à l'import, même sans bipage ni fiche zone).
    getGisementsEmplacement: builder.query({
      query: ({ entrepriseId, emplacement }) =>
        `${BASE}/${entrepriseId}/gisements-emplacement?emplacement=${encodeURIComponent(emplacement)}`,
      keepUnusedDataFor: 300,
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

    // Aperçu AVANT écriture : impact article par article (déjà compté →
    // mouvement → résultat) et état des phases de la zone.
    apercuImportProformas: builder.mutation({
      query: ({ entrepriseId, zoneCode, emplacement, items, mode }) => ({
        url: `${BASE}/${entrepriseId}/proformas/apercu`,
        method: "POST",
        body: { zoneCode, emplacement, items, mode },
      }),
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
      invalidatesTags: (r, e, arg) => [
        ...tagsBipage(arg.entrepriseId, "LISTE", "ECARTS", "STATS", "CONTEXTE"),
        "InventaireZone",
      ],
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
      invalidatesTags: (r, e, arg) => [
        ...tagsBipage(arg.entrepriseId, "LISTE", "ECARTS", "STATS", "CONTEXTE"),
        "InventaireZone",
      ],
    }),
  }),
});

/** URL du modèle Excel d'import (relative à BASE_URL). */
export const getModeleExcelBipageUrl = (entrepriseId) =>
  `${BASE}/${entrepriseId}/modele-excel`;

export const {
  useGetBipagesQuery,
  useGetStatsZonesRetoucheesQuery,
  useGetStatsProformasZonesQuery,
  useUpdateBipageMutation,
  useAjouterLigneBipageMutation,
  useGetContexteControleQuery,
  useLazyResoudreArticleControleQuery,
  useAjouterLigneControleMutation,
  useModifierLigneControleMutation,
  useSupprimerLigneControleMutation,
  useRecommencerZoneMutation,
  useSetStockFigeMutation,
  useGetEcartsBipageQuery,
  useSetEcartQteZoneMutation,
  usePurgerCorrectionsEcartsMutation,
  useGetArtplusGroupesQuery,
  useGetGisementsEmplacementQuery,
  useLazyGetProformasBipageQuery,
  useApercuImportProformasMutation,
  useImportProformasBipageMutation,
  useImportExcelBipageMutation,
} = bipageApiSlice;