// backend/utils/reapproMagPaths.js
//
// Résolution des dossiers où l'outil externe dépose un rapport de rupture par
// jour et par société (`reapro_mag_<societe>_yyyy-mm-dd.xlsx`).
//
// ⚠️ DEUX pièges, tous deux constatés en vrai :
//
// 1. L'emplacement dépend de la machine qui exécute le backend :
//      - poste Ubuntu local  : /home/supportserv/Bureau/doc_temp/reapro_mag
//      - VPS de production   : <racine du montage Rcommun>/doc_temp/reapro_mag
//      - serveur 192.168.0.250 : sous STOCK, pas à la racine du partage
//        (\\192.168.0.250\Rcommun\STOCK\doc_temp\reapro_mag)
//    Coder un chemin en dur faisait échouer le module (« dossier introuvable »)
//    alors que les fichiers existaient, ailleurs. Surcharge : `REAPRO_MAG_DIR`.
//
// 2. L'historique est réparti sur PLUSIEURS dossiers, dont aucun n'est complet
//    (relevé au 18/09/2026 sur 192.168.0.250 ; le premier porte l'essentiel,
//    793 fichiers, les 5 sociétés, 17/03 -> 16/09/2026) :
//      Rcommun\STOCK\doc_temp\reapro_mag — LE dossier courant,
//                                        793 fichiers, 5 sociétés, 17/03 → 16/09
//      Rcommun\reapro_mag               — reliquat,    15/04 → 06/05/2026
//      Rcommun\reapro_mag_histo         — reliquat QC, 16/04 → 27/05/2026
//    D'où `resoudreDossiersReapproMag()` au PLURIEL : on renvoie tous les
//    dossiers lisibles et l'appelant réunit les journées. S'arrêter au premier
//    dossier qui répond fait perdre des MOIS entiers.
//
//    ⚠️ Le `doc_temp` utile est SOUS `STOCK`, pas à la racine du partage. Ne
//    chercher que `<racine>/doc_temp/reapro_mag` ne trouve rien sur ce
//    serveur et donne l'illusion que l'historique n'existe pas.
//
// ⚠️ Depuis la refonte du 18/09/2026, ces classeurs ne servent plus QU'AU
// rattrapage des journées antérieures à la mise en service
// (`performanceReapproService.rejouerArchives`). La mesure quotidienne est lue
// directement dans la fiche article : l'écran fonctionne même si ces dossiers
// sont inaccessibles.
import fs from "fs";
import path from "path";

const DEFAULT_DIR = "/home/supportserv/Bureau/doc_temp/reapro_mag";
const SOUS_DOSSIER = ["doc_temp", "reapro_mag"];
// Racines de partage connues, pour la disposition « dossiers à plat ».
const RACINES = ["\\\\192.168.0.250\\Rcommun"];
const DOSSIERS_PLATS = ["reapro_mag", "reapro_mag_histo"];

/** Chemins à essayer. Tous sont testés, aucun n'est prioritaire sur un autre. */
const candidats = () => {
  const liste = [];
  const ajouter = (chemin, origine) => {
    const v = String(chemin || "").trim();
    if (v && !liste.some((c) => c.chemin === v)) liste.push({ chemin: v, origine });
  };
  // Joindre avec la syntaxe du chemin reçu : un chemin UNC n'est pas un chemin
  // POSIX, `path.posix.join` y mangerait les antislashs.
  const joindre = (base, ...suite) =>
    (String(base).includes("\\") ? path.win32 : path.posix).join(base, ...suite);

  ajouter(process.env.REAPRO_MAG_DIR, "REAPRO_MAG_DIR");

  // Dispositions `doc_temp` connues, essayées sous chaque racine de partage.
  const SOUS_CHEMINS = [
    ["STOCK", ...SOUS_DOSSIER], // ⚠️ le cas réel du serveur 192.168.0.250
    [...SOUS_DOSSIER],
  ];

  // Prod VPS : RCOMMON_STOCK_ROOT pointe sur .../STOCK, doc_temp en est le
  // frère — on remonte d'un cran sous la racine du partage monté.
  const stockRoot = String(process.env.RCOMMON_STOCK_ROOT || "").replace(
    /[\\/]+$/,
    "",
  );
  const racines = [...RACINES];
  if (stockRoot) {
    const parent = path.posix.dirname(stockRoot);
    ajouter(joindre(parent, ...SOUS_DOSSIER), "RCOMMON_STOCK_ROOT (racine du partage)");
    // Si le montage ne porte QUE le dossier STOCK, doc_temp doit alors y être
    // recopié : on essaie aussi les dispositions possibles sous STOCK.
    ajouter(joindre(stockRoot, ...SOUS_DOSSIER), "RCOMMON_STOCK_ROOT/doc_temp");
    racines.push(parent, stockRoot);
  }

  racines.forEach((racine) => {
    // `doc_temp`, avec ou sans le niveau STOCK.
    SOUS_CHEMINS.forEach((suite) => {
      ajouter(joindre(racine, ...suite), `${racine}/${suite.join("/")}`);
    });
    // Disposition « à plat » : dossiers directement sous la racine du partage.
    DOSSIERS_PLATS.forEach((nom) => {
      ajouter(joindre(racine, nom), `${racine} (dossier à plat)`);
    });
  });

  ajouter(DEFAULT_DIR, "poste Ubuntu local");
  ajouter(joindre(RACINES[0], ...SOUS_DOSSIER), "partage UNC (dev Windows)");
  return liste;
};

/** Dossier lisible ? Distingue ENOENT (absent) de EACCES (droits). */
const verifierDossier = (chemin) => {
  try {
    if (!fs.statSync(chemin).isDirectory()) {
      return { ok: false, etat: "existe mais n'est pas un dossier" };
    }
    fs.accessSync(chemin, fs.constants.R_OK | fs.constants.X_OK);
    return { ok: true, etat: "lisible" };
  } catch (e) {
    const code = e.code || "";
    if (code === "ENOENT") return { ok: false, etat: "introuvable" };
    if (code === "EACCES" || code === "EPERM") {
      return { ok: false, etat: `droits insuffisants (${code})` };
    }
    return { ok: false, etat: code || e.message };
  }
};

/**
 * Résout les dossiers source.
 *
 * @returns {{dirs: string[], candidats: Array<{chemin,origine,ok,etat}>}}
 *          `dirs` liste TOUS les dossiers lisibles (voir piège 2 en tête de
 *          fichier) ; vide si aucun ne l'est, `candidats` disant alors ce qui a
 *          été tenté et pourquoi chacun a échoué.
 */
export const resoudreDossiersReapproMag = () => {
  const liste = candidats().map((c) => ({ ...c, ...verifierDossier(c.chemin) }));
  return { dirs: liste.filter((c) => c.ok).map((c) => c.chemin), candidats: liste };
};

export default { resoudreDossiersReapproMag };
