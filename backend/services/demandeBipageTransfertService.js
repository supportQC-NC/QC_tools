// backend/services/demandeBipageTransfertService.js
//
// Génère le fichier .dat d'une demande de BIPAGE réalisée, au même format que
// l'export du module Bipage (bipageCollecteController.genererContenuFichier) :
// CODE(13) | QTE(8, zéros à gauche) | 000 + CRLF, où CODE = GENCOD si présent,
// sinon NART. Déposé dans "collect_sec" (cheminExportInventaire de l'entreprise).
// (Calque de demandeReapproTransfertService, mais code = gencod||nart.)
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

const dossierCollectSec = (entreprise) =>
  safeTrim(entreprise?.cheminExportInventaire) ||
  "/mnt/rcommun/STOCK/collect_sec";

// CODE(13, gencod||nart, espaces à droite) | QTE(8, zéros) | 000
const construireContenu = (lignes) => {
  let contenu = "";
  (lignes || []).forEach((l) => {
    const q = Math.round(Number(l.quantite) || 0);
    if (q <= 0) return;
    const brut = safeTrim(l.gencod) || safeTrim(l.nart);
    if (!brut) return;
    const code = brut.padEnd(13, " ");
    contenu += `${code}|${String(q).padStart(8, "0")}|000\r\n`;
  });
  return contenu;
};

/**
 * Écrit le fichier .dat d'une demande de bipage réalisée dans collect_sec.
 * @param {object} demande  document DemandeBipage (entreprise, source, sourceRef)
 * @param {Array<{nart,gencod,quantite}>} lignes  lignes réellement bipées
 * @returns {Promise<{fileName, chemins, lignes}>}
 */
export const ecrireTransfertBipage = async (demande, lignes) => {
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
  const ref = safeTrim(demande.sourceRef) || safeTrim(demande.source) || "manuel";
  const nomTsf =
    "stock.dat bipage " +
    sanitizeFileName(`${demande.entreprise}_${ref}_${stamp}`);

  const dir = dossierCollectSec(entreprise);
  const chemins = [];
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const p1 = path.join(dir, nomTsf);
    fs.writeFileSync(p1, contenu, "utf8");
    chemins.push(p1);
  } catch (e) {
    console.error("[DEMANDE bipage transfert] écriture impossible:", e.message);
  }

  return { fileName: nomTsf, chemins, lignes: nbLignes };
};

export default { ecrireTransfertBipage };
