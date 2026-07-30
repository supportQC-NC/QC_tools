// backend/controllers/dictionnaireRayonsController.js
//
// Dictionnaire des rayons (fichier Excel « <TRIG>_dictionnaire_rayons.xlsx »
// sur le partage « collecteur ») : lecture, écriture (éditeur), et génération
// d'étiquettes QR/code-barres par sous-zone (metrage → « _A, _B, … »).

import fs from "fs";
import asyncHandler from "../middleware/asyncHandler.js";
import {
  readDictionnaire,
  writeDictionnaire,
  parseWorkbookRows,
  mergeDictionnaire,
  resolveDictionnaireFile,
  expandSubZones,
} from "../services/dictionnaireRayonsService.js";
import { generateGisementLabelsPDF } from "../services/gisementLabelService.js";

const trigOf = (e) =>
  (e?.trigramme || e?.nomDossierDBF || "societe").toString().trim();

// @desc    Lit le dictionnaire des rayons de l'entreprise. Matérialise
//          automatiquement les sous-zones dans le fichier au premier chargement
//          (si elles manquent) — décision client.
// @route   GET /api/dictionnaire-rayons/:nomDossierDBF
// @access  Private (export_gisements_admin, read) + accès entreprise
export const getDictionnaire = asyncHandler(async (req, res) => {
  const { fichier, exists, rows, materialized } = await readDictionnaire(
    req.entreprise,
  );

  // Auto-matérialisation à l'ouverture : si le fichier existe mais ne contient
  // pas encore les sous-zones, on les écrit une fois (non bloquant si échec).
  let justMaterialized = false;
  if (exists && !materialized && rows.length) {
    try {
      await writeDictionnaire(req.entreprise, rows);
      justMaterialized = true;
    } catch (e) {
      console.error(
        `[dictionnaire-rayons] matérialisation auto échouée (${fichier}):`,
        e.message,
      );
    }
  }

  res.json({
    fichier,
    exists,
    rows,
    materialized: materialized || justMaterialized,
    justMaterialized,
  });
});

// @desc    Enregistre (remplace) le dictionnaire des rayons
// @route   PUT /api/dictionnaire-rayons/:nomDossierDBF
// @body    { rows: [{ gism1, libelle, metrage, priorite, emplacement }] }
// @access  Private (export_gisements_admin, write) + accès entreprise
export const saveDictionnaire = asyncHandler(async (req, res) => {
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : null;
  if (!rows) {
    res.status(400);
    throw new Error("Corps invalide : « rows » (tableau) requis.");
  }
  // Un GISM1 non vide au moins.
  if (!rows.some((r) => (r?.gism1 ?? "").toString().trim())) {
    res.status(400);
    throw new Error("Au moins une ligne avec un code GISM1 est requise.");
  }
  try {
    const { fichier, zoneCount, rowCount } = await writeDictionnaire(
      req.entreprise,
      rows,
    );
    res.json({
      message: `Dictionnaire enregistré : ${zoneCount} zone(s), ${rowCount} ligne(s) au total (sous-zones incluses).`,
      fichier,
      zoneCount,
      rowCount,
    });
  } catch (e) {
    res.status(500);
    throw new Error(`Écriture impossible (${e.message}). Vérifiez l'accès au partage.`);
  }
});

// @desc    Étiquettes (A8, Code128/QR) par sous-zone à partir du dictionnaire
// @route   POST /api/dictionnaire-rayons/:nomDossierDBF/etiquettes
// @body    { codeType?: "barcode"|"qr", codes?: string[] }  (codes vide -> tous)
// @access  Private (export_gisements_admin, read) + accès entreprise
export const genererEtiquettesRayons = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const codeType = req.body?.codeType === "qr" ? "qr" : "barcode";
  const codes = Array.isArray(req.body?.codes) ? req.body.codes : [];

  const { rows } = await readDictionnaire(entreprise);
  if (!rows.length) {
    res.status(404);
    throw new Error("Dictionnaire vide ou introuvable pour cette société.");
  }

  const filtre = codes.length
    ? new Set(codes.map((c) => (c == null ? "" : String(c)).trim()).filter(Boolean))
    : null;

  let items = expandSubZones(rows, filtre);
  if (items.length === 0) {
    res.status(404);
    throw new Error("Aucune sous-zone à générer pour la sélection.");
  }

  // Garde-fou volume.
  const MAX = 5000;
  const tronque = items.length > MAX;
  if (tronque) items = items.slice(0, MAX);

  const ext = codeType === "qr" ? "qr" : "cb";
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="etiquettes_rayons_${ext}_${trigOf(entreprise)}.pdf"`,
  );
  res.setHeader("Access-Control-Expose-Headers", "X-Etiquettes, X-Tronque");
  res.setHeader("X-Etiquettes", String(items.length));
  res.setHeader("X-Tronque", tronque ? "1" : "0");

  await generateGisementLabelsPDF({ items, codeType, stream: res });
});

// @desc    Import de masse : fusionne un fichier Excel dans le dictionnaire
//          (mise à jour des rayons existants par GISM1 + ajout des nouveaux).
// @route   POST /api/dictionnaire-rayons/:nomDossierDBF/import
// @body    multipart/form-data, champ « file » (.xlsx)
// @access  Private (export_gisements_admin, write) + accès entreprise
export const importDictionnaire = asyncHandler(async (req, res) => {
  if (!req.file?.buffer) {
    res.status(400);
    throw new Error("Aucun fichier reçu (champ « file » attendu).");
  }

  let importedRows;
  try {
    importedRows = await parseWorkbookRows(req.file.buffer);
  } catch (e) {
    res.status(400);
    throw new Error(`Fichier Excel illisible (${e.message}).`);
  }
  if (!importedRows.length) {
    res.status(400);
    throw new Error(
      "Aucune ligne exploitable : une colonne GISM1 (ou CODE/RAYON) est requise.",
    );
  }

  const { rows: existing } = await readDictionnaire(req.entreprise);
  const { rows: merged, ajoutes, misAJour } = mergeDictionnaire(
    existing,
    importedRows,
  );

  try {
    const { fichier, zoneCount, rowCount } = await writeDictionnaire(
      req.entreprise,
      merged,
    );
    res.json({
      message: `Import fusionné : ${misAJour} rayon(s) mis à jour, ${ajoutes} ajouté(s) (${zoneCount} au total).`,
      fichier,
      ajoutes,
      misAJour,
      total: zoneCount,
      rowCount,
    });
  } catch (e) {
    res.status(500);
    throw new Error(`Écriture impossible (${e.message}). Vérifiez l'accès au partage.`);
  }
});

// @desc    Télécharge une copie du fichier dictionnaire (xlsx brut).
// @route   GET /api/dictionnaire-rayons/:nomDossierDBF/fichier
// @access  Private (export_gisements_admin, read) + accès entreprise
export const telechargerDictionnaire = asyncHandler(async (req, res) => {
  const fichier = resolveDictionnaireFile(req.entreprise);
  if (!fs.existsSync(fichier)) {
    res.status(404);
    throw new Error("Aucun dictionnaire enregistré pour cette société.");
  }
  const trig = trigOf(req.entreprise).toUpperCase();
  res.download(fichier, `${trig}_dictionnaire_rayons.xlsx`);
});

export default {
  getDictionnaire,
  saveDictionnaire,
  genererEtiquettesRayons,
  importDictionnaire,
  telechargerDictionnaire,
};
