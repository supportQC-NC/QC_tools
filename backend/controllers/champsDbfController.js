// backend/controllers/champsDbfController.js
//
// Administration des droits « champ par champ » sur les bases DBF.
//   GET  /api/champs-dbf/tables                      -> catalogue des tables
//   GET  /api/champs-dbf/:table/champs?nomDossierDBF -> champs réels de la table
//   GET  /api/champs-dbf/utilisateur/:userId         -> config d'un utilisateur
//   PUT  /api/champs-dbf/utilisateur/:userId         -> enregistre la config
//
// Réservé au module users_admin (mêmes droits que la gestion des utilisateurs).

import asyncHandler from "../middleware/asyncHandler.js";
import Permission from "../models/PermissionModel.js";
import { DBF_TABLES, DBF_TABLE_BY_KEY } from "../config/dbfTables.js";
import {
  listerChampsUnion,
  normaliserConfig,
  invaliderMasque,
} from "../services/dbfChampsService.js";

// GET /tables
const getTables = asyncHandler(async (req, res) => {
  res.json({ tables: DBF_TABLES });
});

// GET /:table/champs
// Les droits par champ sont GLOBAUX (les mêmes pour toutes les sociétés
// auxquelles l'utilisateur a accès) : la liste renvoyée est donc l'UNION des
// structures de toutes les sociétés actives, sans société de référence.
const getChampsTable = asyncHandler(async (req, res) => {
  const { table } = req.params;
  if (!DBF_TABLE_BY_KEY[table]) {
    res.status(400);
    throw new Error(`Table DBF inconnue : ${table}`);
  }

  const champs = await listerChampsUnion(table);
  if (champs.length === 0) {
    res.status(404);
    throw new Error(
      `${DBF_TABLE_BY_KEY[table].fichier} introuvable dans les sociétés actives.`,
    );
  }

  res.json({ table, champs });
});

// GET /utilisateur/:userId
const getConfigUtilisateur = asyncHandler(async (req, res) => {
  const permission = await Permission.findOne({ user: req.params.userId })
    .select("champsDbf")
    .lean();
  res.json({ champsDbf: permission?.champsDbf || {} });
});

// PUT /utilisateur/:userId   body: { champsDbf }
const setConfigUtilisateur = asyncHandler(async (req, res) => {
  const { userId } = req.params;

  // Le complément (champs masqués) est calculé sur l'union des structures de
  // toutes les sociétés : les droits valent pour l'ensemble d'entre elles.
  const champsDbf = await normaliserConfig(req.body?.champsDbf);

  const permission = await Permission.findOneAndUpdate(
    { user: userId },
    { $set: { champsDbf } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );

  // Le masque est mis en cache 1 min : on le purge pour que le retrait d'un
  // droit s'applique immédiatement.
  invaliderMasque(userId);

  const nbTables = Object.keys(champsDbf).length;
  const nbMasques = Object.values(champsDbf).reduce(
    (s, r) => s + (r.masques?.length || 0),
    0,
  );

  res.json({
    message: nbTables
      ? `${nbTables} table(s) restreinte(s), ${nbMasques} champ(s) masqué(s).`
      : "Aucune restriction : cet utilisateur voit tous les champs.",
    champsDbf: permission.champsDbf,
  });
});

export { getTables, getChampsTable, getConfigUtilisateur, setConfigUtilisateur };
