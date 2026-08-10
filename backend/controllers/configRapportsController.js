// backend/controllers/configRapportsController.js
//
// CRUD générique du « Socle config rapports ». Chaque ressource (URL) est mappée
// à un modèle Mongo via le registre RESOURCES. Config transverse admin : gate par
// le module de permission `config_rapports` (pas de scope société côté route ;
// le champ `entreprise` des collections scopées est porté par le document).
import fs from "fs";
import path from "path";
import asyncHandler from "../middleware/asyncHandler.js";
import { runMasterConfigSeed } from "../services/masterConfigSeedService.js";
import articleCacheService from "../services/articleService.js";
import {
  buildResourceWorkbook,
  parseResourceWorkbook,
} from "../services/configResourceExcelService.js";
import { envoyerClasseur } from "../utils/envoyerClasseur.js";
import Entreprise from "../models/EntrepriseModel.js";

import AbonnementRapportClient from "../models/masterConfig/AbonnementRapportClientModel.js";
import GroupePrioritaire from "../models/masterConfig/GroupePrioritaireModel.js";
import GroupeSpecial from "../models/masterConfig/GroupeSpecialModel.js";
import MailCompta from "../models/masterConfig/MailComptaModel.js";
import ListEnvoiFactAuto from "../models/masterConfig/ListEnvoiFactAutoModel.js";

// nom de ressource (URL) -> { model, entrepriseScoped, hasUser }
// NB : les libellés d'états (commande/facture/proforma/réservation) et la config
// société vivent désormais sur le modèle Entreprise (édités via EntrepriseModal),
// pas ici — on ne garde que les données PAR CLIENT / référentiels.
// `excel` : ressource exportable / importable en Excel.
//   - `cle`     : clé naturelle servant au rapprochement à l'import
//   - `columns` : colonnes du classeur ; `readOnly` = exportée pour info,
//                 ignorée à l'import.
const RESOURCES = {
  abonnements: { model: AbonnementRapportClient, entrepriseScoped: true, hasUser: true },
  "groupes-prioritaires": {
    model: GroupePrioritaire,
    entrepriseScoped: true,
    hasUser: false,
    excel: {
      label: "Groupes prioritaires",
      cle: "groupe",
      columns: [
        { name: "groupe", label: "Groupe" },
        // Champ Mongo `description`, affiché « Libellé ». `aliases` garde
        // lisibles les classeurs exportés avant le renommage.
        { name: "description", label: "Libellé", aliases: ["Description"] },
        { name: "nbArticles", label: "Articles", readOnly: true },
      ],
    },
  },
  "groupes-speciaux": {
    model: GroupeSpecial,
    entrepriseScoped: true,
    hasUser: false,
    excel: {
      label: "Groupes spéciaux",
      cle: "codeListe",
      columns: [
        { name: "codeListe", label: "Code liste" },
        { name: "lblListe", label: "Libellé" },
        { name: "format", label: "Format" },
        { name: "codeJpg", label: "Code JPG" },
      ],
    },
  },
  "mails-compta": { model: MailCompta, entrepriseScoped: true, hasUser: true },
  "factures-auto": { model: ListEnvoiFactAuto, entrepriseScoped: true, hasUser: true },
};

// Entrée `excel` de la ressource, ou 400 si elle n'est pas gérée.
const getExcelConfig = (req, res) => {
  const entry = getResource(req, res);
  if (!entry.excel) {
    res.status(400);
    throw new Error(
      `La ressource ${req.params.resource} n'est pas exportable en Excel.`,
    );
  }
  return entry;
};

// Récupère l'entrée du registre ou lève une 400.
const getResource = (req, res) => {
  const entry = RESOURCES[req.params.resource];
  if (!entry) {
    res.status(400);
    throw new Error(`Ressource de config inconnue : ${req.params.resource}`);
  }
  return entry;
};

// GET /:resource  (?entrepriseId=... pour filtrer les ressources scopées)
const listResource = asyncHandler(async (req, res) => {
  const { model, entrepriseScoped, hasUser } = getResource(req, res);
  const filter = {};
  if (entrepriseScoped && req.query.entrepriseId) {
    filter.entreprise = req.query.entrepriseId;
  }
  let query = model.find(filter).sort({ updatedAt: -1 });
  if (entrepriseScoped) {
    query = query.populate("entreprise", "trigramme nomComplet nom");
  }
  if (hasUser) {
    query = query.populate("user", "nom prenom email");
  }
  const items = await query.lean();
  res.json(items);
});

// POST /:resource
const createResource = asyncHandler(async (req, res) => {
  const { model } = getResource(req, res);
  const created = await model.create(req.body);
  res.status(201).json(created);
});

// PUT /:resource/:id
const updateResource = asyncHandler(async (req, res) => {
  const { model } = getResource(req, res);
  const updated = await model.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true,
  });
  if (!updated) {
    res.status(404);
    throw new Error("Enregistrement introuvable");
  }
  res.json(updated);
});

// DELETE /:resource/:id
const deleteResource = asyncHandler(async (req, res) => {
  const { model } = getResource(req, res);
  const deleted = await model.findByIdAndDelete(req.params.id);
  if (!deleted) {
    res.status(404);
    throw new Error("Enregistrement introuvable");
  }
  res.json({ message: "Supprimé", _id: req.params.id });
});

// POST /seed — importe la config initiale depuis les JSON (NON-DESTRUCTIF :
// n'ajoute que ce qui manque, ne modifie jamais l'existant). Pour la prod.
const seedConfig = asyncHandler(async (req, res) => {
  const result = await runMasterConfigSeed();
  res.json({
    message: "Import terminé (non-destructif).",
    ...result,
  });
});

// POST /groupes-prioritaires/sync-articles   body/query : { entrepriseId }
//
// Scanne article.dbf de la société et complète SA liste de groupes prioritaires.
// NON-DESTRUCTIF : crée uniquement les codes GROUPE absents de cette société et
// ne touche jamais la `description` d'une ligne existante ; le comptage
// d'articles est rafraîchi sur toutes les lignes vues au scan.
const syncGroupesPrioritaires = asyncHandler(async (req, res) => {
  const entrepriseId = req.body?.entrepriseId || req.query?.entrepriseId;
  if (!entrepriseId) {
    res.status(400);
    throw new Error("entrepriseId est requis pour scanner la base article.");
  }

  const entreprise = await Entreprise.findById(entrepriseId);
  if (!entreprise) {
    res.status(404);
    throw new Error("Entreprise introuvable");
  }

  const dbfPath = path.join(
    entreprise.cheminBase,
    entreprise.nomDossierDBF,
    "article.dbf",
  );
  if (!fs.existsSync(dbfPath)) {
    res.status(404);
    throw new Error(
      `Base article introuvable pour ${entreprise.nomDossierDBF} (${dbfPath}).`,
    );
  }

  // Garde-fou AVANT toute écriture : tant que l'index unique global `groupe_1`
  // est en place, un bulkWrite non ordonné écrirait une partie des lignes puis
  // échouerait sur les doublons — on refuse donc en amont.
  const indexes = await GroupePrioritaire.collection.indexes().catch(() => []);
  if (indexes.some((i) => i.name === "groupe_1")) {
    res.status(409);
    throw new Error(
      "Index obsolète `groupe_1` encore présent : lancez " +
        "`npm run migrate:groupes-prioritaires` pour passer les groupes " +
        "prioritaires en liste par société.",
    );
  }

  // [{ code, count }] trié par code, comptage sur l'index GROUPE du cache.
  const groupesDbf = await articleCacheService
    .getGroupes(entreprise)
    .then((liste) => liste.filter((g) => g.code && g.code.trim()));

  // Existant DE CETTE SOCIÉTÉ uniquement.
  const existants = await GroupePrioritaire.find({ entreprise: entreprise._id })
    .select("groupe")
    .lean();
  const dejaLa = new Set(existants.map((g) => (g.groupe || "").toUpperCase()));

  const manquants = groupesDbf.filter(
    (g) => !dejaLa.has(g.code.toUpperCase()),
  );

  // Upsert par (entreprise, groupe) : crée les manquants, rafraîchit le
  // comptage des autres sans écraser leur description.
  const maintenant = new Date();
  const operations = groupesDbf.map((g) => ({
    updateOne: {
      filter: { entreprise: entreprise._id, groupe: g.code.toUpperCase() },
      update: {
        $set: { nbArticles: g.count, scanneLe: maintenant },
        $setOnInsert: { description: "" },
      },
      upsert: true,
    },
  }));

  if (operations.length > 0) {
    try {
      await GroupePrioritaire.bulkWrite(operations, { ordered: false });
    } catch (e) {
      // Filet de sécurité : doublon inattendu malgré le garde-fou ci-dessus.
      if (e?.code === 11000 || e?.writeErrors?.some((w) => w.code === 11000)) {
        res.status(409);
        throw new Error(
          "Conflit d'unicité sur les groupes prioritaires. Vérifiez les index " +
            "avec `npm run migrate:groupes-prioritaires -- --dry-run`.",
        );
      }
      throw e;
    }
  }

  res.json({
    message:
      manquants.length > 0
        ? `${manquants.length} groupe(s) ajouté(s) pour ${entreprise.nomDossierDBF}.`
        : `Aucun groupe manquant : la liste couvre déjà les ${groupesDbf.length} groupes de ${entreprise.nomDossierDBF}.`,
    entreprise: entreprise.nomDossierDBF,
    groupesDansBase: groupesDbf.length,
    ajoutes: manquants.length,
    codesAjoutes: manquants.map((g) => g.code.toUpperCase()),
  });
});

// GET /:resource/export?entrepriseId=...  -> classeur Excel de la liste
const exportResource = asyncHandler(async (req, res) => {
  const { model, entrepriseScoped, excel } = getExcelConfig(req, res);

  const filter = {};
  let entreprise = null;
  if (entrepriseScoped) {
    if (!req.query.entrepriseId) {
      res.status(400);
      throw new Error("entrepriseId est requis pour exporter cette ressource.");
    }
    entreprise = await Entreprise.findById(req.query.entrepriseId).lean();
    if (!entreprise) {
      res.status(404);
      throw new Error("Entreprise introuvable");
    }
    filter.entreprise = entreprise._id;
  }

  const items = await model.find(filter).sort({ [excel.cle]: 1 }).lean();

  const { workbook, filename, count } = buildResourceWorkbook({
    label: excel.label,
    columns: excel.columns,
    items,
    entreprise,
  });

  // envoyerClasseur applique les droits « champ par champ » avant l'envoi :
  // un export ne doit pas contourner ce qui est masqué à l'écran.
  await envoyerClasseur(req, res, workbook, filename, { "X-Lignes": count });
});

// POST /:resource/import  (multipart : file + entrepriseId)
//
// Complète la liste depuis le classeur : cellule renseignée -> écrase,
// cellule vide -> conserve la valeur en base, clé inconnue -> ligne créée.
// Aucune suppression : une ligne absente du fichier reste en base.
const importResource = asyncHandler(async (req, res) => {
  const { model, entrepriseScoped, excel } = getExcelConfig(req, res);

  if (!req.file?.buffer) {
    res.status(400);
    throw new Error("Aucun fichier reçu (champ « file »).");
  }

  const filtreBase = {};
  if (entrepriseScoped) {
    const entrepriseId = req.body?.entrepriseId;
    if (!entrepriseId) {
      res.status(400);
      throw new Error("entrepriseId est requis pour importer cette ressource.");
    }
    const entreprise = await Entreprise.findById(entrepriseId).lean();
    if (!entreprise) {
      res.status(404);
      throw new Error("Entreprise introuvable");
    }
    filtreBase.entreprise = entreprise._id;
  }

  const { lignes, entetesIgnores } = await parseResourceWorkbook(
    req.file.buffer,
    excel.columns,
    excel.cle,
  );

  const modifiables = excel.columns.filter(
    (c) => !c.readOnly && c.name !== excel.cle,
  );

  let crees = 0;
  let misAJour = 0;
  let inchanges = 0;
  const erreurs = [];
  const vus = new Set();

  for (const { valeurs, numero } of lignes) {
    const cle = String(valeurs[excel.cle] || "").trim();
    if (!cle) {
      erreurs.push(`Ligne ${numero} : clé « ${excel.cle} » vide, ignorée.`);
      continue;
    }
    if (vus.has(cle.toUpperCase())) {
      erreurs.push(`Ligne ${numero} : « ${cle} » en double dans le fichier, ignorée.`);
      continue;
    }
    vus.add(cle.toUpperCase());

    // Seules les cellules renseignées sont appliquées.
    const aPoser = {};
    for (const c of modifiables) {
      const v = valeurs[c.name];
      if (v !== undefined && v !== "") aPoser[c.name] = v;
    }

    try {
      const filtre = { ...filtreBase, [excel.cle]: cle };
      const existant = await model.findOne(filtre);
      if (!existant) {
        await model.create({ ...filtreBase, [excel.cle]: cle, ...aPoser });
        crees += 1;
      } else if (Object.keys(aPoser).length === 0) {
        inchanges += 1;
      } else {
        const change = Object.entries(aPoser).some(
          ([k, v]) => String(existant[k] ?? "") !== String(v),
        );
        if (!change) {
          inchanges += 1;
        } else {
          Object.assign(existant, aPoser);
          await existant.save();
          misAJour += 1;
        }
      }
    } catch (e) {
      erreurs.push(`Ligne ${numero} (« ${cle} ») : ${e.message}`);
    }
  }

  res.json({
    message:
      `${lignes.length} ligne(s) lue(s) — ${crees} créée(s), ` +
      `${misAJour} mise(s) à jour, ${inchanges} inchangée(s)` +
      (erreurs.length ? `, ${erreurs.length} en erreur` : "") +
      ".",
    lues: lignes.length,
    crees,
    misAJour,
    inchanges,
    erreurs: erreurs.slice(0, 20),
    entetesIgnores,
  });
});

export {
  listResource,
  createResource,
  updateResource,
  deleteResource,
  seedConfig,
  syncGroupesPrioritaires,
  exportResource,
  importResource,
};
