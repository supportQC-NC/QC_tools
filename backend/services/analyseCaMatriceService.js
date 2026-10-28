// backend/services/analyseCaMatriceService.js
//
// MATRICES CA : lecture des classeurs Excel déposés sur le Rcommun
// (\\192.168.0.250\Rcommun\STOCK\doc_temp\CA) qui servent de base de données
// au module Analyse CA. Deux familles de fichiers, même structure interne :
//
//   matrice_ca_ht_<slug>_<annee>.xlsx          -> une société (slug ≈ nomDossierDBF)
//   Analyse_CA_GROUPE_<NOM>_<annee>.xlsx       -> un groupe consolidé
//
// Chaque classeur contient :
//   - une feuille "Dashboard" : KPI cumulés (CA, marge, taux, clients) N vs N-1
//     + tableau mensuel (CA/Marge/Clients/PM, N, N-1, R/H) + date de génération ;
//   - une feuille par mois ÉCOULÉ ("janv-26"…"oct-26") : par jour CA/MARGE/TX/CLTS
//     pour N et N-1 (avec R/H), et le détail par catégorie client (PART, FIDELITE,
//     PRO CPT, PRO DEBIT, GROUPE, ADMIN, REVEND, AGRI, AUTRE) en montant + part.
//
// Les fichiers sont régénérés chaque jour : cache en mémoire invalidé sur
// mtime + taille. On repère les blocs par leurs LIBELLÉS (ligne "Periode",
// ligne "CUMUL"…), jamais par numéro de ligne en dur — le générateur amont
// peut décaler d'une ligne sans nous casser.
//
// ⚠️ Unités hétérogènes dans le fichier : TX quotidien en pour-cent (62.3),
// taux cumulés et parts de catégorie en ratio (0.51), R/H en ratio (peut
// dépasser 1 : +113 %). Tout est NORMALISÉ ici en pour-cent (0–100) pour que
// le front n'ait qu'une seule convention.

import fs from "fs";
import path from "path";
import ExcelJS from "exceljs";

const DOSSIER_MATRICES =
  process.env.ANALYSE_CA_MATRICES_PATH ||
  "\\\\192.168.0.250\\Rcommun\\STOCK\\doc_temp\\CA";

// Le slug des fichiers suit nomDossierDBF, à une exception près.
const ALIAS_SLUG_VERS_DOSSIER = { quinckone: "konequincaillerie" };
const ALIAS_DOSSIER_VERS_SLUG = Object.fromEntries(
  Object.entries(ALIAS_SLUG_VERS_DOSSIER).map(([slug, dossier]) => [dossier, slug]),
);

const RE_SOCIETE = /^matrice_ca_ht_([a-z0-9]+)_(\d{4})\.xlsx$/i;
const RE_GROUPE = /^Analyse_CA_(GROUPE_[A-Z0-9_]+)_(\d{4})\.xlsx$/i;

// Ordre des feuilles mensuelles (noms "janv-26", "fevr-26"…).
const MOIS_FEUILLES = [
  "janv", "fevr", "mars", "avr", "mai", "juin",
  "juil", "aout", "sept", "oct", "nov", "dec",
];
const MOIS_LABELS = [
  "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
  "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre",
];

// --- Helpers de lecture de cellule -----------------------------------------

// Valeur "plate" d'une cellule exceljs (formule -> result, richText -> texte).
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

function num(cell) {
  const v = val(cell);
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return 0;
}

function str(cell) {
  const v = val(cell);
  return v === null || v === undefined ? "" : String(v).trim();
}

// Ratio (0.51) -> pour-cent (51). Les R/H sont TOUJOURS des ratios dans le fichier.
const ratioEnPct = (v) => Math.round(v * 10000) / 100;

// Taux de marge : pour-cent dans les lignes quotidiennes (62.3), ratio dans les
// cumuls (0.51). Un taux réel est toujours < 150 % et un ratio toujours <= 1,
// donc le seuil 1.5 ne peut pas se tromper sur cette colonne.
const tauxEnPct = (v) => (Math.abs(v) <= 1.5 ? ratioEnPct(v) : Math.round(v * 100) / 100);

// Cherche la première ligne dont la 1re cellule (ou une colonne donnée) vaut un libellé.
function trouverLigne(ws, libelle, colonne = 1) {
  const cible = libelle.toUpperCase();
  for (let r = 1; r <= ws.rowCount; r++) {
    if (str(ws.getRow(r).getCell(colonne)).toUpperCase().startsWith(cible)) return r;
  }
  return -1;
}

// --- Inventaire des fichiers ------------------------------------------------

/**
 * Scanne le dossier des matrices et renvoie les sources disponibles.
 * @returns {{societes: Map<string, Map<number, string>>, groupes: Map<string, Map<number, string>>}}
 *   clés = nomDossierDBF (sociétés) / id groupe en minuscules ; valeurs =
 *   Map année -> chemin complet du fichier.
 */
export function scannerSources() {
  const societes = new Map();
  const groupes = new Map();
  let fichiers = [];
  try {
    fichiers = fs.readdirSync(DOSSIER_MATRICES);
  } catch {
    // Partage indisponible : renvoyer des listes vides, l'appelant décide.
    return { societes, groupes, dossier: DOSSIER_MATRICES, accessible: false };
  }
  for (const f of fichiers) {
    let m = RE_SOCIETE.exec(f);
    if (m) {
      const slug = m[1].toLowerCase();
      const dossier = ALIAS_SLUG_VERS_DOSSIER[slug] || slug;
      if (!societes.has(dossier)) societes.set(dossier, new Map());
      societes.get(dossier).set(Number(m[2]), path.join(DOSSIER_MATRICES, f));
      continue;
    }
    m = RE_GROUPE.exec(f);
    if (m) {
      const id = m[1].toLowerCase();
      if (!groupes.has(id)) groupes.set(id, new Map());
      groupes.get(id).set(Number(m[2]), path.join(DOSSIER_MATRICES, f));
    }
  }
  return { societes, groupes, dossier: DOSSIER_MATRICES, accessible: true };
}

// Libellé humain d'un id de groupe ("groupe_ducos_quincaillerie" -> "Groupe Ducos Quincaillerie").
export function libelleGroupe(id) {
  return id
    .split("_")
    .map((mot) => (mot ? mot[0].toUpperCase() + mot.slice(1).toLowerCase() : mot))
    .join(" ");
}

// --- Parsing d'un classeur --------------------------------------------------

// Cache par chemin de fichier, invalidé sur mtime + taille.
const cache = new Map(); // chemin -> { mtimeMs, size, data }

/**
 * Lit (ou ressert du cache) la matrice complète d'un fichier.
 * @returns {Promise<object>} { genereLe, kpis, mois[], moisDetail[] }
 */
export async function lireMatrice(chemin) {
  const stat = fs.statSync(chemin);
  const enCache = cache.get(chemin);
  if (enCache && enCache.mtimeMs === stat.mtimeMs && enCache.size === stat.size) {
    return enCache.data;
  }

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(chemin);

  const data = {
    fichier: path.basename(chemin),
    modifieLe: stat.mtime.toISOString(),
    ...parseDashboard(wb.getWorksheet("Dashboard")),
    moisDetail: [],
  };

  for (const ws of wb.worksheets) {
    const m = /^([a-z]+)-(\d{2})$/i.exec(ws.name);
    if (!m) continue;
    const indexMois = MOIS_FEUILLES.indexOf(m[1].toLowerCase());
    if (indexMois === -1) continue;
    data.moisDetail.push(parseFeuilleMois(ws, indexMois, 2000 + Number(m[2])));
  }
  data.moisDetail.sort((a, b) => a.mois - b.mois);

  cache.set(chemin, { mtimeMs: stat.mtimeMs, size: stat.size, data });
  return data;
}

// Feuille "Dashboard" : KPI cumulés + tableau mensuel + date de génération.
function parseDashboard(ws) {
  if (!ws) return { genereLe: "", kpis: null, mois: [], total: null };

  // Bloc KPI : ligne "CA HT CUMULE", valeurs N en dessous, N-1 2 lignes plus
  // bas, variations (ratios) encore en dessous.
  const rKpi = trouverLigne(ws, "CA HT CUMULE");
  let kpis = null;
  if (rKpi !== -1) {
    const vN = ws.getRow(rKpi + 1);
    const vN1 = ws.getRow(rKpi + 3);
    const vEvol = ws.getRow(rKpi + 4);
    // Colonnes (cellules fusionnées) : 1 = CA, 4 = marge, 7 = taux, 10 = clients.
    kpis = {
      caN: num(vN.getCell(1)),
      caN1: num(vN1.getCell(1)),
      evolCaPct: ratioEnPct(num(vEvol.getCell(1))),
      margeN: num(vN.getCell(4)),
      margeN1: num(vN1.getCell(4)),
      evolMargePct: ratioEnPct(num(vEvol.getCell(4))),
      tauxMargeN: ratioEnPct(num(vN.getCell(7))),
      tauxMargeN1: ratioEnPct(num(vN1.getCell(7))),
      clientsN: num(vN.getCell(10)),
      clientsN1: num(vN1.getCell(10)),
      evolClientsPct: ratioEnPct(num(vEvol.getCell(10))),
    };
  }

  // Tableau mensuel : entête "Periode", lignes janv..dec puis TOTAL.
  const mois = [];
  let total = null;
  const rTable = trouverLigne(ws, "Periode");
  if (rTable !== -1) {
    for (let r = rTable + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const periode = str(row.getCell(1));
      if (!periode) continue;
      const ligne = {
        periode,
        caN: num(row.getCell(2)),
        caN1: num(row.getCell(3)),
        rhCaPct: ratioEnPct(num(row.getCell(4))),
        margeN: num(row.getCell(5)),
        margeN1: num(row.getCell(6)),
        rhMargePct: ratioEnPct(num(row.getCell(7))),
        clientsN: num(row.getCell(8)),
        clientsN1: num(row.getCell(9)),
        rhClientsPct: ratioEnPct(num(row.getCell(10))),
        pmN: num(row.getCell(11)),
        pmN1: num(row.getCell(12)),
        rhPmPct: ratioEnPct(num(row.getCell(13))),
      };
      if (periode.toUpperCase() === "TOTAL") {
        total = ligne;
        break;
      }
      ligne.mois = MOIS_FEUILLES.indexOf(periode.toLowerCase()) + 1;
      mois.push(ligne);
    }
  }

  // "Rapport genere le JJ/MM/AAAA à HH:MM" (ligne fusionnée en bas de feuille).
  const rGenere = trouverLigne(ws, "Rapport genere le");
  const genereLe = rGenere !== -1 ? str(ws.getRow(rGenere).getCell(1)) : "";

  return { genereLe, kpis, mois, total };
}

// Feuille mensuelle : jours N / N-1 + détail par catégorie client.
function parseFeuilleMois(ws, indexMois, annee) {
  // L'entête porte les noms de catégories (colonnes 15, 17, 19… : NOM puis %).
  const rEntete = trouverLigne(ws, "DATE");
  if (rEntete === -1) {
    // Feuille inattendue : on la renvoie vide plutôt que de planter la matrice.
    return {
      mois: indexMois + 1,
      annee,
      label: MOIS_LABELS[indexMois],
      categories: [],
      jours: [],
      cumul: null,
      pm: null,
    };
  }
  const categories = [];
  const entete = ws.getRow(rEntete);
  for (let c = 15; c <= ws.columnCount; c += 2) {
    const nom = str(entete.getCell(c));
    if (nom && nom !== "%") categories.push({ nom, colonne: c });
  }

  const jours = [];
  let cumul = null;
  let margesCategories = null;
  let pm = null;

  for (let r = rEntete + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const lib = str(row.getCell(1));

    if (lib.toUpperCase() === "CUMUL") {
      cumul = {
        caN: num(row.getCell(2)),
        margeN: num(row.getCell(3)),
        tauxMargeN: tauxEnPct(num(row.getCell(4))),
        clientsN: num(row.getCell(5)),
        caN1: num(row.getCell(8)),
        margeN1: num(row.getCell(9)),
        tauxMargeN1: tauxEnPct(num(row.getCell(10))),
        clientsN1: num(row.getCell(11)),
        rhCaPct: ratioEnPct(num(row.getCell(12))),
        categories: categories.map(({ nom, colonne }) => ({
          nom,
          ca: num(row.getCell(colonne)),
          partPct: ratioEnPct(num(row.getCell(colonne + 1))),
        })),
      };
      continue;
    }

    // Ligne "MARGE" du bloc catégories (col 14) : marge de chaque catégorie et
    // sa PART de la marge totale du mois (⚠️ pas son taux de marge).
    if (str(row.getCell(14)).toUpperCase() === "MARGE") {
      margesCategories = categories.map(({ nom, colonne }) => ({
        nom,
        marge: num(row.getCell(colonne)),
        partMargePct: ratioEnPct(num(row.getCell(colonne + 1))),
      }));
      continue;
    }

    // Ligne "PM" : panier moyen N (col 2) et N-1 (col 8).
    if (lib.toUpperCase() === "PM") {
      pm = { pmN: num(row.getCell(2)), pmN1: num(row.getCell(8)) };
      continue;
    }

    // Ligne quotidienne : "ven. 02" | CA | MARGE | TX | CLTS …
    if (!cumul && /\d/.test(lib)) {
      const jourNum = Number((lib.match(/(\d+)\s*$/) || [])[1] || 0);
      jours.push({
        date: lib,
        jour: jourNum,
        caN: num(row.getCell(2)),
        margeN: num(row.getCell(3)),
        tauxMargeN: tauxEnPct(num(row.getCell(4))),
        clientsN: num(row.getCell(5)),
        dateN1: str(row.getCell(7)),
        caN1: num(row.getCell(8)),
        margeN1: num(row.getCell(9)),
        tauxMargeN1: tauxEnPct(num(row.getCell(10))),
        clientsN1: num(row.getCell(11)),
        rhCaPct: str(row.getCell(12)) === "" ? null : ratioEnPct(num(row.getCell(12))),
        categories: categories.map(({ nom, colonne }) => ({
          nom,
          ca: num(row.getCell(colonne)),
          partPct: ratioEnPct(num(row.getCell(colonne + 1))),
        })),
      });
    }
  }

  // Fusion marge/taux dans le cumul par catégorie (même ordre de colonnes).
  if (cumul && margesCategories) {
    cumul.categories = cumul.categories.map((c, i) => ({
      ...c,
      marge: margesCategories[i]?.marge ?? 0,
      partMargePct: margesCategories[i]?.partMargePct ?? 0,
      // Taux de marge recalculé (marge / CA de la catégorie).
      tauxMargePct:
        c.ca !== 0
          ? Math.round(((margesCategories[i]?.marge ?? 0) / c.ca) * 10000) / 100
          : 0,
    }));
  }

  return {
    mois: indexMois + 1,
    annee,
    label: MOIS_LABELS[indexMois],
    categories: categories.map((c) => c.nom),
    jours,
    cumul,
    pm,
  };
}

export default { scannerSources, lireMatrice, libelleGroupe, DOSSIER_MATRICES };
