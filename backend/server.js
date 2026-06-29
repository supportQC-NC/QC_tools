// backend/server.js
import "./loadEnv.js"; // ⬅️ DOIT rester la toute première ligne (charge dotenv avant tout)
import path from "path";
import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import fs from "fs";

import connectDB from "./config/db.js";

// Import des routes
import userRoutes from "./routes/userRoutes.js";
import articleRoutes from "./routes/articleRoutes.js";
import entrepriseRoutes from "./routes/entrepriseRoutes.js";
import inventaireRoutes from "./routes/InventaireRoutes.js";
import reapproRoutes from "./routes/reaproRoutes.js";
import photoRoutes from "./routes/photoRoutes.js";
import filialeRoutes from "./routes/fillialeRoutes.js";
import concurrentRoutes from "./routes/concurrentRoutes.js";
import releveRoutes from "./routes/releveRoutes.js";
// ========== ROUTES COMMANDES ==========
import commandeRoutes from "./routes/commandeRoutes.js";
// ========== ROUTES CONTRÔLE COMMANDES ==========
import controleCommandeRoutes from "./routes/controleCommandeRoutes.js";
// ========== ROUTES ZONES (INVENTAIRE) ==========
import zoneRoutes from "./routes/zoneRoutes.js";
// ========== ROUTES INVENTAIRE ZONES (PROGRESSION) ==========
import inventaireZoneRoutes from "./routes/inventaireZoneRoutes.js";
// ========== ROUTES COLLECTE INVENTAIRE (AGENT TERRAIN) ==========
import inventaireCollecteRoutes from "./routes/inventaireCollecteRoutes.js";
// ========== ROUTES FICHES DE CONTRÔLE (.DAT) ==========
import ficheControleRoutes from "./routes/ficheControleRoutes.js";
// ========== ROUTES DÉTAIL DES BIPAGES ==========
import bipageRoutes from "./routes/bipageRoutes.js";
import { startInventaireWatcher } from "./services/inventaireWatchService.js";
// ========== ROUTES PROFORMA ==========
import proformaRoutes from "./routes/proformaRoutes.js";
// ========== ROUTES INVENTAIRE PROFORMA (admin, lecture) ==========
import inventaireProformaRoutes from "./routes/inventaireProformaRoutes.js";
// =======================================
// ========== ROUTES FOURNISS ==========
import fournissRoutes from "./routes/fournissRoutes.js";
import factureRoutes from "./routes/factureRoutes.js";
import clientRoutes from "./routes/clientRoutes.js";

// =======================================
import { notFound, errorHandler } from "./middleware/errorMiddleware.js";

const PORT = process.env.PORT || 8000;

// Connexion à la base de données
connectDB();

const app = express();

// CORS middleware - IMPORTANT: configurer avec credentials pour les cookies
app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
    credentials: true,
  }),
);

// Cookie parser middleware
app.use(cookieParser());

// Middleware pour parser le JSON
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Servir les fichiers statiques du dossier uploads
const __dirname = path.resolve();
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Créer les dossiers uploads si nécessaire
const uploadDirs = [
  "./uploads",
  "./uploads/temp",
];

uploadDirs.forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`📁 Dossier créé: ${dir}`);
  }
});

// Route de base (uniquement hors production : en prod, le front React est servi)
app.get("/", (req, res, next) => {
  if (process.env.NODE_ENV === "production") return next();
  res.send("API QC TOOLS is running...");
});

// ==========================================
// ROUTES API
// ==========================================
// Utilisateurs & Authentification
app.use("/api/users", userRoutes);
app.use("/api/entreprises", entrepriseRoutes);
app.use("/api/articles", articleRoutes);
app.use("/api/inventaires", inventaireRoutes);
app.use("/api/reappros", reapproRoutes);
app.use("/api/photos", photoRoutes);
app.use("/api/filiales", filialeRoutes);
app.use("/api/concurrents", concurrentRoutes);
app.use("/api/releves", releveRoutes);
// ========== ROUTES COMMANDES ==========
app.use("/api/commandes", commandeRoutes);
// ========== ROUTES CONTRÔLE COMMANDES ==========
app.use("/api/controle-commandes", controleCommandeRoutes);
// ========== ROUTES ZONES (INVENTAIRE) ==========
app.use("/api/zones", zoneRoutes);
// ========== ROUTES INVENTAIRE ZONES (PROGRESSION) ==========
app.use("/api/inventaires-zones", inventaireZoneRoutes);
// ========== ROUTES COLLECTE INVENTAIRE (AGENT TERRAIN) ==========
app.use("/api/inventaires-collecte", inventaireCollecteRoutes);
// ========== ROUTES FICHES DE CONTRÔLE (.DAT) ==========
app.use("/api/fiches-controle", ficheControleRoutes);
// ========== ROUTES DÉTAIL DES BIPAGES ==========
app.use("/api/bipages", bipageRoutes);
// ========== ROUTES FACTURES ==========
app.use("/api/factures", factureRoutes );
// ========== ROUTES PROFORMAS ==========
app.use("/api/proformas", proformaRoutes);
// ========== ROUTES INVENTAIRE PROFORMA (admin, lecture) ==========
app.use("/api/inventaire-proforma", inventaireProformaRoutes);
// ========== ROUTES FOURNISSEURS ==========
app.use("/api/fournisseurs", fournissRoutes);
app.use("/api/clients", clientRoutes);
// =======================================

// ==========================================
// FRONTEND (production) — servi par Express pour une SEULE origine
// (indispensable derrière le tunnel : cookie JWT sameSite=strict OK,
//  pas de CORS, BASE_URL="" côté front fonctionne tel quel).
// Définir FRONTEND_BUILD_PATH = chemin absolu du build CRA.
// ==========================================
if (process.env.NODE_ENV === "production") {
  const buildPath =
    process.env.FRONTEND_BUILD_PATH ||
    path.join(__dirname, "frontend", "build");

  if (fs.existsSync(buildPath)) {
    app.use(express.static(buildPath));
    // Toute route hors /api et /uploads -> index.html (routing côté client)
    app.get(/^(?!\/api|\/uploads).*/, (req, res) => {
      res.sendFile(path.join(buildPath, "index.html"));
    });
    console.log(`🖥️  Frontend servi depuis: ${buildPath}`);
  } else {
    console.warn(
      `⚠️  FRONTEND_BUILD_PATH introuvable (${buildPath}) — le front ne sera pas servi par Express.`,
    );
  }
}

// ==========================================
// ERROR MIDDLEWARES
// ==========================================

app.use(notFound);
app.use(errorHandler);

// Démarrage du serveur
app.listen(PORT, () => {
  console.log(`🚀 Server is running on http://localhost:${PORT}`);
  startInventaireWatcher();
});