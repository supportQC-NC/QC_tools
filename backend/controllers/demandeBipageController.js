// backend/controllers/demandeBipageController.js
//
// Demandes de BIPAGE : création web (depuis proforma / gisement / manuel),
// suivi, et endpoints mobiles (liste + réalisation par l'agent).
// Calque de demandeReapproController, adapté au bipage.
import asyncHandler from "../middleware/asyncHandler.js";
import DemandeBipage from "../models/DemandeBipageModel.js";
import {
  getMagasinArticlesByGisements,
  resolveArticleForReappro,
} from "../services/analyseReapproService.js";
import { analyserProforma } from "../services/preparationService.js";
import { getAccessibleEntreprises } from "../middleware/accessControl.js";
import Entreprise from "../models/EntrepriseModel.js";
import { ecrireTransfertBipage } from "../services/demandeBipageTransfertService.js";

const ACTIF = ["en_attente", "en_cours"];

const nomUtilisateur = (u) =>
  [u?.prenom, u?.nom].filter(Boolean).join(" ") || u?.email || "Utilisateur";

const normPriorite = (p) =>
  ["urgent", "a_faire", "normal"].includes(p) ? p : "a_faire";

const entOf = (req) =>
  req.entreprise || { nomDossierDBF: req.params.nomDossierDBF };

// @desc    Créer UNE demande de bipage depuis une PROFORMA
// @route   POST /api/demande-bipage/:nomDossierDBF/proforma
// @body    { numpro, priorite?, commentaire? }
const createDemandeProforma = asyncHandler(async (req, res) => {
  const entreprise = entOf(req);
  const numpro = String(req.body.numpro || "").trim();
  if (!numpro) {
    res.status(400);
    throw new Error("Numéro de proforma requis.");
  }

  const { proformaInfo, lignes } = await analyserProforma(entreprise, numpro);
  const articles = (lignes || [])
    .map((l) => ({
      nart: String(l.nart || "").trim(),
      design: l.designation || l.design || "",
      fourn: l.fourn || "",
      fournNom: l.fournisseurNom || l.fournNom || "",
      gencod: l.gencod || "",
      stock: Number(l.stockMagasin ?? l.stock ?? 0) || 0,
      quantiteDemandee: Math.round(Number(l.qteCommandee) || 0),
    }))
    .filter((a) => a.nart);

  if (articles.length === 0) {
    res.status(400);
    throw new Error("Aucun article exploitable dans cette proforma.");
  }

  const demande = await DemandeBipage.create({
    entreprise: entreprise.nomDossierDBF,
    source: "proforma",
    sourceRef: numpro,
    libelle: proformaInfo?.clientNom
      ? `Proforma ${numpro} · ${proformaInfo.clientNom}`
      : `Proforma ${numpro}`,
    priorite: normPriorite(req.body.priorite),
    statut: "en_attente",
    articles,
    nbArticles: articles.length,
    commentaire: String(req.body.commentaire || "").slice(0, 500),
    createdBy: req.user?._id,
    createdByNom: nomUtilisateur(req.user),
  });

  res.status(201).json({ crees: 1, demande });
});

// @desc    Créer des demandes de bipage depuis un ou plusieurs GISEMENTS (1/gisement)
// @route   POST /api/demande-bipage/:nomDossierDBF/gisement
// @body    { gisements: string[], priorite?, commentaire? }
const createDemandeGisement = asyncHandler(async (req, res) => {
  const entreprise = entOf(req);
  const key = entreprise.nomDossierDBF;
  const gisements = Array.isArray(req.body.gisements) ? req.body.gisements : [];
  if (gisements.length === 0) {
    res.status(400);
    throw new Error("Aucun gisement sélectionné.");
  }

  // Anti-doublon : gisements déjà couverts par une demande active.
  const dejaActifs = await DemandeBipage.find({
    entreprise: key,
    source: "gisement",
    sourceRef: { $in: gisements },
    statut: { $in: ACTIF },
  }).select("sourceRef");
  const bloques = new Set(dejaActifs.map((d) => d.sourceRef));
  const aTraiter = gisements.filter((g) => !bloques.has(g));
  const ignores = [...bloques];

  const crees = [];
  if (aTraiter.length > 0) {
    const articles = await getMagasinArticlesByGisements(entreprise, aTraiter);
    const parGisement = new Map();
    articles.forEach((a) => {
      const g = a.gisement || "(sans gisement)";
      if (!parGisement.has(g)) parGisement.set(g, []);
      parGisement.get(g).push(a);
    });

    for (const g of aTraiter) {
      const arts = (parGisement.get(g) || []).map((a) => ({
        nart: a.nart,
        design: a.design,
        fourn: a.fourn,
        fournNom: a.fournNom,
        gencod: a.gencod,
        stock: a.stock,
        quantiteDemandee: 0,
      }));
      if (arts.length === 0) continue;
      // eslint-disable-next-line no-await-in-loop
      const d = await DemandeBipage.create({
        entreprise: key,
        source: "gisement",
        sourceRef: g,
        libelle: `Gisement ${g}`,
        priorite: normPriorite(req.body.priorite),
        statut: "en_attente",
        articles: arts,
        nbArticles: arts.length,
        commentaire: String(req.body.commentaire || "").slice(0, 500),
        createdBy: req.user?._id,
        createdByNom: nomUtilisateur(req.user),
      });
      crees.push(d);
    }
  }

  res.status(201).json({ crees: crees.length, ignores, demandes: crees });
});

// @desc    Résout un NART (saisie manuelle) -> article
// @route   GET /api/demande-bipage/:nomDossierDBF/article/:nart
const getArticleBipage = asyncHandler(async (req, res) => {
  const entreprise = entOf(req);
  const art = await resolveArticleForReappro(entreprise, req.params.nart);
  if (!art) {
    res.status(404);
    throw new Error("Article introuvable (NART inconnu).");
  }
  res.json(art);
});

// @desc    Crée UNE demande à partir d'un panier manuel { articles:[{nart,quantite}] }
// @route   POST /api/demande-bipage/:nomDossierDBF/panier
const createDemandePanier = asyncHandler(async (req, res) => {
  const entreprise = entOf(req);
  const key = entreprise.nomDossierDBF;
  const items = Array.isArray(req.body.articles) ? req.body.articles : [];
  if (items.length === 0) {
    res.status(400);
    throw new Error("Panier vide.");
  }

  const articles = [];
  for (const it of items) {
    // eslint-disable-next-line no-await-in-loop
    const art = await resolveArticleForReappro(entreprise, it.nart);
    if (!art) continue;
    const q = Math.round(Number(it.quantite) || 0);
    articles.push({
      nart: art.nart,
      design: art.design,
      fourn: art.fourn,
      fournNom: art.fournNom,
      gencod: art.gencod,
      stock: art.stock,
      quantiteDemandee: q > 0 ? q : 0,
    });
  }
  if (articles.length === 0) {
    res.status(400);
    throw new Error("Aucun article valide (NART inconnu).");
  }

  const demande = await DemandeBipage.create({
    entreprise: key,
    source: "manuel",
    sourceRef: "Manuelle",
    libelle: "Sélection manuelle",
    priorite: normPriorite(req.body.priorite),
    statut: "en_attente",
    articles,
    nbArticles: articles.length,
    commentaire: String(req.body.commentaire || "").slice(0, 500),
    createdBy: req.user?._id,
    createdByNom: nomUtilisateur(req.user),
  });
  res.status(201).json({ crees: 1, demande });
});

// @desc    Liste des demandes de bipage d'une entreprise
// @route   GET /api/demande-bipage/:nomDossierDBF?statut=
const getDemandes = asyncHandler(async (req, res) => {
  const entreprise = entOf(req);
  const filter = { entreprise: entreprise.nomDossierDBF };
  if (req.query.statut === "actif") filter.statut = { $in: ACTIF };
  else if (["en_attente", "en_cours", "realisee"].includes(req.query.statut)) {
    filter.statut = req.query.statut;
  }
  const demandes = await DemandeBipage.find(filter)
    .select("-articles")
    .sort({ createdAt: -1 })
    .limit(300);
  res.json(demandes);
});

// @desc    Détail d'une demande (avec ses articles)
// @route   GET /api/demande-bipage/detail/:id
const getDemandeById = asyncHandler(async (req, res) => {
  const d = await DemandeBipage.findById(req.params.id);
  if (!d) {
    res.status(404);
    throw new Error("Demande introuvable");
  }
  res.json(d);
});

// @desc    Supprimer une demande (annulation web)
// @route   DELETE /api/demande-bipage/:id
const deleteDemande = asyncHandler(async (req, res) => {
  const d = await DemandeBipage.findById(req.params.id);
  if (!d) {
    res.status(404);
    throw new Error("Demande introuvable");
  }
  await d.deleteOne();
  res.json({ ok: true });
});

const PRIO_RANK = { urgent: 0, a_faire: 1, normal: 2 };

// @desc    (MOBILE) Demandes actives pour les entreprises de l'agent
// @route   GET /api/demande-bipage/mobile/list
const getMobileDemandes = asyncHandler(async (req, res) => {
  const scope = await getAccessibleEntreprises(req.user);
  const filter = { statut: { $in: ACTIF } };
  if (!scope.all) {
    const ents = await Entreprise.find({ _id: { $in: scope.ids } }).select(
      "nomDossierDBF",
    );
    filter.entreprise = { $in: ents.map((e) => e.nomDossierDBF) };
  }
  const demandes = await DemandeBipage.find(filter).limit(200).lean();
  demandes.sort(
    (a, b) =>
      (PRIO_RANK[a.priorite] ?? 9) - (PRIO_RANK[b.priorite] ?? 9) ||
      new Date(a.createdAt) - new Date(b.createdAt),
  );
  res.json(demandes);
});

// @desc    (MOBILE) Marquer une demande de bipage comme réalisée
// @route   PATCH /api/demande-bipage/mobile/:id/realiser
// @body    { lignes: [{ nart, gencod?, quantite }] }
const realiserDemande = asyncHandler(async (req, res) => {
  const d = await DemandeBipage.findById(req.params.id);
  if (!d) {
    res.status(404);
    throw new Error("Demande introuvable");
  }
  // La route mobile n'exige plus de module : le périmètre SOCIÉTÉ reste donc le
  // seul contrôle, et il doit être fait ici aussi (pas seulement à la liste).
  const scope = await getAccessibleEntreprises(req.user);
  if (!scope.all) {
    const ents = await Entreprise.find({ _id: { $in: scope.ids } }).select(
      "nomDossierDBF",
    );
    if (!ents.some((e) => e.nomDossierDBF === d.entreprise)) {
      res.status(403);
      throw new Error("Vous n'avez pas accès à cette société");
    }
  }
  if (d.statut !== "realisee") {
    const lignes = (Array.isArray(req.body?.lignes) ? req.body.lignes : [])
      .map((l) => ({
        nart: String(l.nart || "").trim(),
        gencod: String(l.gencod || "").trim(),
        quantite: Math.round(Number(l.quantite) || 0),
      }))
      .filter((l) => (l.nart || l.gencod) && l.quantite > 0);

    if (lignes.length > 0) {
      const tsf = await ecrireTransfertBipage(d, lignes);
      d.lignesRealisees = lignes;
      d.transfertFichier = tsf.fileName;
    }

    d.statut = "realisee";
    d.realisedBy = req.user?._id;
    d.realisedByNom = nomUtilisateur(req.user);
    d.realisedAt = new Date();
    await d.save();
  }
  res.json(d);
});

export {
  createDemandeProforma,
  createDemandeGisement,
  createDemandePanier,
  getArticleBipage,
  getDemandes,
  getDemandeById,
  deleteDemande,
  getMobileDemandes,
  realiserDemande,
};
