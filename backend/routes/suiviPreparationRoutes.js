// backend/routes/suiviPreparationRoutes.js
//
// Suivi des préparations de commande : une seule route, en lecture, qui
// fusionne les préparations scannées au collecteur et les fiches manuelles.
// Scopée société par :nomDossierDBF -> checkEntrepriseAccess.
import express from "express";
import { getSuiviPreparations } from "../controllers/suiviPreparationController.js";
import { protect } from "../middleware/authMiddleware.js";
import {
  checkEntrepriseAccess,
  checkModuleAccess,
} from "../middleware/checkEntrepriseAccess.js";

const router = express.Router();

// L'écran montre les DEUX origines : l'accès à l'une OU l'autre suffit à
// l'ouvrir (checkModuleAccess accepte un tableau).
const canRead = checkModuleAccess(
  ["prep_commande", "prep_commande_manuelle"],
  "read",
);

router.get(
  "/:nomDossierDBF",
  protect,
  canRead,
  checkEntrepriseAccess,
  getSuiviPreparations,
);

export default router;
