// backend/scripts/listActive.js — lecture seule : liste les sessions actives,
// leur société, leur dossier surveillé, et le contenu (sous-dossiers + fichiers).
import "../loadEnv.js";
import fs from "fs";
import path from "path";
import mongoose from "mongoose";
import connectDB from "../config/db.js";
import InventaireZoneSession from "../models/InventaireZoneSessionModel.js";
import Entreprise from "../models/EntrepriseModel.js";
import { getInventaireDirs } from "../services/ficheControleService.js";

const listeRec = (dir, prof = 0) => {
  let out = "";
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    return `${"  ".repeat(prof)}! ${e.code || e.message}\n`;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      out += `${"  ".repeat(prof)}[DIR] ${e.name}/\n`;
      if (prof < 2) out += listeRec(p, prof + 1);
    } else {
      let sz = "";
      try {
        sz = ` (${fs.statSync(p).size} o)`;
      } catch {
        /* ignore */
      }
      out += `${"  ".repeat(prof)}      ${e.name}${sz}\n`;
    }
  }
  return out || `${"  ".repeat(prof)}(vide)\n`;
};

await connectDB();
const sessions = await InventaireZoneSession.find({ statut: "actif" });
console.log(`\n===== SESSIONS ACTIVES : ${sessions.length} =====\n`);
for (const s of sessions) {
  const ent = await Entreprise.findById(s.entreprise).select("trigramme");
  const slug = s.dossierSlug || s.nom;
  const base = slug ? getInventaireDirs(slug).base : s.dossierDat;
  console.log("Société    :", ent ? ent.trigramme : String(s.entreprise));
  console.log("Inventaire :", s.nom);
  console.log("dossierSlug:", s.dossierSlug || "(vide → repli nom)");
  console.log("Dossier    :", base);
  console.log("Existe ?   :", base ? fs.existsSync(base) : false);
  if (base && fs.existsSync(base)) {
    console.log("Contenu    :");
    process.stdout.write(listeRec(base, 1));
  }
  console.log("--------------------------------------------------");
}
await mongoose.disconnect();
