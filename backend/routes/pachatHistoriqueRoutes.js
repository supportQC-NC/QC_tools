// backend/routes/pachatHistoriqueRoutes.js
import express from "express";
import {
  getHistorique,
  getFournisseurs,
  getEvolutions,
  historiserTout,
} from "../controllers/pachatHistoriqueController.js";
import { protect, admin } from "../middleware/authMiddleware.js";
import {
  checkEntrepriseAccess,
  checkModuleAccess,
} from "../middleware/checkEntrepriseAccess.js";

const router = express.Router();

const canRead = checkModuleAccess("historique_pachat", "read");

// Historisation globale (toutes sociétés) — opération lourde, admin uniquement,
// PAS scopée à une société (pas de :nomDossierDBF).
router.post("/historiser", protect, admin, historiserTout);

// nart peut contenir des caractères variés -> capture large (*) sur le dernier
// segment n'est pas nécessaire ici (NART = code simple), param classique.
router.get(
  "/:nomDossierDBF/fournisseurs",
  protect,
  checkEntrepriseAccess,
  canRead,
  getFournisseurs,
);

router.get(
  "/:nomDossierDBF/evolutions",
  protect,
  checkEntrepriseAccess,
  canRead,
  getEvolutions,
);

router.get(
  "/:nomDossierDBF/article/:nart",
  protect,
  checkEntrepriseAccess,
  canRead,
  getHistorique,
);

export default router;
