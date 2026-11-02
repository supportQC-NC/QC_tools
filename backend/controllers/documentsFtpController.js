// backend/controllers/documentsFtpController.js
// Consultation du MIROIR FTP des documents générés d'une société (écran
// Documents FTP). req.entreprise injecté par checkEntrepriseAccess.

import path from "path";
import asyncHandler from "../middleware/asyncHandler.js";
import {
  miroirDocumentsActif,
  racineDocumentsFtp,
  listerDocumentsFtp,
  telechargerDocumentFtp,
  televerserDocumentFtp,
  supprimerDocumentFtp,
} from "../services/documentsFtpService.js";

const exigerMiroir = (req, res) => {
  if (!miroirDocumentsActif(req.entreprise)) {
    res.status(400);
    throw new Error(
      "Le miroir FTP des documents n'est pas configuré pour cette société " +
        "(champ « Dossier FTP documents » de la fiche société).",
    );
  }
};

// GET /api/documents-ftp/:nomDossierDBF?chemin=reappro/2026-11
const listerDocuments = asyncHandler(async (req, res) => {
  exigerMiroir(req, res);
  const chemin = String(req.query.chemin || "");
  const entrees = await listerDocumentsFtp(req.entreprise, chemin);
  res.json({
    racine: racineDocumentsFtp(req.entreprise),
    chemin,
    entrees,
  });
});

// GET /api/documents-ftp/:nomDossierDBF/telecharger?chemin=reappro/2026-11/x.dat
const telechargerDocument = asyncHandler(async (req, res) => {
  exigerMiroir(req, res);
  const chemin = String(req.query.chemin || "").trim();
  if (!chemin) {
    res.status(400);
    throw new Error("Paramètre « chemin » requis.");
  }
  const nom = path.posix.basename(chemin);
  const types = {
    ".pdf": "application/pdf",
    ".dat": "text/plain; charset=utf-8",
    ".xlsx":
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  };
  res.setHeader(
    "Content-Type",
    types[path.posix.extname(nom).toLowerCase()] || "application/octet-stream",
  );
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${nom.replace(/"/g, "")}"`,
  );
  await telechargerDocumentFtp(req.entreprise, chemin, res);
});

// POST /api/documents-ftp/:nomDossierDBF/televerser — multipart, champ
// « fichiers » (plusieurs possibles), body.chemin = dossier de destination.
const televerserDocuments = asyncHandler(async (req, res) => {
  exigerMiroir(req, res);
  const chemin = String(req.body?.chemin || "");
  const fichiers = req.files || [];
  if (!fichiers.length) {
    res.status(400);
    throw new Error("Aucun fichier reçu.");
  }
  const deposes = [];
  for (const f of fichiers) {
    // multer livre originalname en latin1 : rétablir l'UTF-8 (accents).
    const nom = Buffer.from(f.originalname, "latin1").toString("utf8");
    const r = await televerserDocumentFtp(req.entreprise, chemin, nom, f.buffer);
    deposes.push(r.chemin);
  }
  res.status(201).json({ deposes });
});

// DELETE /api/documents-ftp/:nomDossierDBF?chemin=reappro/2026-11/x.dat
const supprimerDocument = asyncHandler(async (req, res) => {
  exigerMiroir(req, res);
  const chemin = String(req.query.chemin || "").trim();
  if (!chemin) {
    res.status(400);
    throw new Error("Paramètre « chemin » requis.");
  }
  await supprimerDocumentFtp(req.entreprise, chemin);
  res.json({ message: "Document supprimé." });
});

export {
  listerDocuments,
  telechargerDocument,
  televerserDocuments,
  supprimerDocument,
};
