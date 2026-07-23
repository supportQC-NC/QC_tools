// backend/services/libelleConfigService.js
//
// Lecteur générique de fichiers Excel de LIBELLÉS (code -> libellé), placés à la
// racine du dossier « collecteur » sur RCOMMUN — même emplacement que le fichier
// gisements. Sert à enrichir exports et étiquettes avec un libellé lisible.
//
// NON BLOQUANT : si aucun fichier n'est trouvé (ou illisible), on renvoie une
// Map vide — l'appelant se contente alors d'omettre le libellé.
//
// Colonnes attendues (en-têtes tolérants à la casse/accents/espaces) :
//   <CODE> | LIBELLE   (ex. GROUPE | LIBELLE  ou  GISEMENT | LIBELLE)
//
// Cache par chemin + date de modification (relecture auto si le fichier change).

import fs from "fs";
import path from "path";
import ExcelJS from "exceljs";
import { deriveCollecteurBase } from "../utils/receptionPaths.js";

const safeTrim = (v) => (v == null ? "" : String(v)).trim();

const normHeader = (v) =>
  safeTrim(v)
    .toUpperCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // accents
    .replace(/[\s_]+/g, "");

const normCode = (v) => safeTrim(v).toUpperCase();

// Cache en mémoire : cheminFichier -> { mtimeMs, map }
const cache = new Map();

// Construit la liste ordonnée de fichiers candidats.
// bases = noms de base sans extension (ex. ["groupe", "groupes"]).
const fichiersCandidats = (entreprise, bases) => {
  const base = deriveCollecteurBase(entreprise?.cheminRapportReception);
  const trig = safeTrim(entreprise?.trigramme).toUpperCase();
  const noms = [];
  for (const b of bases) {
    if (trig) noms.push(`${trig}_${b}.xlsx`);
  }
  for (const b of bases) noms.push(`${b}.xlsx`);
  return noms.map((n) => path.join(base, n));
};

const resoudreFichier = (entreprise, bases) => {
  for (const p of fichiersCandidats(entreprise, bases)) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {
      /* ignore */
    }
  }
  return null;
};

// Parse le classeur -> Map(codeUpper -> libelle). codeHeaders = en-têtes possibles
// pour la colonne code (normalisés), ex. ["GROUPE","CODE"].
const parseWorkbook = async (cheminFichier, codeHeaders) => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(cheminFichier);
  const ws = wb.worksheets[0] || null;
  const map = new Map();
  if (!ws) return map;

  const wanted = new Set(codeHeaders.map((h) => normHeader(h)));
  const colIdx = {};
  ws.getRow(1).eachCell((cell, col) => {
    const h = normHeader(cell.value);
    if (wanted.has(h) || h === "CODE") colIdx.code = colIdx.code || col;
    else if (h === "LIBELLE" || h === "LIBELE" || h === "NOM" || h === "DESIGNATION")
      colIdx.libelle = colIdx.libelle || col;
  });
  if (!colIdx.code || !colIdx.libelle) return map;

  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const cellVal = (col) => (col ? (row.getCell(col).text ?? row.getCell(col).value) : "");
    const code = normCode(cellVal(colIdx.code));
    if (!code) return;
    const libelle = safeTrim(cellVal(colIdx.libelle));
    if (libelle) map.set(code, libelle);
  });

  return map;
};

/**
 * Lit la Map des libellés (code -> libellé) pour une entreprise. NON BLOQUANT.
 * @param {object} entreprise
 * @param {object} opts
 * @param {string[]} opts.bases        noms de base des fichiers (ex. ["groupe","groupes"])
 * @param {string[]} opts.codeHeaders  en-têtes possibles pour la colonne code
 * @returns {Promise<{ map: Map<string,string>, fichier: string|null }>}
 */
export const readLibelleMap = async (entreprise, { bases, codeHeaders }) => {
  const fichier = resoudreFichier(entreprise, bases);
  if (!fichier) return { map: new Map(), fichier: null };

  let mtimeMs = 0;
  try {
    mtimeMs = fs.statSync(fichier).mtimeMs;
  } catch {
    return { map: new Map(), fichier: null };
  }

  const cached = cache.get(fichier);
  if (cached && cached.mtimeMs === mtimeMs) return { map: cached.map, fichier };

  try {
    const map = await parseWorkbook(fichier, codeHeaders);
    cache.set(fichier, { mtimeMs, map });
    return { map, fichier };
  } catch (e) {
    console.error(`[libellés] lecture Excel impossible (${fichier}):`, e.message);
    return { map: new Map(), fichier };
  }
};

// Recherche le libellé d'un code dans la Map (normalisé). "" si absent.
export const lookupLibelle = (map, code) => {
  if (!map) return "";
  return map.get(normCode(code)) || "";
};

// Presets prêts à l'emploi.
export const GROUPE_LIBELLE_PRESET = { bases: ["groupe", "groupes"], codeHeaders: ["GROUPE"] };

export default { readLibelleMap, lookupLibelle, GROUPE_LIBELLE_PRESET };
