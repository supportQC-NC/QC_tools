// backend/services/analyseStockService.js
//
// ANALYSE STOCK : lecture des classeurs Excel mensuels du serveur FTPS
// « robot-documents » (dossier analyse_stock/), un par société, nommés
// `analyse_stock_<trigramme>_<MM>_<AAAA>.xlsx` (trigramme en minuscules :
// qc, dq, aw…) — même convention que l'analyse CA mensuelle. Le FTP ne garde
// que la dernière génération ; le cache local ACCUMULE les mois.
//
// Deux feuilles par classeur (constaté sur QC/FMB/AVB 09/2026) :
//   « Recap stock »  — répartition par CODE FILTRE (Total, A, B, C, N, Z, S,
//                      Autre : nb articles / valeur / dépréciation, en nombre
//                      et en ratio) + ÉVOLUTION sur 12 mois glissants de 5
//                      indicateurs (valeur du stock, surstock, en commande,
//                      dépréciations, déstockage). Les mois non encore relevés
//                      sont vides (le rapport n'existe que depuis 2 mois).
//   « total stock »  — UNE LIGNE PAR ARTICLE (45 960 chez QC), 24 colonnes :
//                      NART, DESIGN, GENCOD, REFER, NOM (fournisseur), FOURN,
//                      PREV, DEPREC (% de dépréciation), CODTAR, PVTE, ATVA,
//                      GROUPE, STOCK, Valeur stock, Valeur deprécié,
//                      Qte/Valeur commande, VTE AN, CA AN, Taux marge (ratio),
//                      Mois stock (couverture), surtock (VALEUR en XPF de la
//                      part excédentaire), date_vte, date_arrive.
//
// ⚠️ Le « code filtre » du récap est la PREMIÈRE LETTRE du CODTAR (A, B, C,
// N, Z, S — vérifié sur QC : 16 849 « A » = CODTAR A + AT + AP + AX…), le
// reste tombe dans « Autre ». On garde la même règle pour les filtres de
// l'explorateur, afin que les comptes collent au récap.
//
// ⚠️ `Taux marge` est un RATIO (0.35 = 35 %) — normalisé en pour-cent ici.
// `surtock` et `Valeur deprécié` sont déjà des MONTANTS, pas des ratios.
//
// La feuille articles n'est JAMAIS renvoyée brute au front (≈ 12 Mo de JSON
// chez QC) : la synthèse agrège tout côté serveur et l'explorateur est
// filtré/trié/paginé ici. Cache mémoire par fichier, invalidé sur
// mtime + taille (un fichier de mois révolu ne bouge plus jamais).

import fs from "fs";
import path from "path";
import ExcelJS from "exceljs";
import { assurerCacheFtp } from "./ftpDocumentsService.js";

const DOSSIER_FTP = "analyse_stock";
const RE_FICHIER = /^analyse_stock_([a-z0-9]+)_(\d{2})_(\d{4})\.xlsx$/i;

// Codes filtres du récap, dans l'ordre d'affichage du classeur.
const CODES_FILTRE = ["A", "B", "C", "N", "Z", "S"];

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
const numOuNull = (v) =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const isoDate = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : null);
const arrondi = (v, d = 0) => {
  const p = 10 ** d;
  return Math.round(v * p) / p;
};

// --- Inventaire des fichiers -------------------------------------------------

/**
 * Scanne le cache FTP et renvoie les classeurs disponibles.
 * @returns {Promise<{sources: Map<string, Map<string, string>>, dossier: string,
 *   accessible: boolean, erreurFtp?: string}>}
 *   sources : trigramme minuscule -> Map période "AAAA-MM" -> chemin complet.
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
    if (!m) continue;
    const slug = m[1].toLowerCase();
    const periode = `${m[3]}-${m[2]}`; // AAAA-MM (triable)
    if (!sources.has(slug)) sources.set(slug, new Map());
    sources.get(slug).set(periode, path.join(ftp.dossier, f));
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
 * Lit (ou ressert du cache) un classeur d'analyse de stock.
 * @returns {Promise<{fichier: string, modifieLe: string, recap: object,
 *   articles: object[]}>}
 */
export async function lireAnalyse(chemin) {
  const stat = fs.statSync(chemin);
  const enCache = cache.get(chemin);
  if (enCache && enCache.mtimeMs === stat.mtimeMs && enCache.size === stat.size) {
    return enCache.data;
  }

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(chemin);

  const recap = parseRecap(wb);
  const articles = parseArticles(wb, path.basename(chemin));

  const data = {
    fichier: path.basename(chemin),
    modifieLe: stat.mtime.toISOString(),
    recap,
    articles,
  };
  cache.set(chemin, { mtimeMs: stat.mtimeMs, size: stat.size, data });
  return data;
}

// Feuille « Recap stock » : les sections sont repérées par leurs LIBELLÉS en
// colonne 2 (« Code », « Indicateur »), jamais par numéro de ligne.
function parseRecap(wb) {
  const ws = wb.worksheets.find((w) => /recap/i.test(w.name));
  if (!ws) return { titre: "", arreteA: "", codes: [], evolution: null };

  const titre = String(val(ws.getRow(1).getCell(2)) ?? "").trim();
  const arreteA = String(val(ws.getRow(2).getCell(2)) ?? "").trim();

  // ── Répartition par code filtre ──
  // En-tête « Code » en colonne 2, puis une ligne par code jusqu'à la ligne
  // vide. Colonnes : 4=nb, 5=% nb, 6=valeur, 7=% valeur, 8=nb déprec,
  // 9=% nb déprec, 10=valeur déprec, 11=% valeur déprec (ratios 0–1).
  const codes = [];
  let rCodes = 0;
  for (let r = 1; r <= ws.rowCount; r++) {
    if (String(val(ws.getRow(r).getCell(2)) ?? "").trim() === "Code") {
      rCodes = r;
      break;
    }
  }
  if (rCodes) {
    for (let r = rCodes + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const code = String(val(row.getCell(2)) ?? "").trim();
      if (!code) break;
      codes.push({
        code,
        nbArticles: num(val(row.getCell(4))),
        pctArticles: arrondi(num(val(row.getCell(5))) * 100, 1),
        valeur: num(val(row.getCell(6))),
        pctValeur: arrondi(num(val(row.getCell(7))) * 100, 1),
        nbDeprec: num(val(row.getCell(8))),
        valeurDeprec: num(val(row.getCell(10))),
      });
    }
  }

  // ── Évolution 12 mois ──
  // Ligne « Indicateur » en colonne 2 ; la ligne PRÉCÉDENTE porte les libellés
  // de mois (« septembre 2026 »…), colonnes 4..15, du plus récent au plus
  // ancien — on remet en ordre CHRONOLOGIQUE pour le graphique.
  let evolution = null;
  for (let r = 1; r <= ws.rowCount; r++) {
    if (String(val(ws.getRow(r).getCell(2)) ?? "").trim() !== "Indicateur") {
      continue;
    }
    const rowMois = ws.getRow(r - 1);
    const mois = [];
    for (let c = 4; c <= 15; c++) {
      mois.push(String(val(rowMois.getCell(c)) ?? "").trim());
    }
    const indicateurs = [];
    for (let ri = r + 1; ri <= ws.rowCount; ri++) {
      const row = ws.getRow(ri);
      const label = String(val(row.getCell(2)) ?? "").trim();
      if (!label) break;
      const valeurs = [];
      for (let c = 4; c <= 15; c++) {
        valeurs.push(numOuNull(val(row.getCell(c))));
      }
      indicateurs.push({ label, valeurs: valeurs.reverse() });
    }
    evolution = { mois: mois.reverse(), indicateurs };
    break;
  }

  return { titre, arreteA, codes, evolution };
}

// Feuille « total stock » : repérage par EN-TÊTES (ligne 1), jamais par index.
function parseArticles(wb, nomFichier) {
  const ws = wb.worksheets.find((w) => /total/i.test(w.name));
  if (!ws) {
    throw new Error(
      `Feuille « total stock » absente de ${nomFichier} — format inattendu.`,
    );
  }

  const idx = new Map();
  ws.getRow(1).eachCell((cell, c) => {
    const nom = String(val(cell) ?? "").trim();
    if (nom) idx.set(nom, c);
  });
  const col = (nom) => idx.get(nom) || 0;
  if (!col("NART") || !col("Valeur stock") || !col("surtock")) {
    throw new Error(
      `En-têtes inattendus dans ${nomFichier} (NART / Valeur stock / surtock requis).`,
    );
  }

  const articles = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const g = (nom) => val(row.getCell(col(nom)));
    const nart = g("NART");
    if (nart === null || nart === "") continue;

    const codtar = String(g("CODTAR") ?? "").trim();
    const premiere = codtar.charAt(0).toUpperCase();
    const tauxMarge = numOuNull(g("Taux marge"));

    articles.push({
      nart: String(nart).trim(),
      design: String(g("DESIGN") ?? "").trim(),
      gencod: String(g("GENCOD") ?? "").trim(),
      refer: String(g("REFER") ?? "").trim(),
      fournisseur: String(g("NOM") ?? "").trim(),
      groupe: String(g("GROUPE") ?? "").trim(),
      codtar,
      // Même règle que le récap du classeur : première lettre, sinon « Autre ».
      codeFiltre: CODES_FILTRE.includes(premiere) ? premiere : "Autre",
      deprecPct: num(g("DEPREC")),
      prev: num(g("PREV")),
      pvte: num(g("PVTE")),
      stock: num(g("STOCK")),
      valeurStock: num(g("Valeur stock")),
      valeurDeprec: num(g("Valeur deprécié")),
      qteCommande: num(g("Qte commande")),
      valeurCommande: num(g("Valeur commande")),
      vteAn: num(g("VTE AN")),
      caAn: num(g("CA AN")),
      tauxMargePct: tauxMarge === null ? null : arrondi(tauxMarge * 100, 1),
      moisStock: numOuNull(g("Mois stock")),
      surstock: num(g("surtock")),
      dateVte: isoDate(g("date_vte")),
      dateArrive: isoDate(g("date_arrive")),
    });
  }
  return articles;
}

// --- Synthèse ----------------------------------------------------------------

// Tranches de couverture (Mois stock). `null` = pas de vente sur l'année,
// la couverture n'est pas calculable.
const TRANCHES_ROTATION = [
  { cle: "<1", label: "< 1 mois", max: 1 },
  { cle: "1-3", label: "1 à 3 mois", max: 3 },
  { cle: "3-6", label: "3 à 6 mois", max: 6 },
  { cle: "6-12", label: "6 à 12 mois", max: 12 },
  { cle: "12-24", label: "12 à 24 mois", max: 24 },
  { cle: ">24", label: "> 24 mois", max: Infinity },
];

// Tranches d'ancienneté de la dernière vente (vs date d'arrêté du classeur).
const TRANCHES_ANCIENNETE = [
  { cle: "<3", label: "< 3 mois", maxJours: 91 },
  { cle: "3-6", label: "3 à 6 mois", maxJours: 183 },
  { cle: "6-12", label: "6 à 12 mois", maxJours: 365 },
  { cle: "12-24", label: "1 à 2 ans", maxJours: 730 },
  { cle: ">24", label: "> 2 ans", maxJours: Infinity },
];

// Projection minimale d'un article pour les tops (payload contenu).
const topArticle = (a) => ({
  nart: a.nart,
  design: a.design,
  fournisseur: a.fournisseur,
  stock: a.stock,
  valeurStock: a.valeurStock,
  surstock: a.surstock,
  valeurDeprec: a.valeurDeprec,
  moisStock: a.moisStock === null ? null : arrondi(a.moisStock, 1),
  dateVte: a.dateVte,
});

/**
 * Synthèse complète d'un classeur : KPI, répartition, évolution, rotation,
 * ancienneté des ventes, tops fournisseurs/groupes/articles.
 * @param {object} data     résultat de `lireAnalyse`
 * @param {string} periode  "AAAA-MM" du classeur (date d'arrêté = fin de mois)
 */
export function construireSynthese(data, periode) {
  const { articles } = data;

  // Date d'arrêté : dernier jour du mois du classeur (pour l'ancienneté).
  const [annee, mois] = periode.split("-").map(Number);
  const arrete = new Date(Date.UTC(annee, mois, 0));

  const totaux = {
    nbArticles: articles.length,
    nbEnStock: 0,
    valeurStock: 0,
    nbSurstock: 0,
    valeurSurstock: 0,
    nbDeprec: 0,
    valeurDeprec: 0,
    nbEnCommande: 0,
    valeurCommande: 0,
    nbDormants: 0, // stock > 0 et aucune vente sur l'année
    valeurDormants: 0,
    caAn: 0,
  };
  let cogsAn = 0; // coût des ventes approché : Σ PREV × VTE AN (couverture globale)

  const rotation = TRANCHES_ROTATION.map((t) => ({
    ...t,
    nbArticles: 0,
    valeur: 0,
  }));
  const rotationSansVente = { cle: "nc", label: "Sans vente", nbArticles: 0, valeur: 0 };

  const anciennete = TRANCHES_ANCIENNETE.map((t) => ({
    ...t,
    nbArticles: 0,
    valeur: 0,
  }));
  const jamaisVendu = { cle: "jamais", label: "Jamais vendu", nbArticles: 0, valeur: 0 };

  const parFournisseur = new Map();
  const parGroupe = new Map();

  for (const a of articles) {
    totaux.valeurStock += a.valeurStock;
    totaux.caAn += a.caAn;
    if (a.stock > 0) totaux.nbEnStock += 1;
    if (a.surstock !== 0) {
      totaux.nbSurstock += 1;
      totaux.valeurSurstock += a.surstock;
    }
    if (a.valeurDeprec !== 0) {
      totaux.nbDeprec += 1;
      totaux.valeurDeprec += a.valeurDeprec;
    }
    if (a.valeurCommande !== 0 || a.qteCommande !== 0) {
      totaux.nbEnCommande += 1;
      totaux.valeurCommande += a.valeurCommande;
    }
    const dormant = a.vteAn === 0 && a.stock > 0;
    if (dormant) {
      totaux.nbDormants += 1;
      totaux.valeurDormants += a.valeurStock;
    }
    if (a.vteAn > 0 && a.prev > 0) cogsAn += a.prev * a.vteAn;

    // Rotation (uniquement les articles en stock : les autres n'immobilisent rien).
    if (a.stock > 0) {
      if (a.moisStock === null) {
        rotationSansVente.nbArticles += 1;
        rotationSansVente.valeur += a.valeurStock;
      } else {
        const t = rotation.find((tr) => a.moisStock < tr.max) || rotation[rotation.length - 1];
        t.nbArticles += 1;
        t.valeur += a.valeurStock;
      }

      if (!a.dateVte) {
        jamaisVendu.nbArticles += 1;
        jamaisVendu.valeur += a.valeurStock;
      } else {
        const jours = (arrete - new Date(a.dateVte)) / 86400000;
        const t =
          anciennete.find((tr) => jours < tr.maxJours) ||
          anciennete[anciennete.length - 1];
        t.nbArticles += 1;
        t.valeur += a.valeurStock;
      }
    }

    // Agrégats fournisseur / groupe (valeur de stock uniquement).
    if (a.valeurStock !== 0 || a.surstock !== 0) {
      const fKey = a.fournisseur || "(sans fournisseur)";
      let f = parFournisseur.get(fKey);
      if (!f) {
        f = { nom: fKey, nbArticles: 0, valeur: 0, surstock: 0, valeurDeprec: 0 };
        parFournisseur.set(fKey, f);
      }
      f.nbArticles += 1;
      f.valeur += a.valeurStock;
      f.surstock += a.surstock;
      f.valeurDeprec += a.valeurDeprec;

      const gKey = a.groupe || "(sans groupe)";
      let grp = parGroupe.get(gKey);
      if (!grp) {
        grp = { nom: gKey, nbArticles: 0, valeur: 0, surstock: 0, valeurDeprec: 0 };
        parGroupe.set(gKey, grp);
      }
      grp.nbArticles += 1;
      grp.valeur += a.valeurStock;
      grp.surstock += a.surstock;
      grp.valeurDeprec += a.valeurDeprec;
    }
  }

  // Couverture globale : combien de mois le stock couvre au rythme de vente
  // de l'année écoulée (coût des ventes mensuel moyen).
  totaux.couvertureMois = cogsAn
    ? arrondi(totaux.valeurStock / (cogsAn / 12), 1)
    : null;
  totaux.pctSurstock = totaux.valeurStock
    ? arrondi((totaux.valeurSurstock / totaux.valeurStock) * 100, 1)
    : null;
  totaux.pctDeprec = totaux.valeurStock
    ? arrondi((totaux.valeurDeprec / totaux.valeurStock) * 100, 1)
    : null;
  totaux.pctDormants = totaux.valeurStock
    ? arrondi((totaux.valeurDormants / totaux.valeurStock) * 100, 1)
    : null;

  const topsParValeur = (sel, n = 15) =>
    [...articles].sort((a, b) => sel(b) - sel(a)).slice(0, n)
      .filter((a) => sel(a) > 0)
      .map(topArticle);

  const fournisseurs = [...parFournisseur.values()].sort(
    (a, b) => b.valeur - a.valeur,
  );
  const groupes = [...parGroupe.values()].sort((a, b) => b.valeur - a.valeur);

  return {
    fichier: data.fichier,
    modifieLe: data.modifieLe,
    recap: data.recap,
    totaux,
    rotation: [...rotation, rotationSansVente],
    anciennete: [...anciennete, jamaisVendu],
    topFournisseurs: fournisseurs.slice(0, 15),
    nbFournisseurs: fournisseurs.length,
    topGroupes: groupes.slice(0, 15),
    nbGroupes: groupes.length,
    topValeur: topsParValeur((a) => a.valeurStock),
    topSurstock: topsParValeur((a) => a.surstock),
    topDormants: [...articles]
      .filter((a) => a.vteAn === 0 && a.stock > 0)
      .sort((a, b) => b.valeurStock - a.valeurStock)
      .slice(0, 15)
      .map(topArticle),
    topDeprec: topsParValeur((a) => a.valeurDeprec),
  };
}

// --- Explorateur d'articles ---------------------------------------------------

// Colonnes triables de l'explorateur (clé API -> champ de l'article).
const TRIS = new Set([
  "nart", "design", "fournisseur", "groupe", "stock", "valeurStock",
  "surstock", "valeurDeprec", "moisStock", "vteAn", "caAn", "tauxMargePct",
  "valeurCommande", "dateVte", "dateArrive",
]);

const FLAGS = {
  surstock: (a) => a.surstock !== 0,
  dormants: (a) => a.vteAn === 0 && a.stock > 0,
  deprecies: (a) => a.valeurDeprec !== 0,
  commande: (a) => a.qteCommande !== 0 || a.valeurCommande !== 0,
  stock: (a) => a.stock > 0,
};

/**
 * Filtre + trie + pagine la liste des articles (46 000 lignes chez QC :
 * tout se fait ici, le front ne reçoit qu'une page).
 */
export function filtrerArticles(
  data,
  { q = "", codeFiltre = "", fournisseur = "", groupe = "", flag = "", tri = "valeurStock", dir = "desc", page = 1, taille = 50 } = {},
) {
  let lignes = data.articles;

  if (flag && FLAGS[flag]) lignes = lignes.filter(FLAGS[flag]);
  if (codeFiltre) lignes = lignes.filter((a) => a.codeFiltre === codeFiltre);
  if (fournisseur) lignes = lignes.filter((a) => a.fournisseur === fournisseur);
  if (groupe) {
    lignes = lignes.filter((a) => (a.groupe || "(sans groupe)") === groupe);
  }

  const mots = String(q).toLowerCase().split(/\s+/).filter(Boolean);
  if (mots.length) {
    lignes = lignes.filter((a) => {
      const txt =
        `${a.nart} ${a.design} ${a.gencod} ${a.refer} ${a.fournisseur} ${a.groupe}`.toLowerCase();
      return mots.every((m) => txt.includes(m));
    });
  }

  const cle = TRIS.has(tri) ? tri : "valeurStock";
  const sens = dir === "asc" ? 1 : -1;
  const texte = cle === "nart" || cle === "design" || cle === "fournisseur" || cle === "groupe";
  lignes = [...lignes].sort((a, b) => {
    const va = a[cle];
    const vb = b[cle];
    if (texte) return sens * String(va || "").localeCompare(String(vb || ""));
    // null (mois stock, dates absentes) toujours en fin de liste.
    const na = va === null || va === undefined || va === "" ? -Infinity : va;
    const nb = vb === null || vb === undefined || vb === "" ? -Infinity : vb;
    if (typeof na === "string" || typeof nb === "string") {
      return sens * String(na).localeCompare(String(nb));
    }
    return sens * (na - nb);
  });

  const total = lignes.length;
  const parPage = Math.min(Math.max(Number(taille) || 50, 10), 200);
  const pageNum = Math.max(Number(page) || 1, 1);
  const debut = (pageNum - 1) * parPage;

  return {
    total,
    page: pageNum,
    taille: parPage,
    articles: lignes.slice(debut, debut + parPage),
  };
}

/**
 * Valeurs distinctes pour les filtres de l'explorateur (fournisseurs et
 * groupes triés par valeur de stock décroissante, codes filtres fixes).
 */
export function listerFiltres(data) {
  const parFournisseur = new Map();
  const parGroupe = new Map();
  for (const a of data.articles) {
    const f = a.fournisseur || "(sans fournisseur)";
    parFournisseur.set(f, (parFournisseur.get(f) || 0) + a.valeurStock);
    const g = a.groupe || "(sans groupe)";
    parGroupe.set(g, (parGroupe.get(g) || 0) + a.valeurStock);
  }
  const tri = (m) =>
    [...m.entries()].sort((a, b) => b[1] - a[1]).map(([nom]) => nom);
  return {
    codesFiltre: [...CODES_FILTRE, "Autre"],
    fournisseurs: tri(parFournisseur),
    groupes: tri(parGroupe),
  };
}

export default {
  scannerSources,
  lireAnalyse,
  construireSynthese,
  filtrerArticles,
  listerFiltres,
};
