// backend/historiserPachat.js
//
// CLI d'historisation des prix d'achat (module « Historique prix d'achat »).
// Parcourt toutes les entreprises et persiste leurs lignes de commande courantes
// dans la collection Mongo HistoriquePachat (idempotent). À lancer
// PÉRIODIQUEMENT (idéalement avant l'archivage annuel des commandes de l'ERP)
// pour construire un historique pluriannuel.
//
// Usage :
//   npm run pachat:historiser            -> toutes les sociétés
//   npm run pachat:historiser -- qc ld   -> seulement ces nomDossierDBF
import dotenv from "dotenv";
import colors from "colors";

import connectDB from "./config/db.js";
import Entreprise from "./models/EntrepriseModel.js";
import { historiserPachatCommandes } from "./services/pachatHistoriqueService.js";

dotenv.config();

const run = async () => {
  await connectDB();
  const filtres = process.argv.slice(2).map((s) => s.toLowerCase());
  const query = filtres.length ? { nomDossierDBF: { $in: filtres } } : {};
  const ents = await Entreprise.find(query);

  console.log(
    `📈 Historisation prix d'achat — ${ents.length} société(s)`.cyan.bold,
  );

  let totIns = 0;
  let totUpd = 0;
  for (const e of ents) {
    try {
      const t0 = Date.now();
      const r = await historiserPachatCommandes(e);
      totIns += r.inserted;
      totUpd += r.updated;
      console.log(
        `   ✅ ${e.nomDossierDBF.padEnd(22)} scan ${r.scanned} | +${r.inserted} nouv. | ${r.updated} maj | ${Date.now() - t0}ms`
          .green,
      );
    } catch (err) {
      console.log(`   ⚠️  ${e.nomDossierDBF.padEnd(22)} ${err.message}`.yellow);
    }
  }
  console.log(
    `🏁 Terminé : +${totIns} lignes historisées, ${totUpd} mises à jour.`.cyan
      .bold,
  );
  process.exit(0);
};

run().catch((err) => {
  console.error(`❌ Erreur: ${err.message}`.red.bold);
  console.error(err);
  process.exit(1);
});
