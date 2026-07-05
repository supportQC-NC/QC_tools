// backend/migrateAdminsSuperAdmin.js
//
// Migration ponctuelle liée au nouveau contrôle d'accès par entreprise.
// Désormais, un ADMIN n'accède plus à toutes les entreprises « par magie » :
// il faut `allEntreprises = true` sur son document Permission (= super-admin).
//
// Ce script garantit que TOUS les comptes de rôle "admin" restent super-admins :
//   - crée un document Permission { allEntreprises: true, allModules: true } s'il n'existe pas ;
//   - force allEntreprises = true et allModules = true s'il existe.
// -> aucun admin n'est verrouillé après le déploiement. Vous pourrez ensuite
//    restreindre un admin au cas par cas (allEntreprises = false + liste d'entreprises)
//    depuis l'écran Utilisateurs.
//
// Utilisation (depuis la racine du projet, comme server.js) :
//   node backend/migrateAdminsSuperAdmin.js            (applique)
//   node backend/migrateAdminsSuperAdmin.js --dry-run  (affiche sans modifier)
//
// IDEMPOTENT : relançable sans risque.

import "./loadEnv.js"; // charge dotenv (MONGO_URI, etc.) avant tout
import mongoose from "mongoose";
import connectDB from "./config/db.js";
import User from "./models/UserModel.js";
import Permission from "./models/PermissionModel.js";

const DRY_RUN = process.argv.includes("--dry-run");

const run = async () => {
  await connectDB();

  const admins = await User.find({ role: "admin" }).select("_id email");
  console.log(`\n${admins.length} compte(s) admin trouvé(s).\n`);

  let crees = 0;
  let maj = 0;
  let inchanges = 0;

  for (const admin of admins) {
    const perm = await Permission.findOne({ user: admin._id });

    if (!perm) {
      console.log(`+ ${admin.email} : Permission absente -> création super-admin`);
      if (!DRY_RUN) {
        await Permission.create({
          user: admin._id,
          entreprises: [],
          modules: {},
          allEntreprises: true,
          allModules: true,
        });
      }
      crees += 1;
      continue;
    }

    if (perm.allEntreprises === true && perm.allModules === true) {
      inchanges += 1;
      continue;
    }

    console.log(
      `~ ${admin.email} : allEntreprises=${perm.allEntreprises}, allModules=${perm.allModules} -> true/true`,
    );
    if (!DRY_RUN) {
      perm.allEntreprises = true;
      perm.allModules = true;
      await perm.save();
    }
    maj += 1;
  }

  console.log(
    `\n${DRY_RUN ? "[DRY-RUN] " : ""}Terminé — créés: ${crees}, mis à jour: ${maj}, inchangés: ${inchanges}.\n`,
  );

  await mongoose.connection.close();
  process.exit(0);
};

run().catch(async (err) => {
  console.error("Erreur migration:", err);
  try {
    await mongoose.connection.close();
  } catch {
    /* ignore */
  }
  process.exit(1);
});