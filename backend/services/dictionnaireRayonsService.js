// backend/services/dictionnaireRayonsService.js
//
// Dictionnaire des RAYONS : fichier Excel « <TRIGRAMME>_dictionnaire_rayons.xlsx »
// à la racine du dossier « collecteur » sur RCOMMUN (même base que le fichier de
// paramétrage gisements — voir gisementsService.js / deriveCollecteurBase).
//
// Colonnes (en-têtes tolérants casse/accents/espaces) :
//   GISM1 | libelle | metrage | priorite | emplacement
//   - GISM1       : code du rayon (valeur encodée dans l'étiquette QR/code-barres) ;
//   - libelle     : nom affiché sur l'étiquette (en gras) ;
//   - metrage     : nombre de SOUS-ZONES à générer (toujours au moins 1 → « _A ») ;
//   - priorite    : entier ≥ 0 (ou vide) → ordre de préparation des commandes ;
//   - emplacement : « DOCK » ou « MAGASIN » (défaut MAGASIN).
//
// IMPORTANT (compat Analyse CA) : GISM1/libelle/metrage DOIVENT rester les
// colonnes 1/2/3 — analyseCaDataService.loadDictionnaireRayons lit ces cellules
// par position. Les colonnes priorite/emplacement/type sont ajoutées APRÈS.
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

// Emplacement normalisé : « DOCK » ou « MAGASIN » (défaut MAGASIN).
export const normEmplacement = (v) => {
  const h = normHeader(v);
  return h === "DOCK" ? "DOCK" : "MAGASIN";
};

// Priorité normalisée : entier ≥ 0, ou null si vide/non numérique.
export const normPriorite = (v) => {
  const s = safeTrim(v).replace(",", ".");
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : null;
};

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

// Analyse une feuille de calcul et renvoie { rows, hasSous, hasType }.
// Ne renvoie QUE les lignes de ZONE (les lignes de sous-zone — type=sous — sont
// dérivées, donc ignorées). Chaque row = { gism1, libelle, metrage, priorite,
// emplacement }. Les champs priorite/emplacement absents du fichier valent
// null / "MAGASIN". En-têtes tolérants (casse/accents/espaces).
const parseWorksheetZones = (ws) => {
  if (!ws) return { rows: [], hasSous: false, hasType: false };

  // Repérage des colonnes via la 1re ligne.
  const colIdx = {};
  ws.getRow(1).eachCell((cell, col) => {
    const h = normHeader(cell.value);
    if (["GISM1", "GISM", "GISEMENT", "CODE", "RAYON"].includes(h)) colIdx.gism1 = col;
    else if (["LIBELLE", "NOM", "DESIGNATION"].includes(h)) colIdx.libelle = col;
    else if (["METRAGE", "METRE", "METRES", "M", "NBSOUSZONE", "SOUSZONES"].includes(h))
      colIdx.metrage = col;
    else if (["PRIORITE", "PRIO", "ORDRE", "ORDREPREPARATION"].includes(h))
      colIdx.priorite = col;
    else if (["EMPLACEMENT", "EMPL", "LOCALISATION", "LIEU"].includes(h))
      colIdx.emplacement = col;
    else if (["TYPE", "TYPEZONE", "TYPELIGNE"].includes(h)) colIdx.type = col;
  });
  if (!colIdx.gism1) return { rows: [], hasSous: false, hasType: false };

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
      priorite: normPriorite(cellVal(colIdx.priorite)),
      emplacement: normEmplacement(cellVal(colIdx.emplacement)),
    });
  });

  return { rows, hasSous, hasType: colIdx.type !== undefined };
};

// Lit le dictionnaire depuis le fichier de l'entreprise.
// Renvoie { fichier, exists, rows:[{ gism1, libelle, metrage, priorite,
//   emplacement }], materialized }.
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
  const { rows, hasSous, hasType } = parseWorksheetZones(ws);

  return {
    fichier,
    exists: true,
    rows,
    materialized: hasType && hasSous,
  };
};

// Analyse un buffer xlsx uploadé (import de masse) et renvoie ses lignes de zone
// [{ gism1, libelle, metrage, priorite, emplacement }].
export const parseWorkbookRows = async (buffer) => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.getWorksheet("Rayons") || wb.worksheets[0];
  return parseWorksheetZones(ws).rows;
};

// Clé d'identité d'un rayon : GISM1 (insensible à la casse) + EMPLACEMENT.
// ⚠️ L'emplacement fait partie de la clé — c'est l'identité d'une zone côté Mongo
// (index unique { entreprise, code, type }) et le dédoublonnage de
// zoneFicheService. Un même code existe légitimement en MAGASIN ET en DOCK
// (ex. QC : A_1 = « EPI GANTS » au dock et « Ventilateurs muraux » en magasin) ;
// une clé sur le seul GISM1 les fusionnait silencieusement, le dernier écrasant
// l'autre (53 rayons DOCK perdus sur l'import QC du 24/08/2026).
const dicoKeyOf = (r) =>
  `${safeTrim(r?.gism1).toUpperCase()}|${normEmplacement(r?.emplacement)}`;

// Normalise une ligne importée.
const normImportedRow = (imp) => ({
  gism1: safeTrim(imp?.gism1),
  libelle: safeTrim(imp?.libelle),
  metrage: Math.max(0, Math.round(Number(imp?.metrage) || 0)),
  priorite: normPriorite(imp?.priorite),
  emplacement: normEmplacement(imp?.emplacement),
});

// Intègre les lignes importées dans le dictionnaire existant.
// Deux modes (voir option `remplacer`) :
//   - fusion (défaut)  : les rayons existants sont mis à jour (seuls les champs
//     non vides de l'import écrasent), les nouveaux ajoutés, **les autres
//     conservés** — pour compléter un dictionnaire avec un fichier partiel.
//     ⚠️ Un rayon qui change d'emplacement crée une 2e entrée (la clé inclut
//     l'emplacement) ; utiliser le mode « remplacer » pour une resynchro.
//   - remplacer        : le fichier importé DEVIENT le dictionnaire ; les rayons
//     absents du fichier sont supprimés. C'est le mode d'une régénération
//     complète (script d'extraction).
// Renvoie { rows, ajoutes, misAJour, supprimes }.
export const mergeDictionnaire = (existing, imported, options = {}) => {
  const remplacer = options?.remplacer === true;

  const cleanExisting = (Array.isArray(existing) ? existing : []).filter((r) =>
    safeTrim(r?.gism1),
  );
  const clesExistantes = new Set(cleanExisting.map(dicoKeyOf));

  const byKey = new Map();
  const order = [];

  if (remplacer) {
    // Le fichier fait foi : on repart de zéro (doublons du fichier = dernier gagne).
    for (const imp of Array.isArray(imported) ? imported : []) {
      if (!safeTrim(imp?.gism1)) continue;
      const k = dicoKeyOf(imp);
      if (!byKey.has(k)) order.push(k);
      byKey.set(k, normImportedRow(imp));
    }
    const misAJour = order.filter((k) => clesExistantes.has(k)).length;
    return {
      rows: order.map((k) => byKey.get(k)),
      ajoutes: order.length - misAJour,
      misAJour,
      supprimes: [...clesExistantes].filter((k) => !byKey.has(k)).length,
    };
  }

  for (const r of cleanExisting) {
    const k = dicoKeyOf(r);
    if (!byKey.has(k)) order.push(k);
    byKey.set(k, { ...r });
  }

  let ajoutes = 0;
  let misAJour = 0;
  for (const imp of Array.isArray(imported) ? imported : []) {
    if (!safeTrim(imp?.gism1)) continue;
    const k = dicoKeyOf(imp);
    const norm = normImportedRow(imp);
    if (byKey.has(k)) {
      const cur = byKey.get(k);
      byKey.set(k, {
        ...cur,
        ...norm,
        // le libellé n'écrase que s'il est renseigné dans l'import
        libelle: norm.libelle || cur.libelle,
        priorite: norm.priorite ?? cur.priorite ?? null,
      });
      misAJour += 1;
    } else {
      order.push(k);
      byKey.set(k, norm);
      ajoutes += 1;
    }
  }

  return { rows: order.map((k) => byKey.get(k)), ajoutes, misAJour, supprimes: 0 };
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
    const priorite = normPriorite(z?.priorite);
    const emplacement = normEmplacement(z?.emplacement);
    out.push({ gism1, libelle, metrage, priorite, emplacement, type: "zone" });
    const n = Math.max(1, metrage);
    // Les sous-zones héritent de la priorité/emplacement de leur zone.
    for (let i = 0; i < n; i++) {
      out.push({
        gism1: `${gism1}_${letterSuffix(i)}`,
        libelle,
        metrage: null,
        priorite,
        emplacement,
        type: "sous",
      });
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
      priorite: normPriorite(r?.priorite),
      emplacement: normEmplacement(r?.emplacement),
    }))
    .filter((r) => r.gism1);

  const flat = buildFlatRows(cleanZones);

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Rayons");
  // Ordre imposé : GISM1/libelle/metrage en colonnes 1/2/3 (compat Analyse CA).
  ws.columns = [
    { header: "GISM1", key: "gism1", width: 18 },
    { header: "libelle", key: "libelle", width: 42 },
    { header: "metrage", key: "metrage", width: 10 },
    { header: "priorite", key: "priorite", width: 10 },
    { header: "emplacement", key: "emplacement", width: 14 },
    { header: "type", key: "type", width: 8 },
  ];
  ws.getRow(1).font = { bold: true };
  for (const r of flat) {
    ws.addRow({
      gism1: r.gism1,
      libelle: r.libelle,
      metrage: r.metrage == null ? null : r.metrage,
      priorite: r.priorite == null ? null : r.priorite,
      emplacement: r.emplacement,
      type: r.type,
    });
  }

  await wb.xlsx.writeFile(fichier);
  return { fichier, zoneCount: cleanZones.length, rowCount: flat.length };
};

// Génère un buffer xlsx des RAYONS uniquement — SANS sous-zones et SANS colonne
// « type ». `rows` = [{ gism1, libelle, metrage, priorite, emplacement }].
// `emplacement` optionnel : "MAGASIN" | "DOCK" pour ne garder que ces rayons.
// Renvoie { buffer, count }.
export const buildZonesWorkbookBuffer = async (rows, emplacement = null) => {
  const empl = emplacement ? normEmplacement(emplacement) : null;
  const zones = (Array.isArray(rows) ? rows : [])
    .map((r) => ({
      gism1: safeTrim(r?.gism1),
      libelle: safeTrim(r?.libelle),
      metrage: Math.max(0, Math.round(Number(r?.metrage) || 0)),
      priorite: normPriorite(r?.priorite),
      emplacement: normEmplacement(r?.emplacement),
    }))
    .filter((r) => r.gism1 && (!empl || r.emplacement === empl));

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Rayons");
  // GISM1/libelle/metrage en colonnes 1/2/3 (cohérent avec le fichier source).
  ws.columns = [
    { header: "GISM1", key: "gism1", width: 18 },
    { header: "libelle", key: "libelle", width: 42 },
    { header: "metrage", key: "metrage", width: 10 },
    { header: "priorite", key: "priorite", width: 10 },
    { header: "emplacement", key: "emplacement", width: 14 },
  ];
  ws.getRow(1).font = { bold: true };
  for (const z of zones) {
    ws.addRow({
      gism1: z.gism1,
      libelle: z.libelle,
      metrage: z.metrage,
      priorite: z.priorite == null ? null : z.priorite,
      emplacement: z.emplacement,
    });
  }
  const buffer = await wb.xlsx.writeBuffer();
  return { buffer, count: zones.length };
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
  parseWorkbookRows,
  mergeDictionnaire,
  expandSubZones,
  buildZonesWorkbookBuffer,
  letterSuffix,
  normEmplacement,
  normPriorite,
};
