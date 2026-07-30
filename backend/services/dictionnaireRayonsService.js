// backend/services/dictionnaireRayonsService.js
//
// Dictionnaire des RAYONS : fichier Excel « <TRIGRAMME>_dictionnaire_rayons.xlsx »
// à la racine du dossier « collecteur » sur RCOMMUN (même base que le fichier de
// paramétrage gisements — voir gisementsService.js / deriveCollecteurBase).
//
// Colonnes (en-têtes tolérants casse/accents/espaces) :
//   GISM1 | libelle | metrage
//   - GISM1   : code du rayon (valeur encodée dans l'étiquette QR/code-barres) ;
//   - libelle : nom affiché sur l'étiquette (en gras) ;
//   - metrage : nombre de SOUS-ZONES à générer (toujours au moins 1 → « _A »).
//
// Découpage en sous-zones (décision client) : nb = max(1, round(metrage)).
//   Chaque sous-zone = « <GISM1>_<lettre> » (A, B, … Z, AA, …). Ainsi une ligne
//   au_M / metrage 8 → au_M_A … au_M_H ; une ligne metrage 0 → un seul « code_A ».

import fs from "fs";
import path from "path";
import ExcelJS from "exceljs";
import { deriveCollecteurBase } from "../utils/receptionPaths.js";

const safeTrim = (v) => (v == null ? "" : String(v)).trim();

// Normalise un en-tête : majuscules, sans accents, sans espaces/_/./-.
const normHeader = (v) =>
  safeTrim(v)
    .toUpperCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[\s_.\-]+/g, "");

// Suffixe de sous-zone bijectif base 26 : 0→A, 25→Z, 26→AA, …
export const letterSuffix = (n) => {
  let s = "";
  let x = Math.max(0, Math.floor(n)) + 1; // 1-based
  while (x > 0) {
    const rem = (x - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
};

// Chemin du fichier dictionnaire pour l'entreprise (convention par trigramme).
export const resolveDictionnaireFile = (entreprise) => {
  const base = deriveCollecteurBase(entreprise?.cheminRapportReception);
  const trig = safeTrim(entreprise?.trigramme).toUpperCase() || "XXX";
  return path.join(base, `${trig}_dictionnaire_rayons.xlsx`);
};

// Lit le dictionnaire. Renvoie { fichier, exists, rows:[{ gism1, libelle, metrage }] }.
export const readDictionnaire = async (entreprise) => {
  const fichier = resolveDictionnaireFile(entreprise);
  if (!fs.existsSync(fichier)) return { fichier, exists: false, rows: [] };

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(fichier);
  const ws = wb.getWorksheet("Rayons") || wb.worksheets[0];
  if (!ws) return { fichier, exists: true, rows: [] };

  // Repérage des colonnes via la 1re ligne.
  const colIdx = {};
  ws.getRow(1).eachCell((cell, col) => {
    const h = normHeader(cell.value);
    if (["GISM1", "GISM", "GISEMENT", "CODE", "RAYON"].includes(h)) colIdx.gism1 = col;
    else if (["LIBELLE", "NOM", "DESIGNATION"].includes(h)) colIdx.libelle = col;
    else if (["METRAGE", "METRE", "METRES", "M", "NBSOUSZONE", "SOUSZONES"].includes(h))
      colIdx.metrage = col;
  });
  if (!colIdx.gism1) return { fichier, exists: true, rows: [] };

  const rows = [];
  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // en-tête
    const cellVal = (col) => (col ? row.getCell(col).text ?? row.getCell(col).value : "");
    const gism1 = safeTrim(cellVal(colIdx.gism1));
    if (!gism1) return;
    const metrageRaw = safeTrim(cellVal(colIdx.metrage));
    const metrageNum = Number(metrageRaw.replace(",", "."));
    rows.push({
      gism1,
      libelle: safeTrim(cellVal(colIdx.libelle)),
      metrage: Number.isFinite(metrageNum) ? metrageNum : 0,
    });
  });

  return { fichier, exists: true, rows };
};

// Écrit le dictionnaire (crée le dossier au besoin). rows:[{ gism1, libelle, metrage }].
export const writeDictionnaire = async (entreprise, rows) => {
  const fichier = resolveDictionnaireFile(entreprise);
  fs.mkdirSync(path.dirname(fichier), { recursive: true });

  const clean = (Array.isArray(rows) ? rows : [])
    .map((r) => ({
      gism1: safeTrim(r?.gism1),
      libelle: safeTrim(r?.libelle),
      metrage: Math.max(0, Math.round(Number(r?.metrage) || 0)),
    }))
    .filter((r) => r.gism1);

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Rayons");
  ws.columns = [
    { header: "GISM1", key: "gism1", width: 16 },
    { header: "libelle", key: "libelle", width: 42 },
    { header: "metrage", key: "metrage", width: 10 },
  ];
  ws.getRow(1).font = { bold: true };
  for (const r of clean) ws.addRow(r);

  await wb.xlsx.writeFile(fichier);
  return { fichier, count: clean.length };
};

// Développe les lignes en items d'étiquettes { code, libelle } (1 par sous-zone).
// `filtre` : Set de codes GISM1 à conserver (optionnel ; sinon tous).
export const expandSubZones = (rows, filtre = null) => {
  const items = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    const code = safeTrim(r?.gism1);
    if (!code) continue;
    if (filtre && !filtre.has(code)) continue;
    const libelle = safeTrim(r?.libelle);
    const n = Math.max(1, Math.round(Number(r?.metrage) || 0)); // toujours au moins 1 (_A)
    for (let i = 0; i < n; i++) {
      items.push({ code: `${code}_${letterSuffix(i)}`, libelle });
    }
  }
  return items;
};

export default {
  resolveDictionnaireFile,
  readDictionnaire,
  writeDictionnaire,
  expandSubZones,
  letterSuffix,
};
