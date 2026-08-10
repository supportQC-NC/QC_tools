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
} from "../config/dashboardCatalogue.js";
import {
  aModule,
  evaluerKpi,
  validerKpi,
  evaluerGraphique,
  validerGraphique,
  champVisible,
} from "../services/dashboardKpiService.js";

const TAILLES = ["tiers", "moitie", "pleine"];

// Disposition par défaut : ce que l'utilisateur voit tant qu'il n'a rien
// composé. Ordre voulu (compteurs en tête), et non l'ordre du catalogue.
const ORDRE_DEFAUT = ["kpi_perso", "mon_activite", "mes_taches", "acces_rapides"];

const dispositionParDefaut = (widgetsAutorises) => {
  const parCle = new Map(widgetsAutorises.map((w) => [w.key, w]));
  return ORDRE_DEFAUT.filter((cle) => parCle.has(cle)).map((cle) => ({
    id: `defaut-${cle}`,
    type: "widget",
    source: cle,
    taille: parCle.get(cle).tailleDefaut,
  }));
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
  });
});

// GET /me — la disposition est filtrée par les droits COURANTS : un bloc dont
// le module a été retiré disparaît de l'écran sans être supprimé en base.
const getMaDisposition = asyncHandler(async (req, res) => {
  const { widgets, datasets } = await perimetre(req.user, req.masqueDbf);
  const clesWidgets = new Set(widgets.map((w) => w.key));

  const doc = await UserDashboardLayout.findOne({ user: req.user._id }).lean();

  const parDefaut = !doc || !doc.useCustom || !(doc.blocs || []).length;
  const bruts = parDefaut ? dispositionParDefaut(widgets) : doc.blocs;

  const blocs = bruts.filter((b) =>
    b.type === "widget" ? clesWidgets.has(b.source) : !!datasets[b.dataset],
  ); // kpi + graphique sont tous deux gardés par leur dataset

  res.json({
    useCustom: !parDefaut,
    parDefaut,
    blocs,
    masques: bruts.length - blocs.length, // blocs cachés faute de droits
  });
});

// PUT /me
const setMaDisposition = asyncHandler(async (req, res) => {
  const { widgets, datasets } = await perimetre(req.user, req.masqueDbf);
  const clesWidgets = new Set(widgets.map((w) => w.key));

  const entrants = Array.isArray(req.body?.blocs) ? req.body.blocs : [];
  if (entrants.length > 40) {
    res.status(400);
    throw new Error("40 blocs au maximum sur un tableau de bord.");
  }

  const blocs = [];
  const vus = new Set();

  for (const [i, b] of entrants.entries()) {
    const id = String(b?.id || `bloc-${i}`);
    if (vus.has(id)) {
      res.status(400);
      throw new Error(`Identifiant de bloc en double : ${id}`);
    }
    vus.add(id);

    const taille = TAILLES.includes(b?.taille) ? b.taille : "tiers";

    if (b?.type === "widget") {
      if (!clesWidgets.has(b.source)) {
        res.status(403);
        throw new Error(
          `Widget non autorisé ou inconnu : ${b.source} (${WIDGET_BY_KEY[b.source]?.label || "?"})`,
        );
      }
      blocs.push({ id, type: "widget", source: b.source, taille });
      continue;
    }

    if (b?.type === "kpi" || b?.type === "graphique") {
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
      const invalide = estGraphique
        ? validerGraphique(b, req.masqueDbf)
        : validerKpi(b, req.masqueDbf);
      if (invalide) {
        res.status(400);
        throw new Error(
          `${estGraphique ? "Graphique" : "Tuile"} « ${b.titre || id} » : ${invalide}`,
        );
      }

      // Partie commune aux deux natures.
      const commun = {
        id,
        type: b.type,
        taille,
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

      blocs.push(
        estGraphique
          ? {
              ...commun,
              dimension: b.dimension,
              typeGraphique: b.typeGraphique,
              limite: Number(b.limite) || 10,
              tri: b.tri || "valeurDesc",
            }
          : commun,
      );
      continue;
    }

    res.status(400);
    throw new Error(`Type de bloc inconnu : ${b?.type}`);
  }

  const doc = await UserDashboardLayout.findOneAndUpdate(
    { user: req.user._id },
    { user: req.user._id, useCustom: true, blocs },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );

  res.json({ useCustom: doc.useCustom, blocs: doc.blocs });
});

// DELETE /me — revenir à la disposition par défaut.
const resetMaDisposition = asyncHandler(async (req, res) => {
  await UserDashboardLayout.findOneAndUpdate(
    { user: req.user._id },
    { useCustom: false, blocs: [] },
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
        const r =
          bloc?.type === "graphique"
            ? await evaluerGraphique({ user: req.user, bloc, nomDossierDBF, masque: req.masqueDbf })
            : await evaluerKpi({ user: req.user, bloc, nomDossierDBF, masque: req.masqueDbf });
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
