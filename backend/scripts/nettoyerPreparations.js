// backend/scripts/nettoyerPreparations.js
//
// NETTOYAGE DES SESSIONS DE PRÉPARATION FANTÔMES (17/11/2026).
//
// Constaté en production : la même commande sortait plusieurs fois « en
// cours » au suivi — jusqu'à 6 sessions identiques créées la même seconde
// (rafale de POST du même agent, aucun index unique), et des sessions
// « en cours » survivant à la clôture de la commande par une autre session.
//
// Ce script résorbe l'EXISTANT en passant « abandonne » (jamais de
// suppression : l'historique des lignes reste consultable) :
//   1. toute session en_cours dont la commande a AUSSI une session terminée ;
//   2. les doublons en_cours d'une même commande — on garde la session la
//      plus récemment ACTIVE (updatedAt), les autres sont abandonnées.
//
// ⚠️ À lancer AVANT le premier démarrage du backend portant l'index unique
// partiel (entreprise, numpro, status=en_cours) : l'index ne peut pas se
// construire tant que les doublons existent.
//
// Usage (depuis la racine du dépôt, MONGO_URI du .env — le pointer sur la
// base de PRODUCTION pour nettoyer la prod) :
//
//   npm run preparations:nettoyer            # applique
//   npm run preparations:nettoyer -- --dry   # montre sans rien écrire

import "../loadEnv.js";
import mongoose from "mongoose";
import connectDB from "../config/db.js";
import Preparation from "../models/PreparationModel.js";

const dry = process.argv.includes("--dry");

await connectDB();

const abandonner = async (ids, motif) => {
  if (!ids.length || dry) return;
  await Preparation.updateMany(
    { _id: { $in: ids } },
    { $set: { status: "abandonne", abandonAt: new Date(), abandonMotif: motif } },
  );
};

// ── 1) en_cours dont la commande a une session terminée ─────────────────────
const terminees = await Preparation.find({ status: "termine" })
  .select("entreprise numpro")
  .lean();
const clesTerminees = new Set(
  terminees.map((p) => `${p.entreprise}|${String(p.numpro).trim()}`),
);

const enCours = await Preparation.find({ status: "en_cours" })
  .select("entreprise numpro user updatedAt createdAt")
  .lean();

const dejaPreparees = enCours.filter((p) =>
  clesTerminees.has(`${p.entreprise}|${String(p.numpro).trim()}`),
);
console.log(
  `1) Sessions en_cours d'une commande DÉJÀ PRÉPARÉE : ${dejaPreparees.length}`,
);
for (const p of dejaPreparees) {
  console.log(`   - ${p.numpro} (session ${p._id}, créée ${p.createdAt?.toISOString?.() || p.createdAt})`);
}
await abandonner(
  dejaPreparees.map((p) => p._id),
  "Nettoyage : commande déjà préparée par une autre session",
);

// ── 2) doublons en_cours restants d'une même commande ───────────────────────
const restantes = enCours.filter(
  (p) => !clesTerminees.has(`${p.entreprise}|${String(p.numpro).trim()}`),
);
const parCommande = new Map();
for (const p of restantes) {
  const cle = `${p.entreprise}|${String(p.numpro).trim()}`;
  if (!parCommande.has(cle)) parCommande.set(cle, []);
  parCommande.get(cle).push(p);
}

let doublons = 0;
for (const [, sessions] of parCommande) {
  if (sessions.length < 2) continue;
  // On garde la plus récemment ACTIVE, les autres sont des fantômes.
  sessions.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  const aFermer = sessions.slice(1);
  doublons += aFermer.length;
  console.log(
    `2) ${sessions[0].numpro} : ${sessions.length} sessions en_cours → on garde ${sessions[0]._id}`,
  );
  await abandonner(
    aFermer.map((p) => p._id),
    "Nettoyage : doublon de session (rafale de création)",
  );
}
console.log(`2) Doublons en_cours fermés : ${doublons}`);

console.log(
  dry
    ? "\n(--dry : rien n'a été écrit)"
    : `\n✔ Nettoyage terminé : ${dejaPreparees.length + doublons} session(s) passée(s) « abandonne ».`,
);
await mongoose.connection.close();
process.exit(0);
