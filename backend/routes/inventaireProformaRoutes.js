// backend/routes/inventaireProformaRoutes.js
import express from "express";
import {
  getTiers,
  getByTiers,
  genererFicheControle,
  genererInventaireDoc,
} from "../controllers/inventaireProformaController.js";
import { protect, admin } from "../middleware/authMiddleware.js";
import { checkEntrepriseAccess } from "../middleware/checkEntrepriseAccess.js";

const router = express.Router();

// Liste des tiers présents dans les proformas (code + nom)
router.get(
  "/:nomDossierDBF/tiers",
  protect,
  admin,
  checkEntrepriseAccess,
  getTiers,
);

// Feuille de contrôle PDF d'une proforma (téléchargement)
router.get(
  "/:nomDossierDBF/proforma/:numfact/fiche-controle",
  protect,
  admin,
  checkEntrepriseAccess,
  genererFicheControle,
);

// Document d'inventaire (PDF paysage) d'un tiers, groupé famille/fournisseur
router.get(
  "/:nomDossierDBF/tiers/:tiers/inventaire-doc",
  protect,
  admin,
  checkEntrepriseAccess,
  genererInventaireDoc,
);

// Proformas d'un tiers, lignes groupées par NUMFACT, triées par NL
router.get(
  "/:nomDossierDBF/tiers/:tiers",
  protect,
  admin,
  checkEntrepriseAccess,
  getByTiers,
);

export default router;