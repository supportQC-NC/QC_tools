// backend/controllers/dictionnaireRayonsController.js
//
// Dictionnaire des rayons (fichier Excel « <TRIG>_dictionnaire_rayons.xlsx »
// sur le partage « collecteur ») : lecture, écriture (éditeur), et génération
// d'étiquettes QR/code-barres — par sous-zone (metrage → « _A, _B, … ») ou par
// zone seule (GISM1 sans suffixe), au choix de l'utilisateur.

import fs from "fs";
import asyncHandler from "../middleware/asyncHandler.js";
import {
  readDictionnaire,
  writeDictionnaire,
  parseWorkbookRows,
  mergeDictionnaire,
  resolveDictionnaireFile,
  expandSubZones,
  buildZonesWorkbookBuffer,
  normEmplacement,
} from "../services/dictionnaireRayonsService.js";
import { generateGisementLabelsPDF } from "../services/gisementLabelService.js";
import articleCacheService from "../services/articleService.js";
import { champMasque } from "../middleware/masquerChampsDbf.js";

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

// @desc    Étiquettes (A8, Code128/QR) à partir du dictionnaire. Deux modes
//          (champ « sousZones ») : true (défaut) = une étiquette par sous-zone
//          (« <GISM1>_A », …) ; false = une étiquette par ZONE, le code encodé
//          est le GISM1 seul (sans suffixe _A/_B). Filtrable par emplacement
//          (« MAGASIN » | « DOCK », absent/autre = tous).
// @route   POST /api/dictionnaire-rayons/:nomDossierDBF/etiquettes
// @body    { codeType?: "barcode"|"qr", codes?: string[], sousZones?: boolean,
//            emplacement?: "MAGASIN"|"DOCK" }
//          (codes vide -> tous)
// @access  Private (export_gisements_admin, read) + accès entreprise
export const genererEtiquettesRayons = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const codeType = req.body?.codeType === "qr" ? "qr" : "barcode";
  const codes = Array.isArray(req.body?.codes) ? req.body.codes : [];
  const sousZones = req.body?.sousZones !== false; // défaut : avec sous-zones
  const emplRaw = (req.body?.emplacement ?? "").toString().trim().toUpperCase();
  const emplacement = ["MAGASIN", "DOCK"].includes(emplRaw) ? emplRaw : null;

  const { rows } = await readDictionnaire(entreprise);
  if (!rows.length) {
    res.status(404);
    throw new Error("Dictionnaire vide ou introuvable pour cette société.");
  }

  const rowsFiltrees = emplacement
    ? rows.filter((r) => normEmplacement(r.emplacement) === emplacement)
    : rows;

  const filtre = codes.length
    ? new Set(codes.map((c) => (c == null ? "" : String(c)).trim()).filter(Boolean))
    : null;

  let items = expandSubZones(rowsFiltrees, filtre, sousZones);
  if (items.length === 0) {
    res.status(404);
    throw new Error(
      `Aucune ${sousZones ? "sous-zone" : "zone"} à générer pour la sélection${
        emplacement ? ` (emplacement ${emplacement})` : ""
      }.`,
    );
  }

  // Garde-fou volume.
  const MAX = 5000;
  const tronque = items.length > MAX;
  if (tronque) items = items.slice(0, MAX);

  const ext = codeType === "qr" ? "qr" : "cb";
  const suffixEmpl = emplacement ? `_${emplacement.toLowerCase()}` : "";
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="etiquettes_rayons_${ext}${suffixEmpl}_${trigOf(entreprise)}.pdf"`,
  );
  res.setHeader("Access-Control-Expose-Headers", "X-Etiquettes, X-Tronque");
  res.setHeader("X-Etiquettes", String(items.length));
  res.setHeader("X-Tronque", tronque ? "1" : "0");

  await generateGisementLabelsPDF({ items, codeType, stream: res });
});

// @desc    Import de masse d'un fichier Excel dans le dictionnaire.
//          Deux modes selon le champ « remplacer » :
//            - absent/0 : FUSION (maj des rayons existants + ajout des nouveaux,
//              les rayons absents du fichier sont conservés) ;
//            - 1        : REMPLACEMENT (le fichier devient le dictionnaire, les
//              rayons absents sont supprimés) — cas d'une régénération complète.
//          Identité d'un rayon = GISM1 + EMPLACEMENT (un même code peut exister
//          en MAGASIN et en DOCK).
// @route   POST /api/dictionnaire-rayons/:nomDossierDBF/import
// @body    multipart/form-data, champ « file » (.xlsx) + « remplacer » (0|1)
// @access  Private (export_gisements_admin, write) + accès entreprise
export const importDictionnaire = asyncHandler(async (req, res) => {
  if (!req.file?.buffer) {
    res.status(400);
    throw new Error("Aucun fichier reçu (champ « file » attendu).");
  }

  // multipart → tout arrive en chaîne.
  const remplacer = ["1", "true", "on", "oui"].includes(
    (req.body?.remplacer ?? "").toString().trim().toLowerCase(),
  );

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
  const { rows: merged, ajoutes, misAJour, supprimes } = mergeDictionnaire(
    existing,
    importedRows,
    { remplacer },
  );

  try {
    const { fichier, zoneCount, rowCount } = await writeDictionnaire(
      req.entreprise,
      merged,
    );
    const message = remplacer
      ? `Dictionnaire remplacé : ${ajoutes} rayon(s) ajouté(s), ${misAJour} conservé(s), ${supprimes} supprimé(s) (${zoneCount} au total).`
      : `Import fusionné : ${misAJour} rayon(s) mis à jour, ${ajoutes} ajouté(s) (${zoneCount} au total).`;
    res.json({
      message,
      fichier,
      remplacer,
      ajoutes,
      misAJour,
      supprimes,
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

// @desc    Télécharge un xlsx des RAYONS SEULS (sans sous-zones), filtrable par
//          emplacement (MAGASIN / DOCK). Reconstruit à la volée depuis les zones.
// @route   GET /api/dictionnaire-rayons/:nomDossierDBF/rayons?emplacement=MAGASIN|DOCK
// @access  Private (export_gisements_admin, read) + accès entreprise
export const telechargerRayonsSansSousZones = asyncHandler(async (req, res) => {
  const { rows, exists } = await readDictionnaire(req.entreprise);
  if (!exists || !rows.length) {
    res.status(404);
    throw new Error("Aucun dictionnaire enregistré pour cette société.");
  }

  const emplParam = (req.query?.emplacement ?? "").toString().trim();
  // "" ou "TOUS" → pas de filtre ; sinon MAGASIN/DOCK.
  const emplacement =
    emplParam && emplParam.toUpperCase() !== "TOUS" ? emplParam : null;

  const { buffer, count } = await buildZonesWorkbookBuffer(rows, emplacement);
  if (!count) {
    res.status(404);
    throw new Error(
      `Aucun rayon${emplacement ? ` pour l'emplacement ${normEmplacement(emplacement)}` : ""}.`,
    );
  }

  const trig = trigOf(req.entreprise).toUpperCase();
  const suffix = emplacement ? `_${normEmplacement(emplacement)}` : "";
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${trig}_rayons${suffix}.xlsx"`,
  );
  res.send(Buffer.from(buffer));
});

// Séparateurs CSV autorisés (clé du paramètre ?sep=).
const SEPARATEURS_CSV = { ";": ";", ",": ",", tab: "\t", "|": "|" };

// Échappe une valeur CSV : guillemets seulement si nécessaire.
const champCsv = (v, sep) => {
  const s = (v == null ? "" : String(v)).trim();
  return s.includes(sep) || s.includes('"') || /[\r\n]/.test(s)
    ? `"${s.replace(/"/g, '""')}"`
    : s;
};

// @desc    Export CSV de CORRECTION des gisements de la base article, destiné
//          au réimport dans Stock XL : une ligne par article (NART, GISM1,
//          GISM2). Le DICTIONNAIRE fait foi pour l'emplacement : un code de la
//          fiche article reconnu MAGASIN sort en colonne GISM1, reconnu DOCK en
//          colonne GISM2 — quel que soit le champ où il se trouvait. Un code
//          absent du dictionnaire, ou présent aux DEUX emplacements (53 codes
//          chez QC, impossible de trancher), laisse la colonne vide (décision
//          client du 30/10/2026). Tous les articles sortent, même sans gisement.
// @route   GET /api/dictionnaire-rayons/:nomDossierDBF/export-gism?sep=;|,|tab||
// @access  Private (export_gisements_admin, read) + accès entreprise
export const exporterCorrectionGism = asyncHandler(async (req, res) => {
  // Fichier de CORRECTION réimporté dans l'ERP : exporter avec une colonne
  // masquée viderait les gisements à l'import — on refuse plutôt que tronquer.
  for (const champ of ["NART", "GISM1", "GISM2"]) {
    if (champMasque(req, champ)) {
      res.status(403);
      throw new Error(
        `Le champ ${champ} vous est masqué : export de correction impossible.`,
      );
    }
  }

  const sep = SEPARATEURS_CSV[String(req.query.sep || ";")] || ";";

  const { rows, exists } = await readDictionnaire(req.entreprise);
  if (!exists || !rows.length) {
    res.status(404);
    throw new Error("Aucun dictionnaire enregistré pour cette société.");
  }

  // Code (majuscules) -> ensemble des emplacements où il existe. Un code
  // présent aux deux emplacements est AMBIGU : on ne le classe pas.
  const emplacementsParCode = new Map();
  for (const r of rows) {
    const code = (r.gism1 || "").trim().toUpperCase();
    if (!code) continue;
    if (!emplacementsParCode.has(code)) emplacementsParCode.set(code, new Set());
    emplacementsParCode.get(code).add(normEmplacement(r.emplacement));
  }
  const resoudreEmplacement = (code) => {
    const c = (code || "").trim().toUpperCase();
    if (!c) return null;
    let empl = emplacementsParCode.get(c);
    // Code de SOUS-ZONE (« AU_M_B ») : il hérite de l'emplacement de sa zone.
    // On ne retire qu'un suffixe de lettres pures (_A, _AB…) — jamais « _1 »
    // ou « _2d », qui font partie du code de zone lui-même.
    if (!empl) {
      const m = /^(.+)_[A-Z]+$/.exec(c);
      if (m) empl = emplacementsParCode.get(m[1]);
    }
    return empl && empl.size === 1 ? [...empl][0] : null;
  };

  await articleCacheService.preload(req.entreprise).catch(() => {});
  const acache = await articleCacheService.getArticles(req.entreprise);

  const lignes = [["NART", "GISM1", "GISM2"].join(sep)];
  for (const rec of acache.records) {
    const nart = (rec.NART == null ? "" : String(rec.NART)).trim();
    if (!nart) continue;
    const g1 = (rec.GISM1 == null ? "" : String(rec.GISM1)).trim();
    const g2 = (rec.GISM2 == null ? "" : String(rec.GISM2)).trim();
    // Reclassement : la colonne de sortie dépend de l'emplacement DICTIONNAIRE
    // du code, pas du champ d'origine. Priorité au champ déjà bien placé
    // (GISM1 d'abord pour la colonne magasin, GISM2 d'abord pour le dock).
    let colMagasin = "";
    let colDock = "";
    for (const code of [g1, g2]) {
      if (!colMagasin && code && resoudreEmplacement(code) === "MAGASIN") {
        colMagasin = code;
      }
    }
    for (const code of [g2, g1]) {
      if (!colDock && code && resoudreEmplacement(code) === "DOCK") {
        colDock = code;
      }
    }
    lignes.push(
      [champCsv(nart, sep), champCsv(colMagasin, sep), champCsv(colDock, sep)].join(sep),
    );
  }

  const trig = trigOf(req.entreprise).toUpperCase();
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${trig}_correction_gism.csv"`,
  );
  // BOM UTF-8 pour qu'Excel ouvre le fichier sans casser les accents.
  res.send("\uFEFF" + lignes.join("\r\n") + "\r\n");
});

export default {
  getDictionnaire,
  saveDictionnaire,
  genererEtiquettesRayons,
  importDictionnaire,
  telechargerDictionnaire,
  telechargerRayonsSansSousZones,
  exporterCorrectionGism,
};
