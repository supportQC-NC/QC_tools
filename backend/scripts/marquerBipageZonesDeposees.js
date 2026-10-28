// backend/scripts/marquerBipageZonesDeposees.js
//
// RATTRAPAGE one-shot : coche la phase « bipage » des zones de la session
// d'inventaire ACTIVE qui ont déjà une collecte déposée (status "exporte").
//
// Depuis le 29/10/2026 le dépôt d'une zone coche cette phase automatiquement
// (inventaireCollecteController) ; ce script aligne les zones déposées AVANT
// la mise en place. À lancer sur une machine dont le .env pointe la bonne
// base Mongo :  node backend/scripts/marquerBipageZonesDeposees.js
//
// Idempotent : une zone déjà cochée n'est pas retouchée.

import "../loadEnv.js";
import mongoose from "mongoose";
import InventaireZoneSession from "../models/InventaireZoneSessionModel.js";
import InventaireCollecte from "../models/InventaireCollecteModel.js";

const norm = (s) => String(s || "").trim().toUpperCase();

await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
console.log(`Base : ${mongoose.connection.name} (${mongoose.connection.host})`);

const sessions = await InventaireZoneSession.find({ statut: "actif" });
if (!sessions.length) console.log("Aucune session d'inventaire active.");

for (const session of sessions) {
  const exportees = await InventaireCollecte.find({
    session: session._id,
    status: "exporte",
  }).select("zoneCode zoneType user exportedAt");

  let marquees = 0;
  for (const c of exportees) {
    const zone =
      session.zones.find(
        (z) =>
          norm(z.code) === norm(c.zoneCode) && norm(z.type) === norm(c.zoneType),
      ) || session.zones.find((z) => norm(z.code) === norm(c.zoneCode));
    if (zone && !zone.bipage?.fait) {
      zone.bipage = {
        fait: true,
        at: c.exportedAt || new Date(),
        by: c.user || null,
        saisiPar: c.user || null,
      };
      marquees += 1;
    }
  }
  if (marquees) {
    session.markModified("zones");
    await session.save();
  }
  console.log(
    `${session.nom} : ${exportees.length} collecte(s) déposée(s), ${marquees} zone(s) marquée(s) BIPÉE(S).`,
  );
}

await mongoose.disconnect();
