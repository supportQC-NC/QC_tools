// backend/routes/communicationClientRoutes.js
import express from "express";
import {
  getNouveautesReport,
  previewCatalog,
  sendCatalog,
} from "../controllers/communicationClientController.js";
import { protect } from "../middleware/authMiddleware.js";
import {
  checkEntrepriseAccess,
  checkModuleAccess,
} from "../middleware/checkEntrepriseAccess.js";

const router = express.Router();

const canRead = checkModuleAccess("communication_client", "read");
const canWrite = checkModuleAccess("communication_client", "write");

router.get("/:nomDossierDBF", protect, checkEntrepriseAccess, canRead, getNouveautesReport);
router.get("/:nomDossierDBF/preview", protect, checkEntrepriseAccess, canRead, previewCatalog);
router.post("/:nomDossierDBF/send", protect, checkEntrepriseAccess, canWrite, sendCatalog);

export default router;
