// backend/seedMasterConfig.js
//
// CLI du seeder « Socle config rapports ». La logique vit dans
// services/masterConfigSeedService.js (NON-DESTRUCTIVE, partagée avec le bouton
// « Importer la config » du hub /admin/config-rapports).
//
// Usage :
//   npm run masterconfig:import    -> importe sans écraser l'existant
//   npm run masterconfig:destroy   -> vide les 5 collections dédiées
//                                     (ne touche PAS aux champs de l'Entreprise)
import dotenv from "dotenv";
import colors from "colors";

import connectDB from "./config/db.js";
import { runMasterConfigSeed } from "./services/masterConfigSeedService.js";

import AbonnementRapportClient from "./models/masterConfig/AbonnementRapportClientModel.js";
import GroupePrioritaire from "./models/masterConfig/GroupePrioritaireModel.js";
import GroupeSpecial from "./models/masterConfig/GroupeSpecialModel.js";
import MailCompta from "./models/masterConfig/MailComptaModel.js";
import ListEnvoiFactAuto from "./models/masterConfig/ListEnvoiFactAutoModel.js";

dotenv.config();
connectDB();

const importData = async () => {
  try {
    const r = await runMasterConfigSeed();
    console.log("🚀 Import « Config rapports » (non-destructif) terminé :".green.bold);
    console.log(
      `   abonnements +${r.abonnements} | groupes prio +${r.groupesPrioritaires} | groupes spé +${r.groupesSpeciaux} | mails compta +${r.mailsCompta} | factures auto +${r.facturesAuto} | entreprises MAJ ${r.entreprisesMaj}`
        .green,
    );
    if (r.ignores.length) {
      console.log(
        `⚠️  Sociétés ignorées (trigramme absent en base) : ${r.ignores.join(", ")}`
          .yellow,
      );
    }
    process.exit();
  } catch (error) {
    console.error(`❌ Erreur: ${error.message}`.red.bold);
    console.error(error);
    process.exit(1);
  }
};

const destroyData = async () => {
  try {
    await Promise.all([
      AbonnementRapportClient.deleteMany(),
      GroupePrioritaire.deleteMany(),
      GroupeSpecial.deleteMany(),
      MailCompta.deleteMany(),
      ListEnvoiFactAuto.deleteMany(),
    ]);
    console.log(
      "🗑️  Données « Config rapports » supprimées (5 collections dédiées ; champs Entreprise intacts)."
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
