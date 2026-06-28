// backend/controllers/zoneController.js
import asyncHandler from "../middleware/asyncHandler.js";
import Zone from "../models/ZoneModel.js";

// ===========================================
// HELPERS — Parsing CSV
// ===========================================

/**
 * Parse une ligne CSV (séparateur ";") en gérant les guillemets doubles.
 */
const parseCsvLine = (line) => {
  const result = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += c;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
      } else if (c === ";") {
        result.push(cur);
        cur = "";
      } else {
        cur += c;
      }
    }
  }
  result.push(cur);
  return result;
};

/**
 * Convertit un nombre au format français ("0,00") en Number.
 */
const parseNombreFr = (val) => {
  if (val === undefined || val === null || val === "") return 0;
  const n = parseFloat(String(val).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};

/**
 * Parse le contenu CSV des zones.
 * Colonnes attendues (par nom d'en-tête, ordre indifférent) :
 *   code; libelle; type; metre_lineaire;
 *   ean_principal; ean_papillonnage; ean_bipage; ean_controle
 *
 * - Lignes sans `code` ignorées.
 * - Doublons de `code` dans le fichier : le dernier l'emporte.
 *
 * @returns { zones, lignesIgnorees, doublons } | { error }
 */
const parseZonesCsv = (contenu) => {
  const lignes = contenu
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .filter((l) => l.trim() !== "");

  if (lignes.length === 0) {
    return { error: "Fichier vide" };
  }

  const entetes = parseCsvLine(lignes[0]).map((h) => h.trim().toLowerCase());
  const idx = (nom) => entetes.indexOf(nom);

  const iCode = idx("code");
  if (iCode === -1) {
    return { error: "Colonne 'code' absente de l'en-tête du fichier" };
  }

  const iLibelle = idx("libelle");
  const iType = idx("type");
  const iMetre = idx("metre_lineaire");
  const iEanP = idx("ean_principal");
  const iEanPap = idx("ean_papillonnage");
  const iEanBip = idx("ean_bipage");
  const iEanCtrl = idx("ean_controle");

  const get = (cols, i) =>
    i >= 0 && i < cols.length ? String(cols[i]).trim() : "";

  const zonesParCode = new Map(); // dédoublonnage par code (dernier gagne)
  let lignesIgnorees = 0;
  let doublons = 0;

  for (let r = 1; r < lignes.length; r++) {
    const cols = parseCsvLine(lignes[r]);
    const code = get(cols, iCode);

    if (!code) {
      lignesIgnorees++;
      continue;
    }

    if (zonesParCode.has(code)) {
      doublons++;
    }

    zonesParCode.set(code, {
      code,
      libelle: get(cols, iLibelle),
      type: get(cols, iType),
      metreLineaire: parseNombreFr(get(cols, iMetre)),
      eanPrincipal: get(cols, iEanP),
      eanPapillonnage: get(cols, iEanPap),
      eanBipage: get(cols, iEanBip),
      eanControle: get(cols, iEanCtrl),
    });
  }

  return {
    zones: Array.from(zonesParCode.values()),
    lignesIgnorees,
    doublons,
  };
};

const formatEntreprise = (entreprise) => ({
  _id: entreprise._id,
  nomDossierDBF: entreprise.nomDossierDBF,
  trigramme: entreprise.trigramme,
  nomComplet: entreprise.nomComplet,
});

// ===========================================
// IMPORT CSV (remplacement total)
// ===========================================

/**
 * @desc    Importer les zones depuis un CSV — REMPLACE toutes les zones
 *          existantes de l'entreprise.
 * @route   POST /api/zones/import/:entrepriseId
 * @access  Private (module inventaire, write)
 * @form    multipart/form-data, champ "fichier" (.csv)
 */
const importZones = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const startTime = Date.now();

  if (!req.file || !req.file.buffer) {
    res.status(400);
    throw new Error("Aucun fichier fourni (champ 'fichier')");
  }

  // Décodage UTF-8 (le CSV d'exemple est en ASCII/UTF-8).
  const contenu = req.file.buffer.toString("utf8");

  // 1) Parsing + validation AVANT toute écriture
  const parsed = parseZonesCsv(contenu);
  if (parsed.error) {
    res.status(400);
    throw new Error(`CSV invalide : ${parsed.error}`);
  }
  if (parsed.zones.length === 0) {
    res.status(400);
    throw new Error("Aucune zone valide trouvée dans le fichier");
  }

  // 2) Préparer les documents à insérer
  const documents = parsed.zones.map((z) => ({
    ...z,
    entreprise: entreprise._id,
  }));

  // 3) Remplacement total : on supprime puis on réinsère
  await Zone.deleteMany({ entreprise: entreprise._id });

  let zonesInserees;
  try {
    zonesInserees = await Zone.insertMany(documents, { ordered: true });
  } catch (error) {
    res.status(500);
    throw new Error(
      `Erreur lors de l'insertion des zones : ${error.message}`,
    );
  }

  res.status(201).json({
    message: "Import terminé",
    entreprise: formatEntreprise(entreprise),
    resume: {
      importees: zonesInserees.length,
      lignesIgnorees: parsed.lignesIgnorees, // lignes sans code
      doublonsFusionnes: parsed.doublons, // codes en double dans le fichier
    },
    _queryTime: `${Date.now() - startTime}ms`,
    zones: zonesInserees,
  });
});

// ===========================================
// CRUD
// ===========================================

/**
 * @desc    Lister les zones d'une entreprise
 * @route   GET /api/zones/:entrepriseId
 * @query   search (optionnel : code, libellé ou EAN)
 * @access  Private (module inventaire, read)
 */
const getZones = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const { search } = req.query;

  const query = { entreprise: entreprise._id };

  if (search && search.trim()) {
    const regex = new RegExp(
      search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      "i",
    );
    query.$or = [
      { code: regex },
      { libelle: regex },
      { eanPrincipal: regex },
      { eanPapillonnage: regex },
      { eanBipage: regex },
      { eanControle: regex },
    ];
  }

  const zones = await Zone.find(query).sort({ code: 1 });

  res.json({
    entreprise: formatEntreprise(entreprise),
    total: zones.length,
    zones,
  });
});

/**
 * @desc    Obtenir une zone par son ID
 * @route   GET /api/zones/:entrepriseId/:id
 * @access  Private (module inventaire, read)
 */
const getZoneById = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;

  const zone = await Zone.findOne({
    _id: req.params.id,
    entreprise: entreprise._id,
  });

  if (!zone) {
    res.status(404);
    throw new Error("Zone non trouvée");
  }

  res.json(zone);
});

/**
 * @desc    Obtenir une zone par son code
 * @route   GET /api/zones/:entrepriseId/code/:code
 * @access  Private (module inventaire, read)
 */
const getZoneByCode = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;

  const zone = await Zone.findOne({
    entreprise: entreprise._id,
    code: req.params.code.trim(),
  });

  if (!zone) {
    res.status(404);
    throw new Error("Zone non trouvée");
  }

  res.json(zone);
});

/**
 * @desc    Créer une zone manuellement
 * @route   POST /api/zones/:entrepriseId
 * @access  Private (module inventaire, write)
 */
const createZone = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const {
    code,
    libelle,
    type,
    metreLineaire,
    eanPrincipal,
    eanPapillonnage,
    eanBipage,
    eanControle,
  } = req.body;

  if (!code || !code.trim()) {
    res.status(400);
    throw new Error("Le code de la zone est requis");
  }

  // Unicité du code dans l'entreprise
  const existante = await Zone.findOne({
    entreprise: entreprise._id,
    code: code.trim(),
  });
  if (existante) {
    res.status(400);
    throw new Error(`Une zone avec le code "${code.trim()}" existe déjà`);
  }

  const zone = await Zone.create({
    entreprise: entreprise._id,
    code: code.trim(),
    libelle: libelle || "",
    type: type || "",
    metreLineaire:
      metreLineaire !== undefined ? parseNombreFr(metreLineaire) : 0,
    eanPrincipal: eanPrincipal || "",
    eanPapillonnage: eanPapillonnage || "",
    eanBipage: eanBipage || "",
    eanControle: eanControle || "",
  });

  res.status(201).json(zone);
});

/**
 * @desc    Modifier une zone
 * @route   PUT /api/zones/:entrepriseId/:id
 * @access  Private (module inventaire, write)
 */
const updateZone = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;

  const zone = await Zone.findOne({
    _id: req.params.id,
    entreprise: entreprise._id,
  });

  if (!zone) {
    res.status(404);
    throw new Error("Zone non trouvée");
  }

  const {
    code,
    libelle,
    type,
    metreLineaire,
    eanPrincipal,
    eanPapillonnage,
    eanBipage,
    eanControle,
  } = req.body;

  // Si on change le code, vérifier l'unicité
  if (code !== undefined && code.trim() && code.trim() !== zone.code) {
    const existante = await Zone.findOne({
      entreprise: entreprise._id,
      code: code.trim(),
      _id: { $ne: zone._id },
    });
    if (existante) {
      res.status(400);
      throw new Error(`Une zone avec le code "${code.trim()}" existe déjà`);
    }
    zone.code = code.trim();
  }

  if (libelle !== undefined) zone.libelle = libelle;
  if (type !== undefined) zone.type = type;
  if (metreLineaire !== undefined)
    zone.metreLineaire = parseNombreFr(metreLineaire);
  if (eanPrincipal !== undefined) zone.eanPrincipal = eanPrincipal;
  if (eanPapillonnage !== undefined) zone.eanPapillonnage = eanPapillonnage;
  if (eanBipage !== undefined) zone.eanBipage = eanBipage;
  if (eanControle !== undefined) zone.eanControle = eanControle;

  await zone.save();

  res.json(zone);
});

/**
 * @desc    Supprimer une zone
 * @route   DELETE /api/zones/:entrepriseId/:id
 * @access  Private (module inventaire, delete)
 */
const deleteZone = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;

  const zone = await Zone.findOne({
    _id: req.params.id,
    entreprise: entreprise._id,
  });

  if (!zone) {
    res.status(404);
    throw new Error("Zone non trouvée");
  }

  await Zone.deleteOne({ _id: zone._id });

  res.json({ message: "Zone supprimée" });
});

/**
 * @desc    Supprimer TOUTES les zones d'une entreprise
 * @route   DELETE /api/zones/:entrepriseId
 * @access  Private (module inventaire, delete)
 */
const deleteAllZones = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;

  const result = await Zone.deleteMany({ entreprise: entreprise._id });

  res.json({
    message: "Toutes les zones ont été supprimées",
    supprimees: result.deletedCount,
  });
});

export {
  importZones,
  getZones,
  getZoneById,
  getZoneByCode,
  createZone,
  updateZone,
  deleteZone,
  deleteAllZones,
};