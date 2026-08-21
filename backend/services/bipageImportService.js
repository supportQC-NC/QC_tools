// backend/services/bipageImportService.js
//
// Deux sources d'alimentation de l'écran « Détail des bipages », en plus des
// fichiers .DAT déposés par le collecteur :
//
//   1. PROFORMA (lecture DBF) — on choisit une plage de dates et un ou plusieurs
//      numéros de client ; toute proforma qui tombe dedans et dont l'OBSERVATION
//      respecte la convention devient un bipage. L'agent est le vendeur du champ
//      REPRES.
//   2. FICHIER EXCEL — un fichier par zone, dont le NOM porte l'agent, la zone
//      et l'emplacement ; le contenu ne porte que les codes et les quantités.
//
// Dans les deux cas les lignes produites sont des `LigneBipage` rattachées à la
// SESSION D'INVENTAIRE ACTIVE, exactement comme celles issues d'un .DAT : elles
// s'affichent, se corrigent et s'exportent de la même façon.
//
// ⚠️ Aucune écriture DBF : l'ERP reste en lecture seule.
import ExcelJS from "exceljs";
import proformaCacheService from "./proformaCacheService.js";
import { construireLignes } from "./ficheControleService.js";
import Zone from "../models/ZoneModel.js";
import LigneBipage from "../models/LigneBipageModel.js";

const trim = (v) => (v === null || v === undefined ? "" : String(v).trim());

// ────────────────────────────────────────────────────────────────────────────
// CONVENTION DE NOMMAGE — commune aux deux imports
//
//   <code de zone>_<EMPLACEMENT>       ex. A_1_MAGASIN, B_5d_DOCK
//
// Le code de zone est TOUT ce qui précède le DERNIER « _ » (les codes en
// contiennent eux-mêmes : A_1, B_5d) ; ce qui suit désigne l'emplacement.
// C'est exactement la règle des fichiers .dat déposés par le collecteur — une
// seule convention à retenir dans toute l'application.
//
// ⚠️ GARDE-FOU : on n'accepte le découpage que si la partie qui suit le dernier
// « _ » est un emplacement RÉELLEMENT utilisé par la société (MAGASIN, DOCK…).
// Sans ça, n'importe quelle observation contenant un « _ » serait prise pour
// une zone — c'est le risque assumé d'une convention sans préfixe.
// ────────────────────────────────────────────────────────────────────────────

/** Emplacements existants de la société (valeurs distinctes de Zone.type). */
export const getEmplacements = async (entrepriseId) => {
  const types = await Zone.distinct("type", { entreprise: entrepriseId });
  return types.map((t) => trim(t)).filter(Boolean);
};

/**
 * Découpe "<zone>_<EMPLACEMENT>".
 * @returns { zoneCode, emplacement } ou null si la convention n'est pas respectée.
 */
export const parserZoneEmplacement = (texte, emplacements = []) => {
  const valeur = trim(texte);
  if (!valeur) return null;
  const sep = valeur.lastIndexOf("_");
  if (sep <= 0) return null;

  const zoneCode = valeur.slice(0, sep).trim();
  const emplacement = valeur.slice(sep + 1).trim();
  if (!zoneCode || !emplacement) return null;

  const connu = emplacements.find(
    (e) => e.toLowerCase() === emplacement.toLowerCase(),
  );
  if (!connu) return null;

  return { zoneCode, emplacement: connu };
};

/** Nom lisible d'un agent à partir de son code vendeur (REPRES). */
export const nomAgent = (entreprise, code) => {
  const c = trim(code);
  if (!c) return "";
  const vendeurs = entreprise.vendeurs || [];
  // Le code REPRES est numérique dans le DBF ("8") et souvent stocké sur deux
  // caractères dans le dictionnaire des vendeurs ("08") : on compare les deux.
  const v = vendeurs.find(
    (x) => trim(x.code) === c || trim(x.code) === c.padStart(2, "0"),
  );
  // Repli quand l'onglet Vendeurs de la fiche société n'est pas renseigné :
  // même formulation que le module réappro, pour ne jamais afficher un vide.
  if (!v) return `Vendeur ${c}`;
  return `${trim(v.prenom)} ${trim(v.nom)}`.trim() || `Vendeur ${trim(v.code)}`;
};

// ────────────────────────────────────────────────────────────────────────────
// SOURCE 1 — PROFORMAS
// ────────────────────────────────────────────────────────────────────────────

// Dans proforma.dbf, l'observation saisie dans l'ERP est le champ TEXTE (C60) —
// il n'existe pas de champ nommé OBSERV.
const CHAMP_OBSERVATION = "TEXTE";

const memeJour = (d) => {
  if (!d) return null;
  const dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt.getTime())) return null;
  return dt;
};

/**
 * Proformas candidates : plage de dates (DATFACT) + numéros de client (TIERS).
 * Chaque proforma est renvoyée AVEC le verdict de lecture de son observation,
 * pour que l'écran puisse expliquer pourquoi une proforma n'est pas éligible.
 */
export const getProformasEligibles = async (entreprise, options = {}) => {
  const { dateDebut, dateFin, clients = [] } = options;

  const cache = await proformaCacheService.getProformas(entreprise);
  const emplacements = await getEmplacements(entreprise._id);

  const debut = memeJour(dateDebut);
  const fin = memeJour(dateFin);
  if (fin) fin.setHours(23, 59, 59, 999);

  const listeClients = (Array.isArray(clients) ? clients : [clients])
    .map((c) => trim(c))
    .filter(Boolean);

  // Restriction par client via l'index TIERS quand on en a (bien plus rapide
  // qu'un balayage complet : proforma.dbf fait ~80 000 lignes chez QC).
  let indices = null;
  if (listeClients.length) {
    indices = [];
    for (const c of listeClients) {
      const idx = cache.indexByTiers.get(String(Number(c))) || [];
      indices.push(...idx);
    }
    indices = [...new Set(indices)];
  }

  const source = indices
    ? indices.map((i) => cache.proformaRecords[i])
    : cache.proformaRecords;

  const proformas = [];
  for (const p of source) {
    if (!p) continue;
    const date = memeJour(p.DATFACT);
    if (debut && (!date || date < debut)) continue;
    if (fin && (!date || date > fin)) continue;

    const observation = trim(p[CHAMP_OBSERVATION]);
    const lecture = parserZoneEmplacement(observation, emplacements);
    const numfact = trim(p.NUMFACT);
    const lignes = cache.prodetByNumfact.get(numfact) || [];

    proformas.push({
      numfact,
      datfact: p.DATFACT || null,
      tiers: p.TIERS ?? null,
      nomClient: trim(p.NOM),
      etat: p.ETAT ?? null,
      observation,
      montant: p.MONTANT ?? 0,
      nbLignes: lignes.length,
      agentCode: trim(p.REPRES),
      agentNom: nomAgent(entreprise, p.REPRES),
      zoneCode: lecture ? lecture.zoneCode : "",
      emplacement: lecture ? lecture.emplacement : "",
      eligible: !!lecture && lignes.length > 0,
      raison: !lecture
        ? observation
          ? `Observation « ${observation} » non conforme (attendu : <zone>_<EMPLACEMENT>)`
          : "Observation vide"
        : lignes.length === 0
          ? "Proforma sans ligne"
          : "",
    });
  }

  proformas.sort((a, b) => new Date(b.datfact || 0) - new Date(a.datfact || 0));
  return {
    emplacements,
    total: proformas.length,
    nbEligibles: proformas.filter((p) => p.eligible).length,
    proformas,
  };
};

/**
 * Intègre les proformas choisies dans la session d'inventaire active.
 * Un ré-import de la même proforma REMPLACE ses lignes (même logique que le
 * retraitement d'un .DAT), il n'empile pas de doublons.
 */
export const importerProformas = async (entreprise, session, numfacts = []) => {
  const liste = [...new Set(numfacts.map((n) => trim(n)).filter(Boolean))];
  if (!liste.length) return { importees: 0, lignes: 0, resultats: [] };

  const cache = await proformaCacheService.getProformas(entreprise);
  const emplacements = await getEmplacements(entreprise._id);

  const resultats = [];
  let totalLignes = 0;

  for (const numfact of liste) {
    const idx = cache.indexByNumfact.get(numfact);
    const p = idx !== undefined ? cache.proformaRecords[idx] : null;
    if (!p) {
      resultats.push({ numfact, statut: "erreur", message: "Proforma introuvable" });
      continue;
    }

    const lecture = parserZoneEmplacement(trim(p[CHAMP_OBSERVATION]), emplacements);
    if (!lecture) {
      resultats.push({
        numfact,
        statut: "erreur",
        message: `Observation « ${trim(p[CHAMP_OBSERVATION])} » non conforme`,
      });
      continue;
    }

    // La zone doit exister, au bon emplacement (même exigence que pour un .DAT).
    const zone = await Zone.findOne({
      entreprise: entreprise._id,
      code: lecture.zoneCode,
      type: lecture.emplacement,
    });
    if (!zone) {
      resultats.push({
        numfact,
        statut: "erreur",
        message: `Zone ${lecture.zoneCode} (${lecture.emplacement}) inconnue`,
      });
      continue;
    }

    const lignesProforma = cache.prodetByNumfact.get(numfact) || [];
    // Les lignes de commentaire (sans NART) ne sont pas des articles bipés.
    const aCompter = lignesProforma
      .map((l) => ({ code: trim(l.NART), quantite: Number(l.QTE) || 0 }))
      .filter((l) => l.code);

    if (!aCompter.length) {
      resultats.push({ numfact, statut: "erreur", message: "Aucune ligne article" });
      continue;
    }

    const { rows } = await construireLignes(entreprise, aCompter);
    const reference = `proforma ${numfact}`;
    const agentCode = trim(p.REPRES);
    const agentNom = nomAgent(entreprise, p.REPRES);

    await LigneBipage.deleteMany({ session: session._id, datFileName: reference });
    await LigneBipage.insertMany(
      rows.map((r) => ({
        entreprise: entreprise._id,
        session: session._id,
        datFileName: reference,
        zoneCode: lecture.zoneCode,
        zoneType: lecture.emplacement,
        ordre: r.n,
        eanArticle: r.code,
        qteScan: r.qte,
        nart: r.nart === "-" ? "" : r.nart,
        designation: r.designation,
        observation: "",
        stock: typeof r.stock === "number" ? r.stock : null,
        found: !r.nonTrouve,
        source: "proforma",
        sourceRef: numfact,
        agentCode,
        agentNom,
      })),
    );

    totalLignes += rows.length;
    resultats.push({
      numfact,
      statut: "importee",
      zoneCode: lecture.zoneCode,
      emplacement: lecture.emplacement,
      agentNom,
      lignes: rows.length,
    });
  }

  return {
    importees: resultats.filter((r) => r.statut === "importee").length,
    lignes: totalLignes,
    resultats,
  };
};

// ────────────────────────────────────────────────────────────────────────────
// SOURCE 2 — FICHIER EXCEL
//
// CONVENTION DE NOMMAGE DU FICHIER (un fichier = une zone) :
//
//   bipage_<agent>_<zone>_<EMPLACEMENT>.xlsx      ex. bipage_12_A_1_MAGASIN.xlsx
//
// Lecture : on retire le préfixe « bipage_ », le PREMIER bloc est le code agent,
// le DERNIER est l'emplacement, et TOUT CE QUI RESTE AU MILIEU est le code de
// zone (il contient lui-même des « _ »).
// Le contenu ne porte que deux colonnes : CODE et QUANTITE.
// ────────────────────────────────────────────────────────────────────────────
const PREFIXE_FICHIER = "bipage";

export const parserNomFichierExcel = (nomFichier, emplacements = []) => {
  const base = trim(nomFichier).replace(/\.(xlsx|xlsm|xls)$/i, "");
  const parts = base.split("_").filter((p) => p !== "");
  if (parts.length < 4) return null;
  if (parts[0].toLowerCase() !== PREFIXE_FICHIER) return null;

  const agentCode = parts[1];
  const emplacementBrut = parts[parts.length - 1];
  const zoneCode = parts.slice(2, parts.length - 1).join("_");
  if (!agentCode || !zoneCode || !emplacementBrut) return null;

  const connu = emplacements.find(
    (e) => e.toLowerCase() === emplacementBrut.toLowerCase(),
  );
  if (!connu) return null;

  return { agentCode, zoneCode, emplacement: connu };
};

/** Modèle Excel téléchargeable depuis l'écran. */
export const genererModeleExcelBipage = async () => {
  const wb = new ExcelJS.Workbook();
  wb.creator = "QC Tools";

  const ws = wb.addWorksheet("Bipage");
  ws.columns = [
    { header: "CODE", key: "code", width: 22 },
    { header: "QUANTITE", key: "qte", width: 12 },
  ];
  ws.getRow(1).font = { bold: true };
  ws.addRows([
    { code: "3223430141205", qte: 12 },
    { code: "781172", qte: 2 },
  ]);

  const aide = wb.addWorksheet("Aide");
  aide.columns = [{ width: 110 }];
  [
    "IMPORT DE BIPAGES DEPUIS EXCEL",
    "",
    "1) NOMMEZ LE FICHIER AVANT DE L'IMPORTER — c'est le nom qui dit qui a bipé, quelle zone et où :",
    "",
    "        bipage_<agent>_<zone>_<EMPLACEMENT>.xlsx",
    "",
    "   Exemples :   bipage_12_A_1_MAGASIN.xlsx      agent 12, zone A_1, au magasin",
    "                bipage_08_B_5d_DOCK.xlsx        agent 08, zone B_5d, au dock",
    "",
    "   - <agent>       : code vendeur (REPRES), tel qu'il figure dans la fiche société",
    "   - <zone>        : code du rayon, il peut contenir des « _ » (A_1, B_5d)",
    "   - <EMPLACEMENT> : MAGASIN ou DOCK — c'est le DERNIER bloc du nom",
    "",
    "   Un fichier = une seule zone. Pour deux zones, faites deux fichiers.",
    "",
    "2) REMPLISSEZ L'ONGLET « Bipage » :",
    "",
    "   - CODE     : code-barres (gencode) ou code article (NART)",
    "   - QUANTITE : quantité comptée, en nombre entier",
    "",
    "   Une ligne par article. Les lignes sans code sont ignorées.",
    "",
    "3) IMPORTEZ le fichier depuis l'écran « Détail des bipages », en choisissant le MODE :",
    "",
    "   - Inventaire : comptage normal. Les quantités s'ajoutent.",
    "   - Déduction  : les quantités sont retranchées (enregistrées en négatif).",
    "                  À utiliser pour une partie du magasin restée OUVERTE :",
    "                  ce qui a été vendu entre le début et la fin de l'inventaire",
    "                  ne doit pas être compté comme présent en rayon.",
    "",
    "   Dans les deux cas, saisissez les quantités NORMALEMENT (en positif) :",
    "   c'est le mode choisi à l'import qui décide du signe.",
    "",
    "   Un même fichier peut être importé dans les deux modes sans que l'un",
    "   efface l'autre.",
    "",
    "Les articles inconnus du catalogue sont importés quand même et signalés",
    "« Article non trouvé » à l'écran, comme pour un bipage au collecteur.",
    "",
    "Réimporter un fichier du même nom REMPLACE les lignes déjà importées :",
    "cela corrige une erreur sans créer de doublon.",
  ].forEach((l) => aide.addRow([l]));
  aide.getRow(1).font = { bold: true, size: 13 };
  aide.getRow(5).font = { bold: true };

  return wb.xlsx.writeBuffer();
};

/**
 * Lit le fichier et crée les lignes de bipage de la zone concernée.
 *
 * `mode` :
 *  - "inventaire" (défaut) : comptage normal, quantités positives ;
 *  - "deduction" : les quantités sont enregistrées en NÉGATIF. Sert aux parties
 *    du magasin restées ouvertes : ce qui a été vendu entre le début et la fin
 *    de l'inventaire est retranché du comptage. Les deux imports d'un même
 *    fichier coexistent (références distinctes), ils ne s'écrasent pas.
 */
export const importerExcelBipage = async (
  entreprise,
  session,
  nomFichier,
  buffer,
  mode = "inventaire",
) => {
  const deduction = mode === "deduction";
  const emplacements = await getEmplacements(entreprise._id);
  const lecture = parserNomFichierExcel(nomFichier, emplacements);
  if (!lecture) {
    throw new Error(
      `Nom de fichier non conforme : « ${nomFichier} ». Attendu : ` +
        `bipage_<agent>_<zone>_<EMPLACEMENT>.xlsx (emplacements connus : ` +
        `${emplacements.join(", ") || "aucun"}).`,
    );
  }

  const zone = await Zone.findOne({
    entreprise: entreprise._id,
    code: lecture.zoneCode,
    type: lecture.emplacement,
  });
  if (!zone) {
    throw new Error(
      `Zone ${lecture.zoneCode} (${lecture.emplacement}) inconnue pour cette société.`,
    );
  }

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.getWorksheet("Bipage") || wb.worksheets[0];
  if (!ws) throw new Error("Fichier Excel vide.");

  // Repérage des colonnes CODE / QUANTITE sur la première ligne, quel que soit
  // leur ordre ; à défaut on prend les deux premières colonnes.
  const entetes = {};
  ws.getRow(1).eachCell((cell, col) => {
    const t = trim(cell.value).toUpperCase();
    if (t.startsWith("CODE")) entetes.code = col;
    else if (t.startsWith("QUANT") || t === "QTE") entetes.qte = col;
  });
  const colCode = entetes.code || 1;
  const colQte = entetes.qte || 2;

  const aCompter = [];
  const ignorees = [];
  ws.eachRow((row, numero) => {
    if (numero === 1) return;
    const brut = row.getCell(colCode).value;
    const code = trim(
      brut && typeof brut === "object" && brut.text ? brut.text : brut,
    );
    if (!code) return;
    // En mode déduction la quantité est saisie normalement (positive) et c'est
    // l'import qui la passe en négatif ; on tolère aussi un signe déjà saisi.
    const quantite = Math.abs(parseInt(row.getCell(colQte).value, 10));
    if (!quantite) {
      ignorees.push({ ligne: numero, code, raison: "Quantité absente ou nulle" });
      return;
    }
    aCompter.push({ code, quantite });
  });

  if (!aCompter.length) {
    throw new Error("Aucune ligne exploitable (colonnes CODE et QUANTITE).");
  }

  const { rows } = await construireLignes(entreprise, aCompter);
  // Référence distincte par mode : un même fichier peut être importé en
  // comptage PUIS en déduction sans que l'un écrase l'autre.
  const reference = `${deduction ? "deduction" : "excel"} ${trim(nomFichier)}`;

  await LigneBipage.deleteMany({ session: session._id, datFileName: reference });
  await LigneBipage.insertMany(
    rows.map((r) => ({
      entreprise: entreprise._id,
      session: session._id,
      datFileName: reference,
      zoneCode: lecture.zoneCode,
      zoneType: lecture.emplacement,
      ordre: r.n,
      eanArticle: r.code,
      qteScan: deduction ? -r.qte : r.qte,
      nart: r.nart === "-" ? "" : r.nart,
      designation: r.designation,
      observation: "",
      stock: typeof r.stock === "number" ? r.stock : null,
      found: !r.nonTrouve,
      source: "excel",
      sourceRef: trim(nomFichier),
      modeImport: deduction ? "deduction" : "inventaire",
      agentCode: lecture.agentCode,
      agentNom: nomAgent(entreprise, lecture.agentCode),
    })),
  );

  return {
    mode: deduction ? "deduction" : "inventaire",
    zoneCode: lecture.zoneCode,
    emplacement: lecture.emplacement,
    agentCode: lecture.agentCode,
    agentNom: nomAgent(entreprise, lecture.agentCode),
    lignes: rows.length,
    unites: rows.reduce((s, r) => s + r.qte, 0) * (deduction ? -1 : 1),
    nonTrouves: rows.filter((r) => r.nonTrouve).length,
    ignorees,
  };
};

export default {
  getEmplacements,
  parserZoneEmplacement,
  parserNomFichierExcel,
  getProformasEligibles,
  importerProformas,
  genererModeleExcelBipage,
  importerExcelBipage,
};
