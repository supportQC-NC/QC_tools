// backend/printAgent.js
//
// AGENT D'IMPRESSION LOCAL (fiches de contrôle d'inventaire).
//
// Pourquoi : en production, le backend tourne sur un VPS Ubuntu (cloud) qui ne
// peut PAS imprimer sur l'imprimante du magasin. La génération/impression/
// archivage des fiches de contrôle doit donc tourner LÀ où sont à la fois le
// partage Rcommun ET l'imprimante — c.-à-d. sur un poste local (le serveur de
// fichiers 192.168.0.250).
//
// Ce que fait cet agent :
//   1. se connecte au MÊME MongoDB (Atlas) que le VPS ;
//   2. lance le watcher (services/inventaireWatchService) qui, à intervalle :
//        - surveille le dossier de chaque inventaire actif sur le Rcommun
//          (config.sharePath = STOCK_SHARE_PATH + <nom d'inventaire>),
//        - pour chaque nouveau stock.dat <code>[_<EMPLACEMENT>] : génère le PDF
//          de la fiche, l'imprime (SumatraPDF via pdf-to-printer), archive le
//          .DAT et le PDF, et enregistre la FicheControle (Mongo) ;
//        - exécute les demandes de réimpression posées depuis l'app web
//          (FicheControle.reprintRequested).
//
// Pré-requis sur le poste :
//   - Node installé, ce dépôt présent (ou juste le dossier backend + node_modules).
//   - Accès en lecture/écriture au partage Rcommun.
//   - Une imprimante installée (PRINTER_NAME dans .env, vide = imprimante par défaut).
//   - SumatraPDF (fourni par la dépendance pdf-to-printer).
//
// Configuration (.env du poste local — NE PAS définir RCOMMON_STOCK_ROOT ici) :
//   MONGO_URI=...(le même Atlas que le VPS)
//   STOCK_SHARE_PATH=\\192.168.0.250\Rcommun\STOCK   (ou le chemin local du partage)
//   DBF_BASE_PATH / chemins DBF locaux (pour résoudre les désignations d'articles)
//   PRINTER_NAME=...            (optionnel)
//   FICHE_AUTOPRINT=true        (défaut ; mettre false pour un test sans imprimer)
//   FICHE_WATCH_INTERVAL_MS=5000
//
// Lancement :  npm run print-agent
// (garder la fenêtre ouverte ; pour un service permanent, utiliser NSSM /
//  planificateur de tâches Windows / pm2-windows-service.)

import "./loadEnv.js"; // ⬅️ DOIT rester la toute première ligne
import connectDB from "./config/db.js";
import {
  startInventaireWatcher,
  isWatching,
} from "./services/inventaireWatchService.js";
import { config } from "./services/ficheControleService.js";

const main = async () => {
  console.log("──────────────────────────────────────────────");
  console.log("🖨️  Agent d'impression des fiches de contrôle");
  console.log("──────────────────────────────────────────────");
  console.log(`   Partage surveillé : ${config.sharePath}`);
  console.log(`   Intervalle        : ${config.watchIntervalMs} ms`);
  console.log(
    `   Impression auto   : ${config.autoprint ? "OUI" : "NON (mode test)"}`,
  );
  console.log(
    `   Imprimante        : ${config.printerName || "(par défaut du système)"}`,
  );

  await connectDB();

  startInventaireWatcher();
  console.log(
    `   Watcher actif     : ${isWatching() ? "OUI" : "NON"} — Ctrl+C pour arrêter.`,
  );
};

main().catch((err) => {
  console.error("❌ Agent d'impression : erreur fatale :", err.message);
  process.exit(1);
});

// Arrêt propre
const stop = (sig) => {
  console.log(`\n${sig} reçu — arrêt de l'agent d'impression.`);
  process.exit(0);
};
process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));
