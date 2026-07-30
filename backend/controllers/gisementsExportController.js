// backend/controllers/gisementsExportController.js
import asyncHandler from "../middleware/asyncHandler.js";
import fs from "fs";
import path from "path";
import {
  buildExportWorkbook,
  EXPORT_MODES,
} from "../services/gisementsExportService.js";
import { generateGisementLabelsPDF } from "../services/gisementLabelService.js";
import articleCacheService from "../services/articleService.js";
import { getGisements } from "../services/gisementsService.js";
import {
  readLibelleMap,
  GROUPE_LIBELLE_PRESET,
} from "../services/libelleConfigService.js";

// article.dbf doit exister pour l'entreprise (sinon 404).
const assertArticleDbf = (entreprise, res) => {
  const dbfPath = path.join(
    entreprise.cheminBase,
    entreprise.nomDossierDBF,
    "article.dbf",
  );
  if (!fs.existsSync(dbfPath)) {
    res.status(404);
    throw new Error(
      `Fichier articles introuvable pour l'entreprise ${entreprise.nomComplet || entreprise.nomDossierDBF}`,
    );
  }
};

// Map(code MAJ -> libellé) selon la dimension. NON BLOQUANT (Map vide si absent).
const resolveLibelleMap = async (entreprise, dimension) => {
  try {
    if (dimension === "groupes") {
      const { map } = await readLibelleMap(entreprise, GROUPE_LIBELLE_PRESET);
      return map; // déjà code -> libellé
    }
    const { map } = await getGisements(entreprise); // code -> { libelle, priorite }
    const out = new Map();
    for (const [code, v] of map) out.set(code, (v && v.libelle) || "");
    return out;
  } catch {
    return new Map();
  }
};

const trigOf = (entreprise) =>
  (entreprise?.trigramme || entreprise?.nomDossierDBF || "societe").toString().trim();

// @desc    Export Excel des gisements (GISM1..5) ou des groupes (famille)
// @route   GET /api/articles/:nomDossierDBF/export-gisements?mode=...&dimension=gisements|groupes
// @access  Private (module export_gisements_admin, read) + accès entreprise
export const exportGisements = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const dimension = req.query.dimension === "groupes" ? "groupes" : "gisements";
  const mode = String(req.query.mode || "articles");

  if (!EXPORT_MODES[dimension].includes(mode)) {
    res.status(400);
    throw new Error(
      `Mode « ${mode} » invalide pour ${dimension}. Valeurs : ${EXPORT_MODES[dimension].join(", ")}.`,
    );
  }

  assertArticleDbf(entreprise, res);
  const libelleMap = await resolveLibelleMap(entreprise, dimension);

  const { workbook, filename, count, total } = await buildExportWorkbook({
    entreprise,
    mode,
    dimension,
    libelleMap,
  });

  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Access-Control-Expose-Headers", "X-Lignes, X-Articles-Total");
  res.setHeader("X-Lignes", String(count));
  res.setHeader("X-Articles-Total", String(total));

  await workbook.xlsx.write(res);
  res.end();
});

// @desc    Étiquettes (A8, Code128/QR) de gisement ou de groupe, au format PDF
// @route   POST /api/articles/:nomDossierDBF/gisement-etiquettes
// @body    { dimension?: "gisements"|"groupes", niveau?: 1..5, codes?: string[],
//            codeType?: "barcode"|"qr" }   (codes vide -> tous)
// @access  Private (module export_gisements_admin, read) + accès entreprise
export const genererEtiquettesGisement = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const dimension = req.body?.dimension === "groupes" ? "groupes" : "gisements";
  const codeType = req.body?.codeType === "qr" ? "qr" : "barcode";
  let codes = Array.isArray(req.body?.codes) ? req.body.codes : [];

  assertArticleDbf(entreprise, res);

  let topLabel;
  let filePart;

  if (dimension === "gisements") {
    const niveau = parseInt(req.body?.niveau, 10);
    if (!(niveau >= 1 && niveau <= 5)) {
      res.status(400);
      throw new Error(`Niveau de gisement invalide: ${req.body?.niveau} (attendu 1..5).`);
    }
    codes = [...new Set(codes.map((c) => (c == null ? "" : String(c)).trim()).filter(Boolean))];
    if (codes.length === 0) {
      const tous = await articleCacheService.getGismLevel(entreprise, niveau);
      codes = tous.map((g) => g.code);
    }
    if (codes.length === 0) {
      res.status(404);
      throw new Error(`Aucun gisement trouvé au niveau GISM${niveau}.`);
    }
    topLabel = `GISM${niveau}`;
    filePart = `gisements_GISM${niveau}`;
  } else {
    codes = [...new Set(codes.map((c) => (c == null ? "" : String(c)).trim()).filter(Boolean))];
    if (codes.length === 0) {
      const tous = await articleCacheService.getGroupes(entreprise);
      codes = tous.map((g) => g.code);
    }
    if (codes.length === 0) {
      res.status(404);
      throw new Error("Aucun groupe trouvé.");
    }
    topLabel = "GROUPE";
    filePart = "groupes";
  }

  const libelleMap = await resolveLibelleMap(entreprise, dimension);
  const items = codes.map((code) => ({
    code,
    libelle: libelleMap.get(code.toUpperCase()) || "",
  }));

  const ext = codeType === "qr" ? "qr" : "cb";
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="etiquettes_${filePart}_${ext}_${trigOf(entreprise)}.pdf"`,
  );
  res.setHeader("Access-Control-Expose-Headers", "X-Etiquettes");
  res.setHeader("X-Etiquettes", String(items.length));

  await generateGisementLabelsPDF({
    items,
    niveauLabel: topLabel,
    codeType,
    stream: res,
  });
});

// Mots d'en-tête reconnus (ligne de titre à ignorer si la 1re cellule matche).
const HEADER_WORDS = new Set([
  "code", "codes", "gencod", "gencode", "nart", "valeur", "value",
  "ean", "barcode", "code-barres", "qr", "ref", "reference", "référence",
]);

// @desc    Étiquettes (A8, Code128/QR) à partir d'un Excel importé.
//          UNE seule colonne = le code (valeur encodée), 1 étiquette par ligne.
// @route   POST /api/articles/:nomDossierDBF/etiquettes-excel   (multipart, champ "file")
// @body    codeType?: "barcode"|"qr"
// @access  Private (module export_gisements_admin, read) + accès entreprise
export const genererEtiquettesDepuisExcel = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const codeType = req.body?.codeType === "qr" ? "qr" : "barcode";

  if (!req.file || !req.file.buffer) {
    res.status(400);
    throw new Error("Fichier Excel manquant (champ « file »).");
  }

  // Lecture du classeur (xlsx/xls/csv) — 1re feuille, 1re colonne.
  const XLSX = await import("xlsx").catch(() => {
    throw new Error("Module 'xlsx' introuvable. Lancez : npm i xlsx");
  });
  let rows;
  try {
    const wb = XLSX.read(req.file.buffer, { type: "buffer" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    if (!ws) throw new Error("Classeur vide");
    rows = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: "" });
  } catch (e) {
    res.status(400);
    throw new Error(`Fichier Excel illisible : ${e.message}`);
  }

  // Chaque ligne -> 1re cellule = code. Ignore une éventuelle ligne d'en-tête.
  let codes = rows
    .map((r) => (Array.isArray(r) ? String(r[0] ?? "").trim() : ""))
    .filter(Boolean);
  if (codes.length && HEADER_WORDS.has(codes[0].toLowerCase())) {
    codes = codes.slice(1);
  }

  if (codes.length === 0) {
    res.status(400);
    throw new Error("Aucun code trouvé dans la 1re colonne du fichier.");
  }

  // Garde-fou : limite le volume d'étiquettes générées d'un coup.
  const MAX = 5000;
  let tronque = false;
  if (codes.length > MAX) {
    codes = codes.slice(0, MAX);
    tronque = true;
  }

  const items = codes.map((code) => ({ code, libelle: "" }));

  const ext = codeType === "qr" ? "qr" : "cb";
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="etiquettes_import_${ext}_${trigOf(entreprise)}.pdf"`,
  );
  res.setHeader("Access-Control-Expose-Headers", "X-Etiquettes, X-Tronque");
  res.setHeader("X-Etiquettes", String(items.length));
  res.setHeader("X-Tronque", tronque ? "1" : "0");

  await generateGisementLabelsPDF({ items, codeType, stream: res });
});

export default {
  exportGisements,
  genererEtiquettesGisement,
  genererEtiquettesDepuisExcel,
};
