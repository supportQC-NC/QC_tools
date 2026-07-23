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

export default { exportGisements, genererEtiquettesGisement };
