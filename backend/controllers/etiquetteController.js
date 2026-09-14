// backend/controllers/etiquetteController.js
import os from "os";
import path from "path";
import fs from "fs";
import asyncHandler from "../middleware/asyncHandler.js";
import proformaCacheService from "../services/proformaCacheService.js";
import commandeCacheService from "../services/commandeService.js";
import articleCacheService, { CODE_VIDE } from "../services/articleService.js";
import {
  genererEtiquettesPDF,
  genererEtiquettesCustomPDF,
  TYPES_ETIQUETTES,
} from "../services/etiquetteService.js";

const safeTrim = (v) => (v == null ? "" : String(v)).trim();

// Separateurs acceptes quand une liste de codes arrive en une seule chaine.
const SEPARATEUR_CODES = /[\n,;]+/;

// Le code reserve des articles SANS groupe / SANS gisement s'affiche « VIDE »
// partout ou l'utilisateur le lit (titre de section, message d'erreur).
const libelleCode = (code) => (code === CODE_VIDE ? "VIDE" : code);
const toNum = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

// Nombre d'étiquettes à tirer pour une ligne de proforma (décision client du
// 15/09/2026 : une étiquette PAR UNITÉ commandée, la proforma sert à étiqueter
// un arrivage avant mise en rayon).
//
// ⚠️ `prodet.QTE` est un N(x.3) : beaucoup d'articles se vendent au mètre. On
// arrondit ICI, et ICI SEULEMENT, parce qu'on compte des étiquettes (un objet
// physique, forcément entier) — jamais la quantité affichée ou exportée.
// Une ligne à 0 (ou négative : retour, ligne de commentaire chiffrée) donne
// quand même UNE étiquette : l'article figure au document.
const nbEtiquettesLigne = (qte) => {
  const n = Math.round(toNum(qte));
  return n > 1 ? n : 1;
};

// Garde-fou anti-PDF géant : 20 étiquettes par feuille A4, donc 2 000 =
// 100 feuilles. Au-delà on refuse explicitement plutôt que de tronquer en
// silence (l'utilisateur croirait avoir tout imprimé).
const MAX_ETIQUETTES_PROFORMA = 2000;

// Résout une liste ORDONNÉE de NART selon le mode, puis charge les articles.
// Partagé par les types classiques ET le type « custom » avec données.
// Lève des erreurs HTTP via res.status (comportement identique à l'ancien code).
const resolveArticles = async (req, res, entreprise, mode) => {
  let nartList = [];
  // Renseigné par les modes gisement / groupe / proforma : [{ titre, code, narts }].
  let sections = null;
  if (mode === "proforma") {
    const numfact = safeTrim(req.body.numfact);
    if (!numfact) {
      res.status(400);
      throw new Error("N° de proforma requis");
    }
    const cache = await proformaCacheService.getProformas(entreprise);
    const rows = (cache.prodetByNumfact.get(numfact) || []).slice();
    rows.sort((a, b) => toNum(a.NL) - toNum(b.NL));

    // Autant d'étiquettes par référence que la QTE de la proforma : la même
    // NART est répétée, elle ne sera résolue qu'une seule fois plus bas.
    nartList = [];
    for (const r of rows) {
      const nart = safeTrim(r.NART);
      // Lignes de commentaire de la proforma (NART vide ou contenant « ! »,
      // même règle que proformaCacheService.isCommentLine) : rien à étiqueter.
      if (!nart || nart.includes("!")) continue;
      const n = nbEtiquettesLigne(r.QTE);
      for (let i = 0; i < n; i++) nartList.push(nart);
    }
    if (nartList.length === 0) {
      res.status(404);
      throw new Error(`Aucun article pour la proforma ${numfact}`);
    }
    if (nartList.length > MAX_ETIQUETTES_PROFORMA) {
      res.status(400);
      throw new Error(
        `La proforma ${numfact} demande ${nartList.length} étiquettes ` +
          `(limite : ${MAX_ETIQUETTES_PROFORMA}). Imprimez-la en plusieurs fois ` +
          `ou passez par la liste de NART.`,
      );
    }

    // L'observation de la proforma joue le rôle du code de gisement / groupe :
    // titre en haut à droite de chaque feuille ET marque verticale en marge de
    // chaque rangée, pour que les bandes découpées restent identifiables.
    //
    // ⚠️ L'observation est `proforma.TEXTE` : **il n'existe aucun champ OBSERV
    // dans proforma.dbf** (NUMFACT, DATFACT, TIERS, NOM, TEXTE, REPRES,
    // MONTANT, DATCHANT, MAILING1-5, ETAT — vérifié sur le DBF de QC). C'est
    // déjà TEXTE que lisent l'import des proformas « reappro » et le bloc
    // « Texte / Objet » de l'écran Proformas.
    //
    // Observation vide ⇒ AUCUN titre (comportement d'avant) : on n'écrit pas
    // le numéro de proforma à la place, l'utilisateur veut son observation ou
    // rien.
    const idxEntete = cache.indexByNumfact.get(numfact);
    const entete =
      idxEntete === undefined ? null : cache.proformaRecords[idxEntete];
    const observation = safeTrim(entete && entete.TEXTE);
    if (observation) {
      sections = [
        { titre: observation, code: observation, narts: nartList.slice() },
      ];
    }
  } else if (mode === "commande") {
    const numcde = safeTrim(req.body.numcde);
    if (!numcde) {
      res.status(400);
      throw new Error("N° de commande requis");
    }
    const lignes = await commandeCacheService.getDetailsByNumcde(entreprise, numcde);
    nartList = lignes.map((l) => safeTrim(l.NART)).filter(Boolean);
    if (nartList.length === 0) {
      res.status(404);
      throw new Error(`Aucun article pour la commande ${numcde}`);
    }
  } else if (mode === "nart") {
    const { narts } = req.body;
    if (Array.isArray(narts)) {
      nartList = narts.map((n) => safeTrim(n)).filter(Boolean);
    } else if (typeof narts === "string") {
      nartList = narts.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);
    }
    if (nartList.length === 0) {
      res.status(400);
      throw new Error("Aucun NART fourni");
    }
  } else if (mode === "gism1" || mode === "groupe") {
    // Gisement / groupe : on recupere les articles DEJA REGROUPES par code, pour
    // que le PDF puisse commencer une feuille a chaque changement (voir
    // etiquetteService.drawStandard). L'ordre des sections suit celui des codes
    // coches dans l'ecran.
    const estGism = mode === "gism1";
    const brut = estGism ? req.body.gism1 : req.body.groupe;
    let codes = [];
    if (Array.isArray(brut)) codes = brut.map((c) => safeTrim(c)).filter(Boolean);
    else if (typeof brut === "string")
      codes = brut.split(SEPARATEUR_CODES).map((c) => c.trim()).filter(Boolean);
    if (codes.length === 0) {
      res.status(400);
      throw new Error(estGism ? "Aucun GISM1 fourni" : "Aucun groupe fourni");
    }

    const paquets = estGism
      ? await articleCacheService.findArticlesGroupesParGism1(entreprise, codes)
      : await articleCacheService.findArticlesGroupesParGroupe(entreprise, codes);

    // ⚠️ Le CODE SEUL, jamais précédé de « GISEMENT » / « GROUPE » (décision
    // client du 09/09/2026) : toute la feuille vient du même regroupement, le
    // mot n'apprend rien et mange la place — en haut de page comme en bout de
    // rangée, où la marge est comptée.
    sections = paquets.map((paquet) => ({
      titre: libelleCode(paquet.code),
      code: libelleCode(paquet.code),
      narts: paquet.articles.map((a) => safeTrim(a.NART)).filter(Boolean),
    }));
    nartList = sections.flatMap((sec) => sec.narts);

    if (nartList.length === 0) {
      res.status(404);
      throw new Error(
        `Aucun article pour le(s) ${estGism ? "gisement(s)" : "groupe(s)"} : ` +
          codes.map(libelleCode).join(", "),
      );
    }
  } else {
    res.status(400);
    throw new Error(
      'Mode invalide (attendu "proforma", "commande", "nart", "gism1" ou "groupe")',
    );
  }

  const articles = [];
  const introuvables = [];
  // Un NART peut revenir plusieurs fois (quantités d'une proforma, liste saisie
  // avec doublons) : on ne le résout qu'UNE fois, et on ne le compte qu'une
  // fois dans les introuvables.
  const resolus = new Map();
  for (const nart of nartList) {
    if (!resolus.has(nart)) {
      let art = null;
      try {
        art = await articleCacheService.findByNart(entreprise, nart);
      } catch {
        art = null;
      }
      resolus.set(nart, art);
      if (!art) introuvables.push(nart);
    }
    const art = resolus.get(nart);
    if (art) articles.push(art);
  }
  if (articles.length === 0) {
    res.status(404);
    throw new Error("Aucun article trouvé pour les NART fournis");
  }

  // Les sections sont exprimees en NART : on les rattache aux articles charges,
  // en ignorant les introuvables (un article peut avoir disparu du catalogue
  // entre la lecture de l'index et le chargement).
  let sectionsArticles = null;
  if (sections) {
    const parNart = new Map(articles.map((a) => [safeTrim(a.NART), a]));
    sectionsArticles = sections
      .map((sec) => ({
        titre: sec.titre,
        code: sec.code || "",
        articles: sec.narts.map((n) => parNart.get(n)).filter(Boolean),
      }))
      .filter((sec) => sec.articles.length > 0);
  }

  return { nartList, articles, introuvables, sections: sectionsArticles };
};

// Stream un PDF déjà écrit sur disque puis le supprime.
const streamAndCleanup = (res, tmp, filename, headers = {}) => {
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  const stream = fs.createReadStream(tmp);
  const cleanup = () => {
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  };
  stream.on("close", cleanup);
  stream.on("error", cleanup);
  stream.pipe(res);
};

/**
 * @desc    Génère un PDF d'étiquettes (proforma, commande, NART, GISM1, groupe
 *          ou étiquette PERSONNALISÉE — avec ou sans données article).
 * @route   POST /api/etiquettes/:nomDossierDBF/generer
 * @access  Private (module etiquettes, read) — entreprise via :nomDossierDBF
 */
const genererEtiquettes = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise; // injecté par checkEntrepriseAccess
  const { type, mode } = req.body;
  const format = req.body.format === "demi" ? "demi" : "a4";

  if (!TYPES_ETIQUETTES.includes(type)) {
    res.status(400);
    throw new Error(
      `Type d'étiquette invalide. Attendu : ${TYPES_ETIQUETTES.join(", ")}`,
    );
  }

  // ── Étiquette PERSONNALISÉE : layout libre, avec ou sans données article. ──
  if (type === "custom") {
    const layout = req.body.layout || {};
    if (
      !Array.isArray(layout.elements) ||
      !(Number(layout.widthPx) > 0) ||
      !(Number(layout.heightPx) > 0)
    ) {
      res.status(400);
      throw new Error("Étiquette personnalisée invalide (taille/éléments).");
    }

    let articles = null;
    let introuvables = [];
    let nartList = [];
    if (mode === "import") {
      // Données libres importées (Excel/CSV sans en-tête) : 1 étiquette par ligne.
      // Chaque ligne = tableau de colonnes lisibles via le champ `imp<N>`.
      const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
      const clean = rows
        .map((r) => (Array.isArray(r) ? r : [r]).map((c) => (c == null ? "" : String(c))))
        .filter((r) => r.some((c) => c.trim() !== ""))
        .slice(0, 20000); // garde-fou anti-PDF géant
      if (clean.length === 0) {
        res.status(400);
        throw new Error("Aucune ligne exploitable dans le fichier importé.");
      }
      articles = clean.map((cols) => ({ __cols: cols }));
      nartList = articles;
    } else if (mode && mode !== "aucun") {
      const r = await resolveArticles(req, res, entreprise, mode);
      articles = r.articles;
      introuvables = r.introuvables;
      nartList = r.nartList;
    }

    const tmp = path.join(os.tmpdir(), `etiquettes_custom_${Date.now()}.pdf`);
    await genererEtiquettesCustomPDF({
      layout,
      copies: req.body.copies,
      articles,
      entreprise,
      outPath: tmp,
    });
    return streamAndCleanup(res, tmp, "etiquettes_custom.pdf", {
      "X-Articles-Total": String(nartList.length),
      "X-Articles-Trouves": String(articles ? articles.length : 0),
      "X-Articles-Introuvables": String(introuvables.length),
    });
  }

  // ── Types classiques (données article obligatoires). ──
  const { articles, introuvables, nartList, sections } = await resolveArticles(
    req,
    res,
    entreprise,
    mode,
  );

  const tmp = path.join(os.tmpdir(), `etiquettes_${type}_${Date.now()}.pdf`);
  await genererEtiquettesPDF({
    type,
    format,
    articles,
    sections,
    entreprise,
    outPath: tmp,
  });

  return streamAndCleanup(res, tmp, `etiquettes_${type}.pdf`, {
    "X-Articles-Total": String(nartList.length),
    "X-Articles-Trouves": String(articles.length),
    "X-Articles-Introuvables": String(introuvables.length),
  });
});

export { genererEtiquettes };
