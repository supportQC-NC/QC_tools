// backend/scripts/diagInventaire.js
//
// Diagnostic du pipeline fiche de contrôle inventaire par zone.
// À lancer sur la machine qui a ACCÈS AU PARTAGE STOCK (poste dev Windows, ou
// le poste agent d'impression 192.168.0.250) :
//
//   node backend/scripts/diagInventaire.js
//
// Il affiche, pour chaque inventaire ACTIF :
//   - le dossier réellement surveillé (recalculé depuis le slug/nom) ;
//   - l'arborescence de ce dossier (pour voir OÙ sont les .dat) ;
//   - le résultat d'un passage du watcher (statut par fichier) → indique
//     pourquoi le PDF n'est pas généré (zone_inconnue / ignore / erreur…).
//
// ⚠ Ce script EXÉCUTE un vrai passage (il peut générer/déplacer des PDF).

import "../loadEnv.js";
import fs from "fs";
import path from "path";
import mongoose from "mongoose";
import connectDB from "../config/db.js";
import InventaireZoneSession from "../models/InventaireZoneSessionModel.js";
import { config, getInventaireDirs } from "../services/ficheControleService.js";
import { tickOnce, isWatching } from "../services/inventaireWatchService.js";

const liste = (dir, prof = 0) => {
  let out = "";
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    return `${"  ".repeat(prof)}⚠ illisible : ${err.message}\n`;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      out += `${"  ".repeat(prof)}📁 ${e.name}/\n`;
      if (prof < 2) out += liste(p, prof + 1);
    } else {
      let size = "";
      try {
        size = ` (${fs.statSync(p).size} o)`;
      } catch {
        /* ignore */
      }
      out += `${"  ".repeat(prof)}📄 ${e.name}${size}\n`;
    }
  }
  return out || `${"  ".repeat(prof)}(vide)\n`;
};

const main = async () => {
  await connectDB();

  console.log("\n=== CONFIG ===");
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI || "";
  const dbName = (uri.match(/mongodb(?:\+srv)?:\/\/[^/]+\/([^?]+)/i) || [])[1] || "(défaut)";
  console.log("BASE MongoDB     :", decodeURIComponent(dbName), "  ⚠ doit être IDENTIQUE à celle du backend de prod");
  console.log("sharePath        :", config.sharePath);
  console.log("STOCK_SHARE_PATH :", process.env.STOCK_SHARE_PATH || "(non défini)");
  console.log("autoprint        :", config.autoprint);
  console.log("watcher actif ici:", isWatching());

  const sessions = await InventaireZoneSession.find({ statut: "actif" });
  console.log(`\n=== SESSIONS ACTIVES : ${sessions.length} ===`);
  for (const s of sessions) {
    const slug = s.dossierSlug || s.nom;
    const base = slug ? getInventaireDirs(slug).base : s.dossierDat;
    console.log(`\n— Société ${s.entreprise} · « ${s.nom} »`);
    console.log("  dossierSlug :", s.dossierSlug || "(vide → repli sur nom)");
    console.log("  dossierDat  :", s.dossierDat || "(vide)");
    console.log("  Dossier SURVEILLÉ (recalculé) :", base);
    console.log("  existe ?", base ? fs.existsSync(base) : false);
    if (base && fs.existsSync(base)) {
      console.log("  Arborescence :");
      process.stdout.write(
        liste(base)
          .split("\n")
          .map((l) => (l ? "    " + l : l))
          .join("\n"),
      );
    }
  }

  console.log("\n=== PASSAGE DU WATCHER (tickOnce) ===");
  const report = await tickOnce();
  console.log(JSON.stringify(report, null, 2));

  await mongoose.disconnect();
  console.log("\n✔ Diagnostic terminé.");
};

main().catch(async (err) => {
  console.error("Erreur diagnostic :", err);
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
