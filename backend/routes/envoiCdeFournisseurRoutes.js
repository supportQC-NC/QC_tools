// backend/routes/envoiCdeFournisseurRoutes.js
//
// Routes du module « Envoi Commande Fournisseur ».
// Chaîne : protect -> checkEntrepriseAccess (scoping société via :nomDossierDBF)
//          -> checkModuleAccess("envoi_cde_fournisseur", action).
import express from "express";
import multer from "multer";
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
  apercuRelance,
  envoyerRelanceCtrl,
  apercuDemandeFacture,
  envoyerDemandeFactureCtrl,
  listAr,
  apercuAr,
  confirmerArCtrl,
  annulerArCtrl,
  modeleExcelEmails,
  importEmailsExcel,
  deleteEmailsBulk,
  listEmails,
  createEmail,
  updateEmail,
  deleteEmail,
  getMessages,
  upsertMessage,
  getResponsable,
  upsertResponsable,
  getHistorique,
  apercuPurgeHistorique,
  purgerHistoriqueCtrl,
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

// Upload Excel en mémoire (5 Mo max, 1 fichier).
const uploadExcel = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
}).single("file");

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

// ─── Relance des commandes déjà envoyées (onglet Historique) ───────────────
router.post("/:nomDossierDBF/relance/apercu", ...read, apercuRelance);
router.post("/:nomDossierDBF/relance", ...write, envoyerRelanceCtrl);

// ─── Demande de facture (commandes dont l'AR est confirmé) ─────────────────
router.post("/:nomDossierDBF/facture/apercu", ...read, apercuDemandeFacture);
router.post("/:nomDossierDBF/facture", ...write, envoyerDemandeFactureCtrl);

// ─── Accusés de réception fournisseur (onglet dédié) ───────────────────────
router.get("/:nomDossierDBF/ar", ...read, listAr);
router.post("/:nomDossierDBF/ar/apercu", ...read, apercuAr);
router.post("/:nomDossierDBF/ar/confirmer", ...write, confirmerArCtrl);
router.post("/:nomDossierDBF/ar/annuler", ...write, annulerArCtrl);

// ─── Import de la base de référence (migrée depuis Access) ─────────────────
router.post("/:nomDossierDBF/import-reference", ...write, importReference);

// ─── Envoi en masse (vœux / annonces, texte simple FR/EN) ──────────────────
router.get("/:nomDossierDBF/masse/compter", ...read, compterMasse);
router.post("/:nomDossierDBF/masse", ...write, envoyerMasseCtrl);

// ─── Emails fournisseurs (CRUD + import Excel + suppression masse) ──────────
router.get("/:nomDossierDBF/emails/modele-excel", ...read, modeleExcelEmails);
router.post("/:nomDossierDBF/emails/import-excel", ...write, uploadExcel, importEmailsExcel);
router.post("/:nomDossierDBF/emails/delete-bulk", ...del, deleteEmailsBulk);
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

// ─── Historique (+ purge des vieux envois) ─────────────────────────────────
// L'aperçu ne supprime rien (droit lecture) ; la purge exige le droit delete.
router.get("/:nomDossierDBF/historique/purge", ...read, apercuPurgeHistorique);
router.post("/:nomDossierDBF/historique/purge", ...del, purgerHistoriqueCtrl);
router.get("/:nomDossierDBF/historique", ...read, getHistorique);

export default router;
