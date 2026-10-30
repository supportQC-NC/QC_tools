// backend/controllers/bipageController.js
import fs from "fs";
import path from "path";
import asyncHandler from "../middleware/asyncHandler.js";
import LigneBipage from "../models/LigneBipageModel.js";
import InventaireZoneSession from "../models/InventaireZoneSessionModel.js";
import FicheControle from "../models/FicheControleModel.js";
import InventaireStockSnapshot, {
  TAILLE_BLOC_SNAPSHOT,
} from "../models/InventaireStockSnapshotModel.js";
import articleCacheService from "../services/articleService.js";
import {
  config,
  getInventaireDirs,
  emplacementDir,
  sanitizeName,
} from "../services/ficheControleService.js";
import { fmtQteDat } from "../utils/qteDat.js";
import { ZipArchive } from "archiver";
import { deposerFichierInventaireFtp } from "../services/inventaireFtpService.js";
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
  detailsProformas,
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
  let lignes = await LigneBipage.find(filter)
    .sort({ zoneType: 1, zoneCode: 1, datFileName: 1, ordre: 1 })
    .limit(5000)
    .lean();

  // Filtre SUR-COMPTAGE (?surstock=1) : ne garder que les lignes des articles
  // dont la somme bipée sur TOUTE la session (toutes zones confondues — un
  // article compté dans 3 rayons se cumule) dépasse le stock théorique.
  // Stock théorique = la photo du stock figé quand elle existe, sinon le
  // stock réel du cache — même référence que la feuille d'écarts.
  if (req.query.surstock === "1" && lignes.length) {
    const toutes = await LigneBipage.find({ session: session._id })
      .select("nart eanArticle qteScan")
      .lean();
    const sommes = new Map();
    for (const l of toutes) {
      const cle = String(l.nart || l.eanArticle || "").trim().toUpperCase();
      if (!cle) continue;
      sommes.set(cle, (sommes.get(cle) || 0) + (Number(l.qteScan) || 0));
    }

    const fige = await chargerStockFige(session);
    let acache = null;
    if (!fige) {
      await articleCacheService.preload(entreprise).catch(() => {});
      acache = await articleCacheService.getArticles(entreprise);
    }
    const stockDe = (cle) => {
      if (fige) return fige.get(cle) ?? 0;
      const idx = articleCacheService.lookupNart(acache, cle);
      return idx !== undefined
        ? articleCacheService.calculateStockTotal(acache.records[idx])
        : 0; // article inconnu : tout comptage est un sur-comptage
    };

    const enSurstock = new Set();
    for (const [cle, somme] of sommes) {
      if (somme > stockDe(cle)) enSurstock.add(cle);
    }
    lignes = lignes.filter((l) =>
      enSurstock.has(String(l.nart || l.eanArticle || "").trim().toUpperCase()),
    );
  }

  // Rattrapage des lignes bipées AVANT l'ajout du champ `gencod` : on le
  // résout depuis le cache articles pour l'affichage, sans réécrire en base
  // (une lecture ne doit pas écrire). Les lignes créées depuis le portent.
  await completerGencod(entreprise, lignes);

  const { zonesMeta, types } = await buildZonesMeta(session);

  res.json({
    active: true,
    session: {
      _id: session._id,
      nom: session.nom,
      // État du stock figé : pilote le bouton Figer/Défiger de l'écran.
      stockFige: session.stockFige || { actif: false },
    },
    // Noms des entrepôts S1..S5 (fiche société, onglet Entrepôts) : l'écran
    // affiche ces noms partout plutôt que les codes bruts.
    nomsEntrepots: entreprise.mappingEntrepots || {},
    zones: zonesMeta.map((z) => z.code), // rétro-compatibilité (liste de codes)
    zonesMeta, // [{ code, type }]
    types, // liste des types distincts présents
    lignes,
  });
});

/**
 * Charge la PHOTO de stock d'une session (stock figé) sous forme de Map
 * NART (majuscules) -> stock photographié. Renvoie null si le stock n'est
 * pas figé. Un NART absent de la Map vaut stock 0 (seuls les stocks ≠ 0
 * sont photographiés).
 */
const chargerStockFige = async (session) => {
  if (!session?.stockFige?.actif) return null;
  const blocs = await InventaireStockSnapshot.find({ session: session._id })
    .sort({ ordre: 1 })
    .lean();
  const map = new Map();
  for (const bloc of blocs) {
    for (let i = 0; i < bloc.narts.length; i++) {
      map.set(bloc.narts[i], bloc.stocks[i]);
    }
  }
  return map;
};

/**
 * @desc    FIGER / DÉFIGER le stock de l'inventaire actif (demande client du
 *          29/10/2026). Figer photographie le stock total (S1..S5) de tous
 *          les articles à stock ≠ 0 : la feuille d'écarts compare ensuite les
 *          comptages à cette photo, pas au stock réel qui bouge (ventes,
 *          réceptions) pendant l'inventaire. Défiger supprime la photo et
 *          repasse sur le stock réel ; refiger recrée une photo neuve.
 * @route   POST /api/bipages/:entrepriseId/stock-fige
 * @body    { actif: true | false }
 * @access  Private (module inventaire ou bipage, write)
 */
const setStockFige = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const session = await InventaireZoneSession.findOne({
    entreprise: entreprise._id,
    statut: "actif",
  });
  if (!session) {
    res.status(400);
    throw new Error("Aucun inventaire actif.");
  }

  const actif = req.body?.actif === true || req.body?.actif === "true";

  // Dans tous les cas on repart d'une photo vierge : défiger la supprime,
  // refiger la remplace (jamais de photo périmée qui traîne).
  await InventaireStockSnapshot.deleteMany({ session: session._id });

  let nbArticles = 0;
  let nbCatalogue = 0;
  if (actif) {
    await articleCacheService.preload(entreprise).catch(() => {});
    const acache = await articleCacheService.getArticles(entreprise);

    // Photo compacte : seulement les stocks ≠ 0 (négatifs compris — un stock
    // négatif est un écart réel à montrer). NART en MAJUSCULES, la clé de
    // recherche des écarts. Les articles à stock 0 sont couverts PAR
    // CONVENTION (absent de la photo = 0) : on compte quand même le catalogue
    // entier pour l'afficher à l'écran (périmètre réellement couvert).
    const narts = [];
    const stocks = [];
    for (const rec of acache.records) {
      const nart = String(rec.NART || "").trim().toUpperCase();
      if (!nart) continue;
      nbCatalogue += 1;
      const stock = articleCacheService.calculateStockTotal(rec);
      if (!stock) continue;
      narts.push(nart);
      stocks.push(stock);
    }
    nbArticles = narts.length;

    const blocs = [];
    for (let i = 0; i < narts.length; i += TAILLE_BLOC_SNAPSHOT) {
      blocs.push({
        entreprise: entreprise._id,
        session: session._id,
        ordre: blocs.length,
        narts: narts.slice(i, i + TAILLE_BLOC_SNAPSHOT),
        stocks: stocks.slice(i, i + TAILLE_BLOC_SNAPSHOT),
      });
    }
    if (blocs.length) await InventaireStockSnapshot.insertMany(blocs);
  }

  session.stockFige = {
    actif,
    at: actif ? new Date() : null,
    par: actif ? req.user._id : null,
    nbArticles,
    nbCatalogue,
  };
  await session.save();

  res.json({
    message: actif
      ? `Stock figé : ${nbArticles} articles photographiés.`
      : "Stock défigé : les écarts repartent du stock réel.",
    stockFige: session.stockFige,
  });
});

/**
 * @desc    FICHIERS .DAT D'INTÉGRATION Stock XL de l'inventaire : UN fichier
 *          par DÉPÔT (S1..S5), construit depuis TOUS les bipages de la session
 *          active. Un article compté dans plusieurs rayons d'un même
 *          emplacement est SOMMÉ : une seule ligne par article et par dépôt.
 *
 *          `mapping` associe chaque emplacement (zoneType : MAGASIN, DOCK…) au
 *          dépôt Stock XL où intégrer son comptage — "MAGASIN:S1,DOCK:S2"
 *          (défauts : MAGASIN→S1, DOCK→S2, autres→S1). Deux emplacements
 *          mappés sur le même dépôt sont fusionnés dans le même fichier.
 *
 *          Nom des fichiers : `stock.dat <DÉPÔT>_inventaire_<AAAA-MM-JJ>`.
 *          Réponse : un ZIP téléchargé par le navigateur (les fichiers ne sont
 *          PAS posés dans le dossier d'inventaire du partage, que le watcher
 *          prendrait pour des dépôts de zone) + copie miroir best-effort sur
 *          le FTP (inventaire/<TRIG>/<slug>/integration/).
 * @route   GET /api/bipages/:entrepriseId/integration-dat?mapping=MAGASIN:S1,DOCK:S2
 * @access  Private (module inventaire ou bipage, read)
 */
const DEPOTS_STOCK = ["S1", "S2", "S3", "S4", "S5"];

/**
 * @desc    EMPLACEMENTS SPÉCIAUX S3/S4/S5 d'une société : au-delà de
 *          MAGASIN (S1) et DOCK (S2), certains dépôts sont inventoriés via
 *          des proformas. On ne les propose à l'import QUE s'ils existent
 *          dans la fiche article : du stock Sx quelque part, ou un gisement
 *          GISMx réellement renseigné (les « ÄÄÄÄÄÄ » de remplissage DOS ne
 *          comptent pas). Leur NOM vient de la fiche société (onglet
 *          Entrepôts, `mappingEntrepots`).
 * @route   GET /api/bipages/:entrepriseId/emplacements-speciaux
 * @access  Private (module inventaire ou bipage, read)
 */
const getEmplacementsSpeciaux = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;

  await articleCacheService.preload(entreprise).catch(() => {});
  const acache = await articleCacheService.getArticles(entreprise);

  // Une « vraie » valeur de gisement contient au moins un caractère
  // alphanumérique ASCII (écarte les remplissages DOS type « ÄÄÄÄÄÄ »).
  const gisementReel = (v) => /[A-Za-z0-9]/.test(String(v || ""));

  const compte = {
    S3: { stock: 0, gism: 0 },
    S4: { stock: 0, gism: 0 },
    S5: { stock: 0, gism: 0 },
  };
  for (const rec of acache.records) {
    for (const d of ["S3", "S4", "S5"]) {
      if (Number(rec[d]) !== 0 && Number.isFinite(Number(rec[d]))) {
        compte[d].stock += 1;
      }
      if (gisementReel(rec[`GISM${d[1]}`])) compte[d].gism += 1;
    }
  }

  // TOUJOURS proposés, même sans stock ni gisement (décision client
  // 29/10/2026) : un entrepôt qu'on inventorie par proforma peut être à zéro
  // dans l'ERP tant que rien n'a été intégré — le masquer empêcherait
  // justement sa première intégration. Les compteurs restent informatifs.
  const noms = entreprise.mappingEntrepots || {};
  const emplacements = ["S3", "S4", "S5"].map((d) => ({
    key: d,
    nom: String(noms[d] || d).trim() || d,
    articlesEnStock: compte[d].stock,
    articlesAvecGisement: compte[d].gism,
  }));

  res.json({ emplacements });
});

// Champ gisement de la fiche article correspondant à chaque emplacement.
const CHAMP_GISM_PAR_EMPLACEMENT = {
  MAGASIN: "GISM1",
  DOCK: "GISM2",
  S3: "GISM3",
  S4: "GISM4",
  S5: "GISM5",
};

/**
 * @desc    GISEMENTS D'UN EMPLACEMENT, lus dans la FICHE ARTICLE : tous les
 *          codes distincts du champ GISMx correspondant (GISM1 pour MAGASIN,
 *          GISM2 pour DOCK, GISM3/4/5 pour S3/S4/S5), avec le nombre
 *          d'articles. C'est la liste des zones proposées à l'import de
 *          proformas — indépendante du référentiel de zones ET du bipage :
 *          un gisement jamais bipé reste sélectionnable.
 * @route   GET /api/bipages/:entrepriseId/gisements-emplacement?emplacement=MAGASIN
 * @access  Private (module inventaire ou bipage, read)
 */
const getGisementsEmplacement = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const empl = String(req.query.emplacement || "").trim().toUpperCase();
  const champ = CHAMP_GISM_PAR_EMPLACEMENT[empl];
  if (!champ) {
    res.status(400);
    throw new Error("Emplacement inconnu (MAGASIN, DOCK, S3, S4 ou S5).");
  }

  await articleCacheService.preload(entreprise).catch(() => {});
  const acache = await articleCacheService.getArticles(entreprise);

  // Un gisement « réel » contient au moins un alphanumérique ASCII (écarte
  // les remplissages DOS « ÄÄÄÄÄÄ » présents dans GISM3-5).
  const parCode = new Map();
  for (const rec of acache.records) {
    const brut = String(rec[champ] || "").trim();
    if (!/[A-Za-z0-9]/.test(brut)) continue;
    const cle = brut.toUpperCase();
    const cur = parCode.get(cle) || { code: brut, nbArticles: 0 };
    cur.nbArticles += 1;
    parCode.set(cle, cur);
  }
  const gisements = [...parCode.values()].sort((a, b) =>
    a.code.localeCompare(b.code, "fr", { numeric: true }),
  );

  res.json({ emplacement: empl, champ, gisements });
});

const genererDatIntegration = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const session = await InventaireZoneSession.findOne({
    entreprise: entreprise._id,
    statut: "actif",
  });
  if (!session) {
    res.status(400);
    throw new Error("Aucun inventaire actif.");
  }

  // Mapping emplacement -> dépôt, saisi à l'écran (défauts métier : le rayon
  // MAGASIN vit en S1, la réserve DOCK en S2 — GISM1/GISM2).
  const mapping = new Map();
  for (const part of String(req.query.mapping || "").split(",")) {
    const [empl, depot] = part.split(":").map((s) => String(s || "").trim());
    if (empl && DEPOTS_STOCK.includes(depot)) {
      mapping.set(empl.toUpperCase(), depot);
    }
  }
  const depotDe = (zoneType) => {
    // Type vide = « sans emplacement » : même clé que l'écran.
    const t = String(zoneType || "").trim().toUpperCase() || "SANS_EMPLACEMENT";
    if (mapping.has(t)) return mapping.get(t);
    if (t === "MAGASIN") return "S1";
    if (t === "DOCK") return "S2";
    // Emplacements spéciaux (zones importées par proforma sur S3/S4/S5) :
    // chacun part dans SON dépôt — un fichier .dat par emplacement.
    if (DEPOTS_STOCK.includes(t)) return t;
    return "S1";
  };

  const toutes = await LigneBipage.find({ session: session._id })
    .select("nart eanArticle qteScan zoneType")
    .lean();
  if (!toutes.length) {
    res.status(400);
    throw new Error("Aucun bipage dans l'inventaire actif.");
  }

  // Cumul par dépôt puis par article (clé NART résolu, repli code scanné —
  // même convention que la feuille d'écarts).
  const parDepot = new Map();
  for (const l of toutes) {
    const code = String(l.nart || l.eanArticle || "").trim();
    if (!code) continue;
    const depot = depotDe(l.zoneType);
    let articles = parDepot.get(depot);
    if (!articles) {
      articles = new Map();
      parDepot.set(depot, articles);
    }
    const cle = code.toUpperCase();
    const cur = articles.get(cle) || { code, qte: 0 };
    cur.qte = Math.round((cur.qte + (Number(l.qteScan) || 0)) * 1000) / 1000;
    articles.set(cle, cur);
  }

  const dateJour = new Date().toISOString().slice(0, 10); // AAAA-MM-JJ
  const fichiers = [...parDepot.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([depot, articles]) => {
      let contenu = "";
      for (const { code, qte } of [...articles.values()].sort((a, b) =>
        a.code.localeCompare(b.code),
      )) {
        contenu += `${code.padEnd(13, " ")}|${fmtQteDat(qte)}|000\r\n`;
      }
      return {
        nom: `stock.dat ${depot}_inventaire_${dateJour}`,
        contenu: Buffer.from(contenu, "utf8"),
        lignes: articles.size,
      };
    });

  // Copie miroir FTP (référence), SANS attendre — jamais bloquant.
  const slugFtp = session.dossierSlug || session.nom;
  if (slugFtp) {
    for (const f of fichiers) {
      void deposerFichierInventaireFtp(
        entreprise.trigramme,
        slugFtp,
        "integration",
        f.nom,
        f.contenu,
      );
    }
  }

  const nomZip = `${sanitizeName(`integration_inventaire_${entreprise.trigramme || ""}_${dateJour}`)}.zip`;
  res.setHeader("Content-Type", "application/zip");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${encodeURIComponent(nomZip)}"`,
  );
  const archive = new ZipArchive({ zlib: { level: 6 } });
  archive.on("error", (err) => {
    console.error(`[Bipage] ZIP intégration : ${err.message}`);
    res.destroy(err);
  });
  archive.pipe(res);
  for (const f of fichiers) archive.append(f.contenu, { name: f.nom });
  await archive.finalize();
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

  // STOCK FIGÉ : quand une photo existe, le stock théorique vient d'elle et
  // non du DBF réel (qui bouge pendant l'inventaire). Les métadonnées article
  // (désignation, fournisseur, prix de revient) restent lues en direct.
  const fige = await chargerStockFige(session);

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
      stock: fige
        ? fige.get(nart.toUpperCase()) ?? 0
        : articleCacheService.calculateStockTotal(rec),
      prev: num(rec.PREV),
      qte: 0,
      nonTrouve: false,
    });
  };

  if (toutLeStock) {
    if (fige) {
      // Périmètre « stock » figé = les articles qui avaient du stock AU MOMENT
      // de la photo (pas la liste réelle du cache : un article vendu depuis en
      // sortirait, un arrivage y entrerait — exactement ce qu'on fige).
      for (const nartFige of fige.keys()) {
        const idx = articleCacheService.lookupNart(acache, nartFige);
        if (idx !== undefined) ajouterArticle(acache.records[idx]);
        else
          univers.set(nartFige, {
            nart: nartFige,
            design: "(article disparu du fichier)",
            refer: "",
            gencod: "",
            fourn: "",
            stock: fige.get(nartFige) ?? 0,
            prev: 0,
            qte: 0,
            nonTrouve: true,
          });
      }
    } else {
      for (const idx of acache.articlesEnStock)
        ajouterArticle(acache.records[idx]);
    }
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

  // Marquage « déjà importée » (demande client du 30/10/2026) : les lignes de
  // bipage de l'inventaire ACTIF portent source="proforma" + sourceRef=NUMFACT,
  // on en déduit les proformas déjà intégrées — sans rien stocker de plus.
  // « Recommencer » une zone ou réinitialiser l'inventaire les supprime, et la
  // proforma redevient naturellement importable.
  const session = await InventaireZoneSession.findOne({
    entreprise: req.entreprise._id,
    statut: "actif",
  }).select("_id");
  const importees = new Map(); // numfact -> { zones: [...], at }
  if (session) {
    const aggs = await LigneBipage.aggregate([
      { $match: { session: session._id, source: "proforma" } },
      {
        $group: {
          _id: "$sourceRef",
          zones: {
            $addToSet: {
              code: "$zoneCode",
              type: "$zoneType",
              mode: "$modeImport",
            },
          },
          at: { $max: "$createdAt" },
        },
      },
    ]);
    for (const a of aggs) {
      importees.set(String(a._id), { zones: a.zones || [], at: a.at || null });
    }
  }
  const proformas = data.proformas.map((p) => ({
    ...p,
    dejaImportee: importees.get(p.numfact) || null,
  }));

  // Onglet « Déjà importées » : TOUT ce qui a été intégré sur l'inventaire,
  // même hors du filtre dates/clients courant (filtre modifié après coup) —
  // sinon une proforma intégrée peut devenir invisible partout.
  const parNumfact = new Map(proformas.map((p) => [p.numfact, p]));
  const horsFiltre = [...importees.keys()].filter((n) => !parNumfact.has(n));
  const complements = await detailsProformas(req.entreprise, horsFiltre);
  const proformasImportees = [...importees.entries()]
    .map(([numfact, marque]) => ({
      ...(parNumfact.get(numfact) ||
        complements.get(numfact) || { numfact, eligible: false }),
      dejaImportee: marque,
    }))
    .sort((a, b) => new Date(b.dejaImportee.at || 0) - new Date(a.dejaImportee.at || 0));

  res.json({
    ...data,
    proformas,
    proformasImportees,
    nbImportees: proformasImportees.length,
  });
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

  // `tout=1` : le LISTING complet, toutes zones comprises, y compris celles
  // qui n'ont aucune reprise et celles qui n'ont même pas de ligne bipée.
  // Par défaut on ne renvoie que les zones à problème — c'est ce dont la carte
  // du tableau de bord a besoin, et lui envoyer les 622 zones à chaque
  // chargement serait du gâchis.
  const tout = req.query.tout === "1";

  // Ossature : TOUTES les zones du snapshot de session. On part de là plutôt
  // que du seul résultat d'agrégation, sinon une zone sans aucune ligne bipée
  // n'existerait pas dans le listing — or c'est justement une information.
  const parEmplacement = new Map();
  const zoneParCle = new Map();

  const bloc = (type) => {
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
    return parEmplacement.get(type);
  };

  for (const z of session.zones || []) {
    const code = z.code || "";
    if (!code) continue;
    const brut = String(z.type || "").trim();
    const type = brut || "Sans emplacement";
    const entree = {
      code,
      libelle: z.libelle || "",
      emplacement: type,
      lignes: 0,
      ajoutees: 0,
      modifiees: 0,
      touchees: 0,
      pct: 0,
    };
    bloc(type).zones.push(entree);
    // Clé sur le couple code + emplacement : un même code existe en MAGASIN
    // ET en DOCK, les confondre mélangerait deux comptages.
    zoneParCle.set(`${code}|${brut}`, entree);
  }

  for (const l of lignes) {
    const code = l._id.code || "";
    if (!code) continue;
    const brut = String(l._id.type || "").trim();
    const type = brut || "Sans emplacement";
    // Une ligne peut porter une zone absente du snapshot (zone supprimée des
    // fiches après coup) : on la rattache quand même, elle compte.
    let entree = zoneParCle.get(`${code}|${brut}`);
    if (!entree) {
      entree = {
        code,
        libelle: "",
        emplacement: type,
        lignes: 0,
        ajoutees: 0,
        modifiees: 0,
        touchees: 0,
        pct: 0,
      };
      bloc(type).zones.push(entree);
      zoneParCle.set(`${code}|${brut}`, entree);
    }
    entree.lignes = l.lignes;
    entree.ajoutees = l.ajoutees;
    entree.modifiees = l.modifiees;
    entree.touchees = l.touchees;
    // La PART compte autant que le nombre : 3 reprises sur 5 lignes est plus
    // inquiétant que 3 sur 500.
    entree.pct = l.lignes ? Math.round((l.touchees / l.lignes) * 100) : 0;

    const b2 = bloc(type);
    b2.lignes += l.lignes;
    b2.ajoutees += l.ajoutees;
    b2.modifiees += l.modifiees;
    b2.touchees += l.touchees;
  }

  // Tri : la plus retouchée d'abord, puis la part, puis le code — sans ce
  // dernier critère l'ordre des zones à égalité (toutes celles à zéro) serait
  // arbitraire et changerait d'un appel à l'autre.
  const parRetouches = (a, c) =>
    c.touchees - a.touchees ||
    c.pct - a.pct ||
    c.lignes - a.lignes ||
    a.code.localeCompare(c.code, "fr", { numeric: true });

  const emplacements = [...parEmplacement.values()]
    .map((b) => ({
      ...b,
      nbZones: b.zones.length,
      nbZonesComptees: b.zones.filter((z) => z.lignes > 0).length,
      nbZonesTouchees: b.zones.filter((z) => z.touchees > 0).length,
      zones: (tout ? b.zones : b.zones.filter((z) => z.touchees > 0)).sort(
        parRetouches,
      ),
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
  setStockFige,
  genererDatIntegration,
  getEmplacementsSpeciaux,
  getGisementsEmplacement,
  listProformasBipage,
  apercuImportProformas,
  importProformasBipage,
  modeleExcelBipage,
  importExcelBipage,
};
