// backend/services/genericReportExcel.js
//
// Générateur Excel GÉNÉRIQUE : transforme le résultat JSON d'un service d'analyse
// en classeur multi-onglets. Chaque tableau de premier niveau devient un onglet ;
// l'objet `totaux` (s'il existe) devient un onglet récapitulatif.
//
// C'est un export de DONNÉES (colonnes = clés des objets), pas la mise en forme
// exacte des écrans. Il permet d'activer rapidement l'envoi par email de la
// plupart des rapports ; un générateur dédié peut le remplacer plus tard pour un
// rendu plus soigné (ex. analyse_ca a déjà le sien).

import ExcelJS from "exceljs";

const FORBIDDEN = /[\\/?*[\]:]/g;

function safeSheetName(name, fallback, used) {
  let n = String(name || fallback).replace(FORBIDDEN, " ").trim().slice(0, 31) || fallback;
  const base = n;
  let i = 2;
  while (used.has(n.toLowerCase())) {
    n = `${base.slice(0, 28)} ${i++}`;
  }
  used.add(n.toLowerCase());
  return n;
}

function cellValue(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") {
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  }
  return v;
}

// Déduit les onglets à partir du résultat d'un service.
export function autoSheets(result) {
  if (Array.isArray(result)) {
    return result.length ? [{ name: "Données", rows: result }] : [];
  }
  const sheets = [];
  if (result && typeof result.totaux === "object" && result.totaux) {
    sheets.push({ name: "Totaux", rows: [result.totaux] });
  }
  for (const [k, v] of Object.entries(result || {})) {
    if (Array.isArray(v) && v.length && typeof v[0] === "object") {
      sheets.push({ name: k, rows: v });
    }
  }
  return sheets;
}

// Construit le classeur. Retourne une promesse -> { buffer, filename }.
export async function buildTabularExcel(reportLabel, sheets, now = new Date()) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "QC Tools";
  wb.created = now;

  const used = new Set();
  const list = sheets && sheets.length ? sheets : [{ name: "Rapport", rows: [] }];

  for (const s of list) {
    const ws = wb.addWorksheet(safeSheetName(s.name, "Feuille", used));
    const rows = s.rows || [];

    const keys = [
      ...rows.reduce((set, r) => {
        Object.keys(r || {}).forEach((k) => set.add(k));
        return set;
      }, new Set()),
    ];

    if (keys.length === 0) {
      ws.addRow(["(aucune donnée)"]);
      continue;
    }

    ws.columns = keys.map((k) => ({
      header: k,
      key: k,
      width: Math.min(40, Math.max(12, k.length + 4)),
    }));
    ws.getRow(1).font = { bold: true };

    for (const r of rows) {
      const obj = {};
      keys.forEach((k) => {
        obj[k] = cellValue(r?.[k]);
      });
      ws.addRow(obj);
    }
  }

  const pad = (n) => String(n).padStart(2, "0");
  const slug = String(reportLabel)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
  const filename = `${slug}_${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}.xlsx`;

  const buffer = await wb.xlsx.writeBuffer();
  return { buffer, filename };
}

export default buildTabularExcel;