// backend/services/analyseCaMensuelleService.js
//
// ANALYSE CA MENSUELLE : lecture des classeurs Excel déposés chaque mois sur
// le Rcommun (\\192.168.0.250\Rcommun\STOCK\doc_temp\CA_MENSUELLE), un par
// société, nommés `analyse_ca_<trigramme>_<MM>_<AAAA>.xlsx` (trigramme en
// minuscules : qc, dq, aw…). TOUT le contenu doit remonter à l'écran.
//
// Chaque classeur porte jusqu'à 11 onglets (constaté sur QC 09/2026) :
//   TYPES_CLIENT   — matrice type de client × métrique, colonnes JANV..DÉC + CUMUL
//                    (8 métriques par type : NB Factures, CA, Panier Moyen, NUC,
//                    Marge, Marge %, CA R/H %, Marge R/H %) + bloc TOTAL MENSUEL
//   Client         — CA par client (4 000+ lignes chez QC, 31 colonnes)
//   Fournisseurs / Classes / Sous_Classes / Locates / Groupes / Familles /
//   Sous_Familles  — mêmes familles de colonnes (CA N/N-1, évolutions, parts,
//                    marges, quantités, prix moyens…)
//   Rayons         — perf par rayon (CA, MARGE = TAUX en ratio, R/H, stock,
//                    dépréciation, métrage)
//   Client_Interne — comptes internes (régul, vol/casse…)
//
// Le parsing est GÉNÉRIQUE : titre en ligne 1, en-têtes en ligne 2 (avec
// retours à la ligne), données dès la ligne 3, lignes TOTAL en fin de feuille.
// Une société peut ne pas avoir tous les onglets : on renvoie ce qui existe.
//
// ⚠️ Les pourcentages sont stockés en RATIO dans les fichiers (0.02 = +2 %).
// Comme pour les matrices CA, tout est normalisé ici en pour-cent (0–100) :
//   - colonnes dont l'en-tête contient « % » ou « R/H » ;
//   - onglet Rayons : MARGE, R/H, R/H_2 et TAUX_DEPREC (pas de « % » dans
//     l'en-tête mais ce sont des ratios) ;
//   - onglet TYPES_CLIENT : lignes dont la MÉTRIQUE contient « % ».
//
// ⚠️ Les lignes TOTAL de l'onglet Rayons sont des FORMULES sans résultat en
// cache : les sommes des colonnes « montant » sont recalculées ici, les
// colonnes ratio restent vides.
//
// ⚠️ Chemin EN DUR, pas de variable d'environnement (même décision que les
// matrices CA) : <RCOMMON_STOCK_ROOT>/doc_temp/CA_MENSUELLE en prod (VPS),
// le partage UNC en dev Windows.

import fs from "fs";
import path from "path";
import ExcelJS from "exceljs";

const RE_FICHIER = /^analyse_ca_([a-z0-9]+)_(\d{2})_(\d{4})\.xlsx$/i;

// Colonnes ratio de l'onglet Rayons (pas de « % » dans l'en-tête).
const COLONNES_RATIO_RAYONS = new Set(["MARGE", "R/H", "R/H_2", "TAUX_DEPREC"]);

// Candidats essayés dans l'ordre ; le premier dossier lisible gagne.
function candidatsDossier() {
  const liste = [];
  const stockRoot = String(process.env.RCOMMON_STOCK_ROOT || "").replace(
    /[\\/]+$/,
    "",
  );
  if (stockRoot) liste.push(path.posix.join(stockRoot, "doc_temp", "CA_MENSUELLE"));
  liste.push("\\\\192.168.0.250\\Rcommun\\STOCK\\doc_temp\\CA_MENSUELLE");
  return liste;
}

// --- Helpers de cellule (mêmes conventions que analyseCaMatriceService) ----

// Sentinelle : formule sans résultat en cache (à recalculer pour les totaux).
const FORMULE_SANS_RESULTAT = Symbol("formuleSansResultat");

function val(cell) {
  const v = cell?.value;
  if (v === null || v === undefined) return null;
  if (typeof v === "object") {
    if (v.result !== undefined) return v.result;
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join("");
    if (v instanceof Date) return v;
    if (v.text !== undefined) return v.text;
    if (v.formula !== undefined || v.sharedFormula !== undefined) {
      return FORMULE_SANS_RESULTAT;
    }
    return null;
  }
  return v;
}

const ratioEnPct = (v) => Math.round(v * 10000) / 100;

// --- Inventaire des fichiers ------------------------------------------------

/**
 * Scanne le dossier et renvoie les classeurs disponibles.
 * @returns {{sources: Map<string, Map<string, string>>, dossier: string, accessible: boolean}}
 *   sources : trigramme minuscule -> Map période "AAAA-MM" -> chemin complet.
 */
export function scannerSources() {
  const sources = new Map();
  const candidats = candidatsDossier();

  let dossier = null;
  let fichiers = [];
  for (const candidat of candidats) {
    try {
      fichiers = fs.readdirSync(candidat);
      dossier = candidat;
      break;
    } catch {
      // Candidat illisible (pas monté sur cette machine) : suivant.
    }
  }
  if (!dossier) {
    return { sources, dossier: candidats.join(" | "), accessible: false };
  }

  for (const f of fichiers) {
    const m = RE_FICHIER.exec(f);
    if (!m) continue;
    const slug = m[1].toLowerCase();
    const periode = `${m[3]}-${m[2]}`; // AAAA-MM (triable)
    if (!sources.has(slug)) sources.set(slug, new Map());
    sources.get(slug).set(periode, path.join(dossier, f));
  }
  return { sources, dossier, accessible: true };
}

// --- Parsing d'un classeur --------------------------------------------------

const cache = new Map(); // chemin -> { mtimeMs, size, data }

/**
 * Lit (ou ressert du cache) un classeur complet.
 * @returns {Promise<{fichier: string, modifieLe: string, feuilles: object[]}>}
 */
export async function lireClasseur(chemin) {
  const stat = fs.statSync(chemin);
  const enCache = cache.get(chemin);
  if (enCache && enCache.mtimeMs === stat.mtimeMs && enCache.size === stat.size) {
    return enCache.data;
  }

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(chemin);

  const feuilles = wb.worksheets.map((ws) => parseFeuille(ws));

  const data = {
    fichier: path.basename(chemin),
    modifieLe: stat.mtime.toISOString(),
    feuilles,
  };
  cache.set(chemin, { mtimeMs: stat.mtimeMs, size: stat.size, data });
  return data;
}

// Une feuille générique : titre (ligne 1), en-têtes (ligne 2), données (3+).
function parseFeuille(ws) {
  const titre = String(val(ws.getRow(1).getCell(1)) ?? "").trim();

  // En-têtes : retours à la ligne remplacés par des espaces.
  const colonnes = [];
  const entete = ws.getRow(2);
  for (let c = 1; c <= ws.columnCount; c++) {
    const brut = String(val(entete.getCell(c)) ?? "").trim();
    if (!brut) continue;
    const label = brut.replace(/\s*\n\s*/g, " ");
    const pct =
      /%|r\/h/i.test(label) ||
      (ws.name === "Rayons" && COLONNES_RATIO_RAYONS.has(label));
    colonnes.push({ colonne: c, label, format: pct ? "pct" : "auto" });
  }

  const estTypesClient = ws.name === "TYPES_CLIENT";
  const lignes = [];
  for (let r = 3; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const valeurs = colonnes.map(({ colonne }) => {
      const v = val(row.getCell(colonne));
      return typeof v === "number" && !Number.isFinite(v) ? null : v;
    });
    if (valeurs.every((v) => v === null || v === "")) continue; // séparateur

    // Normalisation ratio -> pour-cent.
    colonnes.forEach((col, i) => {
      if (col.format === "pct" && typeof valeurs[i] === "number") {
        valeurs[i] = ratioEnPct(valeurs[i]);
      }
    });
    // TYPES_CLIENT : la nature de la ligne dépend de la MÉTRIQUE (colonne 2).
    if (estTypesClient && /%/.test(String(valeurs[1] ?? ""))) {
      for (let i = 2; i < valeurs.length; i++) {
        if (typeof valeurs[i] === "number") valeurs[i] = ratioEnPct(valeurs[i]);
      }
    }
    lignes.push(valeurs);
  }

  // Formules sans résultat en cache (constaté sur la ligne TOTAL de l'onglet
  // Rayons) : on recalcule la somme de la colonne — jamais pour les ratios,
  // qu'on laisse vides. Une cellule simplement vide reste vide.
  // ⚠️ Une ligne TOTAL se reconnaît à sa PREMIÈRE colonne : les lignes de
  // données y portent un numéro (#/Rang) — tester « la première cellule texte »
  // prendrait les clients « TOTAL ENERGIES… » pour des totaux.
  const estTotal = (l) =>
    typeof l[0] === "string" && /^TOTAL/i.test(l[0].trim());
  const donnees = lignes.filter((l) => !estTotal(l));
  for (const l of lignes) {
    colonnes.forEach((col, i) => {
      if (l[i] !== FORMULE_SANS_RESULTAT) return;
      if (!estTotal(l) || col.format === "pct") {
        l[i] = null;
        return;
      }
      const sommables = donnees
        .map((d) => d[i])
        .filter((v) => typeof v === "number");
      l[i] = sommables.length
        ? Math.round(sommables.reduce((s, v) => s + v, 0) * 100) / 100
        : null;
    });
  }

  return {
    nom: ws.name,
    titre,
    colonnes: colonnes.map(({ label, format }) => ({ label, format })),
    lignes,
  };
}

export default { scannerSources, lireClasseur };
