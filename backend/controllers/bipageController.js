// backend/controllers/bipageController.js
import fs from "fs";
import path from "path";
import asyncHandler from "../middleware/asyncHandler.js";
import LigneBipage from "../models/LigneBipageModel.js";
import InventaireZoneSession from "../models/InventaireZoneSessionModel.js";
import FicheControle from "../models/FicheControleModel.js";
import articleCacheService from "../services/articleService.js";
import {
  config,
  getInventaireDirs,
  emplacementDir,
} from "../services/ficheControleService.js";
import {
  getProformasEligibles,
  importerProformas,
  genererModeleExcelBipage,
  importerExcelBipage,
} from "../services/bipageImportService.js";

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Construit le filtre Mongo des lignes bipées à partir des query params.
 *  - type   : emplacement (MAGASIN/DOCK/…) → filtre directement sur zoneType
 *  - zone   : un code zone précis (peut COEXISTER avec le type : deux zones de
 *             même code se distinguent alors par leur emplacement)
 *  - search : NART ou EAN article (insensible à la casse)
 */
const buildFilter = (session, query) => {
  const filter = { session: session._id };

  if (query.type) filter.zoneType = query.type;
  if (query.zone) filter.zoneCode = query.zone;

  if (query.search) {
    const rx = new RegExp(escapeRegex(query.search.trim()), "i");
    filter.$or = [{ nart: rx }, { eanArticle: rx }];
  }
  return filter;
};

/**
 * Métadonnées des zones présentes dans les lignes : une entrée par PAIRE
 * (code, emplacement) réellement bipée → deux zones de même code à des
 * emplacements différents apparaissent bien SÉPARÉMENT. Repli sur le snapshot
 * de session pour les anciennes lignes sans zoneType.
 */
const buildZonesMeta = async (session) => {
  const typeByCode = {};
  (session.zones || []).forEach((z) => {
    if (typeByCode[z.code] === undefined) typeByCode[z.code] = z.type || "";
  });

  const pairs = await LigneBipage.aggregate([
    { $match: { session: session._id } },
    { $group: { _id: { code: "$zoneCode", type: "$zoneType" } } },
  ]);

  const seen = new Set();
  const zonesMeta = [];
  for (const p of pairs) {
    const code = p._id.code || "";
    if (!code) continue;
    const type = p._id.type || typeByCode[code] || "";
    const key = `${code} ${type}`;
    if (seen.has(key)) continue;
    seen.add(key);
    zonesMeta.push({ code, type });
  }
  zonesMeta.sort(
    (a, b) =>
      a.code.localeCompare(b.code, "fr", { numeric: true }) ||
      a.type.localeCompare(b.type, "fr"),
  );
  const types = [...new Set(zonesMeta.map((z) => z.type).filter(Boolean))].sort();

  return { zonesMeta, types };
};

/**
 * Backfill de `zoneType` pour les anciennes lignes (créées avant ce champ) :
 * l'emplacement est déjà présent en préfixe du `datFileName` logique
 * ("<emplacement>/<nom>"). Idempotent : ne touche que les lignes à zoneType vide
 * dont le datFileName contient un "/". (Pipeline d'update, supporté par Atlas.)
 */
const backfillZoneType = async (session) => {
  try {
    await LigneBipage.updateMany(
      {
        session: session._id,
        datFileName: /\//,
        $or: [{ zoneType: "" }, { zoneType: { $exists: false } }],
      },
      [
        {
          $set: {
            zoneType: { $arrayElemAt: [{ $split: ["$datFileName", "/"] }, 0] },
          },
        },
      ],
    );
  } catch {
    /* best-effort : si l'update pipeline échoue, on n'empêche pas la lecture */
  }
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

  await backfillZoneType(session);

  const filter = buildFilter(session, req.query);
  const lignes = await LigneBipage.find(filter)
    .sort({ zoneType: 1, zoneCode: 1, datFileName: 1, ordre: 1 })
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

  await backfillZoneType(session);

  const filter = buildFilter(session, req.query);
  const lignes = await LigneBipage.find(filter).sort({
    zoneType: 1,
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
    "EMPLACEMENT",
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
      l.zoneType || "",
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

  // Base recalculée pour l'environnement courant (slug unique), comme le watcher
  // — plus fiable que session.dossierDat (figé, potentiellement cross-OS).
  const slug = session.dossierSlug || session.nom;
  const base = slug ? getInventaireDirs(slug).base : session.dossierDat || "";

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
    // Le fichier vit dans le SOUS-DOSSIER de son emplacement (même source de
    // vérité que le dépôt/watcher : emplacementDir). On prend le basename car
    // datFileName/pdfFileName peuvent être préfixés par l'emplacement (clé BDD).
    const scanDir = base ? path.join(base, emplacementDir(f.zoneType)) : base;
    const pdfBase = f.pdfFileName ? path.basename(f.pdfFileName) : "";
    const datBase = f.datFileName ? path.basename(f.datFileName) : "";

    tryUnlink(f.pdfPath);
    if (pdfBase && scanDir) {
      tryUnlink(path.join(scanDir, config.archivePdfDirName, pdfBase));
      tryUnlink(path.join(scanDir, pdfBase));
    }
    if (datBase && scanDir) {
      tryUnlink(path.join(scanDir, config.archiveDatDirName, datBase));
      tryUnlink(path.join(scanDir, datBase));
    }
    // Repli LEGACY : anciens fichiers à plat, directement sous la base.
    if (base && base !== scanDir) {
      if (pdfBase) {
        tryUnlink(path.join(base, config.archivePdfDirName, pdfBase));
        tryUnlink(path.join(base, pdfBase));
      }
      if (datBase) {
        tryUnlink(path.join(base, config.archiveDatDirName, datBase));
        tryUnlink(path.join(base, datBase));
      }
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

// ===========================================
// IMPORTS DE BIPAGES (proforma ERP / fichier Excel)
// ===========================================

/** Session d'inventaire ACTIVE — cible obligatoire de tout import. */
const sessionActiveOuErreur = async (entreprise, res) => {
  const session = await InventaireZoneSession.findOne({
    entreprise: entreprise._id,
    statut: "actif",
  });
  if (!session) {
    res.status(400);
    throw new Error(
      "Aucun inventaire actif : initialisez-en un avant d'importer des bipages.",
    );
  }
  return session;
};

/**
 * @desc    Proformas candidates à l'intégration (plage de dates + clients).
 * @route   GET /api/bipages/:entrepriseId/proformas?dateDebut=&dateFin=&clients=9900,9901
 * @access  Private (module bipage, read)
 */
const listProformasBipage = asyncHandler(async (req, res) => {
  const { dateDebut, dateFin, clients } = req.query;
  const listeClients = clients
    ? String(clients)
        .split(/[;,]/)
        .map((c) => c.trim())
        .filter(Boolean)
    : [];
  const data = await getProformasEligibles(req.entreprise, {
    dateDebut,
    dateFin,
    clients: listeClients,
  });
  res.json(data);
});

/**
 * @desc    Intègre les proformas choisies dans l'inventaire actif.
 * @route   POST /api/bipages/:entrepriseId/import-proformas   body { numfacts: [] }
 * @access  Private (module bipage, write)
 */
const importProformasBipage = asyncHandler(async (req, res) => {
  const { numfacts = [] } = req.body;
  if (!Array.isArray(numfacts) || numfacts.length === 0) {
    res.status(400);
    throw new Error("Aucune proforma sélectionnée.");
  }
  const session = await sessionActiveOuErreur(req.entreprise, res);
  const result = await importerProformas(req.entreprise, session, numfacts);
  res.json({
    message: `${result.importees} proforma(s) intégrée(s), ${result.lignes} ligne(s).`,
    ...result,
  });
});

/**
 * @desc    Modèle Excel d'import de bipages.
 * @route   GET /api/bipages/:entrepriseId/modele-excel
 * @access  Private (module bipage, read)
 */
const modeleExcelBipage = asyncHandler(async (req, res) => {
  const buffer = await genererModeleExcelBipage();
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  // Nom d'exemple VALIDE sous Windows : « < » et « > » y sont interdits, un
  // gabarit littéral donnerait un fichier impossible à enregistrer.
  // L'utilisateur renomme ensuite avec sa zone (mode d'emploi dans l'onglet Aide).
  res.setHeader(
    "Content-Disposition",
    'attachment; filename="bipage_12_A_1_MAGASIN.xlsx"',
  );
  res.send(Buffer.from(buffer));
});

/**
 * @desc    Import d'un fichier Excel de bipage (multipart, champ "file").
 *          C'est le NOM du fichier qui porte l'agent, la zone et l'emplacement.
 * @route   POST /api/bipages/:entrepriseId/import-excel
 * @access  Private (module bipage, write)
 */
const importExcelBipage = asyncHandler(async (req, res) => {
  if (!req.file || !req.file.buffer) {
    res.status(400);
    throw new Error("Aucun fichier reçu.");
  }
  // Mode passé en query (et non en champ de formulaire) : il reste lisible quel
  // que soit l'ordre des parties du multipart.
  const mode = req.query.mode === "deduction" ? "deduction" : "inventaire";

  const session = await sessionActiveOuErreur(req.entreprise, res);
  const result = await importerExcelBipage(
    req.entreprise,
    session,
    req.file.originalname,
    req.file.buffer,
    mode,
  );
  res.json({
    message:
      `${mode === "deduction" ? "DÉDUCTION" : "Comptage"} — zone ${result.zoneCode} ` +
      `(${result.emplacement}) : ${result.lignes} ligne(s), ${result.unites} unité(s)` +
      `${result.nonTrouves ? `, dont ${result.nonTrouves} article(s) non trouvé(s)` : ""}.`,
    ...result,
  });
});

export {
  getBipages,
  updateBipage,
  exportCsv,
  recommencerZone,
  listProformasBipage,
  importProformasBipage,
  modeleExcelBipage,
  importExcelBipage,
};
