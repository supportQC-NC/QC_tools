// backend/routes/receptionRoutes.js
import express from "express";
import multer from "multer";
import {
  // Lecture (commandes à contrôler — DBF)
  getCommandesAControler,
  getDetailsCommande,
  // Sessions
  createReception,
  getReceptionsEnCours,
  getReceptionEnCours,
  getReceptionById,
  getArticlesCommande,
  getHistoriqueReceptions,
  // Scan & identification
  scanArticle,
  rechercheParRef,
  rechercheParCode,
  // Comptage
  addComptage,
  updateComptage,
  deleteComptage,
  // Signalements (problèmes + photos)
  getSignalementTypes,
  upsertSignalement,
  deleteSignalement,
  // Phase finale
  terminerScan,
  getAnalyse,
  validerEcart,
  updateCommentaire,
  // Rapport
  genererRapport,
  // Suppression
  deleteReception,
} from "../controllers/receptionController.js";
import { protect } from "../middleware/authMiddleware.js";
import {
  checkEntrepriseAccess,
  checkModuleAccess,
} from "../middleware/checkEntrepriseAccess.js";

const router = express.Router();

// ------------------------------------------------------------------
// Upload photo de signalement : stockage EN MÉMOIRE (aucun fichier
// temporaire) -> le controller écrit ensuite directement sur RCOMMUN.
// ------------------------------------------------------------------
const uploadPhoto = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15 Mo / photo
  fileFilter: (req, file, cb) => {
    if (String(file.mimetype || "").toLowerCase().startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Seules les images sont acceptées"));
    }
  },
});

// ==========================================
// SESSIONS — routes statiques (AVANT les routes :id génériques)
// ==========================================

// Créer / reprendre une session de réception
router.post(
  "/",
  protect,
  checkModuleAccess("reception", "write"),
  createReception,
);

// Historique des réceptions de l'utilisateur
router.get(
  "/historique",
  protect,
  checkModuleAccess("reception", "read"),
  getHistoriqueReceptions,
);

// Types de problème (menu déroulant) — statique, avant /:id
router.get(
  "/signalement-types",
  protect,
  checkModuleAccess("reception", "read"),
  getSignalementTypes,
);

// ==========================================
// LECTURE — commandes à contrôler (DBF), préfixe statique /a-controler
// ==========================================

// Détails d'une commande (vérification avant contrôle)
router.get(
  "/a-controler/:nomDossierDBF/:numcde/details",
  protect,
  checkEntrepriseAccess,
  checkModuleAccess("reception", "read"),
  getDetailsCommande,
);

// Liste paginée des commandes éligibles (ETAT >= seuil)
router.get(
  "/a-controler/:nomDossierDBF",
  protect,
  checkEntrepriseAccess,
  checkModuleAccess("reception", "read"),
  getCommandesAControler,
);

// ==========================================
// SESSIONS EN COURS
// ==========================================

// Session en cours pour une commande précise
router.get(
  "/en-cours/:entrepriseId/:numcde",
  protect,
  checkModuleAccess("reception", "read"),
  getReceptionEnCours,
);

// Toutes les sessions en cours pour une entreprise
router.get(
  "/en-cours/:entrepriseId",
  protect,
  checkModuleAccess("reception", "read"),
  getReceptionsEnCours,
);

// ==========================================
// ACTIONS SUR UNE SESSION (:id)
// ==========================================

// Liste alphabétique des articles de la commande (liste déroulante)
router.get(
  "/:id/articles-commande",
  protect,
  checkModuleAccess("reception", "read"),
  getArticlesCommande,
);

// Scan & identification
router.post(
  "/:id/scan",
  protect,
  checkModuleAccess("reception", "write"),
  scanArticle,
);
router.post(
  "/:id/recherche-ref",
  protect,
  checkModuleAccess("reception", "write"),
  rechercheParRef,
);
router.post(
  "/:id/recherche-code",
  protect,
  checkModuleAccess("reception", "write"),
  rechercheParCode,
);

// Comptage
router.post(
  "/:id/comptages",
  protect,
  checkModuleAccess("reception", "write"),
  addComptage,
);
router.put(
  "/:id/comptages/:comptageId",
  protect,
  checkModuleAccess("reception", "write"),
  updateComptage,
);
router.delete(
  "/:id/comptages/:comptageId",
  protect,
  checkModuleAccess("reception", "delete"),
  deleteComptage,
);

// Signalements (problème article + photo déposée sur RCOMMUN)
router.post(
  "/:id/signalements",
  protect,
  checkModuleAccess("reception", "write"),
  uploadPhoto.single("photo"),
  upsertSignalement,
);
router.delete(
  "/:id/signalements/:signalementId",
  protect,
  checkModuleAccess("reception", "delete"),
  deleteSignalement,
);

// Phase finale (analyse des écarts)
router.post(
  "/:id/terminer-scan",
  protect,
  checkModuleAccess("reception", "write"),
  terminerScan,
);
router.get(
  "/:id/analyse",
  protect,
  checkModuleAccess("reception", "read"),
  getAnalyse,
);
router.post(
  "/:id/valider-ecart",
  protect,
  checkModuleAccess("reception", "write"),
  validerEcart,
);
router.put(
  "/:id/commentaire",
  protect,
  checkModuleAccess("reception", "write"),
  updateCommentaire,
);

// Génération du rapport (PDF + dépôt RCOMMUN + email) -> clôture la réception
router.post(
  "/:id/generer-rapport",
  protect,
  checkModuleAccess("reception", "write"),
  genererRapport,
);

// Détail d'une session + suppression — EN DERNIER (routes génériques)
router.get(
  "/:id",
  protect,
  checkModuleAccess("reception", "read"),
  getReceptionById,
);
router.delete(
  "/:id",
  protect,
  checkModuleAccess("reception", "delete"),
  deleteReception,
);

export default router;