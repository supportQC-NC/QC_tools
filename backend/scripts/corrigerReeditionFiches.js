// backend/scripts/corrigerReeditionFiches.js
//
// RATTRAPAGE one-shot : recalcule la marque RÉÉDITION des fiches de contrôle.
//
// La première version (27/11/2026 matin) marquait « RÉÉDITION (1) - AJOUT »
// dès qu'une FicheControle existait déjà pour le .DAT — or le document est
// aussi créé par le verrou de réservation et le fichier peut être retraité
// sans nouveau bipage : TOUTES les premières fiches sortaient marquées.
// Depuis le correctif, la marque ne vient QUE d'un complément de bipage
// (collecte `estComplement` dans le cumul de la zone) ; ce script réaligne
// les fiches déjà figées en base sur cette règle, pour que l'aperçu web
// (assurerPdfFiche) cesse de ressortir la fausse marque.
// À lancer sur une machine dont le .env pointe la bonne base Mongo :
//   node backend/scripts/corrigerReeditionFiches.js
//
// Idempotent : rejouable sans effet au-delà de la première passe.

import "../loadEnv.js";
import mongoose from "mongoose";
import FicheControle from "../models/FicheControleModel.js";
import InventaireCollecte from "../models/InventaireCollecteModel.js";

await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
console.log(`Base : ${mongoose.connection.name} (${mongoose.connection.host})`);

const fiches = await FicheControle.find({}).select(
  "entreprise session zoneCode zoneType reedition reeditionNum pdfFileName datFileName",
);
let corrigees = 0;
for (const fiche of fiches) {
  // Même périmètre que le cumul du watcher : les collectes DÉPOSÉES de la
  // zone, bornées à LA session de la fiche, annulées exclues.
  const complements = await InventaireCollecte.countDocuments({
    entreprise: fiche.entreprise,
    session: fiche.session,
    zoneCode: fiche.zoneCode,
    zoneType: fiche.zoneType || "",
    status: "exporte",
    annulee: { $ne: true },
    estComplement: true,
  });
  const reeditionNum = complements > 0 ? complements : 0;
  const reedition = reeditionNum ? `RÉÉDITION (${reeditionNum}) - AJOUT` : "";
  if (fiche.reedition !== reedition || fiche.reeditionNum !== reeditionNum) {
    console.log(
      `${fiche.datFileName} : « ${fiche.reedition || "(première édition)"} » → « ${
        reedition || "(première édition)"
      } »`,
    );
    await FicheControle.updateOne(
      { _id: fiche._id },
      { $set: { reedition, reeditionNum } },
    );
    corrigees += 1;
  }
}
console.log(`${fiches.length} fiche(s) examinée(s), ${corrigees} corrigée(s).`);

await mongoose.disconnect();
