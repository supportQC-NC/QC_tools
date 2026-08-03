// backend/routes/envoiCdeFournisseurRoutes.js
//
// Routes du module « Envoi Commande Fournisseur ».
// Chaîne : protect -> checkEntrepriseAccess (scoping société via :nomDossierDBF)
//          -> checkModuleAccess("envoi_cde_fournisseur", action).
import express from "express";
import {
  listCommandes,
  getDetail,
  verifier,
  apercu,
  envoyer,
  getParametresCtrl,
  updateParametresCtrl,
  importReference,
  importReferenceGlobal,
  compterMasse,
  envoyerMasseCtrl,
  listEmails,
  createEmail,
  updateEmail,
  deleteEmail,
  getMessages,
  upsertMessage,
  getResponsable,
  upsertResponsable,
  getHistorique,
} from "../controllers/envoiCdeFournisseurController.js";
import { protect, admin } from "../middleware/authMiddleware.js";
import {
  checkEntrepriseAccess,
  checkModuleAccess,
} from "../middleware/checkEntrepriseAccess.js";

const router = express.Router();

const MODULE = "envoi_cde_fournisseur";
const read = [protect, checkEntrepriseAccess, checkModuleAccess(MODULE, "read")];
const write = [protect, checkEntrepriseAccess, checkModuleAccess(MODULE, "write")];
const del = [protect, checkEntrepriseAccess, checkModuleAccess(MODULE, "delete")];

// Import GLOBAL (toutes sociétés) — admin, PAS de scoping société (route sans :nomDossierDBF).
// Déclarée en premier pour ne pas être capturée par les routes paramétrées.
router.post("/import-reference-global", protect, admin, importReferenceGlobal);

// ─── Commandes préparées + envoi ───────────────────────────────────────────
router.get("/:nomDossierDBF/commandes", ...read, listCommandes);
router.get("/:nomDossierDBF/commandes/:numcde/detail", ...read, getDetail);
router.get("/:nomDossierDBF/parametres", ...read, getParametresCtrl);
router.put("/:nomDossierDBF/parametres", ...write, updateParametresCtrl);
router.get("/:nomDossierDBF/apercu/:numcde", ...read, apercu);
router.post("/:nomDossierDBF/verifier", ...read, verifier);
router.post("/:nomDossierDBF/envoyer", ...write, envoyer);

// ─── Import de la base de référence (migrée depuis Access) ─────────────────
router.post("/:nomDossierDBF/import-reference", ...write, importReference);

// ─── Envoi en masse (vœux / annonces, texte simple FR/EN) ──────────────────
router.get("/:nomDossierDBF/masse/compter", ...read, compterMasse);
router.post("/:nomDossierDBF/masse", ...write, envoyerMasseCtrl);

// ─── Emails fournisseurs (CRUD) ────────────────────────────────────────────
router.get("/:nomDossierDBF/emails", ...read, listEmails);
router.post("/:nomDossierDBF/emails", ...write, createEmail);
router.put("/:nomDossierDBF/emails/:id", ...write, updateEmail);
router.delete("/:nomDossierDBF/emails/:id", ...del, deleteEmail);

// ─── Modèles de message ────────────────────────────────────────────────────
router.get("/:nomDossierDBF/messages", ...read, getMessages);
router.put("/:nomDossierDBF/messages", ...write, upsertMessage);

// ─── Responsable / CC ──────────────────────────────────────────────────────
router.get("/:nomDossierDBF/responsable", ...read, getResponsable);
router.put("/:nomDossierDBF/responsable", ...write, upsertResponsable);

// ─── Historique ────────────────────────────────────────────────────────────
router.get("/:nomDossierDBF/historique", ...read, getHistorique);

export default router;
