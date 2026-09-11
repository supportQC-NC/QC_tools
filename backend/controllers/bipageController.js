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
import os from "os";
import fournissCacheService from "../services/fournissCacheService.js";
import { envoyerClasseur } from "../utils/envoyerClasseur.js";
import {
  fmtNum,
  grouperEcarts,
  dessinerDocInventaire,
  construireClasseurEcarts,
} from "../services/ecartsInventaireService.js";
import {
  getProformasEligibles,
  importerProformas,
  previsualiserImportProformas,
  genererModeleExcelBipage,
  importerExcelBipage,
  resoudreZoneImport,
} from "../services/bipageImportService.js";

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** « Prénom Nom » (repli e-mail) — même formatage que le suivi bipage. */
const nomUtilisateur = (u) =>
  u ? `${u.prenom || ""} ${u.nom || ""}`.trim() || u.email || "" : "";

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

  // Les deux clauses ci-dessous sont chacune un $or : les cumuler dans
  // `filter.$or` ferait que la seconde ÉCRASE la première (une recherche
  // annulerait le filtre de provenance). On les compose donc dans un $and.
  const clauses = [];

  if (query.search) {
    const rx = new RegExp(escapeRegex(query.search.trim()), "i");
    // `gencod` est dans la recherche parce qu'il est AFFICHÉ : l'utilisateur
    // qui lit un code-barres à l'écran doit pouvoir le retaper ici.
    clauses.push({ $or: [{ nart: rx }, { eanArticle: rx }, { gencod: rx }] });
  }

  // Provenance : ne garder que ce qui a été touché à la main.
  //   ajoutees   : lignes créées depuis l'écran (source "manuel") ;
  //   modifiees  : lignes issues du terrain dont le NART ou la quantité a été
  //                corrigé ;
  //   touchees   : les deux à la fois — « tout ce qui n'est pas brut de
  //                collecteur », la question qu'on se pose en fin d'inventaire.
  if (query.marque === "ajoutees") clauses.push({ source: "manuel" });
  else if (query.marque === "modifiees") clauses.push({ modifie: true });
  else if (query.marque === "touchees") {
    clauses.push({ $or: [{ source: "manuel" }, { modifie: true }] });
  }

  if (clauses.length === 1) Object.assign(filter, clauses[0]);
  else if (clauses.length > 1) filter.$and = clauses;

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
/**
 * Complète `gencod` en mémoire pour les lignes qui n'en ont pas (bipages
 * antérieurs à l'ajout du champ). Lecture seule, sur le cache articles déjà
 * chargé : coût négligeable, et l'écran affiche le bon code-barres dès la
 * première ouverture, sans migration.
 */
const completerGencod = async (entreprise, lignes) => {
  const aResoudre = lignes.filter((l) => !l.gencod && l.nart);
  if (!aResoudre.length) return;
  const dejaVu = new Map();
  for (const l of aResoudre) {
    const cle = String(l.nart).trim().toUpperCase();
    if (!dejaVu.has(cle)) {
      let gencod = "";
      try {
        // eslint-disable-next-line no-await-in-loop
        const rec = await articleCacheService.findByNart(entreprise, l.nart);
        if (rec) gencod = String(rec.GENCOD || "").trim();
      } catch {
        gencod = "";
      }
      dejaVu.set(cle, gencod);
    }
    l.gencod = dejaVu.get(cle);
  }
};

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
    .limit(5000)
    .lean();

  // Rattrapage des lignes bipées AVANT l'ajout du champ `gencod` : on le
  // résout depuis le cache articles pour l'affichage, sans réécrire en base
  // (une lecture ne doit pas écrire). Les lignes créées depuis le portent.
  await completerGencod(entreprise, lignes);

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
 * @desc    FEUILLE D'ÉCARTS du comptage en cours : pour chaque article, la
 *          quantité comptée face au stock théorique, l'écart et sa valeur en
 *          XPF, regroupés par famille (2 premiers caractères du NART) ou par
 *          fournisseur, au-dessus d'un seuil de valeur.
 *
 *          C'EST LE MÊME DOCUMENT que celui de l'inventaire proforma — même
 *          mise en page PDF, même classeur Excel (`ecartsInventaireService`).
 *          Seule la source du comptage change : les lignes bipées de la session
 *          au lieu des lignes de proformas.
 *
 *          `perimetre` :
 *            · "comptes" (défaut) — uniquement les articles effectivement
 *              comptés. C'est le seul périmètre lisible EN COURS d'inventaire :
 *              sinon les 90 000 articles du catalogue jamais bipés sortiraient
 *              tous en écart négatif.
 *            · "stock" — y ajoute tous les articles à stock > 0 non comptés, ce
 *              qui donne la photo complète en FIN d'inventaire (même univers
 *              que l'inventaire proforma).
 *
 *          Les filtres zone / emplacement / recherche de l'écran s'appliquent.
 * @route   GET /api/bipages/:entrepriseId/ecarts?groupBy=&seuil=&format=&perimetre=&zone=&type=
 * @access  Private (module inventaire ou bipage, read)
 */
const exportEcartsBipage = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const session = await InventaireZoneSession.findOne({
    entreprise: entreprise._id,
    statut: "actif",
  });
  if (!session) {
    res.status(400);
    throw new Error("Aucun inventaire actif.");
  }

  const groupBy = req.query.groupBy === "fournisseur" ? "fournisseur" : "famille";
  const seuil = Math.max(0, Number(req.query.seuil) || 0);
  const toutLeStock = req.query.perimetre === "stock";

  // Comptage : mêmes filtres que la liste de l'écran (zone, emplacement,
  // recherche), pour que le document reflète ce que l'utilisateur regarde.
  const lignes = await LigneBipage.find(buildFilter(session, req.query))
    .select("nart eanArticle qteScan designation zoneCode zoneType")
    .lean();

  // Cumul par article. Clé = NART résolu, repli sur le code scanné : deux zones
  // qui comptent le même article doivent s'additionner, pas se doubler.
  const compte = new Map();
  for (const l of lignes) {
    const cle = String(l.nart || l.eanArticle || "").trim().toUpperCase();
    if (!cle) continue;
    const cur = compte.get(cle) || {
      qte: 0,
      design: "",
      code: String(l.nart || l.eanArticle || "").trim(),
      zones: new Set(),
    };
    cur.qte += Number(l.qteScan) || 0;
    if (!cur.design && l.designation) cur.design = l.designation;
    cur.zones.add(`${l.zoneCode}|${l.zoneType || ""}`);
    compte.set(cle, cur);
  }

  await articleCacheService.preload(entreprise).catch(() => {});
  const acache = await articleCacheService.getArticles(entreprise);

  const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  const univers = new Map();
  const ajouterArticle = (rec) => {
    const nart = String(rec.NART || "").trim();
    if (!nart) return;
    const fourn =
      rec.FOURNISS !== undefined && rec.FOURNISS !== null
        ? String(rec.FOURNISS).trim()
        : String(rec.FOURN || "").trim();
    univers.set(nart.toUpperCase(), {
      nart,
      design: String(rec.DESIGN || "").trim(),
      refer: String(rec.REFER || "").trim(),
      gencod: String(rec.GENCOD || "").trim(),
      fourn,
      stock: articleCacheService.calculateStockTotal(rec),
      prev: num(rec.PREV),
      qte: 0,
      nonTrouve: false,
    });
  };

  if (toutLeStock) {
    for (const idx of acache.articlesEnStock) ajouterArticle(acache.records[idx]);
  }

  for (const [cle, info] of compte) {
    if (!univers.has(cle)) {
      // ⚠️ lookupNart, pas indexByNart : l'ERP mélange « 12345 » et « 012345 ».
      const idx = articleCacheService.lookupNart(acache, cle);
      if (idx !== undefined) ajouterArticle(acache.records[idx]);
      else
        univers.set(cle, {
          nart: info.code,
          design: info.design,
          refer: "",
          gencod: "",
          fourn: "",
          stock: 0,
          prev: 0,
          qte: 0,
          nonTrouve: true,
        });
    }
    const cible = univers.get(cle);
    cible.qte += info.qte;
    // « D » ici = article compté dans PLUSIEURS zones : le doublon à vérifier
    // n'est pas la ligne répétée (le collecteur cumule) mais le rayon en double.
    cible.doublon = info.zones.size > 1;
  }

  const rows = [];
  for (const row of univers.values()) {
    const diff = row.qte - row.stock;
    const diffval = Math.round(diff * row.prev);
    if (Math.abs(diffval) <= seuil) continue;
    const flags = [];
    if (row.doublon) flags.push("D");
    if (row.qte > row.stock) flags.push("XX");
    rows.push({ ...row, diff, diffval, att: flags.join(" ") });
  }

  if (rows.length === 0) {
    res.status(404);
    throw new Error("Aucun article au-dessus du seuil de valeur indiqué.");
  }

  // Nom du fournisseur (fourniss.dbf) — nécessaire au groupement fournisseur
  // comme à la colonne du document.
  const nomFournByCode = new Map();
  for (const r of rows) {
    const code = String(r.fourn || "").trim();
    if (!code) {
      r.fournNom = "";
      continue;
    }
    if (!nomFournByCode.has(code)) {
      let nom = "";
      try {
        // eslint-disable-next-line no-await-in-loop
        const f = await fournissCacheService.findByFourn(entreprise, code);
        if (f) nom = String(f.NOM || "").trim();
      } catch {
        nom = "";
      }
      nomFournByCode.set(code, nom);
    }
    r.fournNom = nomFournByCode.get(code);
  }

  const { groupes, grandTotal, groupLabel } = grouperEcarts(rows, groupBy);

  const perimetreLabel = toutLeStock
    ? "stock complet"
    : "articles comptés";
  const filtreLabel = [
    req.query.type ? `emplacement ${req.query.type}` : "",
    req.query.zone ? `zone ${req.query.zone}` : "",
  ]
    .filter(Boolean)
    .join(", ");
  const titre = `Écarts d'inventaire — ${session.nom} — par ${
    groupBy === "fournisseur" ? "fournisseur" : "famille"
  }${filtreLabel ? ` — ${filtreLabel}` : ""} — ${perimetreLabel}${
    seuil ? ` (|écart| > ${fmtNum(seuil)} XPF)` : ""
  }`;

  const base = `ecarts_${session.nom.replace(/[^\w-]+/g, "_")}_${groupBy}`;

  if (req.query.format === "xlsx") {
    const wb = await construireClasseurEcarts({
      titre,
      groupes,
      grandTotal,
      groupLabel,
    });
    // Droits « champ par champ » appliqués avant l'envoi.
    await envoyerClasseur(req, res, wb, `${base}.xlsx`);
    return;
  }

  const tmp = path.join(os.tmpdir(), `${base}_${Date.now()}.pdf`);
  await dessinerDocInventaire({
    titre,
    groupes,
    grandTotal,
    groupLabel,
    outPath: tmp,
  });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${base}.pdf"`);
  const stream = fs.createReadStream(tmp);
  const nettoyer = () => {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
  };
  stream.on("close", nettoyer);
  stream.on("error", nettoyer);
  res.on("close", nettoyer);
  stream.pipe(res);
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

  // Valeurs AVANT saisie : servent à décider si la ligne a réellement changé.
  // ⚠️ Comparer aux valeurs déjà écrites plus bas donnerait toujours « égal ».
  const qteAvant = Number(ligne.qteScan) || 0;
  const nartAvant = String(ligne.nart || "");

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
        // Le NART fait foi : désignation, code-barres et stock du NOUVEL
        // article remplacent ceux de l'ancien. Sans le gencod, la colonne
        // GENCODE de l'écran resterait sur celui de l'article précédent.
        ligne.designation = (record.DESIGN || "").trim();
        ligne.gencod = (record.GENCOD || "").trim();
        ligne.stock = articleCacheService.calculateStockTotal(record);
        ligne.found = true;
      } else {
        ligne.designation = "Article non trouvé";
        ligne.gencod = "";
        ligne.stock = null;
        ligne.found = false;
      }
    } else {
      ligne.designation = "";
      ligne.gencod = "";
      ligne.stock = null;
      ligne.found = false;
    }
  }

  // ── Rattrapage du GENCOD (lignes antérieures à ce champ) ────────────────
  // Ces lignes n'ont PAS de gencod en base : la lecture le résout en mémoire
  // (`completerGencod`) sans l'écrire, parce qu'une lecture ne doit pas écrire.
  // Conséquence côté écran : modifier une quantité renvoyait un document au
  // gencod vide et la colonne se VIDAIT, alors qu'elle était remplie juste
  // avant — elle ne revenait qu'au rechargement.
  // Ici on est dans une écriture : on peut le fixer pour de bon, et la ligne
  // cesse définitivement de dépendre du rattrapage de lecture.
  if (!ligne.gencod && ligne.nart) {
    try {
      const rec = await articleCacheService.findByNart(entreprise, ligne.nart);
      if (rec) ligne.gencod = String(rec.GENCOD || "").trim();
    } catch {
      /* article introuvable dans le catalogue : le gencod reste vide */
    }
  }

  // ── Marquage de la correction ───────────────────────────────────────────
  // Seuls la QUANTITÉ et le NART comptent : une observation ajoutée n'altère
  // pas le comptage et ne doit pas faire passer la ligne pour corrigée.
  // Les valeurs d'origine sont figées à la PREMIÈRE correction — une deuxième
  // passe les écraserait et on perdrait ce que l'agent avait compté.
  const qteChangee = (Number(ligne.qteScan) || 0) !== qteAvant;
  const nartChange = String(ligne.nart || "") !== nartAvant;

  if (qteChangee || nartChange) {
    if (!ligne.modifie) {
      ligne.qteScanOrigine = qteAvant;
      ligne.nartOrigine = nartAvant;
      ligne.modifie = true;
    }
    ligne.modifieAt = new Date();
    ligne.modifiePar = req.user._id;
    ligne.modifieParNom = nomUtilisateur(req.user);
  }

  await ligne.save();
  res.json(ligne);
});

/**
 * @desc    Ajoute une ligne de bipage À LA MAIN dans la zone actuellement
 *          filtrée. La zone et l'emplacement NE SONT PAS saisis : ils viennent
 *          du filtre de l'écran et sont vérifiés contre le snapshot de la
 *          session. Sans cette règle, une faute de frappe créerait une ligne
 *          rattachée à une zone inexistante, invisible dans tous les filtres et
 *          pourtant comptée dans les écarts.
 * @route   POST /api/bipages/:entrepriseId/ligne
 * @access  Private (module bipage, write)
 */
const ajouterLigneBipage = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const session = await InventaireZoneSession.findOne({
    entreprise: entreprise._id,
    statut: "actif",
  });
  if (!session) {
    res.status(400);
    throw new Error("Aucun inventaire actif.");
  }

  const zoneCode = String(req.body.zoneCode || "").trim();
  const zoneType = String(req.body.zoneType || "").trim();
  const nart = String(req.body.nart || "").trim();
  const observation = String(req.body.observation || "").trim();
  const qteScan = Number(req.body.qteScan);

  if (!zoneCode || !zoneType) {
    res.status(400);
    throw new Error(
      "Zone et emplacement obligatoires : filtrez d'abord l'écran sur une zone.",
    );
  }
  if (!nart) {
    res.status(400);
    throw new Error("NART obligatoire.");
  }
  if (!Number.isFinite(qteScan) || qteScan === 0) {
    // 0 est refusé (une ligne à zéro n'apporte rien) ; le négatif reste permis,
    // c'est la convention des lignes de déduction.
    res.status(400);
    throw new Error("Quantité obligatoire, et différente de 0.");
  }

  // La paire (code, emplacement) doit exister dans l'inventaire EN COURS.
  const zone = (session.zones || []).find(
    (z) => z.code === zoneCode && String(z.type || "").trim() === zoneType,
  );
  if (!zone) {
    res.status(400);
    throw new Error(
      `Zone ${zoneCode} (${zoneType}) absente de cet inventaire.`,
    );
  }

  // Résolution article : même règle que la correction d'un NART.
  let record = null;
  try {
    record = await articleCacheService.findByNart(entreprise, nart);
  } catch {
    record = null;
  }

  // La ligne se range à la suite de celles de sa zone.
  const derniere = await LigneBipage.findOne({
    session: session._id,
    zoneCode,
    zoneType,
  })
    .sort({ ordre: -1 })
    .select("ordre")
    .lean();

  const ligne = await LigneBipage.create({
    entreprise: entreprise._id,
    session: session._id,
    // Aucun fichier derrière cette ligne : `datFileName` reste vide, ce qui la
    // regroupe en tête de sa zone au tri (zoneType, zoneCode, datFileName…).
    datFileName: "",
    zoneCode,
    zoneType,
    ordre: (Number(derniere?.ordre) || 0) + 1,
    // Le code brut « scanné » n'existe pas : on inscrit le NART saisi, comme le
    // fait le collecteur pour un article sans code-barres.
    eanArticle: nart,
    qteScan,
    nart,
    observation,
    designation: record ? (record.DESIGN || "").trim() : "Article non trouvé",
    gencod: record ? (record.GENCOD || "").trim() : "",
    stock: record ? articleCacheService.calculateStockTotal(record) : null,
    found: !!record,
    source: "manuel",
    sourceRef: "",
    // L'« agent » d'une ligne ajoutée est celui qui l'a saisie.
    agentNom: nomUtilisateur(req.user),
  });

  res.status(201).json(ligne);
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
  const lignes = await LigneBipage.find(filter)
    .sort({ zoneType: 1, zoneCode: 1, datFileName: 1, ordre: 1 })
    .lean();

  // Même rattrapage que la liste : le CSV doit porter le code-barres, y
  // compris pour les bipages antérieurs au champ `gencod`.
  await completerGencod(entreprise, lignes);

  const sep = ";";
  const esc = (v) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = [
    "ZONE",
    "EMPLACEMENT",
    "CODE_SCANNE",
    "GENCODE",
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
      l.gencod || "",
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
 * @desc    APERÇU d'un import de proformas sur une zone : ce qui va changer,
 *          article par article, sans rien écrire. Sert d'écran de confirmation.
 *          Répond en particulier à deux questions qu'on ne pouvait pas se poser
 *          avant : la zone a-t-elle déjà été contrôlée, et que restera-t-il sur
 *          chaque article une fois la déduction appliquée.
 * @route   POST /api/bipages/:entrepriseId/proformas/apercu
 * @body    { zoneCode, emplacement, items|numfacts, mode? }
 * @access  Private (module inventaire ou bipage, read)
 */
const apercuImportProformas = asyncHandler(async (req, res) => {
  const { items, numfacts = [], zoneCode, emplacement } = req.body;
  const selection = Array.isArray(items) && items.length ? items : numfacts;
  if (!Array.isArray(selection) || selection.length === 0) {
    res.status(400);
    throw new Error("Aucune proforma sélectionnée.");
  }
  const mode = req.body.mode === "deduction" ? "deduction" : "inventaire";

  const session = await sessionActiveOuErreur(req.entreprise, res);

  let zone;
  try {
    zone = await resoudreZoneImport(req.entreprise._id, zoneCode, emplacement);
  } catch (e) {
    res.status(400);
    throw e;
  }

  const apercu = await previsualiserImportProformas(
    req.entreprise,
    session,
    zone,
    selection,
    mode,
  );
  res.json(apercu);
});

/**
 * @desc    Intègre les proformas choisies SUR UNE ZONE CHOISIE dans l'écran.
 * @route   POST /api/bipages/:entrepriseId/import-proformas
 * @body    { zoneCode, emplacement, items|numfacts, mode? }
 *          `zoneCode` (+ `emplacement` si la société en utilise plusieurs) dit
 *          où atterrit le comptage : il n'est plus lu dans l'observation.
 *          `mode` : "inventaire" (défaut) ou "deduction" (quantités négatives).
 * @access  Private (module inventaire ou bipage, write)
 */
const importProformasBipage = asyncHandler(async (req, res) => {
  // `items` = forme complète (agent surchargé) ; `numfacts` = forme simple.
  const { items, numfacts = [], zoneCode, emplacement } = req.body;
  const selection = Array.isArray(items) && items.length ? items : numfacts;
  if (!Array.isArray(selection) || selection.length === 0) {
    res.status(400);
    throw new Error("Aucune proforma sélectionnée.");
  }
  const mode = req.body.mode === "deduction" ? "deduction" : "inventaire";

  const session = await sessionActiveOuErreur(req.entreprise, res);

  let zone;
  try {
    zone = await resoudreZoneImport(req.entreprise._id, zoneCode, emplacement);
  } catch (e) {
    res.status(400);
    throw e;
  }

  const result = await importerProformas(
    req.entreprise,
    session,
    zone,
    selection,
    mode,
    req.user._id,
  );
  const echecs = result.resultats.filter((r) => r.statut === "erreur").length;
  res.json({
    message:
      `${mode === "deduction" ? "DÉDUCTION" : "Comptage"} — zone ${result.zoneCode}` +
      `${result.emplacement ? ` (${result.emplacement})` : ""} : ` +
      `${result.importees} proforma(s) intégrée(s), ${result.lignes} ligne(s), ` +
      `${result.unites} unité(s)` +
      `${echecs ? `, ${echecs} en échec` : ""}` +
      `${
        result.phasesMarquees.length
          ? `. Phases ${result.phasesMarquees.join(" et ")} cochées automatiquement.`
          : "."
      }`,
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
  // Le nom du fichier n'a plus aucun rôle : la zone est choisie dans l'écran.
  res.setHeader(
    "Content-Disposition",
    'attachment; filename="modele_comptage.xlsx"',
  );
  res.send(Buffer.from(buffer));
});

/**
 * @desc    Import d'un comptage Excel (multipart, champ "file") SUR UNE ZONE
 *          CHOISIE dans l'écran. Le nom du fichier ne sert qu'à tracer la
 *          provenance et à ne pas réimporter deux fois le même.
 * @route   POST /api/bipages/:entrepriseId/import-excel?mode=&zoneCode=&emplacement=
 * @access  Private (module inventaire ou bipage, write)
 */
const importExcelBipage = asyncHandler(async (req, res) => {
  if (!req.file || !req.file.buffer) {
    res.status(400);
    throw new Error("Aucun fichier reçu.");
  }
  // Paramètres passés en query (et non en champs de formulaire) : ils restent
  // lisibles quel que soit l'ordre des parties du multipart.
  const mode = req.query.mode === "deduction" ? "deduction" : "inventaire";
  const { zoneCode, emplacement } = req.query;

  const session = await sessionActiveOuErreur(req.entreprise, res);

  let zone;
  try {
    zone = await resoudreZoneImport(req.entreprise._id, zoneCode, emplacement);
  } catch (e) {
    res.status(400);
    throw e;
  }

  const result = await importerExcelBipage(
    req.entreprise,
    session,
    zone,
    req.file.originalname,
    req.file.buffer,
    mode,
    // Le nom du fichier ne porte plus de code agent : on trace qui a importé.
    {
      userId: req.user._id,
      nom: `${req.user.prenom || ""} ${req.user.nom || ""}`.trim() || req.user.email,
    },
  );
  res.json({
    message:
      `${mode === "deduction" ? "DÉDUCTION" : "Comptage"} — zone ${result.zoneCode}` +
      `${result.emplacement ? ` (${result.emplacement})` : ""} : ` +
      `${result.lignes} ligne(s), ${result.unites} unité(s)` +
      `${result.nonTrouves ? `, dont ${result.nonTrouves} article(s) non trouvé(s)` : ""}` +
      `${
        result.phasesMarquees.length
          ? `. Phases ${result.phasesMarquees.join(" et ")} cochées automatiquement.`
          : "."
      }`,
    ...result,
  });
});


/**
 * @desc    Classement des zones par nombre de lignes RETOUCHÉES À LA MAIN
 *          (ajoutées depuis l'écran ou dont le NART / la quantité a été
 *          corrigé), groupées par emplacement. Sert à repérer les zones et les
 *          emplacements qui posent problème : beaucoup de reprises manuelles
 *          sur une zone, c'est un comptage à refaire ou un rayon mal tenu.
 * @route   GET /api/bipages/:entrepriseId/stats-zones
 * @access  Private (module bipage, read)
 */
const getStatsZonesRetouchees = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const session = await InventaireZoneSession.findOne({
    entreprise: entreprise._id,
    statut: "actif",
  });
  if (!session) {
    return res.json({ active: false, emplacements: [], totaux: null });
  }

  // Les anciennes lignes n'ont pas de `zoneType` : sans ce rattrapage elles
  // tomberaient toutes dans un emplacement vide et fausseraient le classement.
  await backfillZoneType(session);

  const lignes = await LigneBipage.aggregate([
    { $match: { session: session._id } },
    {
      $group: {
        _id: { type: "$zoneType", code: "$zoneCode" },
        lignes: { $sum: 1 },
        ajoutees: {
          $sum: { $cond: [{ $eq: ["$source", "manuel"] }, 1, 0] },
        },
        modifiees: {
          $sum: { $cond: [{ $eq: ["$modifie", true] }, 1, 0] },
        },
        // ⚠️ Compté à part, et NON comme ajoutees + modifiees : une ligne
        // ajoutée puis corrigée serait sinon comptée deux fois et la zone
        // remonterait artificiellement dans le classement.
        touchees: {
          $sum: {
            $cond: [
              {
                $or: [
                  { $eq: ["$source", "manuel"] },
                  { $eq: ["$modifie", true] },
                ],
              },
              1,
              0,
            ],
          },
        },
      },
    },
  ]);

  // Libellé de zone : pris dans le snapshot de session, sur le couple
  // code + emplacement — un même code existe en MAGASIN ET en DOCK.
  const libelles = new Map(
    (session.zones || []).map((z) => [
      `${z.code}|${String(z.type || "").trim()}`,
      z.libelle || "",
    ]),
  );

  const parEmplacement = new Map();
  for (const l of lignes) {
    const code = l._id.code || "";
    if (!code) continue;
    const type = String(l._id.type || "").trim() || "Sans emplacement";
    if (!parEmplacement.has(type)) {
      parEmplacement.set(type, {
        emplacement: type,
        zones: [],
        lignes: 0,
        ajoutees: 0,
        modifiees: 0,
        touchees: 0,
      });
    }
    const bloc = parEmplacement.get(type);
    bloc.zones.push({
      code,
      libelle: libelles.get(`${code}|${l._id.type || ""}`) || "",
      lignes: l.lignes,
      ajoutees: l.ajoutees,
      modifiees: l.modifiees,
      touchees: l.touchees,
      // La PART compte autant que le nombre : 3 reprises sur 5 lignes est plus
      // inquiétant que 3 sur 500.
      pct: l.lignes ? Math.round((l.touchees / l.lignes) * 100) : 0,
    });
    bloc.lignes += l.lignes;
    bloc.ajoutees += l.ajoutees;
    bloc.modifiees += l.modifiees;
    bloc.touchees += l.touchees;
  }

  // Les zones SANS aucune reprise ne sont pas du bruit utile ici : l'écran
  // cherche les zones à problème. On les compte, on ne les liste pas.
  const emplacements = [...parEmplacement.values()]
    .map((b) => ({
      ...b,
      nbZones: b.zones.length,
      nbZonesTouchees: b.zones.filter((z) => z.touchees > 0).length,
      zones: b.zones
        .filter((z) => z.touchees > 0)
        .sort((a, c) => c.touchees - a.touchees || c.pct - a.pct),
    }))
    .sort((a, b) => b.touchees - a.touchees);

  res.json({
    active: true,
    session: { _id: session._id, nom: session.nom },
    emplacements,
    totaux: {
      lignes: emplacements.reduce((t, e) => t + e.lignes, 0),
      ajoutees: emplacements.reduce((t, e) => t + e.ajoutees, 0),
      modifiees: emplacements.reduce((t, e) => t + e.modifiees, 0),
      touchees: emplacements.reduce((t, e) => t + e.touchees, 0),
    },
  });
});

export {
  getBipages,
  getStatsZonesRetouchees,
  exportEcartsBipage,
  updateBipage,
  ajouterLigneBipage,
  exportCsv,
  recommencerZone,
  listProformasBipage,
  apercuImportProformas,
  importProformasBipage,
  modeleExcelBipage,
  importExcelBipage,
};
