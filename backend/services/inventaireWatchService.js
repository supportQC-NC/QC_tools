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
  getInventaireDirs,
  resoudreCheminPdf,
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

  // Le nom de fichier peut porter un suffixe d'emplacement ajouté au dépôt :
  // "stock.dat <code>_MAGASIN" / "..._DOCK". On sépare le vrai code du type
  // pour lever l'ambiguïté d'un même code présent aux deux emplacements.
  const rawZoneToken = extraireCodeZone(fileName) || "";
  let zoneCode = rawZoneToken;
  let zoneTypeHint = "";
  const mType = rawZoneToken.match(/^(.*)_(MAGASIN|DOCK)$/i);
  if (mType) {
    zoneCode = mType[1];
    zoneTypeHint = mType[2].toUpperCase();
  }

  // Zone (fiche importée) : d'abord code + emplacement si connu, puis code seul.
  // Exact puis insensible à la casse à chaque étape.
  let zone = null;
  if (zoneCode) {
    if (zoneTypeHint) {
      zone =
        (await Zone.findOne({
          entreprise: entreprise._id,
          code: zoneCode,
          type: zoneTypeHint,
        })) ||
        (await Zone.findOne({
          entreprise: entreprise._id,
          code: new RegExp(`^${escapeRegex(zoneCode)}$`, "i"),
          type: zoneTypeHint,
        }));
    }
    if (!zone) {
      zone =
        (await Zone.findOne({ entreprise: entreprise._id, code: zoneCode })) ||
        (await Zone.findOne({
          entreprise: entreprise._id,
          code: new RegExp(`^${escapeRegex(zoneCode)}$`, "i"),
        }));
    }
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
    const base = session.nom ? getInventaireDirs(session.nom).base : session.dossierDat;
    sr.dossierDat = base;
    if (!base) {
      sr.error = "Aucun dossier (nom de session vide) — réinitialisez l'inventaire.";
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