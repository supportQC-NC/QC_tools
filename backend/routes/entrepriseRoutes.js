import express from "express";
import {
  getEntreprises,
  getEntrepriseById,
  getEntrepriseByDossier,
  createEntreprise,
  updateEntreprise,
  deleteEntreprise,
  toggleEntrepriseActive,
  getMyEntreprises,
  getEntrepriseByTrigramme,
  getRepresentantsCodes,
} from "../controllers/EntrepriseControlleur.js";
import { protect } from "../middleware/authMiddleware.js";
import { checkModuleAccess } from "../middleware/checkEntrepriseAccess.js";

const router = express.Router();

const canRead = checkModuleAccess("entreprises_admin", "read");
const canWrite = checkModuleAccess("entreprises_admin", "write");
const canDelete = checkModuleAccess("entreprises_admin", "delete");

// Private (user connecté) — self-service, jamais gaté par module
router.get("/my-entreprises", protect, getMyEntreprises);
router.get("/trigramme/:trigramme", protect, getEntrepriseByTrigramme);
router.get("/dossier/:nomDossierDBF", protect, getEntrepriseByDossier);

// Administration des entreprises (module "entreprises_admin")
router.get("/", protect, canRead, getEntreprises);
router.post("/", protect, canWrite, createEntreprise);
// Codes vendeurs (REPRES) détectés dans facture.dbf — route à 2 segments,
// placée avant /:id (1 segment) pour rester sans ambiguïté.
router.get("/:nomDossierDBF/representants", protect, canRead, getRepresentantsCodes);
router.get("/:id", protect, canRead, getEntrepriseById);
router.put("/:id", protect, canWrite, updateEntreprise);
router.delete("/:id", protect, canDelete, deleteEntreprise);
router.patch("/:id/toggle-active", protect, canWrite, toggleEntrepriseActive);

export default router;