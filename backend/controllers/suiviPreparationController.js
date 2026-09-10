// backend/controllers/suiviPreparationController.js
//
// SUIVI DES PRÉPARATIONS DE COMMANDE — vue unique sur les deux façons de
// préparer une proforma :
//
//   - « scannée » : préparation faite au collecteur (app mobile), qui déroule
//     le parcours dock puis magasin ligne à ligne  -> collection `Preparation` ;
//   - « manuelle » : fiche papier imprimée depuis le web, remplie dans les
//     allées, puis marquée « préparée » à la main -> collection
//     `FichePreparation`.
//
// ⚠️ Une fiche manuelle marquée « préparée » APPARAÎT ici comme préparée, mais
// n'est PAS retirée de l'écran « Préparation de commande manuelle » : ce sont
// deux lectures du même document, pas deux étapes d'un flux. Ne jamais faire
// disparaître la fiche de son écran d'origine sous prétexte qu'elle est suivie
// ici.
//
// L'agrégation ne renvoie jamais les tableaux de lignes : une proforma peut en
// porter plusieurs centaines.
import asyncHandler from "../middleware/asyncHandler.js";
import Preparation from "../models/PreparationModel.js";
import FichePreparation from "../models/FichePreparationModel.js";

const nomAgent = (u) =>
  [u?.prenom, u?.nom].filter(Boolean).join(" ") || u?.email || "";

const msEntre = (debut, fin) => {
  if (!debut || !fin) return null;
  const d = new Date(debut).getTime();
  const f = new Date(fin).getTime();
  if (!Number.isFinite(d) || !Number.isFinite(f) || f < d) return null;
  return f - d;
};

// Libellé d'étape d'une préparation scannée : la phase en cours dit où en est
// l'agent (dock, magasin, contrôle final) — « en cours » tout court ne suffit
// pas quand on cherche à savoir qui attend quoi.
const PHASE_LABEL = { dock: "Dock", magasin: "Magasin", final: "Contrôle final" };

/**
 * @desc    Suivi unifié des préparations (collecteur + fiches manuelles)
 * @route   GET /api/suivi-preparations/:nomDossierDBF?etat=&origine=&jours=
 * @access  Private (prep_commande OU prep_commande_manuelle, read) + entreprise
 */
const getSuiviPreparations = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise || {
    nomDossierDBF: req.params.nomDossierDBF,
  };
  const dossier = entreprise.nomDossierDBF;

  // Fenêtre glissante : ces collections ne sont jamais purgées.
  const jours = parseInt(req.query.jours, 10);
  const fenetre = Number.isFinite(jours) ? jours : 15;
  const filtreDate =
    fenetre > 0
      ? { createdAt: { $gte: new Date(Date.now() - fenetre * 86400000) } }
      : {};

  const [scannees, manuelles] = await Promise.all([
    Preparation.aggregate([
      { $match: { nomDossierDBF: dossier, ...filtreDate } },
      { $sort: { createdAt: -1 } },
      { $limit: 300 },
      {
        $lookup: {
          from: "users",
          localField: "user",
          foreignField: "_id",
          as: "agent",
        },
      },
      {
        $project: {
          numpro: 1,
          type: 1,
          proformaInfo: 1,
          phase: 1,
          status: 1,
          colisage: 1,
          createdAt: 1,
          preparationDebutAt: 1,
          preparationFinAt: 1,
          commentaire: 1,
          rapportAt: "$rapport.generatedAt",
          emailAt: "$rapport.emailSentAt",
          nbLignes: { $size: { $ifNull: ["$lignes", []] } },
          // Une ligne est « faite » quand chaque zone qui la concerne a été
          // traitée : un article uniquement au dock ne doit pas rester en
          // attente parce que sa part magasin est à zéro.
          lignesFaites: {
            $size: {
              $filter: {
                input: { $ifNull: ["$lignes", []] },
                as: "l",
                cond: {
                  $and: [
                    {
                      $or: [
                        { $eq: [{ $ifNull: ["$$l.qteDockAPreparer", 0] }, 0] },
                        { $ne: ["$$l.statutDock", "a_faire"] },
                      ],
                    },
                    {
                      $or: [
                        {
                          $eq: [
                            { $ifNull: ["$$l.qteMagasinAPreparer", 0] },
                            0,
                          ],
                        },
                        { $ne: ["$$l.statutMagasin", "a_faire"] },
                      ],
                    },
                  ],
                },
              },
            },
          },
          unitesPreparees: {
            $sum: {
              $map: {
                input: { $ifNull: ["$lignes", []] },
                as: "l",
                in: {
                  $add: [
                    { $ifNull: ["$$l.qtePrepareeDock", 0] },
                    { $ifNull: ["$$l.qtePrepareeMagasin", 0] },
                  ],
                },
              },
            },
          },
          unitesCommandees: { $sum: "$lignes.qteCommandee" },
          agent: { $arrayElemAt: ["$agent", 0] },
        },
      },
    ]),
    FichePreparation.find({ nomDossierDBF: dossier, ...filtreDate })
      .select(
        "numfact statut proformaInfo nbImpressions dernierePrintAt dernierePrintPar prepareAt preparePar commentaire impressions createdAt",
      )
      .sort({ createdAt: -1 })
      .limit(300)
      .lean(),
  ]);

  const lignesScannees = scannees.map((p) => ({
    id: String(p._id),
    origine: "scannee",
    numpro: p.numpro,
    client: p.proformaInfo?.clientNom || "",
    vendeur: p.proformaInfo?.vendeurNom || p.proformaInfo?.vendeurCode || "",
    typeDoc: p.type === "reservation" ? "Réservation" : "Proforma",
    statut: p.status === "termine" ? "prepare" : "en_cours",
    etape: p.status === "termine" ? "" : PHASE_LABEL[p.phase] || p.phase || "",
    operateur: nomAgent(p.agent),
    debutAt: p.preparationDebutAt || p.createdAt,
    finAt: p.preparationFinAt || null,
    nbLignes: p.nbLignes || 0,
    lignesFaites: p.lignesFaites || 0,
    unitesCommandees: p.unitesCommandees || 0,
    unitesPreparees: p.unitesPreparees || 0,
    colisage: p.colisage || null,
    nbImpressions: 0,
    rapportAt: p.rapportAt || null,
    emailAt: p.emailAt || null,
    tempsMs: msEntre(p.preparationDebutAt || p.createdAt, p.preparationFinAt),
    commentaire: p.commentaire || "",
  }));

  const lignesManuelles = manuelles.map((f) => {
    // Début = première impression (c'est le moment où la fiche part dans les
    // allées), pas la création du document de suivi.
    const premiere = (f.impressions || [])[0]?.at || f.dernierePrintAt || null;
    return {
      id: String(f._id),
      origine: "manuelle",
      numpro: f.numfact,
      client: f.proformaInfo?.clientNom || "",
      vendeur: f.proformaInfo?.vendeurNom || f.proformaInfo?.vendeurCode || "",
      typeDoc: "Proforma",
      // « imprimée » = la fiche est partie dans les allées : c'est bien une
      // préparation en cours, même si l'application ne compte aucune ligne.
      statut:
        f.statut === "prepare"
          ? "prepare"
          : f.statut === "imprime"
            ? "en_cours"
            : "a_faire",
      etape: f.statut === "imprime" ? "Fiche imprimée" : "",
      operateur: f.preparePar || f.dernierePrintPar || "",
      debutAt: premiere,
      finAt: f.prepareAt || null,
      // Rien n'est saisi ligne à ligne sur une fiche papier : on ne prétend pas
      // le contraire, l'écran affiche « — » plutôt qu'un faux 0.
      nbLignes: null,
      lignesFaites: null,
      unitesCommandees: null,
      unitesPreparees: null,
      colisage: null,
      nbImpressions: f.nbImpressions || 0,
      rapportAt: null,
      emailAt: null,
      tempsMs: msEntre(premiere, f.prepareAt),
      commentaire: f.commentaire || "",
    };
  });

  let lignes = [...lignesScannees, ...lignesManuelles].sort(
    (a, b) => new Date(b.debutAt || 0) - new Date(a.debutAt || 0),
  );

  const origine = String(req.query.origine || "").trim();
  if (["scannee", "manuelle"].includes(origine)) {
    lignes = lignes.filter((l) => l.origine === origine);
  }
  const etat = String(req.query.etat || "").trim();
  if (["a_faire", "en_cours", "prepare"].includes(etat)) {
    lignes = lignes.filter((l) => l.statut === etat);
  } else if (etat === "actif") {
    lignes = lignes.filter((l) => l.statut !== "prepare");
  }

  const totaux = lignes.reduce(
    (acc, l) => {
      acc[l.statut] += 1;
      acc[l.origine] += 1;
      acc.unites += l.unitesPreparees || 0;
      acc.colis +=
        (l.colisage?.nbColis || 0) +
        (l.colisage?.nbPalettes || 0) +
        (l.colisage?.nbLongueurs || 0);
      return acc;
    },
    { a_faire: 0, en_cours: 0, prepare: 0, scannee: 0, manuelle: 0, unites: 0, colis: 0 },
  );

  res.json({ fenetreJours: fenetre, totaux, lignes });
});

export { getSuiviPreparations };
export default { getSuiviPreparations };
