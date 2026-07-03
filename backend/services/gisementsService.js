// backend/services/gisementsService.js
//
// Lit le fichier Excel de paramétrage des gisements, placé à la RACINE du dossier
// « collecteur » sur RCOMMUN. Utilisé UNIQUEMENT pour le tri de la préparation
// MAGASIN (le dock suit l'ordre de la proforma).
//
// Colonnes attendues (en-têtes tolérants à la casse/accents/espaces) :
//   GISEMENT | LIBELLE | PRIORITE
//   -> mappe GISM1 (= GisementSTOCKXL de la fiche article) vers { libelle, priorite }.
//   LIBELLE = nom affiché à l'opérateur ; PRIORITE = ordre de parcours MAGASIN.
//
// Résolution du fichier (premier trouvé) :
//   1) <collecteur>/<TRIGRAMME>_gissement.xlsx   (convention retenue, par entreprise)
//   2) <collecteur>/<TRIGRAMME>_gisement.xlsx    (tolérance orthographe)
//   3) <collecteur>/gissement.xlsx | gisements.xlsx (repli partagé)
// La base « collecteur » est dérivée du chemin de dépôt de l'entreprise
// (deriveCollecteurBase), comme pour le dépôt PDF/photos de réception.
//
// Cache par chemin + date de modification (relecture auto si le fichier change).

import fs from "fs";
import path from "path";
import ExcelJS from "exceljs";
import { deriveCollecteurBase } from "../utils/receptionPaths.js";

const safeTrim = (v) => (v == null ? "" : String(v)).trim();

// Normalise un en-tête : majuscules, sans accents, sans espaces/underscores.
const normHeader = (v) =>
  safeTrim(v)
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // accents
    .replace(/[\s_]+/g, "");

// Clé de gisement normalisée (pour le rapprochement avec GISM1).
const normCode = (v) => safeTrim(v).toUpperCase();

// Cache en mémoire : cheminFichier -> { mtimeMs, map }
const cache = new Map();

// Noms de fichiers candidats, dans l'ordre de priorité.
// Convention : "<TRIGRAMME>_gissement.xlsx" à la racine de « collecteur ».
// Tolérance orthographe (gisement) + repli partagé.
const fichiersCandidats = (entreprise) => {
  const base = deriveCollecteurBase(entreprise?.cheminRapportReception);
  const trig = safeTrim(entreprise?.trigramme).toUpperCase();
  const noms = [];
  if (trig) {
    noms.push(`${trig}_gissement.xlsx`); // convention retenue
    noms.push(`${trig}_gisement.xlsx`); // tolérance orthographe
  }
  noms.push("gissement.xlsx");
  noms.push("gisements.xlsx");
  return noms.map((n) => path.join(base, n));
};

// Retourne le premier fichier existant parmi les candidats, ou null.
const resoudreFichier = (entreprise) => {
  for (const p of fichiersCandidats(entreprise)) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {
      /* ignore */
    }
  }
  return null;
};

// Parse le classeur -> Map(gisement -> { rayon, sousRayon, priorite }).
const parseWorkbook = async (cheminFichier) => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(cheminFichier);

  // Feuille "Gisements" si présente, sinon la première.
  const ws =
    wb.getWorksheet("Gisements") || wb.worksheets[0] || null;
  const map = new Map();
  if (!ws) return map;

  // Repérage des colonnes via la 1re ligne (en-têtes).
  const headerRow = ws.getRow(1);
  const colIdx = {};
  headerRow.eachCell((cell, col) => {
    const h = normHeader(cell.value);
    if (h === "GISEMENT" || h === "GISM" || h === "GISM1" || h === "CODE")
      colIdx.gisement = col;
    else if (h === "LIBELLE" || h === "RAYON" || h === "NOMRAYON")
      colIdx.libelle = col; // normHeader retire les accents -> "LIBELLÉ" == "LIBELLE"
    else if (h === "PRIORITE" || h === "PRIO" || h === "ORDRE")
      colIdx.priorite = col;
  });

  if (!colIdx.gisement) return map; // fichier non exploitable

  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // en-tête
    const cellVal = (col) =>
      col ? (row.getCell(col).text ?? row.getCell(col).value) : "";
    const gisement = normCode(cellVal(colIdx.gisement));
    if (!gisement) return;
    const libelle = safeTrim(cellVal(colIdx.libelle));
    const prioriteRaw = safeTrim(cellVal(colIdx.priorite));
    const priorite = prioriteRaw === "" ? null : Number(prioriteRaw);
    map.set(gisement, {
      libelle,
      priorite: Number.isFinite(priorite) ? priorite : null,
    });
  });

  return map;
};

/**
 * Retourne la Map des gisements pour une entreprise (ou une Map vide si aucun
 * fichier). Utilise un cache invalidé par la date de modification du fichier.
 * @returns {Promise<{ map: Map<string,{rayon,sousRayon,priorite}>, fichier: string|null }>}
 */
export const getGisements = async (entreprise) => {
  const fichier = resoudreFichier(entreprise);
  if (!fichier) return { map: new Map(), fichier: null };

  let mtimeMs = 0;
  try {
    mtimeMs = fs.statSync(fichier).mtimeMs;
  } catch {
    return { map: new Map(), fichier: null };
  }

  const cached = cache.get(fichier);
  if (cached && cached.mtimeMs === mtimeMs) {
    return { map: cached.map, fichier };
  }

  try {
    const map = await parseWorkbook(fichier);
    cache.set(fichier, { mtimeMs, map });
    return { map, fichier };
  } catch (e) {
    console.error(`[PREPA gisements] lecture Excel impossible (${fichier}):`, e.message);
    return { map: new Map(), fichier };
  }
};

/**
 * Cherche le paramétrage d'un gisement (GISM1) dans la Map.
 * @returns {{libelle,priorite}|null}
 */
export const lookupGisement = (map, gism1) => {
  const code = normCode(gism1);
  if (!code || !map) return null;
  return map.get(code) || null;
};

export default { getGisements, lookupGisement };