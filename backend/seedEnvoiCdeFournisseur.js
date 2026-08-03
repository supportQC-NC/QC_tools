// backend/seedEnvoiCdeFournisseur.js
//
// Seeder AUTONOME du module « Envoi Commande Fournisseur ».
// Importe les données migrées depuis Access (ENVOI_CDE_FOURN.accdb) :
//   - emails fournisseurs (MAIL_FOURNISSEUR)  -> FournisseurEmail
//   - modèles de message (tblMessage)         -> MessageFournisseur
//   - responsables / CC (MAIL_RESPONSABLE)    -> ResponsableCc
//
// Il NE TOUCHE PAS aux collections cœur (users / entreprises / permissions).
// Chaque enregistrement est rattaché à l'Entreprise via son `trigramme`
// (= code société « ET » de l'Access). Les sociétés dont le trigramme n'existe
// pas en base sont ignorées (avec un avertissement).
//
// Usage :
//   npm run data:import:envoi-cde     -> upsert des données
//   npm run data:destroy:envoi-cde    -> vide les 3 collections
import mongoose from "mongoose";
import dotenv from "dotenv";
import colors from "colors";

import connectDB from "./config/db.js";
import Entreprise from "./models/EntrepriseModel.js";
import FournisseurEmail from "./models/FournisseurEmailModel.js";
import MessageFournisseur from "./models/MessageFournisseurModel.js";
import ResponsableCc from "./models/ResponsableCcModel.js";

import fournisseurEmails from "./data/fournisseurEmails.js";
import messagesFournisseur from "./data/messagesFournisseur.js";
import responsablesCc from "./data/responsablesCc.js";

dotenv.config();
connectDB();

// Construit une map de résolution vers l'_id d'entreprise, par nomDossierDBF
// (clé stable partagée entre Access et web) ET par trigramme (repli).
const buildEntrepriseMap = async () => {
  const entreprises = await Entreprise.find({}, "trigramme nomDossierDBF").lean();
  const map = new Map();
  for (const e of entreprises) {
    if (e.nomDossierDBF) map.set(String(e.nomDossierDBF).toLowerCase(), e._id);
    if (e.trigramme) map.set(String(e.trigramme).toUpperCase(), e._id);
  }
  return map;
};

// Résout une ligne (par nomDossierDBF puis, à défaut, par code société ET/trigramme).
const resolveEntreprise = (map, row) => {
  if (row.nomDossierDBF) {
    const byDossier = map.get(String(row.nomDossierDBF).toLowerCase());
    if (byDossier) return byDossier;
  }
  if (row.et) return map.get(String(row.et).toUpperCase());
  if (row.trigramme) return map.get(String(row.trigramme).toUpperCase());
  return undefined;
};

const importData = async () => {
  try {
    const entMap = await buildEntrepriseMap();
    const ignores = new Set();

    // ─── 1. Emails fournisseurs ───────────────────────────────────────────
    let okEmails = 0;
    for (const row of fournisseurEmails) {
      const entrepriseId = resolveEntreprise(entMap, row);
      if (!entrepriseId) {
        ignores.add(row.nomDossierDBF || row.et);
        continue;
      }
      await FournisseurEmail.updateOne(
        { entreprise: entrepriseId, fournId: row.fournId },
        {
          $set: {
            fournLbl: row.fournLbl || "",
            langue: row.langue === "A" ? "A" : "F",
            emails: row.emails || [],
            emailsTransitaire: row.emailsTransitaire || [],
            emailsCC: row.emailsCC || [],
          },
          $setOnInsert: { actif: true },
        },
        { upsert: true },
      );
      okEmails += 1;
    }
    console.log(`✅ ${okEmails} email(s) fournisseur importé(s)`.green);

    // ─── 2. Modèles de message ────────────────────────────────────────────
    let okMsg = 0;
    for (const row of messagesFournisseur) {
      const entrepriseId = resolveEntreprise(entMap, row);
      if (!entrepriseId) {
        ignores.add(row.nomDossierDBF || row.et);
        continue;
      }
      await MessageFournisseur.updateOne(
        { entreprise: entrepriseId, langue: row.langue },
        { $set: { message: row.message || "" } },
        { upsert: true },
      );
      okMsg += 1;
    }
    console.log(`✅ ${okMsg} modèle(s) de message importé(s)`.green);

    // ─── 3. Responsables / CC ─────────────────────────────────────────────
    let okResp = 0;
    for (const row of responsablesCc) {
      const entrepriseId = resolveEntreprise(entMap, row);
      if (!entrepriseId) {
        ignores.add(row.nomDossierDBF || row.et);
        continue;
      }
      await ResponsableCc.updateOne(
        { entreprise: entrepriseId },
        { $set: { nom: row.nom || "", emails: row.emails || [] } },
        { upsert: true },
      );
      okResp += 1;
    }
    console.log(`✅ ${okResp} responsable(s) / CC importé(s)`.green);

    if (ignores.size > 0) {
      console.log(
        `⚠️  Sociétés ignorées (trigramme absent en base) : ${[...ignores].join(", ")}`
          .yellow,
      );
    }

    console.log("🚀 Import « Envoi Cde Fournisseur » terminé !".green.bold);
    process.exit();
  } catch (error) {
    console.error(`❌ Erreur: ${error.message}`.red.bold);
    console.error(error);
    process.exit(1);
  }
};

const destroyData = async () => {
  try {
    await FournisseurEmail.deleteMany();
    await MessageFournisseur.deleteMany();
    await ResponsableCc.deleteMany();
    console.log(
      "🗑️  Données « Envoi Cde Fournisseur » supprimées (emails/messages/responsables)."
        .red.bold,
    );
    process.exit();
  } catch (error) {
    console.error(`❌ Erreur: ${error.message}`.red.bold);
    process.exit(1);
  }
};

if (process.argv[2] === "-d") {
  destroyData();
} else {
  importData();
}
