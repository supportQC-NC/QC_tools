// backend/services/demandeReapproTransfertService.js
//
// Génère le fichier de transfert MAGASIN (réassort réserve -> rayon) au MÊME
// format et au MÊME endroit que la préparation de commande : un .dat déposé
// dans "collect_sec" (Stock XL), lignes = CODE(13, NART, espaces à droite) |
// QTE(8, zéros à gauche) | 000 + CRLF.
import fs from "fs";
import path from "path";
import Entreprise from "../models/EntrepriseModel.js";

const safeTrim = (v) => (v == null ? "" : String(v)).trim();
const pad2 = (n) => String(n).padStart(2, "0");

const sanitizeFileName = (nom) =>
  safeTrim(nom)
    .replace(/[^a-zA-Z0-9_\-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");

// Même règle que preparationReportService : cheminExportInventaire sinon défaut.
const dossierCollectSec = (entreprise) =>
  safeTrim(entreprise?.cheminExportInventaire) ||
  "/mnt/rcommun/STOCK/collect_sec";

// NART(13, gauche) | QTE(8, zéros) | 000
const construireContenu = (lignes) => {
  let contenu = "";
  (lignes || []).forEach((l) => {
    const q = Math.round(Number(l.quantite) || 0);
    if (q <= 0) return;
    const code = safeTrim(l.nart).padEnd(13, " ");
    contenu += `${code}|${String(q).padStart(8, "0")}|000\r\n`;
  });
  return contenu;
};

/**
 * Écrit le fichier de transfert d'une demande magasin dans collect_sec.
 * @param {object} demande  document DemandeReappro (entreprise, gisement)
 * @param {Array<{nart,quantite}>} lignes  lignes réellement réassorties
 * @returns {Promise<{fileName, chemins, lignes}>}
 */
export const ecrireTransfertMagasin = async (demande, lignes) => {
  const contenu = construireContenu(lignes);
  const nbLignes = contenu
    ? contenu.trimEnd().split("\r\n").filter(Boolean).length
    : 0;
  if (nbLignes === 0) return { fileName: "", chemins: [], lignes: 0 };

  const entreprise = await Entreprise.findOne({
    nomDossierDBF: demande.entreprise,
  });

  const d = new Date();
  const stamp = `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(
    d.getDate(),
  )}_${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
  const nomTsf =
    sanitizeFileName(
      `tsf_reappro_mag_${demande.entreprise}_${demande.gisement}_${stamp}`,
    ) + ".dat";

  const dir = dossierCollectSec(entreprise);
  const chemins = [];
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const p1 = path.join(dir, nomTsf);
    fs.writeFileSync(p1, contenu, "utf8");
    chemins.push(p1);
  } catch (e) {
    console.error(
      "[DEMANDE transfert collect_sec] écriture impossible:",
      e.message,
    );
  }

  return { fileName: nomTsf, chemins, lignes: nbLignes };
};

export default { ecrireTransfertMagasin };