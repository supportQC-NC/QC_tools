// backend/controllers/bipageController.js
import fs from "fs";
import path from "path";
import asyncHandler from "../middleware/asyncHandler.js";
import LigneBipage from "../models/LigneBipageModel.js";
import InventaireZoneSession from "../models/InventaireZoneSessionModel.js";
import FicheControle from "../models/FicheControleModel.js";
import articleCacheService from "../services/articleService.js";
import { config } from "../services/ficheControleService.js";

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Construit le filtre Mongo des lignes bipées à partir des query params.
 *  - zone   : un code zone précis (le plus spécifique : l'emporte sur "type")
 *  - type   : tous les codes zone de ce type (résolus depuis le snapshot session)
 *  - search : NART ou EAN article (insensible à la casse)
 */
const buildFilter = (session, query) => {
  const filter = { session: session._id };

  if (query.type) {
    const codes = (session.zones || [])
      .filter((z) => (z.type || "") === query.type)
      .map((z) => z.code);
    // Aucun code pour ce type → filtre volontairement vide (0 ligne).
    filter.zoneCode = { $in: codes.length ? codes : ["__aucune__"] };
  }

  // Une zone précise l'emporte sur le filtre par type.
  if (query.zone) filter.zoneCode = query.zone;

  if (query.search) {
    const rx = new RegExp(escapeRegex(query.search.trim()), "i");
    filter.$or = [{ nart: rx }, { eanArticle: rx }];
  }
  return filter;
};

/**
 * Métadonnées des zones présentes dans les lignes (code + type)
 * + liste des types distincts. Le type vient du snapshot de la session.
 */
const buildZonesMeta = async (session) => {
  const typeByCode = {};
  (session.zones || []).forEach((z) => {
    typeByCode[z.code] = z.type || "";
  });

  const codes = await LigneBipage.distinct("zoneCode", {
    session: session._id,
  });
  const zonesMeta = codes
    .filter(Boolean)
    .sort()
    .map((code) => ({ code, type: typeByCode[code] || "" }));
  const types = [
    ...new Set(zonesMeta.map((z) => z.type).filter(Boolean)),
  ].sort();

  return { zonesMeta, types };
};

/**
 * @desc    Lignes bipées de l'inventaire actif (filtre zone + type + recherche)
 * @route   GET /api/bipages/:entrepriseId?zone=&type=&search=
 * @access  Private/Admin
 */
const getBipages = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const session = await InventaireZoneSession.findOne({
    entreprise: entreprise._id,
    statut: "actif",
  });
  if (!session) {
    return res.json({
      active: false,
      lignes: [],
      zones: [],
      zonesMeta: [],
      types: [],
    });
  }

  const filter = buildFilter(session, req.query);
  const lignes = await LigneBipage.find(filter)
    .sort({ zoneCode: 1, datFileName: 1, ordre: 1 })
    .limit(5000);

  const { zonesMeta, types } = await buildZonesMeta(session);

  res.json({
    active: true,
    session: { _id: session._id, nom: session.nom },
    zones: zonesMeta.map((z) => z.code), // rétro-compatibilité (liste de codes)
    zonesMeta, // [{ code, type }]
    types, // liste des types distincts présents
    lignes,
  });
});

/**
 * @desc    Modifier une ligne (qteScan, nart, observation).
 *          Si nart change → re-résolution designation + stock depuis article.DBF.
 * @route   PUT /api/bipages/:entrepriseId/:id
 * @access  Private/Admin
 */
const updateBipage = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const ligne = await LigneBipage.findOne({
    _id: req.params.id,
    entreprise: entreprise._id,
  });
  if (!ligne) {
    res.status(404);
    throw new Error("Ligne non trouvée");
  }

  const { qteScan, nart, observation } = req.body;

  if (qteScan !== undefined) {
    ligne.qteScan = Number.isFinite(Number(qteScan)) ? Number(qteScan) : 0;
  }
  if (observation !== undefined) {
    ligne.observation = String(observation);
  }

  if (nart !== undefined && String(nart).trim() !== ligne.nart) {
    ligne.nart = String(nart).trim();
    if (ligne.nart) {
      let record = null;
      try {
        record = await articleCacheService.findByNart(entreprise, ligne.nart);
      } catch {
        record = null;
      }
      if (record) {
        ligne.designation = (record.DESIGN || "").trim();
        ligne.stock = articleCacheService.calculateStockTotal(record);
        ligne.found = true;
      } else {
        ligne.designation = "Article non trouvé";
        ligne.stock = null;
        ligne.found = false;
      }
    } else {
      ligne.designation = "";
      ligne.stock = null;
      ligne.found = false;
    }
  }

  await ligne.save();
  res.json(ligne);
});

/**
 * @desc    Export CSV (séparateur ;) des lignes bipées (mêmes filtres que la liste)
 * @route   GET /api/bipages/:entrepriseId/export?zone=&type=&search=
 * @access  Private/Admin
 */
const exportCsv = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const session = await InventaireZoneSession.findOne({
    entreprise: entreprise._id,
    statut: "actif",
  });
  if (!session) {
    res.status(404);
    throw new Error("Aucun inventaire actif");
  }

  const filter = buildFilter(session, req.query);
  const lignes = await LigneBipage.find(filter).sort({
    zoneCode: 1,
    datFileName: 1,
    ordre: 1,
  });

  const sep = ";";
  const esc = (v) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = [
    "ZONE",
    "EAN_ARTICLE",
    "QTE_SCAN",
    "NART",
    "DESIGNATION",
    "OBSERVATION",
    "STOCK",
  ];
  const lines = lignes.map((l) =>
    [
      l.zoneCode,
      l.eanArticle,
      l.qteScan,
      l.nart,
      l.designation,
      l.observation,
      l.stock === null || l.stock === undefined ? "" : l.stock,
    ]
      .map(esc)
      .join(sep),
  );

  // BOM UTF-8 pour Excel FR (accents)
  const csv = "\uFEFF" + [header.join(sep), ...lines].join("\r\n");
  const fname = `bipages_${(session.nom || "inventaire").replace(/[^\w-]+/g, "_")}.csv`;

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${fname}"`);
  res.send(csv);
});

/**
 * @desc    « Recommencer » une zone : efface entièrement son bipage.
 *          - supprime les LigneBipage de la zone (session active)
 *          - supprime les FicheControle de la zone (lève le verrou printed)
 *          - supprime les fichiers .DAT/PDF déjà imprimés/archivés sur le partage
 *          - remet la phase "bipage" de la zone à zéro (re-bipage de nouveau autorisé)
 * @route   POST /api/bipages/:entrepriseId/recommencer
 * @access  Private/Admin
 * @body    { zoneCode }
 */
const recommencerZone = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const code = String(req.body.zoneCode || "").trim();
  if (!code) {
    res.status(400);
    throw new Error("Code zone requis");
  }

  const session = await InventaireZoneSession.findOne({
    entreprise: entreprise._id,
    statut: "actif",
  });
  if (!session) {
    res.status(404);
    throw new Error("Aucun inventaire actif");
  }

  // 1) Fiches de contrôle de la zone → fichiers à supprimer sur le partage.
  const fiches = await FicheControle.find({
    session: session._id,
    zoneCode: code,
  });

  const base = session.dossierDat || "";
  const archiveDat = base ? path.join(base, config.archiveDatDirName) : "";
  const archivePdf = base ? path.join(base, config.archivePdfDirName) : "";

  const fichiersSupprimes = [];
  const avertissements = [];
  const tryUnlink = (p) => {
    if (!p) return;
    try {
      if (fs.existsSync(p)) {
        fs.unlinkSync(p);
        fichiersSupprimes.push(p);
      }
    } catch (err) {
      avertissements.push(`${p} : ${err.message}`);
    }
  };

  for (const f of fiches) {
    // PDF : chemin final archivé, puis replis archive_pdf/<nom> et base/<nom>.
    tryUnlink(f.pdfPath);
    if (f.pdfFileName) {
      if (archivePdf) tryUnlink(path.join(archivePdf, f.pdfFileName));
      if (base) tryUnlink(path.join(base, f.pdfFileName));
    }
    // .DAT : archivé dans archive_dat, puis repli base/<nom> (non archivé).
    if (f.datFileName) {
      if (archiveDat) tryUnlink(path.join(archiveDat, f.datFileName));
      if (base) tryUnlink(path.join(base, f.datFileName));
    }
  }

  // 2) Purge BDD : fiches (lève le verrou printed) + lignes bipées.
  const fichesSupprimees = await FicheControle.deleteMany({
    session: session._id,
    zoneCode: code,
  });
  const lignesSupprimees = await LigneBipage.deleteMany({
    session: session._id,
    zoneCode: code,
  });

  // 3) Réinitialiser la phase bipage de la zone (papillonnage/contrôle inchangés).
  const zone = session.zones.find((z) => z.code === code);
  if (zone) {
    zone.bipage = { fait: false, at: null, by: null };
    session.markModified("zones");
    await session.save();
  }

  res.json({
    message: `Zone ${code} réinitialisée — elle peut être re-bipée.`,
    zoneCode: code,
    lignesSupprimees: lignesSupprimees.deletedCount || 0,
    fichesSupprimees: fichesSupprimees.deletedCount || 0,
    fichiersSupprimes,
    avertissements,
  });
});

export { getBipages, updateBipage, exportCsv, recommencerZone };