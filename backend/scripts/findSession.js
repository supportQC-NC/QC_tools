import "../loadEnv.js";
import mongoose from "mongoose";
import connectDB from "../config/db.js";
import InventaireZoneSession from "../models/InventaireZoneSessionModel.js";

await connectDB();
const all = await InventaireZoneSession.find({}).select("nom statut dossierSlug entreprise createdAt").sort({ createdAt: -1 }).limit(20);
console.log(`\nDernières sessions dans CETTE base : ${all.length}\n`);
for (const s of all) {
  console.log(
    (s.statut === "actif" ? "★ACTIF " : "  arch "),
    (s.nom || "").padEnd(38),
    "slug:", s.dossierSlug || "(vide)",
  );
}
const match = all.find((s) => (s.nom || "").includes("12:49") || (s.dossierSlug || "").includes("12h49"));
console.log("\nSession « 12:49:03 » présente dans cette base ?", !!match);
await mongoose.disconnect();
