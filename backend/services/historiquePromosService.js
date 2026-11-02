// backend/services/historiquePromosService.js
//
// HISTORIQUE PROMOS : lecture des fichiers JSON du serveur FTPS
// « robot-documents » (dossier historique_promos/), un par société, nommés
// `<trigramme>.json` (trigramme en minuscules : qc, sit, pb…). Le robot y
// AJOUTE un bloc par mois (clé "AAAA-MM" sous `mois`) : CA promo, marge
// promo, nombre d'articles vendus en promo et top des articles (NART,
// désignation, période de la promo, CA, marge, taux, quantité, nb factures).
// Constaté le 03/11/2026 : 15 fichiers, un seul mois (2026-10) pour l'instant
// — l'historique s'étoffe au fil des mois, côté FTP cette fois (le fichier
// entier est réécrit), le cache local n'a donc rien à accumuler lui-même.
//
// Le top est passé de 3 à 10 articles (demande client du 03/11/2026, script
// robot modifié en parallèle). ⚠️ Le robot a renommé la clé `top3` en **`top`**
// à cette occasion : on lit `top`, puis `top10`, puis `top3` — les trois
// écritures peuvent coexister (fichiers régénérés vs mois déjà historisés),
// et le nombre d'articles n'est PAS garanti égal à 10 (une société qui n'a
// vendu que 5 articles en promo n'en a que 5). D'où l'affichage « Top N »
// calculé sur ce qui arrive, jamais « Top 10 » en dur.
//
// Les fichiers sont minuscules (≈ 1,3 Ko par société et par mois) : pas de
// cache mémoire, on relit le JSON du cache FTP à chaque requête.

import fs from "fs";
import path from "path";
import { assurerCacheFtp } from "./ftpDocumentsService.js";

const DOSSIER_FTP = "historique_promos";
const RE_FICHIER = /^([a-z0-9]+)\.json$/i;

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/**
 * Scanne le cache FTP et renvoie les fichiers disponibles.
 * @returns {Promise<{sources: Map<string, string>, accessible: boolean,
 *   erreurFtp?: string}>}  sources : trigramme minuscule -> chemin complet.
 */
export async function scannerSources() {
  const { dossier, ok, erreur } = await assurerCacheFtp(DOSSIER_FTP);
  const sources = new Map();
  let fichiers = [];
  try {
    fichiers = fs.readdirSync(dossier);
  } catch {
    fichiers = [];
  }
  for (const f of fichiers) {
    const m = RE_FICHIER.exec(f);
    if (m) sources.set(m[1].toLowerCase(), path.join(dossier, f));
  }
  return { sources, accessible: ok, erreurFtp: erreur };
}

/**
 * Lit et normalise le fichier d'une société : mois triés du plus récent au
 * plus ancien, clés en camelCase, taux de marge mensuel recalculé.
 * @returns {{nom: string, mois: Array<{periode, libelle, caPromo, margePromo,
 *   tauxMarge, nbArticlesVendus, enregistreLe, top: Array}>}}
 */
export function lireHistorique(chemin) {
  const brut = JSON.parse(fs.readFileSync(chemin, "utf8"));
  const mois = Object.entries(brut.mois || {})
    .map(([periode, m]) => {
      const caPromo = num(m.ca_promo);
      const margePromo = num(m.marge_promo);
      // `top` (format courant) > `top10` > `top3` (mois historisés avant le
      // passage au top 10) — le premier tableau présent gagne.
      const brutTop = [m.top, m.top10, m.top3].find(Array.isArray) || [];
      return {
        periode,
        libelle: m.libelle || periode,
        caPromo,
        margePromo,
        tauxMarge: caPromo > 0 ? Math.round((margePromo / caPromo) * 1000) / 10 : null,
        nbArticlesVendus: num(m.nb_articles_vendus),
        enregistreLe: m.enregistre_le || null,
        top: brutTop.slice(0, 10).map((t) => ({
          rang: num(t.rang),
          nart: String(t.nart || ""),
          designation: String(t.designation || ""),
          debutPromo: t.debut_promo || null,
          finPromo: t.fin_promo || null,
          ca: num(t.ca),
          marge: num(t.marge),
          tauxMarge: typeof t.taux_marge === "number" ? t.taux_marge : null,
          qte: num(t.qte),
          nbFactures: num(t.nb_factures),
        })),
      };
    })
    .sort((a, b) => b.periode.localeCompare(a.periode));
  return { nom: brut.nom || "", mois };
}

export default { scannerSources, lireHistorique };
