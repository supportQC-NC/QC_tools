// src/slices/analyseCaApiSlice.js
import { apiSlice } from "./apiSlice";

const URL = "/api/analyse-ca";

// Décode l'en-tête X-Analyse-Meta (base64 JSON UTF-8).
function decodeMeta(b64) {
  if (!b64) return null;
  try {
    const bin = atob(b64);
    // atob -> chaîne binaire ; reconstruire l'UTF-8
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const json = new TextDecoder("utf-8").decode(bytes);
    return JSON.parse(json);
  } catch {
    return null;
  }
}

// Extrait le nom de fichier de Content-Disposition.
function filenameFrom(cd, fallback) {
  if (!cd) return fallback;
  const m = cd.match(/filename\*?=(?:UTF-8'')?"?([^\";]+)"?/i);
  return m ? decodeURIComponent(m[1]) : fallback;
}

export const analyseCaApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    // Aperçu (période, KPIs, onglets) pour le dashboard.
    getAnalyseCaApercu: builder.query({
      query: ({ nomDossierDBF, moisCoupure }) => ({
        url: `${URL}/${nomDossierDBF}`,
        params: moisCoupure ? { moisCoupure } : undefined,
      }),
      keepUnusedDataFor: 60,
    }),

    // Génération du fichier .xlsx (13 onglets). Renvoie { blob, filename, meta }.
    genererAnalyseCa: builder.mutation({
      query: ({ nomDossierDBF, moisCoupure }) => ({
        url: `${URL}/${nomDossierDBF}/generer`,
        method: "POST",
        params: moisCoupure ? { moisCoupure } : undefined,
        responseHandler: async (response) => {
          if (!response.ok) {
            // Laisse RTK gérer l'erreur (corps JSON éventuel).
            try {
              return await response.json();
            } catch {
              return { message: "Échec de la génération" };
            }
          }
          const blob = await response.blob();
          const filename = filenameFrom(
            response.headers.get("Content-Disposition"),
            "analyse_ca.xlsx",
          );
          const meta = decodeMeta(response.headers.get("X-Analyse-Meta"));
          return { blob, filename, meta };
        },
        cache: "no-cache",
      }),
    }),
  }),
});

export const {
  useGetAnalyseCaApercuQuery,
  useGenererAnalyseCaMutation,
} = analyseCaApiSlice;