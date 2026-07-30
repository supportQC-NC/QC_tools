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

// Lit le dictionnaire. Ne renvoie QUE les lignes de ZONE (les lignes de
// sous-zone — type=sous — sont dérivées, donc ignorées à la lecture).
// Renvoie { fichier, exists, rows:[{ gism1, libelle, metrage }], materialized }.
//   materialized = true si le fichier contient déjà les sous-zones matérialisées
//   (colonne « type » présente + au moins une ligne « sous »).
export const readDictionnaire = async (entreprise) => {
  const fichier = resolveDictionnaireFile(entreprise);
  if (!fs.existsSync(fichier)) {
    return { fichier, exists: false, rows: [], materialized: false };
  }

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(fichier);
  const ws = wb.getWorksheet("Rayons") || wb.worksheets[0];
  if (!ws) return { fichier, exists: true, rows: [], materialized: false };

  // Repérage des colonnes via la 1re ligne.
  const colIdx = {};
  ws.getRow(1).eachCell((cell, col) => {
    const h = normHeader(cell.value);
    if (["GISM1", "GISM", "GISEMENT", "CODE", "RAYON"].includes(h)) colIdx.gism1 = col;
    else if (["LIBELLE", "NOM", "DESIGNATION"].includes(h)) colIdx.libelle = col;
    else if (["METRAGE", "METRE", "METRES", "M", "NBSOUSZONE", "SOUSZONES"].includes(h))
      colIdx.metrage = col;
    else if (["TYPE", "TYPEZONE", "TYPELIGNE"].includes(h)) colIdx.type = col;
  });
  if (!colIdx.gism1)
    return { fichier, exists: true, rows: [], materialized: false };

  const rows = [];
  let hasSous = false;
  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // en-tête
    const cellVal = (col) => (col ? row.getCell(col).text ?? row.getCell(col).value : "");
    const gism1 = safeTrim(cellVal(colIdx.gism1));
    if (!gism1) return;
    // Lignes de sous-zone : ignorées (dérivées du métrage de la zone).
    const type = normHeader(cellVal(colIdx.type));
    if (type === "SOUS" || type === "SOUSZONE") {
      hasSous = true;
      return;
    }
    const metrageRaw = safeTrim(cellVal(colIdx.metrage));
    const metrageNum = Number(metrageRaw.replace(",", "."));
    rows.push({
      gism1,
      libelle: safeTrim(cellVal(colIdx.libelle)),
      metrage: Number.isFinite(metrageNum) ? metrageNum : 0,
    });
  });

  return {
    fichier,
    exists: true,
    rows,
    materialized: colIdx.type !== undefined && hasSous,
  };
};

// Construit la liste PLATE (zones + sous-zones) écrite dans le fichier :
//   pour chaque zone : 1 ligne « zone » (avec métrage) puis N lignes « sous »
//   (<GISM1>_A … ; N = max(1, métrage) → toujours au moins « _A »).
const buildFlatRows = (zones) => {
  const out = [];
  for (const z of Array.isArray(zones) ? zones : []) {
    const gism1 = safeTrim(z?.gism1);
    if (!gism1) continue;
    const libelle = safeTrim(z?.libelle);
    const metrage = Math.max(0, Math.round(Number(z?.metrage) || 0));
    out.push({ gism1, libelle, metrage, type: "zone" });
    const n = Math.max(1, metrage);
    for (let i = 0; i < n; i++) {
      out.push({ gism1: `${gism1}_${letterSuffix(i)}`, libelle, metrage: null, type: "sous" });
    }
  }
  return out;
};

// Écrit le dictionnaire (zones + sous-zones matérialisées, colonne « type »).
// `zones` = [{ gism1, libelle, metrage }] (la source éditable).
export const writeDictionnaire = async (entreprise, zones) => {
  const fichier = resolveDictionnaireFile(entreprise);
  fs.mkdirSync(path.dirname(fichier), { recursive: true });

  const cleanZones = (Array.isArray(zones) ? zones : [])
    .map((r) => ({
      gism1: safeTrim(r?.gism1),
      libelle: safeTrim(r?.libelle),
      metrage: Math.max(0, Math.round(Number(r?.metrage) || 0)),
    }))
    .filter((r) => r.gism1);

  const flat = buildFlatRows(cleanZones);

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Rayons");
  ws.columns = [
    { header: "GISM1", key: "gism1", width: 18 },
    { header: "libelle", key: "libelle", width: 42 },
    { header: "metrage", key: "metrage", width: 10 },
    { header: "type", key: "type", width: 8 },
  ];
  ws.getRow(1).font = { bold: true };
  for (const r of flat) {
    ws.addRow({
      gism1: r.gism1,
      libelle: r.libelle,
      metrage: r.metrage == null ? null : r.metrage,
      type: r.type,
    });
  }

  await wb.xlsx.writeFile(fichier);
  return { fichier, zoneCount: cleanZones.length, rowCount: flat.length };
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
