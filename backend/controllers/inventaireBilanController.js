// backend/controllers/inventaireBilanController.js
//
// BILANS DE CLÔTURE des inventaires par zones. Routes montées dans
// InventaireZoneRoutes (admin + accès société, comme le reste du module).
//
// Le bilan Mongo (InventaireBilan) est LA référence : l'Excel et le PDF sont
// regénérés depuis lui à la demande — pas besoin du partage ni du FTP pour
// relire un inventaire d'il y a un an. Voir inventaireBilanService pour la
// construction et l'archivage FTP.

import asyncHandler from "../middleware/asyncHandler.js";
import InventaireZoneSession from "../models/InventaireZoneSessionModel.js";
import InventaireBilan from "../models/InventaireBilanModel.js";
import {
  archiverBilan,
  genererExcelBilan,
  genererPdfBilan,
} from "../services/inventaireBilanService.js";
import { envoyerClasseur } from "../utils/envoyerClasseur.js";
import { emitInventaireMaj } from "../socket/inventaireEvents.js";

/** Résumé d'un bilan pour la liste (sans le détail par zone ni les anomalies). */
const bilanResume = (b) => ({
  _id: b._id,
  session: b.session,
  sessionNom: b.sessionNom,
  genereAt: b.genereAt,
  auto: b.auto,
  debutAt: b.debutAt,
  finAt: b.finAt,
  progression: b.progression,
  comptage: b.comptage,
  nbAgents: (b.agents || []).length,
  ecartsTotaux: b.ecarts?.totaux || null,
  parEmplacement: b.ecarts?.parEmplacement || [],
  nbZonesRecomptees: (b.zonesRecomptees || []).length,
});

/**
 * @desc    Figer le bilan de l'inventaire ACTIF — et le clôturer si demandé
 *          (la session passe en « archive » sans rien purger : la purge
 *          n'arrive qu'à la prochaine initialisation, le bilan est déjà
 *          à l'abri).
 * @route   POST /api/inventaires-zones/:entrepriseId/bilan
 * @body    { cloturer?: boolean }
 * @access  Private/Admin
 */
const genererBilan = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const { cloturer = false } = req.body || {};

  const session = await InventaireZoneSession.findOne({
    entreprise: entreprise._id,
    statut: "actif",
  });
  if (!session) {
    res.status(400);
    throw new Error("Aucun inventaire actif : rien à clôturer.");
  }

  // ⚠️ Peut prendre plusieurs secondes à cache articles froid (les écarts
  // relisent chaque ligne bipée contre le stock) — c'est une action d'admin,
  // pas un écran de polling.
  const bilan = await archiverBilan(entreprise, session, {
    user: req.user,
    auto: false,
  });

  let sessionCloturee = false;
  if (cloturer) {
    session.statut = "archive";
    session.archivedAt = new Date();
    await session.save();
    sessionCloturee = true;
    emitInventaireMaj(entreprise._id, "session");
  }

  res.status(201).json({
    message: sessionCloturee
      ? "Bilan figé et inventaire clôturé."
      : "Bilan figé (l'inventaire reste actif).",
    sessionCloturee,
    bilan: bilanResume(bilan),
  });
});

/**
 * @desc    Liste des bilans archivés de la société (résumés, plus récents
 *          d'abord).
 * @route   GET /api/inventaires-zones/:entrepriseId/bilans
 * @access  Private/Admin
 */
const getBilans = asyncHandler(async (req, res) => {
  const bilans = await InventaireBilan.find({ entreprise: req.entreprise._id })
    .select("-ecarts.zones -ecarts.topAnomalies -agents.email")
    .sort({ genereAt: -1 })
    .lean();

  // La session active (si elle existe) pour proposer la clôture.
  const active = await InventaireZoneSession.findOne({
    entreprise: req.entreprise._id,
    statut: "actif",
  }).select("nom createdAt");

  res.json({
    active: active
      ? { _id: active._id, nom: active.nom, createdAt: active.createdAt }
      : null,
    total: bilans.length,
    bilans: bilans.map(bilanResume),
  });
});

/**
 * @desc    Comparaison INTER-INVENTAIRES par zone : pour chaque zone
 *          (code + emplacement), ses écarts dans chaque bilan archivé.
 *          Une zone est dite CHRONIQUE quand elle est en écart dans au moins
 *          deux inventaires — c'est le rayon à aller voir.
 * @route   GET /api/inventaires-zones/:entrepriseId/bilans/comparaison
 * @access  Private/Admin
 */
const getComparaisonBilans = asyncHandler(async (req, res) => {
  const bilans = await InventaireBilan.find({ entreprise: req.entreprise._id })
    .select("sessionNom genereAt ecarts.zones")
    .sort({ genereAt: 1 })
    .lean();

  const colonnes = bilans.map((b) => ({
    _id: b._id,
    sessionNom: b.sessionNom,
    genereAt: b.genereAt,
  }));

  const zonesMap = new Map();
  bilans.forEach((b, idx) => {
    for (const z of b.ecarts?.zones || []) {
      const cle = `${z.zoneCode}|${z.zoneType || ""}`;
      if (!zonesMap.has(cle)) {
        zonesMap.set(cle, {
          zoneCode: z.zoneCode,
          zoneType: z.zoneType || "",
          zoneLibelle: z.zoneLibelle || "",
          // Une case par bilan, null = zone pas comptée dans cet inventaire.
          parBilan: colonnes.map(() => null),
        });
      }
      const entry = zonesMap.get(cle);
      if (!entry.zoneLibelle && z.zoneLibelle) entry.zoneLibelle = z.zoneLibelle;
      entry.parBilan[idx] = {
        totalEcartXpf: z.totalEcartXpf,
        ecartAbsXpf: z.ecartAbsXpf,
        nbEcarts: z.nbEcarts,
        totalArticles: z.totalArticles,
      };
    }
  });

  const zones = [...zonesMap.values()]
    .map((z) => {
      const presentes = z.parBilan.filter(Boolean);
      const enEcart = presentes.filter((c) => c.nbEcarts > 0);
      return {
        ...z,
        nbInventaires: presentes.length,
        nbEnEcart: enEcart.length,
        ampleurCumulee: presentes.reduce((s, c) => s + (c.ecartAbsXpf || 0), 0),
        // CHRONIQUE : en écart dans ≥ 2 inventaires — le rayon à traiter.
        chronique: enEcart.length >= 2,
      };
    })
    .sort(
      (a, b) =>
        b.nbEnEcart - a.nbEnEcart || b.ampleurCumulee - a.ampleurCumulee,
    );

  res.json({ bilans: colonnes, zones });
});

/** Charge un bilan en vérifiant qu'il appartient bien à la société. */
const chargerBilan = async (req, res) => {
  const bilan = await InventaireBilan.findOne({
    _id: req.params.id,
    entreprise: req.entreprise._id,
  }).lean();
  if (!bilan) {
    res.status(404);
    throw new Error("Bilan non trouvé");
  }
  return bilan;
};

/**
 * @desc    Détail complet d'un bilan (zones, agents, anomalies).
 * @route   GET /api/inventaires-zones/:entrepriseId/bilans/:id
 * @access  Private/Admin
 */
const getBilan = asyncHandler(async (req, res) => {
  res.json(await chargerBilan(req, res));
});

const nomFichierBilan = (bilan, entreprise, ext) => {
  const date = bilan.genereAt
    ? new Date(bilan.genereAt).toISOString().slice(0, 10)
    : "";
  return `bilan_inventaire_${entreprise.trigramme || ""}_${date}.${ext}`;
};

/**
 * @desc    Excel du bilan, regénéré depuis le document Mongo.
 * @route   GET /api/inventaires-zones/:entrepriseId/bilans/:id/excel
 * @access  Private/Admin
 */
const getBilanExcel = asyncHandler(async (req, res) => {
  const bilan = await chargerBilan(req, res);
  const wb = genererExcelBilan(bilan, req.entreprise);
  await envoyerClasseur(req, res, wb, nomFichierBilan(bilan, req.entreprise, "xlsx"));
});

/**
 * @desc    PDF de synthèse du bilan, regénéré depuis le document Mongo.
 * @route   GET /api/inventaires-zones/:entrepriseId/bilans/:id/pdf
 * @access  Private/Admin
 */
const getBilanPdf = asyncHandler(async (req, res) => {
  const bilan = await chargerBilan(req, res);
  const buffer = await genererPdfBilan(bilan, req.entreprise);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `${req.query.download === "1" ? "attachment" : "inline"}; filename="${nomFichierBilan(bilan, req.entreprise, "pdf")}"`,
  );
  res.send(buffer);
});

/**
 * @desc    Supprimer un bilan archivé (erreur de génération, test…).
 * @route   DELETE /api/inventaires-zones/:entrepriseId/bilans/:id
 * @access  Private/Admin
 */
const deleteBilan = asyncHandler(async (req, res) => {
  const bilan = await chargerBilan(req, res);
  await InventaireBilan.deleteOne({ _id: bilan._id });
  res.json({ message: "Bilan supprimé" });
});

export {
  genererBilan,
  getBilans,
  getBilan,
  getBilanExcel,
  getBilanPdf,
  getComparaisonBilans,
  deleteBilan,
};
