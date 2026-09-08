// frontend/src/slices/ficheControleApiSlice.js
import { apiSlice } from "./apiSlice";

const BASE = "/api/fiches-controle";

// Aperçu (inline) ou téléchargement (attachment) du PDF d'une fiche.
// Le backend regénère le PDF si le fichier n'est plus sur le partage :
// ces deux URL répondent donc même sans agent d'impression.
export const getFichePdfUrl = (entrepriseId, id, { download = false } = {}) =>
  `${BASE}/${entrepriseId}/${id}/pdf${download ? "?download=1" : ""}`;

/**
 * Télécharge le PDF sur le poste (cookie JWT → credentials "include") et
 * déclenche l'enregistrement du fichier. On passe par un blob plutôt que par
 * un simple lien : on peut ainsi remonter une vraie erreur au lieu d'ouvrir un
 * onglet blanc.
 */
export const telechargerFichePdf = async (entrepriseId, id, nomFichier) => {
  const res = await fetch(getFichePdfUrl(entrepriseId, id, { download: true }), {
    credentials: "include",
  });
  if (!res.ok) {
    let msg = `Téléchargement impossible (${res.status})`;
    try {
      const data = await res.json();
      if (data?.message) msg = data.message;
    } catch {
      /* réponse non JSON : on garde le message générique */
    }
    throw new Error(msg);
  }
  const blob = await res.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nomFichier || "fiche-controle.pdf";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Laisser le temps au navigateur d'entamer l'enregistrement avant de libérer.
  setTimeout(() => window.URL.revokeObjectURL(url), 10000);
};

export const ficheControleApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getFiches: builder.query({
      query: (entrepriseId) => `${BASE}/${entrepriseId}`,
      providesTags: ["FicheControle"],
    }),

    scanFiches: builder.mutation({
      query: (entrepriseId) => ({
        url: `${BASE}/${entrepriseId}/scan`,
        method: "POST",
      }),
      invalidatesTags: ["FicheControle"],
    }),

    reprintFiche: builder.mutation({
      query: ({ entrepriseId, id }) => ({
        url: `${BASE}/${entrepriseId}/${id}/reprint`,
        method: "POST",
      }),
      invalidatesTags: ["FicheControle"],
    }),

    deleteFiche: builder.mutation({
      query: ({ entrepriseId, id }) => ({
        url: `${BASE}/${entrepriseId}/${id}`,
        method: "DELETE",
      }),
      invalidatesTags: ["FicheControle"],
    }),

    // Surveillance automatique (globale)
    getWatchStatus: builder.query({
      query: () => `${BASE}/watch/status`,
      providesTags: ["Surveillance"],
    }),

    startWatch: builder.mutation({
      query: () => ({ url: `${BASE}/watch/start`, method: "POST" }),
      invalidatesTags: ["Surveillance"],
    }),

    stopWatch: builder.mutation({
      query: () => ({ url: `${BASE}/watch/stop`, method: "POST" }),
      invalidatesTags: ["Surveillance"],
    }),
  }),
});

export const {
  useGetFichesQuery,
  useScanFichesMutation,
  useReprintFicheMutation,
  useDeleteFicheMutation,
  useGetWatchStatusQuery,
  useStartWatchMutation,
  useStopWatchMutation,
} = ficheControleApiSlice;