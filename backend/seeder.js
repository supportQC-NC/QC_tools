// backend/seeder.js
import mongoose from "mongoose";
import dotenv from "dotenv";
import colors from "colors";

// Models
import User from "./models/UserModel.js";
import Permission from "./models/PermissionModel.js";
import Entreprise from "./models/EntrepriseModel.js";

// Data
import users from "./data/users.js";
import permissions from "./data/permissions.js";
import entreprises from "./data/entreprises.js";

// Config
import connectDB from "./config/db.js";

dotenv.config();

connectDB();

const importData = async () => {
  try {
    // 1. Nettoyer la base de données
    await User.deleteMany();
    await Permission.deleteMany();
    await Entreprise.deleteMany();

    console.log("🗑️  Base de données nettoyée".yellow);

    // 2. Créer les entreprises
    const createdEntreprises = await Entreprise.insertMany(entreprises);
    console.log(`✅ ${createdEntreprises.length} entreprise(s) créée(s)`.green);

    // 3. Créer les utilisateurs UN PAR UN (pour le hash password)
    const createdUsers = [];
    for (const userData of users) {
      const user = await User.create(userData);
      createdUsers.push(user);
    }

    console.log(`✅ ${createdUsers.length} utilisateur(s) créé(s)`.green);

    // 4. Créer les permissions pour chaque utilisateur
    for (let i = 0; i < createdUsers.length; i++) {
      const user = createdUsers[i];
      const permData = permissions[i];

      // Toutes les entreprises pour admin ET user dans ce cas
      const userEntreprises = createdEntreprises.map((e) => e._id);

      await Permission.create({
        user: user._id,
        entreprises: userEntreprises,
        allEntreprises: permData.allEntreprises,
        allModules: permData.allModules,
        modules: permData.modules,
      });
    }

    console.log("✅ Permissions créées".green);

    console.log("");
    console.log("=".repeat(50).cyan);
    console.log("🚀 Données importées avec succès !".green.bold);
    console.log("=".repeat(50).cyan);
    console.log("");
    console.log("👤 Utilisateurs créés:".cyan);
    console.log("   Admin:".yellow);
    console.log("   📧 admin@qctools.com".cyan);
    console.log("   🔑 Admin123!".cyan);
    console.log("");
    console.log("   User:".yellow);
    console.log("   📧 user@qctools.com".cyan);
    console.log("   🔑 User123!".cyan);
    console.log("   🏢 Accès: QC, DQ, FMB".cyan);
    console.log("");
    console.log("🏢 Entreprises créées:".cyan);
    createdEntreprises.forEach((e) => {
      console.log(`   - ${e.trigramme}: ${e.nomComplet}`.cyan);
    });
    console.log("");

    process.exit();
  } catch (error) {
    console.error(`❌ Erreur: ${error.message}`.red.bold);
    console.error(error);
    process.exit(1);
  }
};

const destroyData = async () => {
  try {
    await User.deleteMany();
    await Permission.deleteMany();
    await Entreprise.deleteMany();

    console.log("🗑️  Toutes les données ont été supprimées !".red.bold);
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
