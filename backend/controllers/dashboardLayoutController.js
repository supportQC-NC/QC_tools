// backend/controllers/dashboardLayoutController.js
//
// Tableau de bord personnel : catalogue, disposition de l'utilisateur connecté
// et évaluation des tuiles KPI sur mesure.
//
//   GET  /api/dashboard-layout/catalogue  -> widgets + datasets AUTORISÉS
//   GET  /api/dashboard-layout/me         -> ma disposition (filtrée par droits)
//   PUT  /api/dashboard-layout/me         -> enregistre ma disposition
//   POST /api/dashboard-layout/evaluer    -> valeurs des tuiles KPI

import asyncHandler from "../middleware/asyncHandler.js";
import UserDashboardLayout from "../models/UserDashboardLayoutModel.js";
import {
  DASHBOARD_WIDGETS,
  WIDGET_BY_KEY,
  KPI_DATASETS,
  MESURES,
  OPERATEURS,
  TYPES_GRAPHIQUE,
  TRIS,
  LIMITE_MIN,
  LIMITE_MAX,
  LIGNES_MIN,
  LIGNES_MAX,
  COLONNES_MAX,
} from "../config/dashboardCatalogue.js";
import {
  aModule,
  evaluerKpi,
  validerKpi,
  evaluerGraphique,
  validerGraphique,
  evaluerTableau,
  validerTableau,
  champVisible,
} from "../services/dashboardKpiService.js";

const TAILLES = ["tiers", "moitie", "pleine"];

// Grille : 12 colonnes, hauteur en unités de 90 px.
const COLONNES_GRILLE = 12;
const H_MIN = 1;
const H_MAX = 12;

// Largeur par défaut d'un bloc, déduite de l'ancien réglage en trois crans.
const LARGEUR_DEPUIS_TAILLE = { tiers: 4, moitie: 6, pleine: 12 };

// Hauteur par défaut selon la nature du bloc.
const HAUTEUR_DEFAUT = { kpi: 2, graphique: 4, tableau: 5, widget: 4 };

const borner = (v, min, max, defaut) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return defaut;
  return Math.min(max, Math.max(min, Math.round(n)));
};

// Complète un bloc hérité (sans w/h) à partir de sa taille et de son type.
const completerGrille = (b) => ({
  ...b,
  w: borner(b.w, 1, COLONNES_GRILLE, LARGEUR_DEPUIS_TAILLE[b.taille] ?? 4),
  h: borner(b.h, H_MIN, H_MAX, HAUTEUR_DEFAUT[b.type] ?? 3),
});

// Disposition par défaut : ce que l'utilisateur voit tant qu'il n'a rien
// composé. Ordre voulu (compteurs en tête), et non l'ordre du catalogue.
const ORDRE_DEFAUT = ["kpi_perso", "mon_activite", "mes_taches", "acces_rapides"];

const dispositionParDefaut = (widgetsAutorises) => {
  const parCle = new Map(widgetsAutorises.map((w) => [w.key, w]));
  return ORDRE_DEFAUT.filter((cle) => parCle.has(cle)).map((cle) =>
    completerGrille({
      id: `defaut-${cle}`,
      type: "widget",
      source: cle,
      taille: parCle.get(cle).tailleDefaut,
    }),
  );
};

/**
 * Normalise un document vers le format « pages ».
 * Reprend sans perte les dispositions enregistrées AVANT les pages multiples :
 * leurs `blocs` deviennent une page unique, et chaque bloc reçoit sa largeur et
 * sa hauteur de grille déduites de son ancienne taille.
 */
const normaliserPages = (doc) => {
  if (doc?.pages?.length) {
    return doc.pages.map((p) => ({
      id: p.id,
      nom: p.nom || "Page",
      blocs: (p.blocs || []).map(completerGrille),
    }));
  }
  if (doc?.blocs?.length) {
    return [
      { id: "page-1", nom: "Mon tableau", blocs: doc.blocs.map(completerGrille) },
    ];
  }
  return [];
};

// Widgets / datasets réellement accessibles à l'utilisateur.
// `masque` = droits « champ par champ » : les champs interdits sont retirés des
// sources, donc invisibles dans le constructeur ET refusés à l'enregistrement.
const perimetre = async (user, masque = null) => {
  const widgets = [];
  for (const w of DASHBOARD_WIDGETS) {
    if (await aModule(user, w.module)) widgets.push(w);
  }
  const datasets = {};
  for (const [cle, ds] of Object.entries(KPI_DATASETS)) {
    if (!(await aModule(user, ds.module))) continue;
    const champs = ds.champs.filter((c) => champVisible(c, masque, ds.origine));
    // Une source dont TOUS les champs sont masqués n'a plus d'intérêt.
    if (champs.length === 0) continue;
    datasets[cle] = { ...ds, champs };
  }
  return { widgets, datasets };
};

// GET /catalogue
const getCatalogue = asyncHandler(async (req, res) => {
  const { widgets, datasets } = await perimetre(req.user, req.masqueDbf);
  res.json({
    widgets,
    datasets,
    mesures: MESURES,
    operateurs: OPERATEURS,
    typesGraphique: TYPES_GRAPHIQUE,
    tris: TRIS,
    limites: { min: LIMITE_MIN, max: LIMITE_MAX },
    lignes: { min: LIGNES_MIN, max: LIGNES_MAX, colonnesMax: COLONNES_MAX },
  });
});

// GET /me — la disposition est filtrée par les droits COURANTS : un bloc dont
// le module a été retiré disparaît de l'écran sans être supprimé en base.
const getMaDisposition = asyncHandler(async (req, res) => {
  const { widgets, datasets } = await perimetre(req.user, req.masqueDbf);
  const clesWidgets = new Set(widgets.map((w) => w.key));

  const doc = await UserDashboardLayout.findOne({ user: req.user._id }).lean();
  const pagesBrutes = normaliserPages(doc);
  const parDefaut = !doc || !doc.useCustom || pagesBrutes.length === 0;

  const pages = parDefaut
    ? [{ id: "page-1", nom: "Mon tableau", blocs: dispositionParDefaut(widgets) }]
    : pagesBrutes;

  // Un bloc dont le module a été retiré disparaît de l'écran sans être
  // supprimé en base.
  let masques = 0;
  const visibles = pages.map((p) => {
    const blocs = p.blocs.filter((b) =>
      b.type === "widget" ? clesWidgets.has(b.source) : !!datasets[b.dataset],
    );
    masques += p.blocs.length - blocs.length;
    return { ...p, blocs };
  });

  res.json({
    useCustom: !parDefaut,
    parDefaut,
    pages: visibles,
    colonnes: COLONNES_GRILLE,
    masques,
  });
});

// PUT /me   body : { pages: [{ id, nom, blocs: [...] }] }
const setMaDisposition = asyncHandler(async (req, res) => {
  const { widgets, datasets } = await perimetre(req.user, req.masqueDbf);
  const clesWidgets = new Set(widgets.map((w) => w.key));

  // Accepte aussi l'ancien corps { blocs } : un client pas encore rechargé
  // continue de fonctionner, ses blocs formant une page unique.
  const pagesEntrantes = Array.isArray(req.body?.pages)
    ? req.body.pages
    : [{ id: "page-1", nom: "Mon tableau", blocs: req.body?.blocs || [] }];

  if (pagesEntrantes.length > 10) {
    res.status(400);
    throw new Error("10 pages au maximum sur un tableau de bord.");
  }

  const vus = new Set(); // identifiants de blocs, uniques TOUTES pages confondues
  const pages = [];
  const idsPages = new Set();

  for (const [ip, page] of pagesEntrantes.entries()) {
    const idPage = String(page?.id || `page-${ip + 1}`);
    if (idsPages.has(idPage)) {
      res.status(400);
      throw new Error(`Identifiant de page en double : ${idPage}`);
    }
    idsPages.add(idPage);

    const entrants = Array.isArray(page?.blocs) ? page.blocs : [];
    if (entrants.length > 40) {
      res.status(400);
      throw new Error("40 blocs au maximum par page.");
    }

    const blocs = normaliserBlocsPage({
      entrants,
      vus,
      clesWidgets,
      datasets,
      req,
      res,
    });

    pages.push({
      id: idPage,
      nom: String(page?.nom || `Page ${ip + 1}`).slice(0, 40),
      blocs,
    });
  }

  const doc = await UserDashboardLayout.findOneAndUpdate(
    { user: req.user._id },
    { user: req.user._id, useCustom: true, pages, blocs: [] },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );

  res.json({ useCustom: doc.useCustom, pages: doc.pages });
});

// Valide et normalise les blocs d'UNE page. `vus` porte l'unicité globale des
// identifiants (un même id ne peut pas exister sur deux pages).
const normaliserBlocsPage = ({ entrants, vus, clesWidgets, datasets, req, res }) => {
  const blocs = [];

  for (const [i, b] of entrants.entries()) {
    const id = String(b?.id || `bloc-${i}`);
    if (vus.has(id)) {
      res.status(400);
      throw new Error(`Identifiant de bloc en double : ${id}`);
    }
    vus.add(id);

    const taille = TAILLES.includes(b?.taille) ? b.taille : "tiers";
    // Grille : bornée côté serveur, jamais fiée au client.
    const grille = {
      w: borner(b?.w, 1, COLONNES_GRILLE, LARGEUR_DEPUIS_TAILLE[taille] ?? 4),
      h: borner(b?.h, H_MIN, H_MAX, HAUTEUR_DEFAUT[b?.type] ?? 3),
    };

    if (b?.type === "widget") {
      if (!clesWidgets.has(b.source)) {
        res.status(403);
        throw new Error(
          `Widget non autorisé ou inconnu : ${b.source} (${WIDGET_BY_KEY[b.source]?.label || "?"})`,
        );
      }
      blocs.push({ id, type: "widget", source: b.source, taille, ...grille });
      continue;
    }

    if (b?.type === "kpi" || b?.type === "graphique" || b?.type === "tableau") {
      if (!datasets[b.dataset]) {
        res.status(403);
        throw new Error(`Source non autorisée ou inconnue : ${b.dataset}`);
      }
      // La source croisée est soumise aux mêmes droits que la principale.
      if (b.jointure?.dataset && !datasets[b.jointure.dataset]) {
        res.status(403);
        throw new Error(
          `Source croisée non autorisée ou inconnue : ${b.jointure.dataset}`,
        );
      }

      const estGraphique = b.type === "graphique";
      const estTableau = b.type === "tableau";
      const invalide = estTableau
        ? validerTableau(b, req.masqueDbf)
        : estGraphique
          ? validerGraphique(b, req.masqueDbf)
          : validerKpi(b, req.masqueDbf);
      if (invalide) {
        const nature = estTableau ? "Tableau" : estGraphique ? "Graphique" : "Tuile";
        res.status(400);
        throw new Error(`${nature} « ${b.titre || id} » : ${invalide}`);
      }

      // Partie commune aux deux natures.
      const commun = {
        id,
        type: b.type,
        taille,
        ...grille,
        titre: String(b.titre || "").slice(0, 60),
        dataset: b.dataset,
        jointure: b.jointure?.dataset
          ? {
              dataset: b.jointure.dataset,
              champGauche: b.jointure.champGauche,
              champDroit: b.jointure.champDroit,
            }
          : null,
        mesure: b.mesure,
        champ: b.champ || "",
        filtres: (b.filtres || []).map((f) => ({
          champ: f.champ,
          operateur: f.operateur,
          valeur: String(f.valeur ?? "").slice(0, 120),
        })),
        format: ["nombre", "xpf", "pourcent"].includes(b.format)
          ? b.format
          : "nombre",
        couleur: String(b.couleur || "#6366f1").slice(0, 24),
        icone: String(b.icone || "HiChartBar").slice(0, 40),
      };

      if (estGraphique) {
        blocs.push({
          ...commun,
          dimension: b.dimension,
          serie: b.serie || "",
          empile: !!b.empile,
          typeGraphique: b.typeGraphique,
          limite: Number(b.limite) || 10,
          tri: b.tri || "valeurDesc",
        });
      } else if (estTableau) {
        blocs.push({
          ...commun,
          colonnes: (b.colonnes || []).map(String),
          limite: Number(b.limite) || 25,
          tri: b.tri || "valeurDesc",
        });
      } else {
        blocs.push(commun);
      }
      continue;
    }

    res.status(400);
    throw new Error(`Type de bloc inconnu : ${b?.type}`);
  }

  return blocs;
};

// DELETE /me — revenir à la disposition par défaut.
const resetMaDisposition = asyncHandler(async (req, res) => {
  await UserDashboardLayout.findOneAndUpdate(
    { user: req.user._id },
    { useCustom: false, pages: [], blocs: [] },
    { upsert: true },
  );
  res.json({ message: "Disposition réinitialisée." });
});

// POST /evaluer  { blocs: [...], nomDossierDBF }
// Accepte tuiles ET graphiques. Renvoie un résultat (ou une erreur lisible) par
// bloc, sans jamais faire échouer l'ensemble : un bloc en erreur n'aveugle pas
// les autres.
const evaluerBlocs = asyncHandler(async (req, res) => {
  const blocs = Array.isArray(req.body?.blocs) ? req.body.blocs : [];
  if (blocs.length > 40) {
    res.status(400);
    throw new Error("40 blocs au maximum par évaluation.");
  }
  const nomDossierDBF = req.body?.nomDossierDBF || "";

  const resultats = await Promise.all(
    blocs.map(async (bloc) => {
      try {
        const commun = {
          user: req.user,
          bloc,
          nomDossierDBF,
          masque: req.masqueDbf,
        };
        const r =
          bloc?.type === "tableau"
            ? await evaluerTableau(commun)
            : bloc?.type === "graphique"
              ? await evaluerGraphique(commun)
              : await evaluerKpi(commun);
        return { id: bloc?.id, type: bloc?.type || "kpi", ...r };
      } catch (e) {
        return {
          id: bloc?.id,
          type: bloc?.type || "kpi",
          valeur: null,
          series: [],
          lignes: 0,
          erreur: e.message,
        };
      }
    }),
  );

  res.json({ resultats });
});

export {
  getCatalogue,
  getMaDisposition,
  setMaDisposition,
  resetMaDisposition,
  evaluerBlocs,
};
