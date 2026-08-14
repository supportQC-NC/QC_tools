// backend/controllers/commercialController.js
//
// ESPACE COMMERCIAL — API de l'interface dédiée aux utilisateurs « commerciaux ».
// Toutes les routes sont protégées par requireCommercial (+ checkEntrepriseAccess
// et checkCommercialEntreprise quand la route porte :nomDossierDBF), de sorte
// qu'un commercial ne peut JAMAIS lire les données d'un autre code vendeur.

import asyncHandler from "../middleware/asyncHandler.js";
import SuiviCommercial from "../models/SuiviCommercialModel.js";
import commercialService from "../services/commercialService.js";
import { vueProfil } from "../middleware/commercialAccess.js";

// Relances / alertes déjà enregistrées par CET utilisateur sur CETTE société.
const chargerSuivis = async (userId, entrepriseId, type) => {
  const docs = await SuiviCommercial.find({
    user: userId,
    entreprise: entrepriseId,
    type,
  }).lean();
  return new Map(docs.map((d) => [d.reference, d]));
};

const intParam = (v, def) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : def;
};

/**
 * @desc    Profil commercial de l'utilisateur connecté (sociétés + codes vendeur)
 * @route   GET /api/commercial/profil
 * @access  Private (profil commercial actif)
 */
const getProfil = asyncHandler(async (req, res) => {
  res.json(
    vueProfil({ actif: true, societes: req.commercialSocietes }),
  );
});

/**
 * @desc    Dashboard commercial — agrégé sur TOUTES ses sociétés, ou une seule
 * @route   GET /api/commercial/dashboard
 * @query   dossier (nomDossierDBF, optionnel), joursRelance, joursInactif
 * @access  Private (profil commercial actif)
 */
const getDashboard = asyncHandler(async (req, res) => {
  const t0 = Date.now();
  const { dossier, joursRelance, joursInactif } = req.query;

  let societes = req.commercialSocietes;
  if (dossier) {
    societes = societes.filter((s) => s.entreprise.nomDossierDBF === dossier);
    if (!societes.length) {
      res.status(403);
      throw new Error("Société hors de votre périmètre commercial");
    }
  }

  const blocs = await Promise.all(
    societes.map(async ({ entreprise, codes }) => {
      const suivis = await chargerSuivis(req.user._id, entreprise._id, "relance");
      try {
        return await commercialService.getDashboardSociete(
          entreprise,
          codes,
          { joursRelance, joursInactif },
          suivis,
        );
      } catch (error) {
        console.error(
          `[Commercial] Dashboard ${entreprise.nomDossierDBF}:`,
          error.message,
        );
        return {
          entreprise: {
            _id: entreprise._id,
            nomDossierDBF: entreprise.nomDossierDBF,
            trigramme: entreprise.trigramme,
            nomComplet: entreprise.nomComplet,
          },
          codes,
          erreur: error.message,
        };
      }
    }),
  );

  const ok = blocs.filter((b) => !b.erreur);
  const somme = (chemin) =>
    ok.reduce((s, b) => {
      const v = chemin.split(".").reduce((o, k) => (o ? o[k] : 0), b);
      return s + (Number(v) || 0);
    }, 0);

  res.json({
    societes: blocs,
    totaux: {
      nbSocietes: ok.length,
      nbClients: somme("portefeuille.nbClients"),
      nbAContacter: somme("portefeuille.nbAContacter"),
      caN: somme("ca.caN"),
      caN1: somme("ca.caN1"),
      margeN: somme("ca.margeN"),
      reservations: somme("documents.reservations.nb"),
      speciales: somme("documents.speciales.nb"),
      preparer: somme("documents.preparer.nb"),
      devis: somme("documents.devis.nb"),
      aRelancer: somme("documents.aRelancer.nb"),
    },
    _queryTime: `${Date.now() - t0}ms`,
  });
});

/**
 * @desc    Volet CHIFFRE D'AFFAIRES du dashboard (CA, top clients, à recontacter)
 * @route   GET /api/commercial/dashboard/ca
 * @query   dossier (optionnel), joursInactif
 * @note    SÉPARÉ du dashboard : dépend du cache des factures, long à
 *          reconstruire (plusieurs minutes sur les grosses sociétés) et
 *          invalidé à chaque facturation. Le front l'affiche en différé.
 */
const getDashboardCa = asyncHandler(async (req, res) => {
  const t0 = Date.now();
  const { dossier, joursInactif } = req.query;

  let societes = req.commercialSocietes;
  if (dossier) {
    societes = societes.filter((s) => s.entreprise.nomDossierDBF === dossier);
    if (!societes.length) {
      res.status(403);
      throw new Error("Société hors de votre périmètre commercial");
    }
  }

  const blocs = await Promise.all(
    societes.map(async ({ entreprise, codes }) => {
      try {
        return await commercialService.getCaSociete(entreprise, codes, {
          joursInactif,
        });
      } catch (error) {
        console.error(
          `[Commercial] CA ${entreprise.nomDossierDBF}:`,
          error.message,
        );
        return {
          entreprise: {
            _id: entreprise._id,
            nomDossierDBF: entreprise.nomDossierDBF,
            trigramme: entreprise.trigramme,
            nomComplet: entreprise.nomComplet,
          },
          erreur: error.message,
        };
      }
    }),
  );

  const ok = blocs.filter((b) => !b.erreur);
  res.json({
    societes: blocs,
    totaux: {
      caN: ok.reduce((s, b) => s + (b.ca?.caN || 0), 0),
      caN1: ok.reduce((s, b) => s + (b.ca?.caN1 || 0), 0),
      margeN: ok.reduce((s, b) => s + (b.ca?.margeN || 0), 0),
      nbAContacter: ok.reduce(
        (s, b) => s + (b.portefeuille?.nbAContacter || 0),
        0,
      ),
    },
    _queryTime: `${Date.now() - t0}ms`,
  });
});

/**
 * @desc    Portefeuille clients (clients.REPRES = son code sur cette société)
 * @route   GET /api/commercial/:nomDossierDBF/clients
 * @query   search, tri (ca|nom|recent|ancien), inactifs, joursInactif, page, limit
 */
const getClients = asyncHandler(async (req, res) => {
  const t0 = Date.now();
  const result = await commercialService.getPortefeuilleListe(
    req.entreprise,
    req.codesCommercial,
    {
      search: req.query.search || undefined,
      tri: req.query.tri || "ca",
      inactifs: req.query.inactifs === "true" || req.query.inactifs === "1",
      joursInactif: req.query.joursInactif,
      page: intParam(req.query.page, 1),
      limit: intParam(req.query.limit, 50),
    },
  );
  res.json({ ...result, _queryTime: `${Date.now() - t0}ms` });
});

/**
 * @desc    Fiche client 360° (infos, CA, factures, proformas, résa, spéciales)
 * @route   GET /api/commercial/:nomDossierDBF/clients/:tiers
 */
const getClient = asyncHandler(async (req, res) => {
  const suivis = await chargerSuivis(
    req.user._id,
    req.entreprise._id,
    "relance",
  );
  const fiche = await commercialService.getFicheClient(
    req.entreprise,
    req.codesCommercial,
    req.params.tiers,
    suivis,
  );
  if (!fiche) {
    res.status(403);
    throw new Error("Ce client ne fait pas partie de votre portefeuille");
  }
  res.json(fiche);
});

/**
 * @desc    Proformas / réservations / commandes spéciales du commercial
 * @route   GET /api/commercial/:nomDossierDBF/proformas
 * @query   categorie (speciale|reservation|preparer|devis), aRelancer,
 *          tiers, search, joursRelance, page, limit
 */
const getProformas = asyncHandler(async (req, res) => {
  const t0 = Date.now();
  const suivis = await chargerSuivis(
    req.user._id,
    req.entreprise._id,
    "relance",
  );
  const result = await commercialService.getProformasCommercial(
    req.entreprise,
    req.codesCommercial,
    {
      categorie: req.query.categorie || undefined,
      aRelancer: req.query.aRelancer === "true" || req.query.aRelancer === "1",
      tiers: req.query.tiers || undefined,
      search: req.query.search || undefined,
      joursRelance: req.query.joursRelance,
      page: intParam(req.query.page, 1),
      limit: intParam(req.query.limit, 50),
    },
    suivis,
  );
  res.json({ ...result, _queryTime: `${Date.now() - t0}ms` });
});

/**
 * @desc    Réservations et commandes spéciales (facture.dbf TYPFACT="R")
 * @route   GET /api/commercial/:nomDossierDBF/reservations
 * @query   categorie (reservation|speciale), tiers, search, fenetreMois
 *          (défaut 12, 0 = tout l'historique), page, limit
 * @note    Source validée avec le client : proforma.dbf ne porte pas les
 *          commandes spéciales (aucun ETAT=0). L'index est construit en
 *          streaming sur les seuls entêtes TYPFACT="R" — on ne passe PAS par
 *          le cache factures complet, bien trop lourd.
 */
const getReservations = asyncHandler(async (req, res) => {
  const t0 = Date.now();
  const result = await commercialService.getReservationsCommercial(
    req.entreprise,
    req.codesCommercial,
    {
      categorie: req.query.categorie || undefined,
      tiers: req.query.tiers || undefined,
      search: req.query.search || undefined,
      fenetreMois:
        req.query.fenetreMois !== undefined
          ? Number(req.query.fenetreMois)
          : undefined,
      page: intParam(req.query.page, 1),
      limit: intParam(req.query.limit, 50),
    },
  );
  res.json({ ...result, _queryTime: `${Date.now() - t0}ms` });
});

/**
 * @desc    Lignes d'une proforma (le document doit être le sien)
 * @route   GET /api/commercial/:nomDossierDBF/proformas/:numfact/lignes
 */
const getProformaLignes = asyncHandler(async (req, res) => {
  const { numfact } = req.params;
  // Contrôle d'appartenance : la proforma doit porter un de SES codes.
  const doc = await commercialService.getProformasCommercial(
    req.entreprise,
    req.codesCommercial,
    { search: numfact, limit: 500 },
  );
  const entete = doc.proformas.find((p) => p.numfact === numfact.trim());
  if (!entete) {
    res.status(403);
    throw new Error("Cette proforma ne vous est pas rattachée");
  }
  const lignes = await commercialService.getLignesProforma(
    req.entreprise,
    numfact,
  );
  res.json({ entete, lignes });
});

/**
 * @desc    Factures du commercial (facture.REPRES = son code sur cette société)
 * @route   GET /api/commercial/:nomDossierDBF/factures
 * @query   tiers, typfact (ex "FA"), search, dateDebut, dateFin, page, limit
 */
const getFactures = asyncHandler(async (req, res) => {
  const t0 = Date.now();
  const result = await commercialService.getFacturesCommercial(
    req.entreprise,
    req.codesCommercial,
    {
      tiers: req.query.tiers || undefined,
      typfact: req.query.typfact || "FA",
      search: req.query.search || undefined,
      dateDebut: req.query.dateDebut || undefined,
      dateFin: req.query.dateFin || undefined,
      page: intParam(req.query.page, 1),
      limit: intParam(req.query.limit, 50),
    },
  );
  res.json({ ...result, _queryTime: `${Date.now() - t0}ms` });
});

/**
 * @desc    Alertes « commande spéciale / réservation disponible » (entrée en stock)
 * @route   GET /api/commercial/:nomDossierDBF/alertes
 * @query   jours (fenêtre de recherche, défaut 45)
 * @note    Endpoint volontairement SÉPARÉ du dashboard : le premier appel scanne
 *          facture.dbf + detail.dbf en streaming (lent), puis c'est caché.
 */
const getAlertes = asyncHandler(async (req, res) => {
  const t0 = Date.now();
  const suivis = await chargerSuivis(req.user._id, req.entreprise._id, "alerte");
  const alertes = await commercialService.getAlertesCommandesSpeciales(
    req.entreprise,
    req.codesCommercial,
    {
      jours: req.query.jours || undefined,
      vues: new Set([...suivis.keys()]),
    },
  );
  res.json({
    entreprise: {
      _id: req.entreprise._id,
      nomDossierDBF: req.entreprise.nomDossierDBF,
      trigramme: req.entreprise.trigramme,
      nomComplet: req.entreprise.nomComplet,
    },
    total: alertes.length,
    nbNouvelles: alertes.filter((a) => !a.vue).length,
    alertes,
    _queryTime: `${Date.now() - t0}ms`,
  });
});

/**
 * @desc    Enregistrer une relance client sur une proforma
 * @route   POST /api/commercial/:nomDossierDBF/relances
 * @body    { numfact, tiers, nomClient, canal, note }
 */
const enregistrerRelance = asyncHandler(async (req, res) => {
  const { numfact, tiers, nomClient, canal, note } = req.body;
  if (!numfact) {
    res.status(400);
    throw new Error("Le numéro de proforma est requis");
  }

  // Contrôle d'appartenance avant toute écriture.
  const doc = await commercialService.getProformasCommercial(
    req.entreprise,
    req.codesCommercial,
    { search: String(numfact), limit: 500 },
  );
  const entete = doc.proformas.find((p) => p.numfact === String(numfact).trim());
  if (!entete) {
    res.status(403);
    throw new Error("Cette proforma ne vous est pas rattachée");
  }

  const suivi = await SuiviCommercial.findOneAndUpdate(
    {
      user: req.user._id,
      entreprise: req.entreprise._id,
      type: "relance",
      reference: String(numfact).trim(),
    },
    {
      $set: {
        tiers: tiers || entete.tiers,
        nomClient: nomClient || entete.nom,
        faitLe: new Date(),
        canal: canal || "",
        note: note || "",
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );

  res.status(201).json(suivi);
});

/**
 * @desc    Relances en masse (sélection de plusieurs proformas à relancer)
 * @route   POST /api/commercial/:nomDossierDBF/relances/lot
 * @body    { numfacts: [], canal, note }
 */
const enregistrerRelancesLot = asyncHandler(async (req, res) => {
  const { numfacts, canal, note } = req.body;
  if (!Array.isArray(numfacts) || !numfacts.length) {
    res.status(400);
    throw new Error("Aucune proforma sélectionnée");
  }

  const doc = await commercialService.getProformasCommercial(
    req.entreprise,
    req.codesCommercial,
    { limit: 100000 },
  );
  const parNum = new Map(doc.proformas.map((p) => [p.numfact, p]));

  const acceptes = [];
  const refuses = [];
  for (const n of numfacts) {
    const key = String(n).trim();
    if (parNum.has(key)) acceptes.push(parNum.get(key));
    else refuses.push(key);
  }

  if (acceptes.length) {
    await SuiviCommercial.bulkWrite(
      acceptes.map((p) => ({
        updateOne: {
          filter: {
            user: req.user._id,
            entreprise: req.entreprise._id,
            type: "relance",
            reference: p.numfact,
          },
          update: {
            $set: {
              tiers: p.tiers,
              nomClient: p.nom,
              faitLe: new Date(),
              canal: canal || "",
              note: note || "",
            },
          },
          upsert: true,
        },
      })),
    );
  }

  res.status(201).json({
    enregistrees: acceptes.length,
    refusees: refuses,
  });
});

/**
 * @desc    Annuler une relance (la proforma repasse « à relancer »)
 * @route   DELETE /api/commercial/:nomDossierDBF/relances/:numfact
 */
const supprimerRelance = asyncHandler(async (req, res) => {
  await SuiviCommercial.deleteOne({
    user: req.user._id,
    entreprise: req.entreprise._id,
    type: "relance",
    reference: String(req.params.numfact).trim(),
  });
  res.json({ message: "Relance annulée" });
});

/**
 * @desc    Historique des relances de l'utilisateur sur cette société
 * @route   GET /api/commercial/:nomDossierDBF/relances
 */
const getRelances = asyncHandler(async (req, res) => {
  const relances = await SuiviCommercial.find({
    user: req.user._id,
    entreprise: req.entreprise._id,
    type: "relance",
  })
    .sort({ faitLe: -1 })
    .limit(500)
    .lean();
  res.json({ total: relances.length, relances });
});

/**
 * @desc    Marquer des alertes comme vues (elles quittent le badge « nouvelles »)
 * @route   POST /api/commercial/:nomDossierDBF/alertes/vues
 * @body    { cles: [] }
 */
const marquerAlertesVues = asyncHandler(async (req, res) => {
  const { cles } = req.body;
  if (!Array.isArray(cles) || !cles.length) {
    res.status(400);
    throw new Error("Aucune alerte sélectionnée");
  }
  await SuiviCommercial.bulkWrite(
    cles.map((cle) => ({
      updateOne: {
        filter: {
          user: req.user._id,
          entreprise: req.entreprise._id,
          type: "alerte",
          reference: String(cle),
        },
        update: { $set: { faitLe: new Date() } },
        upsert: true,
      },
    })),
  );
  res.json({ marquees: cles.length });
});

export {
  getProfil,
  getDashboard,
  getDashboardCa,
  getClients,
  getClient,
  getProformas,
  getReservations,
  getProformaLignes,
  getFactures,
  getAlertes,
  enregistrerRelance,
  enregistrerRelancesLot,
  supprimerRelance,
  getRelances,
  marquerAlertesVues,
};
