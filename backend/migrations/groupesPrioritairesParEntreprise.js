// backend/migrations/groupesPrioritairesParEntreprise.js
//
// Fait passer les groupes prioritaires d'un référentiel GLOBAL (un doc par code
// GROUPE, index unique `groupe_1`) à une liste PAR SOCIÉTÉ (un doc par couple
// entreprise + groupe).
//
// Ce que fait la migration :
//   1. Supprime l'index unique obsolète `groupe_1` (il interdirait à deux
//      sociétés de partager un même code).
//   2. Recopie chaque ligne « héritée » (sans `entreprise`) dans TOUTES les
//      sociétés, description conservée — l'ancienne liste était commune, donc
//      elle s'appliquait de fait à tout le monde.
//   3. Supprime les lignes héritées une fois recopiées.
//   4. Crée le nouvel index unique (entreprise, groupe).
//
// NON-DESTRUCTIF pour les descriptions : une ligne déjà présente pour un couple
// (société, groupe) n'est jamais écrasée.
//
// Usage :  npm run migrate:groupes-prioritaires
//          npm run migrate:groupes-prioritaires -- --dry-run

import "../loadEnv.js";
import mongoose from "mongoose";
import connectDB from "../config/db.js";
import Entreprise from "../models/EntrepriseModel.js";
import GroupePrioritaire from "../models/masterConfig/GroupePrioritaireModel.js";

const DRY_RUN = process.argv.includes("--dry-run");

const log = (...a) => console.log(DRY_RUN ? "[dry-run]" : "[migration]", ...a);

const run = async () => {
  await connectDB();
  const collection = GroupePrioritaire.collection;

  // 1. Index unique global obsolète
  const indexes = await collection.indexes();
  const obsolete = indexes.find((i) => i.name === "groupe_1");
  if (obsolete) {
    log("index obsolète `groupe_1` trouvé →", DRY_RUN ? "à supprimer" : "suppression");
    if (!DRY_RUN) await collection.dropIndex("groupe_1");
  } else {
    log("pas d'index `groupe_1` (déjà migré ou base neuve)");
  }

  // 2/3. Lignes héritées -> une copie par société
  const heritees = await collection
    .find({ entreprise: { $exists: false } })
    .toArray();
  const societes = await Entreprise.find({}).select("_id nomDossierDBF").lean();

  log(`${heritees.length} ligne(s) héritée(s), ${societes.length} société(s)`);

  let crees = 0;
  let ignores = 0;
  if (heritees.length > 0 && societes.length > 0) {
    for (const ligne of heritees) {
      const code = String(ligne.groupe || "").toUpperCase();
      if (!code) continue;
      for (const s of societes) {
        const existe = await collection.findOne({
          entreprise: s._id,
          groupe: code,
        });
        if (existe) {
          ignores += 1;
          continue;
        }
        if (!DRY_RUN) {
          await collection.insertOne({
            entreprise: s._id,
            groupe: code,
            description: ligne.description || "",
            nbArticles: 0,
            scanneLe: null,
            createdAt: ligne.createdAt || new Date(),
            updatedAt: new Date(),
          });
        }
        crees += 1;
      }
    }
    if (!DRY_RUN) {
      const r = await collection.deleteMany({ entreprise: { $exists: false } });
      log(`${r.deletedCount} ligne(s) héritée(s) supprimée(s) après recopie`);
    }
  }

  log(`${crees} ligne(s) créée(s), ${ignores} déjà présente(s) (non touchée(s))`);

  // 4. Nouvel index
  if (!DRY_RUN) {
    await GroupePrioritaire.syncIndexes();
    log("index (entreprise, groupe) unique en place");
  }

  const total = await collection.countDocuments();
  log(`total en base : ${total} ligne(s)`);

  await mongoose.disconnect();
  log("terminé.");
};

run().catch(async (e) => {
  console.error("[migration] ÉCHEC :", e.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
