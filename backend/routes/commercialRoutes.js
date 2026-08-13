// backend/routes/commercialRoutes.js
//
// ESPACE COMMERCIAL — /api/commercial/...
//
// Chaîne de sécurité :
//   protect                  -> utilisateur connecté
//   requireCommercial        -> profil commercial actif + au moins un code vendeur
//   checkEntrepriseAccess    -> la société :nomDossierDBF est dans son périmètre
//   checkCommercialEntreprise-> il a un code vendeur SUR cette société
//                               (attache req.codesCommercial : le seul filtre
//                                utilisé par le service — d'où l'isolation entre
//                                commerciaux)

import express from "express";
import { protect } from "../middleware/authMiddleware.js";
import { checkEntrepriseAccess } from "../middleware/checkEntrepriseAccess.js";
import {
  requireCommercial,
  checkCommercialEntreprise,
} from "../middleware/commercialAccess.js";
import {
  getProfil,
  getDashboard,
  getDashboardCa,
  getClients,
  getClient,
  getProformas,
  getProformaLignes,
  getFactures,
  getAlertes,
  enregistrerRelance,
  enregistrerRelancesLot,
  supprimerRelance,
  getRelances,
  marquerAlertesVues,
} from "../controllers/commercialController.js";

const router = express.Router();

// Toutes les routes de l'espace sont réservées aux commerciaux.
router.use(protect, requireCommercial);

// --- Transverse (toutes sociétés confondues) ---
router.get("/profil", getProfil);
router.get("/dashboard", getDashboard);
// Volet CA du dashboard, chargé en différé (cache factures : lent).
router.get("/dashboard/ca", getDashboardCa);

// --- Par société ---
const scope = [checkEntrepriseAccess, checkCommercialEntreprise];

router.get("/:nomDossierDBF/clients", ...scope, getClients);
router.get("/:nomDossierDBF/clients/:tiers", ...scope, getClient);

router.get("/:nomDossierDBF/proformas", ...scope, getProformas);
router.get(
  "/:nomDossierDBF/proformas/:numfact/lignes",
  ...scope,
  getProformaLignes,
);

router.get("/:nomDossierDBF/factures", ...scope, getFactures);

router.get("/:nomDossierDBF/alertes", ...scope, getAlertes);
router.post("/:nomDossierDBF/alertes/vues", ...scope, marquerAlertesVues);

router.get("/:nomDossierDBF/relances", ...scope, getRelances);
router.post("/:nomDossierDBF/relances", ...scope, enregistrerRelance);
router.post("/:nomDossierDBF/relances/lot", ...scope, enregistrerRelancesLot);
router.delete("/:nomDossierDBF/relances/:numfact", ...scope, supprimerRelance);

export default router;
