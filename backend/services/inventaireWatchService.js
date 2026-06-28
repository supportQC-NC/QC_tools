// backend/services/inventaireWatchService.js
import fs from "fs";
import path from "path";
import os from "os";
import InventaireZoneSession from "../models/InventaireZoneSessionModel.js";
import Entreprise from "../models/EntrepriseModel.js";
import Zone from "../models/ZoneModel.js";
import FicheControle from "../models/FicheControleModel.js";
import LigneBipage from "../models/LigneBipageModel.js";
import {
  config,
  parseDat,
  construireLignes,
  ecrirePDF,
  extraireCodeZone,
  estFichierDat,
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
export const deplacerVers = (srcPath, destDir) => {
  fs.mkdirSync(destDir, { recursive: true });
  const dest = path.join(destDir, path.basename(srcPath));
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

const traiterFichier = async (session, entreprise, dirs, fileName) => {
  const { base, archiveDat, archivePdf, zoneInconnue } = dirs;
  const filePath = path.join(base, fileName);
  const stat = fs.statSync(filePath);

  // Déjà traité et inchangé ?
  const existing = await FicheControle.findOne({
    session: session._id,
    datFileName: fileName,
  });
  if (
    existing &&
    existing.datMtimeMs === stat.mtimeMs &&
    existing.datSize === stat.size
  ) {
    return { status: "inchange", message: "déjà traité" };
  }

  const content = fs.readFileSync(filePath, "utf8");
  const lignesDat = parseDat(content);
  const zoneCode = extraireCodeZone(fileName) || "";

  // Zone (fiche importée) : exact puis insensible à la casse
  let zone = null;
  if (zoneCode) {
    zone =
      (await Zone.findOne({ entreprise: entreprise._id, code: zoneCode })) ||
      (await Zone.findOne({
        entreprise: entreprise._id,
        code: new RegExp(`^${escapeRegex(zoneCode)}$`, "i"),
      }));
  }

  // Zone introuvable → pas de fiche, pas d'impression : déplacer le .DAT
  // dans zone_non_trouvee. Si le déplacement échoue, on REMONTE l'erreur.
  if (!zone) {
    try {
      deplacerVers(filePath, zoneInconnue);
      return {
        status: "zone_inconnue",
        message: `zone "${zoneCode || "?"}" introuvable → déplacé dans ${config.zoneInconnueDirName}`,
      };
    } catch (err) {
      return {
        status: "erreur",
        message: `zone "${zoneCode || "?"}" introuvable, déplacement IMPOSSIBLE : ${err.message}`,
      };
    }
  }

  // VERROU ATOMIQUE anti double-impression : on "réserve" le fichier via
  // l'index unique (session + datFileName). Seul le passage/process qui réussit
  // la réservation imprimera ; les autres voient "déjà pris en charge".
  if (existing) {
    // Le fichier a changé (mtime/size) → re-réservation conditionnelle atomique.
    const res = await FicheControle.updateOne(
      {
        session: session._id,
        datFileName: fileName,
        datMtimeMs: existing.datMtimeMs,
        datSize: existing.datSize,
      },
      {
        $set: {
          datMtimeMs: stat.mtimeMs,
          datSize: stat.size,
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
        datFileName: fileName,
        datMtimeMs: stat.mtimeMs,
        datSize: stat.size,
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
  const { rows, stats } = await construireLignes(entreprise, lignesDat);

  // Persistance des lignes pour l'écran "Détail des bipages"
  // (remplace les lignes éventuelles de ce même fichier).
  await LigneBipage.deleteMany({ session: session._id, datFileName: fileName });
  if (rows.length) {
    await LigneBipage.insertMany(
      rows.map((r) => ({
        entreprise: entreprise._id,
        session: session._id,
        datFileName: fileName,
        zoneCode,
        ordre: r.n,
        eanArticle: r.code,
        qteScan: r.qte,
        nart: r.nart === "-" ? "" : r.nart,
        designation: r.designation,
        observation: "",
        stock: typeof r.stock === "number" ? r.stock : null,
        found: !r.nonTrouve,
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

  const pdfFileName = `${fileName.replace(/\.dat$/i, "")}.pdf`;
  const workPath = path.join(base, pdfFileName);
  await ecrirePDF({ header, rows, outPath: workPath });

  let printed = false;
  let printError = "";
  let archived = false;
  let finalPath = workPath;

  if (config.autoprint) {
    try {
      await imprimerPdf(workPath);
      printed = true;
    } catch (err) {
      printError = `Impression échouée : ${err.message}`;
    }
  }

  // Archivage (uniquement si imprimé) : PDF → archive_pdf, .DAT → archive_dat.
  // Les échecs de déplacement sont REMONTÉS dans printError (plus jamais avalés).
  if (printed) {
    try {
      finalPath = deplacerVers(workPath, archivePdf);
    } catch (err) {
      printError = `Imprimée mais PDF non archivé : ${err.message}`;
    }
    try {
      deplacerVers(filePath, archiveDat);
      archived = true;
    } catch (err) {
      printError = printError
        ? `${printError} ; .DAT non archivé : ${err.message}`
        : `Imprimée mais .DAT non archivé : ${err.message}`;
    }
  }

  await FicheControle.findOneAndUpdate(
    { session: session._id, datFileName: fileName },
    {
      $set: {
        entreprise: entreprise._id,
        session: session._id,
        inventaireNom: session.nom,
        datFileName: fileName,
        datMtimeMs: stat.mtimeMs,
        datSize: stat.size,
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
          ? archived
            ? " · imprimée + archivée"
            : ` · imprimée (archivage : ${printError || "?"})`
          : ` · NON imprimée (${printError})`
        : ""
    }`,
  };
};

/** Un passage : parcourt les inventaires actifs et traite les nouveaux .DAT.
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

    const base = session.dossierDat;
    if (!base) {
      sr.error = "Aucun dossier (dossierDat vide) — réinitialisez l'inventaire.";
      report.sessions.push(sr);
      continue;
    }
    const dirs = {
      base,
      archiveDat: path.join(base, config.archiveDatDirName),
      archivePdf: path.join(base, config.archivePdfDirName),
      zoneInconnue: path.join(base, config.zoneInconnueDirName),
    };

    try {
      fs.mkdirSync(dirs.base, { recursive: true });
      fs.mkdirSync(dirs.archiveDat, { recursive: true });
      fs.mkdirSync(dirs.archivePdf, { recursive: true });
      fs.mkdirSync(dirs.zoneInconnue, { recursive: true });
    } catch (err) {
      sr.error = `Dossier inaccessible : ${err.message}`;
      report.sessions.push(sr);
      continue;
    }

    const entreprise = await Entreprise.findById(session.entreprise);
    if (!entreprise) {
      sr.error = "Entreprise introuvable";
      report.sessions.push(sr);
      continue;
    }

    let entries = [];
    try {
      entries = fs.readdirSync(base, { withFileTypes: true });
    } catch (err) {
      sr.error = `Lecture du dossier impossible : ${err.message}`;
      report.sessions.push(sr);
      continue;
    }

    sr.ok = true;
    for (const d of entries) {
      if (!d.isFile()) continue;
      const name = d.name;
      if (name.toLowerCase().endsWith(".pdf")) continue;
      if (!estFichierDat(name)) {
        sr.files.push({
          name,
          status: "ignore",
          message: "nom ne correspond pas au motif stock.dat_<zone>",
        });
        continue;
      }
      try {
        const r = await traiterFichier(session, entreprise, dirs, name);
        sr.files.push({ name, ...r });
      } catch (err) {
        sr.files.push({ name, status: "erreur", message: err.message });
      }
    }

    report.sessions.push(sr);
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

/** Scan manuel sérialisé : attend la fin d'un tick en cours puis renvoie le rapport. */
export const scanManuel = async () => {
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