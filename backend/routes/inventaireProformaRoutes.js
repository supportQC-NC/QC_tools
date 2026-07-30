// backend/routes/inventaireProformaRoutes.js
import express from "express";
import {
  getTiers,
  getByTiers,
  genererFicheControle,
  genererInventaireDoc,
  setProformaZone,
  exportProformaDat,
  exportGisement,
} from "../controllers/inventaireProformaController.js";
import { protect } from "../middleware/authMiddleware.js";
import {
  checkEntrepriseAccess,
  checkModuleAccess,
} from "../middleware/checkEntrepriseAccess.js";

const router = express.Router();

const canRead = checkModuleAccess("inventaire_proforma_admin", "read");
const canWrite = checkModuleAccess("inventaire_proforma_admin", "write");

// Liste des tiers présents dans les proformas (code + nom)
router.get("/:nomDossierDBF/tiers", protect, canRead, checkEntrepriseAccess, getTiers);

// Feuille de contrôle PDF d'une proforma (téléchargement)
router.get(
  "/:nomDossierDBF/proforma/:numfact/fiche-controle",
  protect,
  canRead,
  checkEntrepriseAccess,
  genererFicheControle,
);

// Document d'inventaire (PDF paysage) d'un tiers, groupé famille/fournisseur
router.get(
  "/:nomDossierDBF/tiers/:tiers/inventaire-doc",
  protect,
  canRead,
  checkEntrepriseAccess,
  genererInventaireDoc,
);

// Export « gisement » (Excel) : une ligne par article des proformas du tiers
router.get(
  "/:nomDossierDBF/tiers/:tiers/export-gisement",
  protect,
  canRead,
  checkEntrepriseAccess,
  exportGisement,
);

// Affecter une proforma à une zone/entrepôt (S1..S5)
router.put(
  "/:nomDossierDBF/proforma/:numfact/zone",
  protect,
  canWrite,
  checkEntrepriseAccess,
  setProformaZone,
);

// Exporter les proformas d'un tiers en .DAT (zone/général, serveur/téléchargement)
router.post(
  "/:nomDossierDBF/tiers/:tiers/export-dat",
  protect,
  canWrite,
  checkEntrepriseAccess,
  exportProformaDat,
);

// Proformas d'un tiers, lignes groupées par NUMFACT, triées par NL
router.get(
  "/:nomDossierDBF/tiers/:tiers",
  protect,
  canRead,
  checkEntrepriseAccess,
  getByTiers,
);

export default router;