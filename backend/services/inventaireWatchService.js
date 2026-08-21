// backend/services/inventaireWatchService.js
import fs from "fs";
import path from "path";
import os from "os";
import InventaireZoneSession from "../models/InventaireZoneSessionModel.js";
import Entreprise from "../models/EntrepriseModel.js";
import Zone from "../models/ZoneModel.js";
import FicheControle from "../models/FicheControleModel.js";
import LigneBipage from "../models/LigneBipageModel.js";
import InventaireCollecte from "../models/InventaireCollecteModel.js";
// Enregistre le modèle User pour le populate ci-dessous.
// ⚠️ La casse EXACTE du chemin compte : sous Windows, "userModel.js" et
// "UserModel.js" désignent le même fichier mais forment deux specifiers ESM
// distincts → le module est évalué deux fois et mongoose lève
// « Cannot overwrite `User` model once compiled ».
import "../models/UserModel.js";
import {
  config,
  parseDat,
  construireLignes,
  ecrirePDF,
  extraireCodeZone,
  estFichierDat,
  getInventaireDirs,
  resoudreCheminPdf,
  sanitizeName,
} from "./ficheControleService.js";

let isRunning = false;
let intervalHandle = null;

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Impression silencieuse via pdf-to-printer.
 * On copie d'abord le PDF vers un fichier local temporaire SANS espaces :
 * SumatraPDF (utilisé par pdf-to-printer) échoue souvent sur les chemins
 * réseau UNC et/ou contenant des espaces.
 */
export const imprimerPdf = async (filePath) => {
  const mod = await import("pdf-to-printer").catch(() => null);
  if (!mod) {
    throw new Error("pdf-to-printer non installé (npm i pdf-to-printer)");
  }
  const ptp = mod.default && mod.default.print ? mod.default : mod;

  const tmp = path.join(
    os.tmpdir(),
    `fiche_${Date.now()}_${Math.random().toString(36).slice(2)}.pdf`,
  );
  fs.copyFileSync(filePath, tmp);
  try {
    const options = {};
    if (config.printerName) options.printer = config.printerName;
    await ptp.print(tmp, options);
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
  }
};

/**
 * Déplace un fichier vers un dossier (copie + suppression).
 * Plus robuste que rename sur un partage réseau SMB.
 * Les erreurs NE SONT PAS avalées : elles remontent à l'appelant.
 */
export const deplacerVers = (srcPath, destDir, nouveauNom = "") => {
  fs.mkdirSync(destDir, { recursive: true });
  const dest = path.join(destDir, nouveauNom || path.basename(srcPath));
  // Déplacement "sur lui-même" (même fichier, éventuellement à la casse près sous
  // Windows) → NO-OP. Sinon le unlink(dest) ci-dessous effacerait la source.
  const norm = (p) =>
    process.platform === "win32"
      ? path.resolve(p).toLowerCase()
      : path.resolve(p);
  if (norm(dest) === norm(srcPath)) {
    return srcPath;
  }
  if (fs.existsSync(dest)) {
    try {
      fs.unlinkSync(dest);
    } catch {
      /* on tentera l'écrasement par la copie */
    }
  }
  fs.copyFileSync(srcPath, dest);
  // Copie réussie : on supprime la source. Si la source est verrouillée,
  // la copie existe déjà dans le dossier cible.
  fs.unlinkSync(srcPath);
  return dest;
};

const traiterFichier = async (
  session,
  entreprise,
  base,
  currentDir,
  fileName,
  folderName,
) => {
  const filePath = path.join(currentDir, fileName);

  // ── LECTURE DU NOM DE FICHIER ────────────────────────────────────────────
  // Le collecteur dépose "stock.dat <zone>_<EMPLACEMENT>" à la racine.
  // Le code de zone est TOUT ce qui précède le DERNIER "_" (les codes en
  // contiennent eux-mêmes : A_1, B_5d) ; ce qui suit dit où est le rayon
  // (MAGASIN / DOCK).
  // Un fichier déjà rangé dans un sous-dossier a été renommé au passage
  // précédent : son nom ne porte plus que le code, et l'emplacement vient du
  // dossier qui le contient.
  const rawZoneToken = extraireCodeZone(fileName) || "";
  let zoneCode = rawZoneToken;
  let emplacement = folderName || "";

  if (!folderName) {
    const sep = rawZoneToken.lastIndexOf("_");
    if (sep > 0) {
      const codeCandidat = rawZoneToken.slice(0, sep);
      const empCandidat = rawZoneToken.slice(sep + 1);
      // ⚠️ On ne coupe QUE si ce qui suit le dernier "_" est bien un emplacement
      // utilisé par cette société (MAGASIN, DOCK…). Sinon un fichier sans
      // suffixe ("stock.dat A_1") serait charcuté en zone "A" / emplacement "1".
      const emplacementConnu = await Zone.exists({
        entreprise: entreprise._id,
        type: new RegExp(`^${escapeRegex(empCandidat)}$`, "i"),
      });
      if (emplacementConnu) {
        zoneCode = codeCandidat;
        emplacement = empCandidat;
      }
    }
  }

  // ── RANGEMENT : bon dossier d'emplacement + nom réduit au code de zone ────
  const dossierEmplacement = emplacement
    ? sanitizeName(emplacement)
    : config.sansEmplacementDirName;
  const targetDir = path.join(base, dossierEmplacement);
  const nomFinal = `stock.dat ${zoneCode}`;

  let workFilePath = filePath;
  if (
    path.resolve(currentDir) !== path.resolve(targetDir) ||
    fileName !== nomFinal
  ) {
    try {
      workFilePath = deplacerVers(filePath, targetDir, nomFinal);
    } catch (err) {
      return {
        status: "erreur",
        message: `Rangement dans "${dossierEmplacement}" impossible : ${err.message}`,
      };
    }
  }

  // ── LA ZONE EXISTE-T-ELLE ? ──────────────────────────────────────────────
  // Oui → le fichier reste où il vient d'être rangé. Non → zone_non_trouvee.
  let zone = await Zone.findOne(
    emplacement
      ? { entreprise: entreprise._id, code: zoneCode, type: emplacement }
      : { entreprise: entreprise._id, code: zoneCode },
  );
  if (!zone) {
    // Repli insensible à la casse avant de déclarer la zone introuvable.
    const rx = new RegExp(`^${escapeRegex(zoneCode)}$`, "i");
    zone = await Zone.findOne(
      emplacement
        ? {
            entreprise: entreprise._id,
            code: rx,
            type: new RegExp(`^${escapeRegex(emplacement)}$`, "i"),
          }
        : { entreprise: entreprise._id, code: rx },
    );
  }

  if (!zone) {
    const zoneInconnue = path.join(base, config.zoneInconnueDirName);
    try {
      deplacerVers(workFilePath, zoneInconnue);
      return {
        status: "zone_inconnue",
        message: `zone "${zoneCode || "?"}"${
          emplacement ? ` (${emplacement})` : ""
        } introuvable → déplacé dans ${config.zoneInconnueDirName}`,
      };
    } catch (err) {
      return {
        status: "erreur",
        message: `zone "${zoneCode || "?"}" introuvable, déplacement IMPOSSIBLE : ${err.message}`,
      };
    }
  }

  const dirs = { base: targetDir };

  // Le fichier a pu être déplacé/renommé juste au-dessus : on relit sa date et
  // sa taille SUR PLACE. Sans ça, la copie changeant la date, le contrôle
  // « déjà traité » plus bas échouerait à chaque passage et le fichier serait
  // retraité en boucle (il n'est plus archivé après impression).
  const statFinal = fs.statSync(workFilePath);

  // Clé LOGIQUE en BDD, préfixée par l'emplacement → 2 fiches distinctes pour un
  // même code présent à 2 emplacements, sans changer les index uniques.
  const logicalName = `${dossierEmplacement}/${nomFinal}`;

  // Déjà traité et inchangé ?
  const existing = await FicheControle.findOne({
    session: session._id,
    datFileName: logicalName,
  });
  if (
    existing &&
    existing.datMtimeMs === statFinal.mtimeMs &&
    existing.datSize === statFinal.size
  ) {
    return { status: "inchange", message: "déjà traité" };
  }

  // VERROU ATOMIQUE anti double-impression : on "réserve" le fichier via
  // l'index unique (session + datFileName). Seul le passage/process qui réussit
  // la réservation imprimera ; les autres voient "déjà pris en charge".
  if (existing) {
    // Le fichier a changé (mtime/size) → re-réservation conditionnelle atomique.
    const res = await FicheControle.updateOne(
      {
        session: session._id,
        datFileName: logicalName,
        datMtimeMs: existing.datMtimeMs,
        datSize: existing.datSize,
      },
      {
        $set: {
          datMtimeMs: statFinal.mtimeMs,
          datSize: statFinal.size,
          printed: false,
          printedAt: null,
          printError: "",
          archived: false,
          zoneCode,
        },
      },
    );
    if (res.modifiedCount === 0) {
      return { status: "inchange", message: "pris en charge par un autre passage" };
    }
  } else {
    try {
      await FicheControle.create({
        entreprise: entreprise._id,
        session: session._id,
        inventaireNom: session.nom,
        inventaireSlug: session.dossierSlug || session.nom,
        datFileName: logicalName,
        datMtimeMs: statFinal.mtimeMs,
        datSize: statFinal.size,
        zoneCode,
        printed: false,
      });
    } catch (err) {
      if (err && err.code === 11000) {
        return { status: "inchange", message: "pris en charge par un autre passage" };
      }
      throw err;
    }
  }

  // À partir d'ici : nous sommes le SEUL à traiter ce fichier.
  const content = fs.readFileSync(workFilePath, "utf8");
  const lignesDat = parseDat(content);
  const { rows, stats } = await construireLignes(entreprise, lignesDat);

  // Agent : le .DAT ne porte aucune identité, mais la COLLECTE qui l'a produit
  // sait quel compte utilisateur a bipé la zone. On reprend son nom/prénom.
  let agentNom = "";
  try {
    const collecte = await InventaireCollecte.findOne({
      entreprise: entreprise._id,
      session: session._id,
      zoneCode,
      zoneType: zone.type || "",
      status: "exporte",
    })
      .sort({ exportedAt: -1 })
      .populate("user", "nom prenom email");
    if (collecte?.user) {
      const u = collecte.user;
      agentNom =
        `${(u.prenom || "").trim()} ${(u.nom || "").trim()}`.trim() ||
        (u.email || "");
    }
  } catch {
    agentNom = "";
  }

  // Persistance des lignes pour l'écran "Détail des bipages"
  // (remplace les lignes éventuelles de ce même fichier).
  await LigneBipage.deleteMany({
    session: session._id,
    datFileName: logicalName,
  });
  if (rows.length) {
    await LigneBipage.insertMany(
      rows.map((r) => ({
        entreprise: entreprise._id,
        session: session._id,
        datFileName: logicalName,
        zoneCode,
        zoneType: zone.type || "",
        ordre: r.n,
        eanArticle: r.code,
        qteScan: r.qte,
        nart: r.nart === "-" ? "" : r.nart,
        designation: r.designation,
        observation: "",
        stock: typeof r.stock === "number" ? r.stock : null,
        found: !r.nonTrouve,
        source: "dat",
        sourceRef: nomFinal,
        agentNom,
      })),
    );
  }

  const date = new Date();
  const header = {
    zoneCode,
    zoneLibelle: zone.libelle || "",
    zoneType: zone.type || "",
    date,
  };

  // Le PDF prend le nom FINAL du .DAT (donc sans le suffixe d'emplacement) et
  // se pose à côté de lui, dans le dossier de l'emplacement.
  const pdfFileName = `${nomFinal.replace(/\.dat$/i, "")}.pdf`;
  const workPath = path.join(dirs.base, pdfFileName);
  await ecrirePDF({ header, rows, outPath: workPath });

  let printed = false;
  let printError = "";
  // Le fichier n'est plus jamais déplacé : il reste à sa place dans le dossier
  // de l'inventaire (cf. commentaire plus bas). `archived` reste donc à false.
  const archived = false;
  const finalPath = workPath;

  if (config.autoprint) {
    try {
      await imprimerPdf(workPath);
      printed = true;
    } catch (err) {
      printError = `Impression échouée : ${err.message}`;
    }
  }

  // PLUS D'ARCHIVAGE : le .DAT et le PDF restent dans le dossier de
  // l'inventaire. Un programme EXTERNE surveille ce dossier — les déplacer vers
  // archive_dat/archive_pdf les lui faisait disparaître, et c'est précisément le
  // symptôme « rien n'est posté dans le dossier ». Le retraitement en boucle est
  // évité par le contrôle mtime/taille plus haut (statut « inchangé »), pas par
  // le déplacement du fichier.

  await FicheControle.findOneAndUpdate(
    { session: session._id, datFileName: logicalName },
    {
      $set: {
        entreprise: entreprise._id,
        session: session._id,
        inventaireNom: session.nom,
        inventaireSlug: session.dossierSlug || session.nom,
        datFileName: logicalName,
        datMtimeMs: statFinal.mtimeMs,
        datSize: statFinal.size,
        zoneCode,
        zoneLibelle: header.zoneLibelle,
        zoneType: header.zoneType,
        pdfFileName,
        pdfPath: finalPath,
        date,
        printed,
        printedAt: printed ? new Date() : null,
        printError,
        archived,
        stats,
      },
    },
    { upsert: true },
  );

  return {
    status: "traite",
    message: `zone ${zoneCode || "?"} · ${stats.total} ligne(s)${
      config.autoprint
        ? printed
          ? " · imprimée"
          : ` · NON imprimée (${printError})`
        : ""
    }`,
  };
};

/**
 * Traite les demandes de réimpression posées depuis l'app web
 * (FicheControle.reprintRequested === true). Le VPS ne pouvant pas imprimer,
 * il pose le drapeau ; c'est ici (agent local, imprimante branchée) qu'on
 * réimprime réellement puis qu'on remet le drapeau à false.
 * N'agit que si l'impression auto est active sur cette machine.
 */
const traiterReimpressions = async (report) => {
  report.reimpressions = [];
  if (!config.autoprint) return; // machine sans imprimante (ex. VPS) : on ignore

  const fiches = await FicheControle.find({ reprintRequested: true });
  for (const fiche of fiches) {
    const rr = { fiche: fiche.datFileName, ok: false, message: "" };
    const pdfPath = resoudreCheminPdf(fiche);
    if (!pdfPath) {
      rr.message = "PDF introuvable sur le disque";
      // On laisse le drapeau : un prochain passage retentera (ex. partage revenu).
      report.reimpressions.push(rr);
      continue;
    }
    try {
      // eslint-disable-next-line no-await-in-loop
      await imprimerPdf(pdfPath);
      fiche.reprintRequested = false;
      fiche.reprintRequestedAt = null;
      fiche.printed = true;
      fiche.printedAt = new Date();
      fiche.printError = "";
      // eslint-disable-next-line no-await-in-loop
      await fiche.save();
      rr.ok = true;
      rr.message = "réimprimée";
    } catch (err) {
      fiche.printError = `Réimpression échouée : ${err.message}`;
      // eslint-disable-next-line no-await-in-loop
      await fiche.save();
      rr.message = fiche.printError;
    }
    report.reimpressions.push(rr);
  }
};

/** Un passage : parcourt les inventaires actifs et traite les nouveaux .DAT,
 *  puis exécute les réimpressions demandées depuis le web.
 *  Renvoie un rapport de diagnostic. */
export const tickOnce = async () => {
  const report = { sessions: [] };
  const sessions = await InventaireZoneSession.find({ statut: "actif" });

  for (const session of sessions) {
    const sr = {
      nom: session.nom,
      dossierDat: session.dossierDat || "",
      ok: false,
      error: "",
      files: [],
    };

    // Dossier surveillé, recalculé pour l'ENVIRONNEMENT COURANT (config.sharePath
    // + <nom>). On NE se fie PAS à session.dossierDat, qui peut avoir été figé en
    // chemin d'un autre OS (session créée sur le VPS Linux → "/mnt/..." ; l'agent
    // local Windows a besoin de "\\192.168.0.250\Rcommun\STOCK\<nom>").
    // Dossier = slug UNIQUE (horodaté) si présent, sinon repli sur le nom pour
    // les anciennes sessions créées avant l'introduction du slug.
    const slug = session.dossierSlug || session.nom;
    const base = slug ? getInventaireDirs(slug).base : session.dossierDat;
    sr.dossierDat = base;
    if (!base) {
      sr.error = "Aucun dossier (nom de session vide) — réinitialisez l'inventaire.";
      report.sessions.push(sr);
      continue;
    }
    const entreprise = await Entreprise.findById(session.entreprise);
    if (!entreprise) {
      sr.error = "Entreprise introuvable";
      report.sessions.push(sr);
      continue;
    }

    // Sous-dossiers réservés (jamais interprétés comme un emplacement).
    const reserved = new Set([
      config.archiveDatDirName.toLowerCase(),
      config.archivePdfDirName.toLowerCase(),
      config.zoneInconnueDirName.toLowerCase(),
    ]);

    // Traite un .DAT : traiterFichier le range dans le sous-dossier de son
    // emplacement (via la zone résolue), génère le PDF, imprime et archive.
    // `currentDir` = où est le fichier ; `folderName` = sous-dossier d'emplacement
    // ("" si le fichier est à la racine).
    const traiterUn = async (currentDir, folderName, name) => {
      const label = folderName ? `${folderName}/${name}` : name;
      if (name.toLowerCase().endsWith(".pdf")) return;
      if (!estFichierDat(name)) {
        sr.files.push({
          name: label,
          status: "ignore",
          message: "nom ne correspond pas au motif stock.dat_<zone>",
        });
        return;
      }
      try {
        const r = await traiterFichier(
          session,
          entreprise,
          base,
          currentDir,
          name,
          folderName,
        );
        sr.files.push({ name: label, ...r });
      } catch (err) {
        sr.files.push({ name: label, status: "erreur", message: err.message });
      }
    };

    // On NE recrée PAS le dossier de base. S'il n'existe pas (rien encore
    // déposé, ou dossier supprimé à la main après une annulation), il n'y a rien
    // à traiter : il sera recréé À LA DEMANDE lors du prochain dépôt d'un .DAT.
    // → un dossier supprimé ne "revient" plus tout seul à chaque passage.
    let rootEntries = [];
    try {
      rootEntries = fs.readdirSync(base, { withFileTypes: true });
    } catch (err) {
      if (err.code === "ENOENT") {
        sr.ok = true; // dossier absent = normal (aucun dépôt) → rien à faire
        report.sessions.push(sr);
        continue;
      }
      sr.error = `Lecture du dossier impossible : ${err.message}`;
      report.sessions.push(sr);
      continue;
    }

    sr.ok = true;
    // 1) Fichiers déposés À LA RACINE → rangés dans leur sous-dossier d'emplacement.
    for (const d of rootEntries) {
      if (!d.isFile()) continue;
      // eslint-disable-next-line no-await-in-loop
      await traiterUn(base, "", d.name);
    }
    // 2) Fichiers déjà DANS un sous-dossier d'emplacement (dépôt direct).
    for (const d of rootEntries) {
      if (!d.isDirectory()) continue;
      if (reserved.has(d.name.toLowerCase())) continue;
      const scanDir = path.join(base, d.name);
      let subEntries = [];
      try {
        // eslint-disable-next-line no-await-in-loop
        subEntries = fs.readdirSync(scanDir, { withFileTypes: true });
      } catch (err) {
        sr.files.push({
          name: `${d.name}/`,
          status: "erreur",
          message: `Lecture impossible : ${err.message}`,
        });
        continue;
      }
      for (const f of subEntries) {
        if (!f.isFile()) continue;
        // eslint-disable-next-line no-await-in-loop
        await traiterUn(scanDir, d.name, f.name);
      }
    }

    report.sessions.push(sr);
  }

  // Réimpressions demandées depuis le web (indépendant des sessions actives).
  try {
    await traiterReimpressions(report);
  } catch (err) {
    report.reimpressionsError = err.message;
  }

  return report;
};

const tick = async () => {
  if (isRunning) return;
  isRunning = true;
  try {
    await tickOnce();
  } catch (err) {
    console.error("[FicheControle] tick:", err.message);
  } finally {
    isRunning = false;
  }
};

/** Scan manuel sérialisé : attend la fin d'un tick en cours puis renvoie le rapport.
 *  Ne s'exécute QUE si cette instance porte réellement la surveillance
 *  (intervalHandle actif). Sinon (ex. VPS de prod, qui ne peut pas imprimer et
 *  ne doit pas « voler » les .DAT à l'agent local) on renvoie un rapport neutre
 *  sans traiter aucun fichier. */
export const scanManuel = async () => {
  if (!intervalHandle) {
    return {
      sessions: [],
      skipped:
        "Cette instance n'assure pas l'impression des fiches. L'agent local (poste imprimante) scanne automatiquement.",
    };
  }
  // attendre qu'un tick automatique en cours se termine (max ~10s)
  for (let i = 0; i < 50 && isRunning; i++) {
    await new Promise((r) => setTimeout(r, 200));
  }
  isRunning = true;
  try {
    return await tickOnce();
  } finally {
    isRunning = false;
  }
};

/** Indique si la surveillance périodique est active. */
export const isWatching = () => !!intervalHandle;

/** Démarre la surveillance périodique. */
export const startInventaireWatcher = () => {
  if (intervalHandle) return;
  console.log(
    `📂 Surveillance .DAT démarrée (${config.sharePath}, ${config.watchIntervalMs}ms)`,
  );
  intervalHandle = setInterval(tick, config.watchIntervalMs);
  // premier passage rapide
  setTimeout(tick, 2000);
};

export const stopInventaireWatcher = () => {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
};