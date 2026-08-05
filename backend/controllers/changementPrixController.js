// backend/controllers/changementPrixController.js
//
// Module « Changement de prix de vente » (mode manuel) — portage du script
// Python `main.py`. Au lieu d'une boucle multi-sociétés qui envoie un email,
// l'utilisateur choisit une société (sélecteur global) + une date, consulte les
// changements, télécharge le rapport Excel et le PDF d'étiquettes.
// Société injectée via checkEntrepriseAccess (:nomDossierDBF -> req.entreprise).
import os from "os";
import path from "path";
import fs from "fs";
import asyncHandler from "../middleware/asyncHandler.js";
import { getChangementsPrix } from "../services/verifService.js";
import { genererExcelChangementPrix } from "../services/changementPrixExcelService.js";
import { genererEtiquettesPDF } from "../services/etiquetteService.js";

// "YYYY-MM-DD" (input date HTML) ou "YYYYMMDD" -> "YYYYMMDD" (vide si invalide).
const ymdFromParam = (raw) => {
  const s = (raw == null ? "" : String(raw)).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s.replace(/-/g, "");
  if (/^\d{8}$/.test(s)) return s;
  return "";
};

// Hier (date locale serveur, comme le Python : datetime.now() - 1 jour).
const yesterdayYmd = () => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
};

const ymdToFr = (ymd) =>
  `${ymd.slice(6, 8)}/${ymd.slice(4, 6)}/${ymd.slice(0, 4)}`;

/**
 * @desc   Liste des changements de prix de vente (tableau écran).
 * @route  GET /api/changement-prix/:nomDossierDBF?date=YYYY-MM-DD
 * @access Private (module changement_prix, read) — société via :nomDossierDBF
 */
const getChangements = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const dateYmd = ymdFromParam(req.query.date) || yesterdayYmd();
  const { rows } = await getChangementsPrix(entreprise, dateYmd);
  res.json({
    date: dateYmd,
    dateFr: ymdToFr(dateYmd),
    total: rows.length,
    rows,
  });
});

/**
 * @desc   Rapport Excel des changements de prix de vente.
 * @route  GET /api/changement-prix/:nomDossierDBF/excel?date=YYYY-MM-DD
 * @access Private (module changement_prix, read)
 */
const exportExcel = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const dateYmd = ymdFromParam(req.query.date) || yesterdayYmd();
  const { rows } = await getChangementsPrix(entreprise, dateYmd);

  const buffer = await genererExcelChangementPrix({ rows });
  const fname = `changement_prix_${entreprise.nomDossierDBF}_${dateYmd}.xlsx`;
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  res.setHeader("Content-Disposition", `attachment; filename="${fname}"`);
  res.send(Buffer.from(buffer));
});

/**
 * @desc   PDF des étiquettes de prix (format standard 5×4 cm) pour les articles
 *         dont le prix a changé. Réutilise le générateur d'étiquettes standard
 *         (rendu strictement identique au module Générateur d'étiquettes).
 * @route  POST /api/changement-prix/:nomDossierDBF/etiquettes   body: { date }
 * @access Private (module changement_prix, read)
 */
const genererEtiquettes = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const dateYmd = ymdFromParam(req.body.date) || yesterdayYmd();
  const { articles } = await getChangementsPrix(entreprise, dateYmd);

  if (!articles.length) {
    res.status(404);
    throw new Error(
      "Aucun article avec changement de prix pour cette date (rien à étiqueter).",
    );
  }

  const tmp = path.join(
    os.tmpdir(),
    `etiquettes_changement_prix_${Date.now()}.pdf`,
  );
  await genererEtiquettesPDF({
    type: "standard",
    format: "a4",
    articles,
    entreprise,
    outPath: tmp,
  });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    'attachment; filename="etiquettes_changement_prix.pdf"',
  );
  res.setHeader("X-Articles-Total", String(articles.length));

  const stream = fs.createReadStream(tmp);
  const cleanup = () => {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
  };
  stream.on("close", cleanup);
  stream.on("error", cleanup);
  stream.pipe(res);
});

export { getChangements, exportExcel, genererEtiquettes };
