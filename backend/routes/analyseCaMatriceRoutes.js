// backend/routes/analyseCaMatriceRoutes.js
//
// Analyse CA sur matrices Excel (Rcommun). Même module de permission que
// l'Analyse CA historique (`analyse_ca_admin`) : c'est le même écran côté web,
// seule la source de données change (matrices au lieu du DBF).

import express from "express";
import {
  listerSources,
  getMatriceSociete,
  getMatriceGroupe,
} from "../controllers/analyseCaMatriceController.js";
import { protect, admin } from "../middleware/authMiddleware.js";
import {
  checkEntrepriseAccess,
  checkModuleAccess,
} from "../middleware/checkEntrepriseAccess.js";

const router = express.Router();

const canRead = checkModuleAccess("analyse_ca_admin", "read");

// Sources disponibles (sociétés du périmètre + groupes si admin).
router.get("/", protect, canRead, listerSources);

// Matrice d'une société (scopée entreprise).
router.get(
  "/societe/:nomDossierDBF",
  protect,
  canRead,
  checkEntrepriseAccess,
  getMatriceSociete,
);

// Matrice d'un groupe consolidé (admins uniquement).
router.get("/groupe/:groupeId", protect, canRead, admin, getMatriceGroupe);

export default router;
