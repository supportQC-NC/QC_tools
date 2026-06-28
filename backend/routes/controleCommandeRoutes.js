// backend/routes/controleCommandeRoutes.js
import express from "express";
import {
  // Lecture (commandes à contrôler depuis les DBF)
  getCommandesAControler,
  getDetailsCommande,
  // Workflow de contrôle (sessions persistées)
  createControleCommande,
  getControlesEnCoursParEntreprise,
  getControleEnCours,
  getControleById,
  scanArticleControle,
  addLigneControle,
  updateLigneControle,
  deleteLigneControle,
  exportControleCommande,
  downloadControleCommande,
  deleteControleCommande,
  getHistoriqueControle,
} from "../controllers/controleCommandeController.js";
import { protect } from "../middleware/authMiddleware.js";
import {
  checkEntrepriseAccess,
  checkModuleAccess,
} from "../middleware/checkEntrepriseAccess.js";

const router = express.Router();

// ==========================================
// WORKFLOW DE CONTRÔLE — routes statiques (AVANT les routes :id génériques)
// ==========================================

// Créer / reprendre une session de contrôle pour une commande
router.post(
  "/",
  protect,
  checkModuleAccess("ctr_commande", "write"),
  createControleCommande,
);

// Historique des contrôles de l'utilisateur
router.get(
  "/historique",
  protect,
  checkModuleAccess("ctr_commande", "read"),
  getHistoriqueControle,
);

// ==========================================
// LECTURE — commandes à contrôler (DBF), préfixe statique /a-controler
// ==========================================

// Détails (lignes) d'une commande, à la demande
router.get(
  "/a-controler/:nomDossierDBF/:numcde/details",
  protect,
  checkEntrepriseAccess,
  checkModuleAccess("ctr_commande", "read"),
  getDetailsCommande,
);

// Liste paginée des commandes à contrôler (BATEAU = date valide >= aujourd'hui)
router.get(
  "/a-controler/:nomDossierDBF",
  protect,
  checkEntrepriseAccess,
  checkModuleAccess("ctr_commande", "read"),
  getCommandesAControler,
);

// ==========================================
// SESSIONS EN COURS
// ==========================================

// Session en cours pour une commande précise
router.get(
  "/en-cours/:entrepriseId/:numcde",
  protect,
  checkModuleAccess("ctr_commande", "read"),
  getControleEnCours,
);

// Toutes les sessions en cours pour une entreprise
router.get(
  "/en-cours/:entrepriseId",
  protect,
  checkModuleAccess("ctr_commande", "read"),
  getControlesEnCoursParEntreprise,
);

// ==========================================
// ACTIONS SUR UNE SESSION (:id)
// ==========================================

// Scanner un article
router.post(
  "/:id/scan",
  protect,
  checkModuleAccess("ctr_commande", "write"),
  scanArticleControle,
);

// Lignes du contrôle
router.post(
  "/:id/lignes",
  protect,
  checkModuleAccess("ctr_commande", "write"),
  addLigneControle,
);
router.put(
  "/:id/lignes/:ligneId",
  protect,
  checkModuleAccess("ctr_commande", "write"),
  updateLigneControle,
);
router.delete(
  "/:id/lignes/:ligneId",
  protect,
  checkModuleAccess("ctr_commande", "delete"),
  deleteLigneControle,
);

// Export serveur / téléchargement
router.post(
  "/:id/export",
  protect,
  checkModuleAccess("ctr_commande", "write"),
  exportControleCommande,
);
router.post(
  "/:id/download",
  protect,
  checkModuleAccess("ctr_commande", "write"),
  downloadControleCommande,
);

// Détail d'une session par ID + suppression — EN DERNIER (routes génériques)
router.get(
  "/:id",
  protect,
  checkModuleAccess("ctr_commande", "read"),
  getControleById,
);
router.delete(
  "/:id",
  protect,
  checkModuleAccess("ctr_commande", "delete"),
  deleteControleCommande,
);

export default router;