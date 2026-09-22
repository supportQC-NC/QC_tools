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
  codeBarresImprimable,
  TYPES_ETIQUETTES,
} from "../services/etiquetteService.js";
import { generateQrGondolePDF } from "../services/gisementLabelService.js";
import {
  buildIndexRayons,
  lookupRayon,
} from "../services/dictionnaireRayonsService.js";
import { getGisements, lookupGisement } from "../services/gisementsService.js";
import { comparerCodeGisement } from "../services/preparationService.js";
import { construireClasseurComptageGisements } from "../services/gisementsComptageExcelService.js";
import { envoyerClasseur } from "../utils/envoyerClasseur.js";
import { champMasque } from "../middleware/masquerChampsDbf.js";

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

// ── Panneaux QR de gisement (affichage en gondole) ──────────────────────────
//
// MAGASIN -> un panneau par GISM1 (le rayon) ; DOCK -> un panneau par GISM2
// (la réserve). Ce sont bien DEUX jeux de codes distincts : chez QC, le même
// article est rangé en « D_2d » au magasin et en « H_1 » au dock.
//
// Le libellé vient du DICTIONNAIRE DES RAYONS, interrogé sur le couple
// « code + emplacement » — obligatoire : 53 codes existent aux deux
// emplacements et 34 y portent un libellé DIFFÉRENT (« A_1 » = Ventilateurs
// muraux au magasin, EPI GANTS au dock). Repli sur l'ancien fichier gisements
// (indexé par code seul) pour les sociétés sans dictionnaire, comme partout
// ailleurs dans l'application.
const NIVEAU_PAR_EMPLACEMENT = { MAGASIN: 1, DOCK: 2 };
const champDe = (emplacement) => `GISM${NIVEAU_PAR_EMPLACEMENT[emplacement]}`;

// Emplacements visés. « TOUS » = les deux (magasin puis dock), et la sélection
// de codes n'y a alors pas de sens : les deux niveaux n'ont pas les mêmes codes.
const lireEmplacements = (valeur) => {
  const demande = safeTrim(valeur).toUpperCase();
  if (demande === "TOUS") return { emplacements: ["MAGASIN", "DOCK"], tous: true };
  return {
    emplacements: [demande === "DOCK" ? "DOCK" : "MAGASIN"],
    tous: false,
  };
};

const lireCodes = (brut) => {
  let codes = [];
  if (Array.isArray(brut)) codes = brut.map((c) => safeTrim(c)).filter(Boolean);
  else if (typeof brut === "string")
    codes = brut.split(SEPARATEUR_CODES).map((c) => c.trim()).filter(Boolean);
  return [...new Set(codes)];
};

// Libellés des rayons : dictionnaire des rayons (couple code + emplacement),
// repli sur l'ancien fichier gisements pour les sociétés sans dictionnaire. Ni
// l'un ni l'autre n'est bloquant — un code sans libellé sort avec son code seul.
const chargerLibellesRayons = async (entreprise) => {
  const { index } = await buildIndexRayons(entreprise);
  let anciens = null;
  if (index.size === 0) {
    try {
      ({ map: anciens } = await getGisements(entreprise));
    } catch {
      anciens = null;
    }
  }
  return { index, anciens };
};

// Gisements d'UN emplacement, triés dans l'ordre naturel des codes, avec le
// libellé du rayon et le NOMBRE D'ARTICLES rangés dessus. `codesDemandes` vide
// = tous les codes du niveau.
//
// Source unique du PDF de panneaux ET de l'export Excel : les deux doivent
// toujours parler des mêmes gisements.
const gisementsEmplacement = async (
  entreprise,
  emplacement,
  codesDemandes,
  index,
  anciens,
) => {
  const tous = await articleCacheService.getGismLevel(
    entreprise,
    NIVEAU_PAR_EMPLACEMENT[emplacement],
  );
  const comptes = new Map(tous.map((g) => [g.code, g.count]));
  const codes = codesDemandes.length ? codesDemandes : tous.map((g) => g.code);

  return codes
    .slice()
    .sort(comparerCodeGisement)
    .map((code) => {
      const rayon = lookupRayon(index, code, emplacement);
      const ancien = rayon ? null : lookupGisement(anciens, code);
      return {
        code,
        libelle: (rayon && rayon.libelle) || (ancien && ancien.libelle) || "",
        // 0 = code saisi à la main que ne porte aucune fiche article.
        count: comptes.get(code) || 0,
      };
    });
};

// Résolution commune au PDF de panneaux et à l'export Excel.
// `partieNom` est la partie variable du nom de fichier (« magasin_GISM1 »,
// « dock_GISM2 », « tous_GISM1-GISM2 »).
const resoudreGisements = async (req, res, source) => {
  const entreprise = req.entreprise;
  const { emplacements, tous } = lireEmplacements(source.emplacement);
  const codes = tous ? [] : lireCodes(source.codes);
  const { index, anciens } = await chargerLibellesRayons(entreprise);

  const lots = [];
  for (const emplacement of emplacements) {
    // eslint-disable-next-line no-await-in-loop
    const lignes = await gisementsEmplacement(
      entreprise,
      emplacement,
      codes,
      index,
      anciens,
    );
    if (lignes.length === 0) continue; // niveau non renseigné dans ce catalogue
    lots.push({ emplacement, champ: champDe(emplacement), lignes });
  }

  if (lots.length === 0) {
    res.status(404);
    throw new Error(
      `Aucun gisement ${emplacements.map(champDe).join(" / ")} trouvé pour ` +
        `${entreprise.nomComplet || entreprise.nomDossierDBF}.`,
    );
  }

  return {
    lots,
    total: lots.reduce((n, l) => n + l.lignes.length, 0),
    partieNom: tous
      ? "tous_GISM1-GISM2"
      : `${emplacements[0].toLowerCase()}_${champDe(emplacements[0])}`,
    trig:
      safeTrim(entreprise.trigramme) ||
      safeTrim(entreprise.nomDossierDBF) ||
      "societe",
  };
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

  // ── Panneaux QR de GISEMENT : ni article, ni prix, ni code-barres. ────────
  // Traité AVANT tout le reste : ce type n'a pas de source d'articles, donc
  // ni `mode`, ni `format`, ni contrôle GENCOD ne s'y appliquent.
  if (type === "qr_gisement") {
    const { lots, total, partieNom, trig } = await resoudreGisements(
      req,
      res,
      req.body,
    );

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="qr_gisements_${partieNom}_${trig}.pdf"`,
    );
    res.setHeader("Access-Control-Expose-Headers", "X-Etiquettes");
    res.setHeader("X-Etiquettes", String(total));

    // Chaque section (emplacement) démarre sur une nouvelle feuille et porte
    // son pied de page : une fois les panneaux découpés, rien ne distinguerait
    // un code dock d'un code magasin (ils sont souvent identiques).
    await generateQrGondolePDF({
      sections: lots.map((lot) => ({
        piedDePage: `QR gisement · ${lot.emplacement} (${lot.champ}) · ${trig}`,
        items: lot.lignes,
      })),
      stream: res,
    });
    return;
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
    // Choix fait par l'utilisateur dans la fenêtre de contrôle (voir
    // controlerGencod), pour les articles sans GENCOD exploitable : « nart »
    // imprime le NART en gros dans la zone code-barres, « vide » n'imprime
    // AUCUN NART (petit NART du coin compris). Sans choix : comportement
    // historique.
    sansGencod:
      req.body.sansGencod === "nart" || req.body.sansGencod === "vide"
        ? req.body.sansGencod
        : "defaut",
  });

  return streamAndCleanup(res, tmp, `etiquettes_${type}.pdf`, {
    "X-Articles-Total": String(nartList.length),
    "X-Articles-Trouves": String(articles.length),
    "X-Articles-Introuvables": String(introuvables.length),
  });
});

/**
 * @desc    Contrôle AVANT génération : quels articles de la sélection n'ont pas
 *          de code-barres imprimable ? L'écran s'en sert pour demander à
 *          l'utilisateur, une seule fois et seulement si nécessaire, s'il veut
 *          voir le NART à la place ou laisser la zone vide.
 *
 *          Même corps de requête que /generer (mode + source) : la résolution
 *          des articles passe par le MÊME `resolveArticles`, sinon le contrôle
 *          et le PDF pourraient porter sur deux listes différentes.
 * @route   POST /api/etiquettes/:nomDossierDBF/controle-gencod
 * @access  Private (module etiquettes, read) — entreprise via :nomDossierDBF
 */
const controlerGencod = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const { mode } = req.body;

  // Le type « custom » avec données libres importées n'a pas d'article à
  // contrôler, et les modes sans source non plus.
  if (!mode || mode === "aucun" || mode === "import") {
    return res.json({ total: 0, nbSansGencod: 0, articles: [] });
  }

  const { articles } = await resolveArticles(req, res, entreprise, mode);

  // Dédoublonné par NART : une proforma répète la même référence autant de
  // fois que sa quantité, l'utilisateur n'a pas besoin de la lire 12 fois.
  const vus = new Set();
  const sans = [];
  for (const art of articles) {
    const nart = safeTrim(art.NART);
    if (vus.has(nart)) continue;
    vus.add(nart);
    if (!codeBarresImprimable(art)) {
      sans.push({
        NART: nart,
        DESIGN: safeTrim(art.DESIGN),
        GENCOD: safeTrim(art.GENCOD),
      });
    }
  }

  return res.json({
    total: articles.length,
    nbSansGencod: sans.length,
    // Liste bornée : au-delà l'écran affiche « … et N autres ».
    articles: sans.slice(0, 200),
  });
});

/**
 * @desc    Export Excel « gisements et nombre d'articles » : une ligne par
 *          gisement, le nombre d'articles rangés dessus, le libellé du rayon.
 *          MAGASIN (GISM1) et DOCK (GISM2) sur deux feuilles séparées ;
 *          `emplacement=TOUS` sort les deux.
 *
 *          Vit ici, et pas dans l'export gisements de l'admin, parce que c'est
 *          l'option « télécharger le comptage » du bloc QR gisement du
 *          générateur d'étiquettes : même résolution (`resoudreGisements`), donc
 *          l'Excel et les panneaux imprimés portent toujours sur les mêmes
 *          gisements.
 * @route   GET /api/etiquettes/:nomDossierDBF/gisements-excel?emplacement=MAGASIN|DOCK|TOUS
 * @access  Private (module etiquettes, read) — entreprise via :nomDossierDBF
 */
const exporterComptageGisements = asyncHandler(async (req, res) => {
  // Le gisement EST la donnée demandée : si `champsDbf` interdit GISM1/GISM2 à
  // cet utilisateur, envoyerClasseur retirerait la colonne et laisserait un
  // classeur de comptages anonymes. Autant le dire.
  const { emplacements } = lireEmplacements(req.query.emplacement);
  const interdits = emplacements.map(champDe).filter((c) => champMasque(req, c));
  if (interdits.length > 0) {
    res.status(403);
    throw new Error(
      `Le champ ${interdits.join(" / ")} vous est masqué : cet export n'aurait aucun contenu.`,
    );
  }

  const { lots, total, partieNom, trig } = await resoudreGisements(
    req,
    res,
    req.query,
  );

  const workbook = construireClasseurComptageGisements({
    trigramme: trig,
    sections: lots,
  });

  await envoyerClasseur(
    req,
    res,
    workbook,
    `gisements_nb_articles_${partieNom}_${trig}.xlsx`,
    { "X-Gisements": total },
  );
});

export { genererEtiquettes, controlerGencod, exporterComptageGisements };
