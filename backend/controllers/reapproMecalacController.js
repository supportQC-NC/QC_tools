// backend/controllers/reapproMecalacController.js
//
// Réappro « Mécalac » : analyse d'un entrepôt (S2..S5) vers le rayon (S1),
// puis génération du fichier .dat dans collect_sec.
//
// Module SANS ÉTAT — rien en base : l'écran garde la liste retouchée et la
// renvoie telle quelle à la génération (même parti pris que le réappro rayon
// du collecteur).

import path from "path";
import fs from "fs";
import asyncHandler from "../middleware/asyncHandler.js";
import {
  getEntrepots,
  analyserEntrepot,
  resoudreArticle,
  construireContenuDat,
  estDepotValide,
} from "../services/reapproMecalacService.js";
import {
  deposerDocumentFtp,
  deposerDatFtp,
  modeDepotFtp,
} from "../services/documentsFtpService.js";

const safeTrim = (v) => (v == null ? "" : String(v)).trim();
const round3 = (v) => Math.round((Number(v) || 0) * 1000) / 1000;

// Même sanitisation que le réappro classique (exportReappro) et le réappro
// rayon : on garde lettres, chiffres, « _ », « - » et l'espace ; tout le reste
// devient « _ ». Le nom de fichier doit rester lisible par Stock XL.
const sanitizeNom = (v) => safeTrim(v).replace(/[^a-zA-Z0-9_\- ]/g, "_");

/**
 * Nom du fichier déposé : « stock.dat reappro_<entrepôt>_<nom choisi> »
 * (demande client). Le préfixe « stock.dat » et la convention de nommage sont
 * ceux des autres .dat de l'application.
 */
export const nomFichierReappro = (nomEntrepot, nomLibre) =>
  `stock.dat reappro_${sanitizeNom(nomEntrepot)}_${sanitizeNom(nomLibre)}`;

/**
 * @desc    Entrepôts sources (S2..S5) de la société, avec leurs volumes
 * @route   GET /api/reappro-mecalac/:entrepriseId/entrepots
 * @access  Private (module reapro, read) + accès société
 */
const listerEntrepots = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  // Première lecture : c'est elle qui chauffe le cache article (90 000 fiches
  // chez QC) ; l'analyse déclenchée ensuite le trouvera prêt.
  const data = await getEntrepots(entreprise);
  res.json(data);
});

/**
 * @desc    Analyse : articles à descendre de l'entrepôt vers le rayon
 * @route   GET /api/reappro-mecalac/:entrepriseId/analyse?depot=S3&fourn=&limit=
 * @access  Private (module reapro, read) + accès société
 */
const analyser = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const { depot, fourn, limit } = req.query;

  try {
    const data = await analyserEntrepot(entreprise, { depot, fourn, limit });
    res.json(data);
  } catch (e) {
    res.status(e.statusCode || 500);
    throw e;
  }
});

/**
 * @desc    Résoudre un code saisi à la main (ajout d'une ligne)
 * @route   POST /api/reappro-mecalac/:entrepriseId/article
 * @body    { code, depot }
 * @access  Private (module reapro, read) + accès société
 */
const resoudre = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const code = safeTrim(req.body?.code);
  if (!code) {
    res.status(400);
    throw new Error("Code article requis (code-barres, NART ou référence).");
  }

  const article = await resoudreArticle(entreprise, code, req.body?.depot);
  if (!article) {
    res.status(404);
    throw new Error(`Aucun article ne correspond à « ${code} ».`);
  }
  res.json(article);
});

/**
 * @desc    Générer le fichier .dat du réappro dans collect_sec
 * @route   POST /api/reappro-mecalac/:entrepriseId/generer
 * @body    { depot, nom, lignes: [{ nart, quantite }] }
 * @access  Private (module reapro, write) + accès société
 *
 * Destination : le chemin d'export PROPRE À LA SOCIÉTÉ
 * (`cheminExportInventaire`, déjà traduit vers le montage Linux en prod par le
 * getter du modèle), ou le FTP documents quand la société est en mode dépôt
 * FTP (ex. DQ → SEDQ) — exactement comme les autres .dat.
 */
const genererFichier = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const depot = safeTrim(req.body?.depot).toUpperCase();
  const nomLibre = safeTrim(req.body?.nom);

  if (!estDepotValide(depot)) {
    res.status(400);
    throw new Error("Entrepôt invalide : choisissez S2, S3, S4 ou S5.");
  }
  if (!nomLibre) {
    res.status(400);
    throw new Error("Le nom du réappro est requis.");
  }

  const lignes = (Array.isArray(req.body?.lignes) ? req.body.lignes : [])
    .map((l) => ({ nart: safeTrim(l?.nart), quantite: round3(l?.quantite) }))
    .filter((l) => l.nart && l.quantite > 0);

  if (lignes.length === 0) {
    res.status(400);
    throw new Error("Aucune ligne à générer (quantités à zéro ou liste vide).");
  }

  const contenu = construireContenuDat(lignes);
  const nbLignes = contenu
    ? contenu.trimEnd().split("\r\n").filter(Boolean).length
    : 0;
  if (nbLignes === 0) {
    res.status(400);
    throw new Error("Aucune quantité transférable.");
  }

  const nomEntrepot =
    safeTrim(entreprise.mappingEntrepots?.[depot]) || depot;
  const nomFichier = nomFichierReappro(nomEntrepot, nomLibre);

  // Mode FTP : le FTP EST la destination, pas de collect_sec. Un échec lève —
  // le fichier n'existerait nulle part.
  if (modeDepotFtp(entreprise)) {
    try {
      const r = await deposerDatFtp(
        entreprise,
        "reappro",
        nomFichier,
        Buffer.from(contenu, "utf8"),
      );
      return res.json({
        message: "Fichier déposé sur le serveur de documents",
        fichier: {
          nom: nomFichier,
          chemin: `FTP:${r.chemin}`,
          destination: "ftp",
          lignes: nbLignes,
          totalQuantite: round3(
            lignes.reduce((s, l) => s + l.quantite, 0),
          ),
        },
      });
    } catch (error) {
      res.status(502);
      throw new Error(error.message);
    }
  }

  const dossier =
    safeTrim(entreprise.cheminExportInventaire) ||
    "/mnt/rcommun/STOCK/collect_sec";

  try {
    if (!fs.existsSync(dossier)) fs.mkdirSync(dossier, { recursive: true });
  } catch (error) {
    res.status(400);
    throw new Error(
      `Impossible d'accéder au dossier de dépôt : ${dossier}. Vérifiez les droits d'accès. (${error.message})`,
    );
  }

  const cheminFichier = path.join(dossier, nomFichier);
  try {
    fs.writeFileSync(cheminFichier, contenu, "utf8");
  } catch (error) {
    res.status(400);
    throw new Error(`Impossible d'écrire le fichier : ${error.message}`);
  }

  // Copie d'archive FTP si la société en a une (best-effort).
  deposerDocumentFtp(entreprise, "reappro", nomFichier, cheminFichier).catch(
    () => {},
  );

  res.json({
    message: "Fichier de réappro généré",
    fichier: {
      nom: nomFichier,
      chemin: cheminFichier,
      destination: "collect_sec",
      lignes: nbLignes,
      totalQuantite: round3(lignes.reduce((s, l) => s + l.quantite, 0)),
    },
  });
});

export { listerEntrepots, analyser, resoudre, genererFichier };
