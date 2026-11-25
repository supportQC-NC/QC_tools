// backend/controllers/verificationInventaireController.js
//
// VÉRIFICATION POINT ROUGE (module `verification_inventaire`, 24/11/2026).
// L'agent balaye une allée ENTIÈREMENT CONTRÔLÉE à la recherche des scotchs
// sans point rouge : il bipe d'abord le QR DU RAYON (l'étiquette de zone),
// puis chaque scotch, et le système croise avec les bipages DE CE RAYON :
//   - trouvé à la bonne quantité → point rouge oublié, on TRACE (conforme) ;
//   - absent → ligne ajoutée au bipage (quantité du scotch) ;
//   - quantité différente → ligne de DELTA (le scotch fait foi).
//
// ⚠️ Croisement STRICT PAR ZONE depuis le 26/11/2026 (demande client — avant,
// le croisement portait sur l'allée entière et la zone de l'ajout était
// désignée à la main) : un article présent à PLUSIEURS endroits de l'allée
// faisait mentir le total, et la ligne de delta pouvait partir dans la
// mauvaise zone. Le bip du QR de rayon est OBLIGATOIRE : une app qui appelle
// encore /verifier sans zone reçoit un 400 explicite (mise à jour requise).
//
// ⚠️ Décision client : ces ajouts NE TOUCHENT NI les fiches de contrôle NI
// les .dat de zones (aucune régénération, aucune impression). Ils n'existent
// que dans LigneBipage (source "verification") — comptés dans la feuille
// d'écarts, le récap/bilan et l'intégration Stock XL, et filtrables dans le
// Détail des bipages pour être contrôlés.

import asyncHandler from "../middleware/asyncHandler.js";
import InventaireZoneSession from "../models/InventaireZoneSessionModel.js";
import LigneBipage from "../models/LigneBipageModel.js";
import VerificationInventaire from "../models/VerificationInventaireModel.js";
import { resoudreArticleActif } from "./bipageController.js";
import articleCacheService from "../services/articleService.js";
import {
  construireAllees,
  resoudreZoneAllee,
  rechercherDansZone,
  lettreAllee,
} from "../services/verificationInventaireService.js";

const round3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;

const nomUtilisateur = (u) =>
  u ? `${u.prenom || ""} ${u.nom || ""}`.trim() || u.email || "" : "";

const sessionActive = async (req, res) => {
  const session = await InventaireZoneSession.findOne({
    entreprise: req.entreprise._id,
    statut: "actif",
  });
  if (!session) {
    res.status(400);
    throw new Error("Aucun inventaire actif.");
  }
  return session;
};

// Garde d'allée : la vérification n'ouvre que quand TOUTES les zones de
// l'allée sont contrôlées (arbitrage client — le balayage des scotchs est la
// dernière passe, après le contrôle).
const alleeVerifiable = (session, allee, res) => {
  const a = construireAllees(session).find((x) => x.lettre === allee);
  if (!a) {
    res.status(404);
    throw new Error(`Aucune zone dans l'allée « ${allee} ».`);
  }
  if (!a.prete) {
    res.status(409);
    throw new Error(
      `Allée ${allee} : ${a.nbControlees}/${a.nbZones} zones contrôlées — ` +
        "la vérification n'ouvre qu'une fois TOUTE l'allée contrôlée.",
    );
  }
  return a;
};

// Garde de rayon : le QR bipé doit désigner une zone de l'ALLÉE vérifiée,
// présente dans l'inventaire et non neutralisée. C'est elle qui porte le
// croisement ET la ligne de delta éventuelle.
const zoneDeLAllee = (session, allee, zoneCode, zoneType, res) => {
  if (!zoneCode || !zoneType) {
    res.status(400);
    throw new Error(
      "Bipez d'abord le QR du rayon : le croisement se fait rayon par rayon " +
        "(mise à jour de l'application requise si ce message persiste).",
    );
  }
  const zone = (session.zones || []).find(
    (z) =>
      !z.neutralisee &&
      z.code === zoneCode &&
      String(z.type || "").trim() === zoneType,
  );
  if (!zone || lettreAllee(zone.code) !== allee) {
    res.status(400);
    throw new Error(
      `Zone ${zoneCode} (${zoneType}) absente de l'allée ${allee}.`,
    );
  }
  return zone;
};

// GET /api/verification-inventaire/:entrepriseId/contexte
// Allées de l'inventaire actif (état de contrôle) + compteurs du journal.
export const getContexte = asyncHandler(async (req, res) => {
  const session = await InventaireZoneSession.findOne({
    entreprise: req.entreprise._id,
    statut: "actif",
  });
  if (!session) {
    return res.json({ active: false, allees: [], stats: null });
  }
  const allees = construireAllees(session);
  const brut = await VerificationInventaire.aggregate([
    { $match: { session: session._id } },
    { $group: { _id: "$verdict", nb: { $sum: 1 } } },
  ]);
  const stats = { conforme: 0, ajout: 0, ecart: 0, total: 0 };
  for (const r of brut) {
    stats[r._id] = r.nb;
    stats.total += r.nb;
  }
  res.json({
    active: true,
    session: { _id: session._id, nom: session.nom },
    allees,
    stats,
  });
});

// GET /api/verification-inventaire/:entrepriseId/rayon?allee=&code=
// Résolution du QR de rayon bipé vers une zone de l'allée. Plusieurs
// correspondances possibles sur un code brut (MAGASIN/DOCK) : le client fait
// alors choisir l'emplacement.
export const resoudreRayon = asyncHandler(async (req, res) => {
  const allee = String(req.query.allee || "").trim().toUpperCase();
  const code = String(req.query.code || "").trim();
  if (!allee || !code) {
    res.status(400);
    throw new Error("Allée et code de rayon requis.");
  }
  const session = await sessionActive(req, res);
  alleeVerifiable(session, allee, res);

  const zones = resoudreZoneAllee({ session, allee, code });
  if (!zones.length) {
    return res.json({
      found: false,
      zones: [],
      message: `Aucun rayon de l'allée ${allee} ne correspond à ce code.`,
    });
  }
  res.json({ found: true, zones });
});

// GET /api/verification-inventaire/:entrepriseId/verifier?allee=&zoneCode=&zoneType=&code=
// Le croisement : l'article bipé est-il dans les bipages du RAYON, combien ?
export const verifierCode = asyncHandler(async (req, res) => {
  const allee = String(req.query.allee || "").trim().toUpperCase();
  const zoneCode = String(req.query.zoneCode || "").trim();
  const zoneType = String(req.query.zoneType || "").trim();
  const code = String(req.query.code || "").trim();
  if (!allee || !code) {
    res.status(400);
    throw new Error("Allée et code article requis.");
  }
  const session = await sessionActive(req, res);
  alleeVerifiable(session, allee, res);
  const zone = zoneDeLAllee(session, allee, zoneCode, zoneType, res);

  const { record, renvoye } = await resoudreArticleActif(req.entreprise, code);
  const { lignes, totalQte } = await rechercherDansZone({
    session,
    zoneCode,
    zoneType,
    code,
    nartResolu: record ? String(record.NART || "").trim() : "",
  });

  res.json({
    allee,
    zone: { code: zone.code, libelle: zone.libelle || "", type: zoneType },
    code,
    article: record
      ? {
          found: true,
          renvoye,
          nart: String(record.NART || "").trim(),
          gencod: String(record.GENCOD || "").trim(),
          designation: String(record.DESIGN || "").trim(),
        }
      : {
          found: false,
          nart: "",
          gencod: "",
          // Une ligne du rayon peut porter la désignation d'un code que le
          // catalogue ne connaît plus — mieux que rien à l'écran.
          designation: lignes[0]?.designation || "",
        },
    lignes: lignes.map((l) => ({
      zoneCode: l.zoneCode,
      zoneType: String(l.zoneType || "").trim(),
      qteScan: l.qteScan,
      source: l.source,
      agentNom: l.agentNom || "",
    })),
    totalQte,
  });
});

// POST /api/verification-inventaire/:entrepriseId/confirmer
// { allee, zoneCode, zoneType, code } — le scotch correspond au total bipé du
// rayon : point rouge oublié, on trace le « conforme » (décision client) et
// rien d'autre ne bouge.
export const confirmerCode = asyncHandler(async (req, res) => {
  const allee = String(req.body.allee || "").trim().toUpperCase();
  const zoneCode = String(req.body.zoneCode || "").trim();
  const zoneType = String(req.body.zoneType || "").trim();
  const code = String(req.body.code || "").trim();
  if (!allee || !code) {
    res.status(400);
    throw new Error("Allée et code article requis.");
  }
  const session = await sessionActive(req, res);
  alleeVerifiable(session, allee, res);
  zoneDeLAllee(session, allee, zoneCode, zoneType, res);

  const { record } = await resoudreArticleActif(req.entreprise, code);
  const nartResolu = record ? String(record.NART || "").trim() : "";
  const { totalQte } = await rechercherDansZone({
    session,
    zoneCode,
    zoneType,
    code,
    nartResolu,
  });

  await VerificationInventaire.create({
    entreprise: req.entreprise._id,
    session: session._id,
    allee,
    codeScanne: code,
    nart: nartResolu,
    designation: record ? String(record.DESIGN || "").trim() : "",
    verdict: "conforme",
    qteScotch: null,
    qteTrouvee: totalQte,
    delta: 0,
    zoneCode,
    zoneType,
    user: req.user._id,
    agentNom: nomUtilisateur(req.user),
  });

  res.status(201).json({ verdict: "conforme", qteTrouvee: totalQte });
});

// POST /api/verification-inventaire/:entrepriseId/ajouter
// { allee, zoneCode, zoneType, code, qteScotch, observation? }
// Le scotch ne correspond pas (absent, ou quantité différente) : LE SCOTCH
// FAIT FOI — on écrit dans LigneBipage la quantité manquante (delta, négatif
// accepté), rattachée au RAYON BIPÉ, source "verification".
export const ajouterAuBipage = asyncHandler(async (req, res) => {
  const allee = String(req.body.allee || "").trim().toUpperCase();
  const code = String(req.body.code || "").trim();
  const zoneCode = String(req.body.zoneCode || "").trim();
  const zoneType = String(req.body.zoneType || "").trim();
  const observation = String(req.body.observation || "").trim();
  const qteScotch = Number(req.body.qteScotch);

  if (!allee || !code) {
    res.status(400);
    throw new Error("Allée et code article requis.");
  }
  if (!Number.isFinite(qteScotch)) {
    res.status(400);
    throw new Error("Quantité du scotch obligatoire.");
  }

  const session = await sessionActive(req, res);
  alleeVerifiable(session, allee, res);
  zoneDeLAllee(session, allee, zoneCode, zoneType, res);

  const { record } = await resoudreArticleActif(req.entreprise, code);
  const nartResolu = record ? String(record.NART || "").trim() : "";

  // Total recalculé CÔTÉ SERVEUR au moment de la validation : le delta ne
  // doit jamais reposer sur un affichage périmé du client.
  const { totalQte } = await rechercherDansZone({
    session,
    zoneCode,
    zoneType,
    code,
    nartResolu,
  });
  const delta = round3(qteScotch - totalQte);

  if (delta === 0) {
    // Le total colle finalement au scotch (double bip, autre vérificateur
    // passé avant…) : c'est un conforme, rien à écrire au bipage.
    await VerificationInventaire.create({
      entreprise: req.entreprise._id,
      session: session._id,
      allee,
      codeScanne: code,
      nart: nartResolu,
      designation: record ? String(record.DESIGN || "").trim() : "",
      verdict: "conforme",
      qteScotch,
      qteTrouvee: totalQte,
      delta: 0,
      zoneCode,
      zoneType,
      user: req.user._id,
      agentNom: nomUtilisateur(req.user),
    });
    return res.status(201).json({ verdict: "conforme", qteTrouvee: totalQte });
  }

  // Même motif que l'Ajout contrôle : la ligne se range EN FIN de sa zone,
  // sans fichier derrière elle — ni fiche de contrôle ni .dat de zone ne
  // seront régénérés (décision client), seul le comptage de l'inventaire
  // (écarts, intégration Stock XL) la voit.
  const derniere = await LigneBipage.findOne({
    session: session._id,
    zoneCode,
    zoneType,
  })
    .sort({ ordre: -1 })
    .select("ordre")
    .lean();

  const ligne = await LigneBipage.create({
    entreprise: req.entreprise._id,
    session: session._id,
    datFileName: "",
    zoneCode,
    zoneType,
    ordre: (Number(derniere?.ordre) || 0) + 1,
    eanArticle: code,
    codeScanne: code,
    qteScan: delta,
    nart: nartResolu,
    observation,
    designation: record ? (record.DESIGN || "").trim() : "Article non trouvé",
    gencod: record ? (record.GENCOD || "").trim() : "",
    stock: record ? articleCacheService.calculateStockTotal(record) : null,
    found: !!record,
    source: "verification",
    sourceRef: `allee ${allee}`,
    agentNom: nomUtilisateur(req.user),
  });

  const verdict = totalQte === 0 ? "ajout" : "ecart";
  await VerificationInventaire.create({
    entreprise: req.entreprise._id,
    session: session._id,
    allee,
    codeScanne: code,
    nart: nartResolu,
    designation: ligne.designation,
    verdict,
    qteScotch,
    qteTrouvee: totalQte,
    delta,
    zoneCode,
    zoneType,
    ligneBipage: ligne._id,
    user: req.user._id,
    agentNom: nomUtilisateur(req.user),
  });

  res.status(201).json({ verdict, qteTrouvee: totalQte, delta, ligne });
});
