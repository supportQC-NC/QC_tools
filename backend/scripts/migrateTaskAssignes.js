// backend/scripts/migrateTaskAssignes.js
//
// Migration ponctuelle : recopie l'ancien champ mono `assigneA` dans le nouveau
// tableau `assignes` pour les tâches créées avant le passage au multi-assignés.
// À exécuter UNE fois :  NODE_OPTIONS= node backend/scripts/migrateTaskAssignes.js
//
// ⚠️ Agit sur la base MongoDB configurée dans .env (MONGO_URI).

import "../loadEnv.js";
import mongoose from "mongoose";
import connectDB from "../config/db.js";

const run = async () => {
  await connectDB();
  const coll = mongoose.connection.collection("tasks");

  // Tâches sans `assignes` (ou vide) mais avec un ancien `assigneA` défini.
  const res = await coll.updateMany(
    {
      assigneA: { $exists: true, $ne: null },
      $or: [{ assignes: { $exists: false } }, { assignes: { $size: 0 } }],
    },
    [{ $set: { assignes: ["$assigneA"] } }],
  );

  console.log(
    `Migration terminée : ${res.modifiedCount} tâche(s) mise(s) à jour (assigneA -> assignes).`,
  );
  await mongoose.disconnect();
  process.exit(0);
};

run().catch((e) => {
  console.error("Erreur migration:", e);
  process.exit(1);
});
