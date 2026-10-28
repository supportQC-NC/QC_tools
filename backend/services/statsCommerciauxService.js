// backend/services/statsCommerciauxService.js
//
// STATS COMMERCIAUX : lecture des classeurs Excel du serveur FTPS
// « robot-documents » (dossier stats_commerciaux/), un par société, régénérés
// chaque soir. Deux familles de fichiers coexistent sur le FTP :
//   - `stats_<TRIG>.xlsx`                      (42 colonnes, format RICHE) ;
//   - `stats_<slug>_<TRIG>_<AAAAMMJJ>.xlsx`    (29 colonnes, format ancien,
//     sans % atteinte, sans nb factures N-1 et sans marges mensuelles).
// On ne lit QUE la forme riche `stats_<TRIG>.xlsx` — le nom sans underscore
// dans le trigramme suffit à l'isoler.
//
// Structure d'un classeur (constaté sur QC/HD le 29/10/2026) :
//   DASHBOARD  — KPI société (CA/Marge N vs N-1) + top commerciaux (facultatif)
//   GLOBAL     — UNE LIGNE PAR CLIENT, avec sa colonne `Commercial` : c'est la
//                seule feuille parsée, les onglets par commercial (MAGASIN,
//                CAMELIA…) en sont des sous-ensembles redondants.
//   Colonnes : Tiers, nomTiers, CATEGORIE, PROFES, Commercial, REMISE,
//   CA_HT_cumul_N, CA_HT_cumul_N1, EvolCAHT, PctRealise, RestantAFaire,
//   Marge_cumul_N, Marge_cumul_N1, EvolMarge, nbFacture, nbFacture_N1,
//   %Marge, tauxContribution, puis 12 paires `<mois>` / `Marge_<mois>`.
//   Dernière ligne : TOTAL GÉNÉRAL.
//
// ⚠️ Les pourcentages du fichier sont des CHAÎNES (« 12.66% », « ↑ 1% »).
// Les évolutions sont recalculées ici depuis N/N-1 (la chaîne du fichier est
// arrondie à l'entier) ; les autres % sont parsés tels quels.
// ⚠️ « MAGASIN » est un pseudo-commercial (ventes comptoir) : il écrase les
// vrais commerciaux dans toute comparaison — le front propose de l'exclure,
// le service ne filtre rien.
//
// Repérage par EN-TÊTES (ligne 1), jamais par index de colonne. Cache mémoire
// par fichier, invalidé sur mtime + taille (le fichier change chaque soir).

import fs from "fs";
import path from "path";
import ExcelJS from "exceljs";
import { assurerCacheFtp } from "./ftpDocumentsService.js";

const DOSSIER_FTP = "stats_commerciaux";

// Forme riche uniquement : `stats_QC.xlsx` (le trigramme ne contient jamais
// d'underscore, ce qui écarte les `stats_qc_QC_20261029.xlsx`).
const RE_FICHIER = /^stats_([A-Z0-9]+)\.xlsx$/;

const MOIS = [
  "janvier", "février", "mars", "avril", "mai", "juin",
  "juillet", "août", "septembre", "octobre", "novembre", "décembre",
];

// --- Helpers de cellule (mêmes conventions que les autres services FTP) -----

function val(cell) {
  const v = cell?.value;
  if (v === null || v === undefined) return null;
  if (typeof v === "object") {
    if (v.result !== undefined) return v.result;
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join("");
    if (v instanceof Date) return v;
    if (v.text !== undefined) return v.text;
    return null;
  }
  return v;
}

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

// « 12.66% » / « 30% » → 12.66 / 30. Un nombre est accepté tel quel (ratio ≤ 1,5
// converti en %, convention des autres classeurs du robot).
function pct(v) {
  if (typeof v === "number") {
    return Math.abs(v) <= 1.5 ? Math.round(v * 10000) / 100 : v;
  }
  if (typeof v !== "string") return null;
  const m = v.replace(",", ".").match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
}

// Évolution N vs N-1 en %, null quand N-1 est vide (division impossible).
const evolPct = (n, n1) =>
  n1 ? Math.round(((n - n1) / Math.abs(n1)) * 1000) / 10 : null;

// --- Inventaire des fichiers -------------------------------------------------

/**
 * Scanne le cache FTP et renvoie les classeurs stats disponibles.
 * @returns {Promise<{sources: Map<string, string>, dossier: string,
 *   accessible: boolean, erreurFtp?: string}>}
 *   sources : trigramme MINUSCULE -> chemin complet du fichier.
 */
export async function scannerSources() {
  const ftp = await assurerCacheFtp(DOSSIER_FTP);

  const sources = new Map();
  let fichiers = [];
  try {
    fichiers = fs.readdirSync(ftp.dossier);
  } catch {
    // Cache jamais créé : traité comme vide.
  }
  for (const f of fichiers) {
    const m = RE_FICHIER.exec(f);
    if (m) sources.set(m[1].toLowerCase(), path.join(ftp.dossier, f));
  }

  return {
    sources,
    dossier: ftp.dossier,
    accessible: sources.size > 0,
    erreurFtp: ftp.erreur,
  };
}

// --- Parsing d'un classeur ---------------------------------------------------

const cache = new Map(); // chemin -> { mtimeMs, size, data }

/**
 * Lit (ou ressert du cache) le classeur stats d'une société et renvoie les
 * lignes clients brutes + les métadonnées. Les agrégats se construisent avec
 * `construireSynthese` / `clientsDuCommercial`.
 */
export async function lireStats(chemin) {
  const stat = fs.statSync(chemin);
  const enCache = cache.get(chemin);
  if (enCache && enCache.mtimeMs === stat.mtimeMs && enCache.size === stat.size) {
    return enCache.data;
  }

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(chemin);

  const ws = wb.getWorksheet("GLOBAL");
  if (!ws) {
    throw new Error(
      `Feuille GLOBAL absente de ${path.basename(chemin)} — format inattendu.`,
    );
  }

  // En-têtes (ligne 1) → index de colonne.
  const idx = new Map();
  ws.getRow(1).eachCell((cell, c) => {
    const nom = String(val(cell) ?? "").trim();
    if (nom) idx.set(nom, c);
  });
  const col = (nom) => idx.get(nom) || 0;
  if (!col("Tiers") || !col("CA_HT_cumul_N") || !col("Commercial")) {
    throw new Error(
      `En-têtes inattendus dans ${path.basename(chemin)} (Tiers / Commercial / CA_HT_cumul_N requis).`,
    );
  }

  // Paires mensuelles CA / Marge (Marge_<mois> absent du format ancien → 0).
  const colsMois = MOIS.map((m) => ({ ca: col(m), marge: col(`Marge_${m}`) }));

  const clients = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const premier = val(row.getCell(1));
    // Ligne TOTAL GÉNÉRAL (fin de feuille) ou ligne vide : ignorée, les
    // totaux sont recalculés depuis les lignes (sommes vérifiées sur QC).
    if (premier === null || /^TOTAL/i.test(String(premier))) continue;

    const caN = num(val(row.getCell(col("CA_HT_cumul_N"))));
    const caN1 = num(val(row.getCell(col("CA_HT_cumul_N1"))));
    const margeN = num(val(row.getCell(col("Marge_cumul_N"))));
    const margeN1 = num(val(row.getCell(col("Marge_cumul_N1"))));

    clients.push({
      tiers: String(premier),
      nom: String(val(row.getCell(col("nomTiers"))) ?? ""),
      categorie: String(val(row.getCell(col("CATEGORIE"))) ?? "") || "SANS CATÉGORIE",
      profession: String(val(row.getCell(col("PROFES"))) ?? ""),
      commercial: String(val(row.getCell(col("Commercial"))) ?? "") || "—",
      remisePct: pct(val(row.getCell(col("REMISE")))),
      caN,
      caN1,
      evolCaPct: evolPct(caN, caN1),
      margeN,
      margeN1,
      evolMargePct: evolPct(margeN, margeN1),
      tauxMargeN: caN ? Math.round((margeN / caN) * 1000) / 10 : null,
      pctRealisePct: pct(val(row.getCell(col("PctRealise")))),
      restant: num(val(row.getCell(col("RestantAFaire")))),
      nbFactures: num(val(row.getCell(col("nbFacture")))),
      nbFacturesN1: num(val(row.getCell(col("nbFacture_N1")))),
      contributionPct: pct(val(row.getCell(col("tauxContribution")))),
      mois: colsMois.map((cm) => ({
        ca: num(val(row.getCell(cm.ca))),
        marge: num(val(row.getCell(cm.marge))),
      })),
    });
  }

  const data = {
    fichier: path.basename(chemin),
    modifieLe: stat.mtime.toISOString(),
    annee: stat.mtime.getFullYear(),
    clients,
  };
  cache.set(chemin, { mtimeMs: stat.mtimeMs, size: stat.size, data });
  return data;
}

// --- Agrégats ----------------------------------------------------------------

// Agrégat vide (12 mois à zéro).
const agregatVide = (nom) => ({
  nom,
  caN: 0,
  caN1: 0,
  margeN: 0,
  margeN1: 0,
  nbFactures: 0,
  nbFacturesN1: 0,
  nbClients: 0,
  clientsActifs: 0, // CA N ≠ 0
  nouveaux: 0, // CA N > 0 et CA N-1 = 0
  perdus: 0, // CA N = 0 et CA N-1 > 0
  mois: MOIS.map(() => ({ ca: 0, marge: 0 })),
});

function accumuler(agg, c) {
  agg.caN += c.caN;
  agg.caN1 += c.caN1;
  agg.margeN += c.margeN;
  agg.margeN1 += c.margeN1;
  agg.nbFactures += c.nbFactures;
  agg.nbFacturesN1 += c.nbFacturesN1;
  agg.nbClients += 1;
  if (c.caN !== 0) agg.clientsActifs += 1;
  if (c.caN > 0 && c.caN1 === 0) agg.nouveaux += 1;
  if (c.caN === 0 && c.caN1 > 0) agg.perdus += 1;
  c.mois.forEach((m, i) => {
    agg.mois[i].ca += m.ca;
    agg.mois[i].marge += m.marge;
  });
}

// Ratios dérivés, calculés une fois l'accumulation terminée.
function finaliser(agg, caTotal) {
  agg.evolCaPct = evolPct(agg.caN, agg.caN1);
  agg.evolMargePct = evolPct(agg.margeN, agg.margeN1);
  agg.tauxMargeN = agg.caN ? Math.round((agg.margeN / agg.caN) * 1000) / 10 : null;
  agg.tauxMargeN1 = agg.caN1
    ? Math.round((agg.margeN1 / agg.caN1) * 1000) / 10
    : null;
  agg.partCaPct = caTotal ? Math.round((agg.caN / caTotal) * 1000) / 10 : null;
  agg.panierMoyen = agg.nbFactures ? Math.round(agg.caN / agg.nbFactures) : null;
  return agg;
}

/**
 * Synthèse société : totaux, un agrégat par commercial (CA desc), CA/Marge
 * par catégorie de client. Les lignes clients ne sont PAS renvoyées ici —
 * elles passent par `clientsDuCommercial` (GLOBAL = ~4 000 lignes chez QC).
 */
export function construireSynthese(data) {
  const totaux = agregatVide("TOTAL");
  const parCommercial = new Map();
  const parCategorie = new Map();

  for (const c of data.clients) {
    accumuler(totaux, c);
    let agg = parCommercial.get(c.commercial);
    if (!agg) {
      agg = agregatVide(c.commercial);
      parCommercial.set(c.commercial, agg);
    }
    accumuler(agg, c);

    let cat = parCategorie.get(c.categorie);
    if (!cat) {
      cat = { nom: c.categorie, caN: 0, caN1: 0, margeN: 0, nbClients: 0 };
      parCategorie.set(c.categorie, cat);
    }
    cat.caN += c.caN;
    cat.caN1 += c.caN1;
    cat.margeN += c.margeN;
    cat.nbClients += 1;
  }

  finaliser(totaux, totaux.caN);
  const commerciaux = [...parCommercial.values()]
    .map((a) => finaliser(a, totaux.caN))
    .sort((a, b) => b.caN - a.caN);
  const categories = [...parCategorie.values()].sort((a, b) => b.caN - a.caN);

  return {
    fichier: data.fichier,
    modifieLe: data.modifieLe,
    annee: data.annee,
    totaux,
    commerciaux,
    categories,
  };
}

/**
 * Lignes clients d'un commercial (ou de toute la société avec "GLOBAL"),
 * triées CA N décroissant. Le détail mensuel par client est retiré de la
 * réponse (l'écran ne s'en sert pas et il triple le payload : 2,4 Mo → bien
 * moins sur les 4 173 clients de QC) — repasser `avecMois: true` le jour où
 * un graphique client en aura besoin.
 */
export function clientsDuCommercial(data, nomCommercial, { avecMois = false } = {}) {
  const tous =
    nomCommercial === "GLOBAL"
      ? data.clients
      : data.clients.filter((c) => c.commercial === nomCommercial);
  const tries = [...tous].sort((a, b) => b.caN - a.caN);
  if (avecMois) return tries;
  return tries.map(({ mois, ...reste }) => reste);
}

export default {
  scannerSources,
  lireStats,
  construireSynthese,
  clientsDuCommercial,
};
