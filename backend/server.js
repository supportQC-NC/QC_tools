// backend/server.js
import "./loadEnv.js"; // ⬅️ DOIT rester la toute première ligne (charge dotenv avant tout)
import path from "path";
import http from "http";
import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import fs from "fs";
import { Server as SocketServer } from "socket.io";

import connectDB from "./config/db.js";
import initChat from "./socket/chatSocket.js";

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
import dashboardRoutes from "./routes/dashboardRoutes.js";
import dashboardLayoutRoutes from "./routes/dashboardLayoutRoutes.js";
import { installerMasqueDbf } from "./middleware/masquerChampsDbf.js";
import champsDbfRoutes from "./routes/champsDbfRoutes.js";
// ========== ROUTES COMMANDES ==========
import commandeRoutes from "./routes/commandeRoutes.js";
// ========== ROUTES CONTRÔLE COMMANDES ==========
import controleCommandeRoutes from "./routes/controleCommandeRoutes.js";
// ========== ROUTES RÉCEPTION DE MARCHANDISES ==========
import receptionRoutes from "./routes/receptionRoutes.js";
// ========== ROUTES PRÉPARATION DE COMMANDE ==========
import preparationRoutes from "./routes/preparationRoutes.js";
import etiquetteRoutes from "./routes/etiquetteRoutes.js";
import changementPrixRoutes from "./routes/changementPrixRoutes.js";
import pachatHistoriqueRoutes from "./routes/pachatHistoriqueRoutes.js";
import suiviEntreesRoutes from "./routes/suiviEntreesRoutes.js";
import rapportTgcRoutes from "./routes/rapportTgcRoutes.js";
import balancesRoutes from "./routes/balancesRoutes.js";
import configRapportsRoutes from "./routes/configRapportsRoutes.js";
import communicationClientRoutes from "./routes/communicationClientRoutes.js";
import resaEntreesRoutes from "./routes/resaEntreesRoutes.js";
import editionPromoRoutes from "./routes/editionPromoRoutes.js";
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
import envoiCdeFournisseurRoutes from "./routes/envoiCdeFournisseurRoutes.js";
import factureRoutes from "./routes/factureRoutes.js";
import clientRoutes from "./routes/clientRoutes.js";
import filialesRoutes from "./routes/filialesRoutes.js";
 import reapproLocalRoutes from "./routes/reapproLocalRoutes.js";
import commerciauxRoutes from "./routes/commerciauxRoutes.js";
import topVentesRoutes from "./routes/topVentesRoutes.js";
import menuHintRoutes from "./routes/menuHintRoutes.js";
import menuLayoutRoutes from "./routes/menuLayoutRoutes.js";
import smtpConfigRoutes from "./routes/smtpConfigRoutes.js";
import debitComptantRoutes from "./routes/debitComptantRoutes.js";
   import gencodDoublonsRoutes from "./routes/gencodDoublonsRoutes.js";
 import performanceDockRoutes from "./routes/performanceDockRoutes.js";
  import collecteurRoutes from "./routes/collecteurRoutes.js";
       import appReleaseRoutes from "./routes/appReleaseRoutes.js";
       import bipageCollecteRoutes from "./routes/bipageCollecteRoutes.js";

       import factureAnalyseRoutes from "./routes/factureAnalyseRoutes.js";
import journalCaisseRoutes from "./routes/journalCaisseRoutes.js";
import topArticlesRoutes from "./routes/topArticlesRoutes.js";
import analyseReapproRoutes from "./routes/analyseReapproRoutes.js";
import demandeReapproRoutes from "./routes/demandeReapproRoutes.js";
import demandeBipageRoutes from "./routes/demandeBipageRoutes.js";
import receptionSuiviRoutes from "./routes/receptionSuiviRoutes.js";
import ficheArticleRoutes from "./routes/ficheArticleRoutes.js";
// ========== ROUTES ÉQUIPES (hiérarchie responsables) ==========
import teamRoutes from "./routes/teamRoutes.js";
// ========== ROUTES TÂCHES ==========
import taskRoutes from "./routes/taskRoutes.js";
// ⚠️ ABONNEMENTS AUX RAPPORTS — remonté (avait été retiré par erreur).
//    Vérifie le nom exact du fichier dans backend/routes/ ; si ce n'est pas
//    "reportSubscriptionRoutes.js", corrige juste cette ligne.
import reportSubscriptionRoutes from "./routes/reportSubscriptionRoutes.js";
// ========== ROUTES ANALYSE CA (13 onglets, admin) ==========
import analyseCaRoutes from "./routes/analyseCaRoutes.js";
// ========== ROUTES EXÉCUTABLES (catalogue téléchargeable, GridFS) ==========
import executableRoutes from "./routes/executableRoutes.js";
// ========== ROUTES MESSAGES (chat temps réel) ==========
import messageRoutes from "./routes/messageRoutes.js";
// ========== ROUTES NOTIFICATIONS (badges sidebar) ==========
import notificationRoutes from "./routes/notificationRoutes.js";
// ========== ROUTES CONVERSATIONS (discussions Espace équipe) ==========
import conversationRoutes from "./routes/conversationRoutes.js";
// ========== ROUTES MAILING (campagnes email clients) ==========
import mailingRoutes from "./routes/mailingRoutes.js";
// ========== ROUTES ASSISTANT IA (chat métier branché sur les données) ==========
import aiRoutes from "./routes/aiRoutes.js";
// ========== ROUTES DICTIONNAIRE DES RAYONS (étiquettes rayons/sous-zones) ==========
import dictionnaireRayonsRoutes from "./routes/dictionnaireRayonsRoutes.js";
// ========== API PARTENAIRE (clé d'API, lecture seule, prestataires externes) ==========
import publicApiRoutes from "./routes/publicApiRoutes.js";
import { startMailingScheduler } from "./services/mailingScheduler.js";
import { startAiSnapshotScheduler } from "./services/aiSnapshotService.js";
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
  app.use(express.json({ limit: "5mb" }));
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
// Masquage des champs DBF interdits : enveloppe res.json pour TOUTES les routes
// de l'API. Doit rester AVANT les routeurs. Le masque lui-même est posé par
// `protect` (voir middleware/masquerChampsDbf.js).
app.use("/api", installerMasqueDbf);

// Utilisateurs & Authentification
app.use("/api/users", userRoutes);
app.use("/api/champs-dbf", champsDbfRoutes);
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
// ========== ROUTES RÉCEPTION DE MARCHANDISES ==========
app.use("/api/receptions", receptionRoutes);
// ========== ROUTES PRÉPARATION DE COMMANDE ==========
app.use("/api/preparations", preparationRoutes);
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
app.use("/api/etiquettes", etiquetteRoutes);
app.use("/api/changement-prix", changementPrixRoutes);
app.use("/api/historique-pachat", pachatHistoriqueRoutes);
app.use("/api/suivi-entrees", suiviEntreesRoutes);
app.use("/api/rapport-tgc", rapportTgcRoutes);
app.use("/api/balances-clients", balancesRoutes);
app.use("/api/config-rapports", configRapportsRoutes);
app.use("/api/communication-client", communicationClientRoutes);
app.use("/api/resa-entrees", resaEntreesRoutes);
app.use("/api/edition-promo", editionPromoRoutes);
// ========== ROUTES FOURNISSEURS ==========
app.use("/api/fournisseurs", fournissRoutes);
app.use("/api/envoi-cde-fournisseur", envoiCdeFournisseurRoutes);
app.use("/api/clients", clientRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/dashboard-layout", dashboardLayoutRoutes);
app.use("/api/commerciaux", commerciauxRoutes);
app.use("/api/top-ventes", topVentesRoutes);
app.use("/api/menu-hints", menuHintRoutes);
app.use("/api/menu-layout", menuLayoutRoutes);
app.use("/api/smtp-config", smtpConfigRoutes);
app.use("/api/filiales", filialesRoutes);
app.use("/api/reappro-local", reapproLocalRoutes);
  app.use("/api/debit-comptant", debitComptantRoutes);
   app.use("/api/gencod-doublons", gencodDoublonsRoutes);
 app.use("/api/performance-dock", performanceDockRoutes);
  app.use("/api/collecteurs", collecteurRoutes);
    app.use("/api/app-release", appReleaseRoutes);
    app.use("/api/bipage-collecte", bipageCollecteRoutes);

    app.use("/api/facture-analyse", factureAnalyseRoutes);
app.use("/api/journal-caisse", journalCaisseRoutes);
app.use("/api/top-articles", topArticlesRoutes);
app.use("/api/analyse-reappro", analyseReapproRoutes);
app.use("/api/demande-reappro", demandeReapproRoutes);
app.use("/api/demande-bipage", demandeBipageRoutes);
app.use("/api/reception-suivi", receptionSuiviRoutes);
app.use("/api/fiche-article", ficheArticleRoutes);
// ========== ROUTES ÉQUIPES ==========
app.use("/api/teams", teamRoutes);
// ========== ROUTES TÂCHES ==========
app.use("/api/tasks", taskRoutes);
// ⚠️ ABONNEMENTS AUX RAPPORTS (répare /api/report-subscriptions/available)
app.use("/api/report-subscriptions", reportSubscriptionRoutes);
// ========== ROUTES ANALYSE CA ==========
app.use("/api/analyse-ca", analyseCaRoutes);
// ========== ROUTES EXÉCUTABLES ==========
app.use("/api/executables", executableRoutes);
// ========== ROUTES MESSAGES (chat) ==========
app.use("/api/messages", messageRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/conversations", conversationRoutes);
app.use("/api/mailing", mailingRoutes);
app.use("/api/ai", aiRoutes);
app.use("/api/dictionnaire-rayons", dictionnaireRayonsRoutes);
// ========== API PARTENAIRE ==========
// Authentification par clé d'API (X-API-Key), PAS par cookie JWT.
// Lecture seule, périmètre verrouillé par société ET par ressource.
// Doc intégrateur : docs/API_PARTENAIRE.md
app.use("/api/public/v1", publicApiRoutes);
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

// Serveur HTTP + Socket.IO (chat temps réel). Même origine que le REST :
// le cookie JWT est envoyé au handshake (auth dans socket/chatSocket.js).
const server = http.createServer(app);
const io = new SocketServer(server, {
  cors: { origin: true, credentials: true },
});
// Rendre `io` accessible aux contrôleurs REST (ex. notif de nouvelle tâche) via
// req.app.get("io").
app.set("io", io);
initChat(io);

// Démarrage du serveur
server.listen(PORT, () => {
  console.log(`🚀 Server is running on http://localhost:${PORT}`);

  // Surveillance .DAT + impression des fiches de contrôle.
  // Elle ne doit tourner QUE là où sont l'imprimante ET le Rcommun :
  //   - en dev (tout-en-un local) → on la lance ici ;
  //   - en prod, le backend est le VPS Ubuntu (ne peut PAS imprimer) → NE PAS
  //     la lancer ici ; c'est l'« agent d'impression » local (npm run print-agent,
  //     sur le serveur 192.168.0.250) qui la porte.
  // Règle : on démarre le watcher dans le serveur sauf si on est en prod
  // (RCOMMON_STOCK_ROOT défini) ; surcharge possible via RUN_FICHE_WATCHER.
  const forceWatcher = process.env.RUN_FICHE_WATCHER; // "true" / "false"
  const watcherInServer =
    forceWatcher != null
      ? String(forceWatcher).toLowerCase() === "true"
      : !process.env.RCOMMON_STOCK_ROOT;
  if (watcherInServer) {
    startInventaireWatcher();
  } else {
    console.log(
      "🖨️  Watcher fiches NON démarré dans le serveur (prod VPS) — utiliser l'agent local `npm run print-agent` sur le poste imprimante.",
    );
  }

  startMailingScheduler();
  startAiSnapshotScheduler();
});