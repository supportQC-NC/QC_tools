// backend/controllers/ficheControleController.js
import fs from "fs";
import asyncHandler from "../middleware/asyncHandler.js";
import FicheControle from "../models/FicheControleModel.js";
import InventaireZoneSession from "../models/InventaireZoneSessionModel.js";
import LigneBipage from "../models/LigneBipageModel.js";
import {
  config,
  resoudreCheminPdf,
  assurerPdfFiche,
  referenceImportsZone,
} from "../services/ficheControleService.js";
import {
  scanManuel,
  isWatching,
  startInventaireWatcher,
  stopInventaireWatcher,
} from "../services/inventaireWatchService.js";
import {
  detailsProformas,
  enteteFicheImport,
  enregistrerFicheZoneImports,
} from "../services/bipageImportService.js";

/**
 * @desc    Liste des fiches de l'inventaire actif
 * @route   GET /api/fiches-controle/:entrepriseId
 * @access  Private/Admin
 */
const getFiches = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;

  const session = await InventaireZoneSession.findOne({
    entreprise: entreprise._id,
    statut: "actif",
  });

  if (!session) {
    return res.json({ active: false, fiches: [] });
  }

  // ── Rattrapage / MIGRATION des fiches d'imports ──
  // UNE fiche PAR ZONE depuis le 16/11/2026 (cumul de tous les imports de la
  // zone — avant, une fiche PAR document). Toute zone importée qui n'a pas
  // encore sa fiche groupée la reçoit ici : imports intégrés avant la fiche
  // automatique du 30/10/2026 comme fiches « une par proforma » antérieures au
  // regroupement (remplacées au passage par `enregistrerFicheZoneImports`).
  // SANS impression (`reimprimer: false`) : rien n'a changé au terrain.
  // Best-effort : un échec n'empêche pas la liste de s'afficher.
  try {
    const zonesImports = await LigneBipage.aggregate([
      {
        $match: {
          session: session._id,
          $or: [
            { source: { $in: ["proforma", "excel"] } },
            {
              source: { $in: [null, ""] },
              datFileName: { $regex: /^(?:deduction |excel |proforma )/ },
            },
          ],
        },
      },
      { $group: { _id: { code: "$zoneCode", type: "$zoneType" } } },
    ]);
    if (zonesImports.length) {
      const refs = zonesImports.map((z) =>
        referenceImportsZone(z._id.code, z._id.type),
      );
      const existantes = new Set(
        (
          await FicheControle.find({
            session: session._id,
            datFileName: { $in: refs },
          })
            .select("datFileName")
            .lean()
        ).map((f) => f.datFileName),
      );
      for (const z of zonesImports) {
        if (existantes.has(referenceImportsZone(z._id.code, z._id.type))) {
          continue;
        }
        await enregistrerFicheZoneImports({
          entreprise,
          session,
          zoneCode: z._id.code,
          zoneType: z._id.type,
          reimprimer: false,
        });
      }
    }
  } catch (e) {
    console.error("[fiches-controle] rattrapage imports :", e.message);
  }

  const fiches = await FicheControle.find({ session: session._id })
    .sort({ date: -1 })
    .lean();

  // ── Enrichissement des fiches PROFORMA ──
  // L'écran doit montrer, en plus du numéro, le CLIENT (n° + nom) et
  // l'OBSERVATION du document (demande client du 30/10/2026). Résolu à la
  // lecture dans le cache proforma (TTL) : rien de plus à stocker, et les
  // fiches déjà créées en profitent aussi. Best-effort — cache indisponible =
  // fiches sans enrichissement, jamais d'écran vide. L'écran "polle" toutes
  // les 5 s : après le premier chargement le cache est chaud, le coût est nul.
  const RE_NUMFACT = /^(?:deduction )?proforma (\S+)/;
  try {
    const numfacts = [
      ...new Set(
        fiches
          .map((f) => (RE_NUMFACT.exec(String(f.datFileName || "")) || [])[1])
          .filter(Boolean),
      ),
    ];
    if (numfacts.length) {
      const details = await detailsProformas(entreprise, numfacts);
      for (const f of fiches) {
        const numfact = (RE_NUMFACT.exec(String(f.datFileName || "")) || [])[1];
        const d = numfact ? details.get(numfact) : null;
        if (d) {
          f.proforma = {
            numfact: d.numfact,
            tiers: d.tiers,
            nomClient: d.nomClient,
            observation: d.observation,
          };
        }
      }
    }
  } catch (e) {
    console.error("[fiches-controle] enrichissement proformas :", e.message);
  }

  res.json({
    active: true,
    session: { _id: session._id, nom: session.nom, dossierDat: session.dossierDat },
    fiches,
  });
});

/**
 * @desc    Déclenche un scan immédiat des dossiers .DAT
 * @route   POST /api/fiches-controle/:entrepriseId/scan
 * @access  Private/Admin
 */
const scanMaintenant = asyncHandler(async (req, res) => {
  const report = await scanManuel();
  res.json({ message: "Scan effectué", report });
});

/**
 * @desc    État de la surveillance automatique
 * @route   GET /api/fiches-controle/watch/status
 * @access  Private/Admin
 */
const statutSurveillance = asyncHandler(async (req, res) => {
  res.json({ watching: isWatching(), intervalMs: config.watchIntervalMs });
});

/**
 * @desc    Démarrer la surveillance automatique
 * @route   POST /api/fiches-controle/watch/start
 * @access  Private/Admin
 */
const demarrerSurveillance = asyncHandler(async (req, res) => {
  startInventaireWatcher();
  res.json({ watching: true, intervalMs: config.watchIntervalMs });
});

/**
 * @desc    Arrêter la surveillance automatique
 * @route   POST /api/fiches-controle/watch/stop
 * @access  Private/Admin
 */
const arreterSurveillance = asyncHandler(async (req, res) => {
  stopInventaireWatcher();
  res.json({ watching: false });
});

/**
 * @desc    Demander la réimpression d'une fiche.
 *          L'impression a lieu là où sont l'imprimante + le Rcommun (agent
 *          local). Le backend web (potentiellement le VPS Linux) ne peut pas
 *          imprimer : il POSE le drapeau `reprintRequested`, que le watcher/
 *          agent local exécute au passage suivant (~quelques secondes).
 * @route   POST /api/fiches-controle/:entrepriseId/:id/reprint
 * @access  Private/Admin
 */
const reimprimer = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const fiche = await FicheControle.findOne({
    _id: req.params.id,
    entreprise: entreprise._id,
  });

  if (!fiche) {
    res.status(404);
    throw new Error("Fiche non trouvée");
  }

  fiche.reprintRequested = true;
  fiche.reprintRequestedAt = new Date();
  fiche.printError = "";
  await fiche.save();

  res.json({
    message:
      "Réimpression envoyée : la fiche va sortir sur l'imprimante du magasin.",
    fiche,
  });
});

/**
 * @desc    Afficher (aperçu) ou télécharger le PDF d'une fiche.
 *          Le PDF vit sur le partage réseau, mais il peut avoir été déplacé ou
 *          supprimé par le programme externe qui surveille le dossier — et le
 *          backend web (VPS) n'a pas toujours accès à ce partage. On le
 *          REGÉNÈRE alors à l'identique depuis le .DAT ou depuis les lignes
 *          stockées en base : l'aperçu et le téléchargement marchent donc
 *          toujours, indépendamment de l'agent d'impression.
 * @route   GET /api/fiches-controle/:entrepriseId/:id/pdf[?download=1]
 * @access  Private/Admin
 */
const telechargerPdf = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const fiche = await FicheControle.findOne({
    _id: req.params.id,
    entreprise: entreprise._id,
  });

  if (!fiche) {
    res.status(404);
    throw new Error("Fiche non trouvée");
  }

  // Fiche d'IMPORT de proforma : en-tête enrichi (observation après la zone,
  // client après le libellé). Best-effort — sans résolution on garde l'en-tête
  // stocké.
  const surcharge = await enteteFicheImport(entreprise, fiche).catch(() => null);

  const { chemin, temporaire } = await assurerPdfFiche(fiche, entreprise, surcharge);
  if (!chemin) {
    res.status(404);
    throw new Error(
      "PDF indisponible : ni le fichier sur le partage, ni les lignes bipées ne sont accessibles pour cette fiche.",
    );
  }

  // Nom de fichier lisible côté poste : "fiche_<zone>_<emplacement>.pdf".
  const base =
    [fiche.zoneCode, fiche.zoneType].filter(Boolean).join("_") || "fiche";
  const nomFichier = (fiche.pdfFileName || `fiche ${base}.pdf`).replace(
    /[\\/:*?"<>|]/g,
    "_",
  );
  const disposition = req.query.download ? "attachment" : "inline";

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `${disposition}; filename="${nomFichier}"`,
  );

  const stream = fs.createReadStream(chemin);
  // Le PDF regénéré est un temporaire : on le supprime une fois envoyé (ou si
  // le client coupe la connexion), sinon on remplit %TEMP% à chaque aperçu.
  const nettoyer = () => {
    if (!temporaire) return;
    try {
      fs.unlinkSync(chemin);
    } catch {
      /* ignore */
    }
  };
  stream.on("close", nettoyer);
  stream.on("error", nettoyer);
  res.on("close", nettoyer);
  stream.pipe(res);
});

/**
 * @desc    Supprimer une fiche (enregistrement + PDF)
 * @route   DELETE /api/fiches-controle/:entrepriseId/:id
 * @access  Private/Admin
 */
const supprimerFiche = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const fiche = await FicheControle.findOne({
    _id: req.params.id,
    entreprise: entreprise._id,
  });

  if (!fiche) {
    res.status(404);
    throw new Error("Fiche non trouvée");
  }

  try {
    const pdfPath = resoudreCheminPdf(fiche, entreprise);
    if (pdfPath) {
      fs.unlinkSync(pdfPath);
    }
  } catch {
    // ignore : suppression du PDF best-effort
  }

  await FicheControle.deleteOne({ _id: fiche._id });
  res.json({ message: "Fiche supprimée" });
});

/**
 * @desc    Marquer des fiches « imprimées » (ou l'inverse) — rangement de
 *          l'écran : les fiches cochées passent dans l'onglet « Imprimées »
 *          (demande client du 30/10/2026). Marquer imprimée annule aussi une
 *          demande d'impression en attente (l'agent n'a plus à la sortir).
 * @route   POST /api/fiches-controle/:entrepriseId/marquer-imprimees
 * @body    { ids: [..], printed?: true }
 * @access  Private (fiches_controle_admin, write)
 */
const marquerImprimees = asyncHandler(async (req, res) => {
  const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).filter(Boolean);
  if (!ids.length) {
    res.status(400);
    throw new Error("Aucune fiche sélectionnée.");
  }
  const printed = req.body?.printed !== false;

  const maj = printed
    ? {
        printed: true,
        printedAt: new Date(),
        printError: "",
        reprintRequested: false,
        reprintRequestedAt: null,
      }
    : { printed: false, printedAt: null };

  const r = await FicheControle.updateMany(
    { _id: { $in: ids }, entreprise: req.entreprise._id },
    { $set: maj },
  );

  res.json({
    message: `${r.modifiedCount} fiche(s) ${
      printed ? "marquée(s) imprimée(s)" : "repassée(s) à imprimer"
    }.`,
    modifiees: r.modifiedCount,
  });
});

export {
  getFiches,
  scanMaintenant,
  statutSurveillance,
  demarrerSurveillance,
  arreterSurveillance,
  reimprimer,
  telechargerPdf,
  supprimerFiche,
  marquerImprimees,
};