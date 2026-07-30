// backend/controllers/dictionnaireRayonsController.js
//
// Dictionnaire des rayons (fichier Excel « <TRIG>_dictionnaire_rayons.xlsx »
// sur le partage « collecteur ») : lecture, écriture (éditeur), et génération
// d'étiquettes QR/code-barres par sous-zone (metrage → « _A, _B, … »).

import asyncHandler from "../middleware/asyncHandler.js";
import {
  readDictionnaire,
  writeDictionnaire,
  expandSubZones,
} from "../services/dictionnaireRayonsService.js";
import { generateGisementLabelsPDF } from "../services/gisementLabelService.js";

const trigOf = (e) =>
  (e?.trigramme || e?.nomDossierDBF || "societe").toString().trim();

// @desc    Lit le dictionnaire des rayons de l'entreprise
// @route   GET /api/dictionnaire-rayons/:nomDossierDBF
// @access  Private (export_gisements_admin, read) + accès entreprise
export const getDictionnaire = asyncHandler(async (req, res) => {
  const { fichier, exists, rows } = await readDictionnaire(req.entreprise);
  res.json({ fichier, exists, rows });
});

// @desc    Enregistre (remplace) le dictionnaire des rayons
// @route   PUT /api/dictionnaire-rayons/:nomDossierDBF
// @body    { rows: [{ gism1, libelle, metrage }] }
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
    const { fichier, count } = await writeDictionnaire(req.entreprise, rows);
    res.json({ message: `Dictionnaire enregistré (${count} ligne(s)).`, fichier, count });
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

export default { getDictionnaire, saveDictionnaire, genererEtiquettesRayons };
