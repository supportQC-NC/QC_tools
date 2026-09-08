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

// Résout une liste ORDONNÉE de NART selon le mode, puis charge les articles.
// Partagé par les types classiques ET le type « custom » avec données.
// Lève des erreurs HTTP via res.status (comportement identique à l'ancien code).
const resolveArticles = async (req, res, entreprise, mode) => {
  let nartList = [];
  // Renseigne uniquement par les modes gisement / groupe : [{ titre, narts }].
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
    nartList = rows.map((r) => safeTrim(r.NART)).filter(Boolean);
    if (nartList.length === 0) {
      res.status(404);
      throw new Error(`Aucun article pour la proforma ${numfact}`);
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

    sections = paquets.map((paquet) => ({
      titre: `${estGism ? "GISEMENT" : "GROUPE"} ${libelleCode(paquet.code)}`,
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
  for (const nart of nartList) {
    let art = null;
    try {
      art = await articleCacheService.findByNart(entreprise, nart);
    } catch {
      art = null;
    }
    if (art) articles.push(art);
    else introuvables.push(nart);
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
