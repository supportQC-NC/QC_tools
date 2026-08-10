// backend/services/configResourceExcelService.js
//
// Export / import Excel générique des ressources de config (groupes spéciaux,
// groupes prioritaires…). Les colonnes sont décrites par la ressource dans
// configRapportsController.RESOURCES.
//
// Aller-retour : on exporte la liste, on la travaille sous Excel (ajout des
// libellés, lignes supplémentaires), on réimporte le MÊME fichier.
//
// Règles d'import (jamais destructif) :
//   - ligne rapprochée par sa clé naturelle (codeListe, groupe…) ;
//   - cellule renseignée      -> écrase la valeur en base ;
//   - cellule vide            -> la valeur en base est CONSERVÉE ;
//   - clé inconnue            -> ligne créée ;
//   - ligne absente du fichier-> jamais supprimée.

import ExcelJS from "exceljs";

const safeTrim = (v) => (v == null ? "" : String(v)).trim();

// Normalise un entête pour le rapprochement (casse, accents, ponctuation).
const normaliser = (s) =>
  safeTrim(s)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");

const styleHeader = (row) => {
  row.font = { bold: true, color: { argb: "FFFFFFFF" } };
  row.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF8B5CF6" },
  };
  row.alignment = { vertical: "middle" };
  row.height = 20;
};

/**
 * Classeur d'une ressource : une ligne par enregistrement, entêtes = libellés
 * des colonnes. Les colonnes `readOnly` sont exportées pour information mais
 * ignorées à l'import.
 *
 * @param {object} p
 * @param {string} p.label            titre de la section (« Groupes spéciaux »)
 * @param {Array}  p.columns          [{ name, label, readOnly?, aliases? }]
 * @param {Array}  p.items            documents (lean)
 * @param {object} [p.entreprise]     société, pour l'entête et le nom de fichier
 */
export const buildResourceWorkbook = ({ label, columns, items, entreprise }) => {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Outil Quincaillerie";
  wb.created = new Date();

  const ws = wb.addWorksheet(label.slice(0, 31) || "Export");
  const derniereColonne = String.fromCharCode(64 + columns.length);

  ws.mergeCells(`A1:${derniereColonne}1`);
  ws.getCell("A1").value = entreprise
    ? `${label} — ${entreprise.nomComplet || entreprise.nom || entreprise.nomDossierDBF}`
    : label;
  ws.getCell("A1").font = { bold: true, size: 13 };

  ws.mergeCells(`A2:${derniereColonne}2`);
  ws.getCell("A2").value =
    `${items.length} ligne(s). Complétez les colonnes puis réimportez ce fichier : ` +
    `une cellule vide conserve la valeur en base, une ligne inconnue est créée.`;
  ws.getCell("A2").font = { italic: true, color: { argb: "FF666666" } };

  ws.getRow(3).values = columns.map((c) => c.label);
  ws.columns = columns.map((c) => ({
    key: c.name,
    width: Math.max(14, Math.min(46, c.label.length + 8)),
  }));
  styleHeader(ws.getRow(3));
  ws.views = [{ state: "frozen", ySplit: 3 }];

  for (const it of items) {
    const ligne = {};
    for (const c of columns) {
      const v = it[c.name];
      if (v == null) ligne[c.name] = "";
      else if (v instanceof Date) ligne[c.name] = v;
      else if (typeof v === "number") ligne[c.name] = v;
      else ligne[c.name] = String(v);
    }
    ws.addRow(ligne);
  }

  ws.autoFilter = { from: "A3", to: `${derniereColonne}3` };

  const trig = safeTrim(entreprise?.trigramme) || safeTrim(entreprise?.nomDossierDBF);
  const slug = normaliser(label) || "config";
  const filename = `${slug}${trig ? `_${trig}` : ""}.xlsx`;

  return { workbook: wb, filename, count: items.length };
};

/**
 * Relit un classeur produit par buildResourceWorkbook (ou saisi à la main).
 * La ligne d'entêtes est repérée par la présence du libellé de la clé, ce qui
 * tolère l'ajout ou la suppression de lignes de titre au-dessus.
 *
 * @returns {Promise<{ lignes: Array<{ valeurs: object, numero: number }>, entetesIgnores: string[] }>}
 */
export const parseResourceWorkbook = async (buffer, columns, cleName) => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error("Le classeur ne contient aucune feuille.");

  // name / label / anciens libellés -> name, pour accepter toutes les formes
  // d'entête (dont les classeurs exportés avant un renommage de colonne).
  const parNorm = new Map();
  for (const c of columns) {
    parNorm.set(normaliser(c.label), c.name);
    parNorm.set(normaliser(c.name), c.name);
    for (const alias of c.aliases || []) parNorm.set(normaliser(alias), c.name);
  }
  const cleNorms = new Set([
    normaliser(cleName),
    normaliser(columns.find((c) => c.name === cleName)?.label || ""),
  ]);

  // Cherche la ligne d'entêtes : la première contenant le libellé de la clé.
  let ligneEntetes = 0;
  let colonnesParIndex = null;
  const entetesIgnores = [];

  ws.eachRow((row, numero) => {
    if (ligneEntetes) return;
    const cellules = [];
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      cellules[col] = normaliser(cell.text ?? cell.value);
    });
    if (!cellules.some((v) => v && cleNorms.has(v))) return;

    ligneEntetes = numero;
    colonnesParIndex = new Map();
    cellules.forEach((norm, col) => {
      if (!norm) return;
      const name = parNorm.get(norm);
      if (name) colonnesParIndex.set(col, name);
      else entetesIgnores.push(String(row.getCell(col).text || "").trim());
    });
  });

  if (!ligneEntetes) {
    throw new Error(
      `Colonne « ${columns.find((c) => c.name === cleName)?.label || cleName} » introuvable dans le fichier.`,
    );
  }

  const lignes = [];
  ws.eachRow((row, numero) => {
    if (numero <= ligneEntetes) return;
    const valeurs = {};
    let vide = true;
    for (const [col, name] of colonnesParIndex) {
      const cell = row.getCell(col);
      const brut = cell.text ?? cell.value;
      const v = safeTrim(brut);
      valeurs[name] = v;
      if (v) vide = false;
    }
    if (vide) return; // ligne blanche
    lignes.push({ valeurs, numero });
  });

  return { lignes, entetesIgnores: [...new Set(entetesIgnores)] };
};

export default { buildResourceWorkbook, parseResourceWorkbook };
