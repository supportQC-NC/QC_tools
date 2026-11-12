// backend/services/dictionnaireRayonsService.js
//
// Dictionnaire des RAYONS : fichier Excel « <TRIGRAMME>_dictionnaire_rayons.xlsx »
// à la racine du dossier « collecteur » sur RCOMMUN (même base que le fichier de
// paramétrage gisements — voir gisementsService.js / deriveCollecteurBase).
//
// Colonnes (en-têtes tolérants casse/accents/espaces) :
//   GISM1 | libelle | metrage | priorite | emplacement
//   - GISM1       : code du rayon (valeur encodée dans l'étiquette QR/code-barres) ;
//   - libelle     : nom affiché sur l'étiquette (en gras) ;
//   - metrage     : nombre de SOUS-ZONES à générer (toujours au moins 1 → « _A ») ;
//   - priorite    : entier ≥ 0 (ou vide) → ordre de préparation des commandes ;
//   - emplacement : « DOCK » ou « MAGASIN » (défaut MAGASIN).
//
// IMPORTANT (compat Analyse CA) : GISM1/libelle/metrage DOIVENT rester les
// colonnes 1/2/3 — analyseCaDataService.loadDictionnaireRayons lit ces cellules
// par position. Les colonnes priorite/emplacement/type sont ajoutées APRÈS.
//
// Découpage en sous-zones (décision client) : nb = max(1, round(metrage)).
//   Chaque sous-zone = « <GISM1>_<lettre> » (A, B, … Z, AA, …). Ainsi une ligne
//   au_M / metrage 8 → au_M_A … au_M_H ; une ligne metrage 0 → un seul « code_A ».

import fs from "fs";
import path from "path";
import ExcelJS from "exceljs";
import { deriveCollecteurBase } from "../utils/receptionPaths.js";

const safeTrim = (v) => (v == null ? "" : String(v)).trim();

// Normalise un en-tête : majuscules, sans accents, sans espaces/_/./-.
const normHeader = (v) =>
  safeTrim(v)
    .toUpperCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[\s_.\-]+/g, "");

// Emplacement (type de zone) normalisé : MAJUSCULES, sans accent ni espace,
// vide → MAGASIN (défaut historique).
//
// ⚠️ Le type est LIBRE depuis le 12/11/2026. Avant, tout ce qui n'était pas
// « DOCK » devenait « MAGASIN » : une société qui déclarait RESERVE, SAV ou
// QUAI dans son dictionnaire voyait ces rayons fusionner silencieusement avec
// le magasin, et les fiches d'inventaire correspondantes disparaissaient.
// MAGASIN et DOCK gardent leur sens particulier — eux seuls correspondent aux
// colonnes GISM1 / GISM2 de la fiche article — mais ils ne sont plus les
// seules valeurs possibles.
export const normEmplacement = (v) => normHeader(v) || "MAGASIN";

// Priorité normalisée : entier ≥ 0, ou null si vide/non numérique.
export const normPriorite = (v) => {
  const s = safeTrim(v).replace(",", ".");
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : null;
};

// Suffixe de sous-zone bijectif base 26 : 0→A, 25→Z, 26→AA, …
export const letterSuffix = (n) => {
  let s = "";
  let x = Math.max(0, Math.floor(n)) + 1; // 1-based
  while (x > 0) {
    const rem = (x - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
};

/**
 * Le nom de fichier est-il le dictionnaire de la société `trig` ?
 *   « <TRIG>[ _-]dictionnaire[ _-]rayons….xls[x] », casse indifférente.
 * Écrit sans RegExp : le trigramme vient de la base, l'échapper serait un piège
 * de plus pour une comparaison aussi simple.
 */
const nomEstDictionnaire = (nom, trig) => {
  const n = safeTrim(nom).toLowerCase();
  const t = safeTrim(trig).toLowerCase();
  if (!t || !n.startsWith(t)) return false;
  if (n.startsWith("~$")) return false; // temporaire Excel (fichier ouvert)
  if (!n.endsWith(".xlsx") && !n.endsWith(".xls")) return false;
  const reste = n.slice(t.length).replace(/^[\s_-]+/, "");
  return reste.startsWith("dictionnaire") && reste.includes("rayons");
};

// Nom canonique du dictionnaire d'une société : « <TRIG>_dictionnaire_rayons.xlsx ».
export const nomDictionnaireCanonique = (trigramme) =>
  `${safeTrim(trigramme).toUpperCase() || "XXX"}_dictionnaire_rayons.xlsx`;

/**
 * Localise le dictionnaire des rayons d'UNE société.
 *
 * ⚠️ Toutes les sociétés partagent le MÊME dossier « collecteur » : leurs
 * dictionnaires n'y sont distingués que par le PRÉFIXE trigramme
 * (QC_dictionnaire_rayons.xlsx, DQ_dictionnaire_rayons.xlsx, FMB_…). Aucun
 * fichier commençant par le trigramme = la société n'a PAS de dictionnaire, et
 * il ne faut surtout pas retomber sur celui d'une autre société : les fiches
 * d'inventaire générées porteraient les rayons du mauvais magasin.
 *
 * Le nom canonique gagne toujours ; le repli préfère le nom le plus court, parce
 * que des copies de travail cohabitent sur le partage
 * (QC_dictionnaire_rayons_old.xlsx, _oldss.xlsx) et ne doivent jamais être lues
 * à la place du fichier courant.
 *
 * Renvoie { base, trigramme, nomFichier, fichier, exists }.
 */
export const findDictionnaireFile = (entreprise) => {
  const base = deriveCollecteurBase(entreprise?.cheminRapportReception);
  const trigramme = safeTrim(entreprise?.trigramme).toUpperCase() || "XXX";
  const canonique = path.join(base, nomDictionnaireCanonique(trigramme));
  const resultat = (fichier, exists) => ({
    base,
    trigramme,
    nomFichier: path.basename(fichier),
    fichier,
    exists,
  });

  if (fs.existsSync(canonique)) return resultat(canonique, true);

  let noms = [];
  try {
    noms = fs.readdirSync(base);
  } catch {
    noms = []; // partage injoignable ou dossier « collecteur » absent
  }
  const candidats = noms
    .filter((n) => nomEstDictionnaire(n, trigramme))
    .sort((a, b) => a.length - b.length || a.localeCompare(b));

  // Aucun candidat : on renvoie quand même le chemin canonique, qui est la cible
  // d'écriture de writeDictionnaire (création du dictionnaire de la société).
  if (candidats.length === 0) return resultat(canonique, false);
  return resultat(path.join(base, candidats[0]), true);
};

// Chemin du fichier dictionnaire pour l'entreprise : le fichier RÉELLEMENT
// présent pour son trigramme s'il y en a un, sinon le chemin canonique (cible
// d'écriture). Voir findDictionnaireFile.
export const resolveDictionnaireFile = (entreprise) =>
  findDictionnaireFile(entreprise).fichier;

/**
 * Retire les lignes de SOUS-ZONE d'un dictionnaire qui n'a pas de colonne
 * « type » pour les déclarer.
 *
 * Les sous-zones sont DÉRIVÉES du métrage (« <CODE>_A », « _B », … écrites par
 * writeDictionnaire) : ce ne sont jamais des entrées du dictionnaire. Les
 * fichiers récents les marquent `type = sous` et sont filtrés sur ce champ ;
 * certains fichiers du partage ont perdu la colonne (DQ : 1 240 lignes « _A » sur
 * 1 741 remontaient comme autant de rayons, donc autant de fiches d'inventaire
 * fantômes).
 *
 * Les TROIS conditions sont exigées ensemble, sinon on supprime de vrais rayons :
 * chez QC 22 rayons se terminent par « _V » (vitrine : D_7_V « Batterie Bosch »
 * sous D_7 « BOSCH ») et doivent rester.
 *   1. suffixe de lettres pures après le dernier « _ » (base 26 de letterSuffix) ;
 *   2. la zone parente existe dans le fichier, au MÊME emplacement ;
 *   3. le libellé est celui de la zone parente (les sous-zones l'héritent).
 */
export const retirerSousZonesDerivees = (rows) => {
  const liste = Array.isArray(rows) ? rows : [];
  const cleOf = (code, empl) =>
    `${safeTrim(code).toUpperCase()}|${normEmplacement(empl)}`;
  const parents = new Map();
  for (const r of liste) {
    const cle = cleOf(r?.gism1, r?.emplacement);
    if (safeTrim(r?.gism1) && !parents.has(cle)) parents.set(cle, r);
  }

  const zones = [];
  let sousZonesIgnorees = 0;
  for (const r of liste) {
    const code = safeTrim(r?.gism1);
    if (!code) continue;
    const sep = code.lastIndexOf("_");
    if (sep > 0 && /^[A-Za-z]+$/.test(code.slice(sep + 1))) {
      const parent = parents.get(cleOf(code.slice(0, sep), r?.emplacement));
      const memeLibelle =
        !!parent &&
        safeTrim(parent.libelle).toUpperCase() ===
          safeTrim(r?.libelle).toUpperCase();
      if (memeLibelle) {
        sousZonesIgnorees += 1;
        continue;
      }
    }
    zones.push(r);
  }
  return { zones, sousZonesIgnorees };
};

// Analyse une feuille de calcul et renvoie
// { rows, hasSous, hasType, sousZonesIgnorees }.
// Ne renvoie QUE les lignes de ZONE PARENTE — jamais une sous-zone, qui est
// dérivée du métrage. Deux filtres, dans cet ordre :
//   1. la colonne « type » quand le fichier la renseigne (`sous` → ignorée) ;
//   2. à défaut SEULEMENT (fichier sans colonne type, ou colonne vide — cas du
//      dictionnaire DQ), la détection structurelle de retirerSousZonesDerivees.
// Chaque row = { gism1, libelle, metrage, priorite, emplacement }. Les champs
// priorite/emplacement absents du fichier valent null / "MAGASIN". En-têtes
// tolérants (casse/accents/espaces).
const parseWorksheetZones = (ws) => {
  if (!ws)
    return { rows: [], hasSous: false, hasType: false, sousZonesIgnorees: 0 };

  // Repérage des colonnes via la 1re ligne.
  const colIdx = {};
  ws.getRow(1).eachCell((cell, col) => {
    const h = normHeader(cell.value);
    if (["GISM1", "GISM", "GISEMENT", "CODE", "RAYON"].includes(h)) colIdx.gism1 = col;
    else if (["LIBELLE", "NOM", "DESIGNATION"].includes(h)) colIdx.libelle = col;
    else if (["METRAGE", "METRE", "METRES", "M", "NBSOUSZONE", "SOUSZONES"].includes(h))
      colIdx.metrage = col;
    else if (["PRIORITE", "PRIO", "ORDRE", "ORDREPREPARATION"].includes(h))
      colIdx.priorite = col;
    else if (["EMPLACEMENT", "EMPL", "LOCALISATION", "LIEU"].includes(h))
      colIdx.emplacement = col;
    else if (["TYPE", "TYPEZONE", "TYPELIGNE"].includes(h)) colIdx.type = col;
  });
  if (!colIdx.gism1)
    return { rows: [], hasSous: false, hasType: false, sousZonesIgnorees: 0 };

  const rows = [];
  let hasSous = false;
  let hasZone = false;
  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // en-tête
    const cellVal = (col) => (col ? row.getCell(col).text ?? row.getCell(col).value : "");
    const gism1 = safeTrim(cellVal(colIdx.gism1));
    if (!gism1) return;
    // Lignes de sous-zone : ignorées (dérivées du métrage de la zone).
    const type = normHeader(cellVal(colIdx.type));
    if (type === "SOUS" || type === "SOUSZONE") {
      hasSous = true;
      return;
    }
    if (type === "ZONE") hasZone = true;
    const metrageRaw = safeTrim(cellVal(colIdx.metrage));
    const metrageNum = Number(metrageRaw.replace(",", "."));
    rows.push({
      gism1,
      libelle: safeTrim(cellVal(colIdx.libelle)),
      metrage: Number.isFinite(metrageNum) ? metrageNum : 0,
      priorite: normPriorite(cellVal(colIdx.priorite)),
      emplacement: normEmplacement(cellVal(colIdx.emplacement)),
    });
  });

  // Le fichier déclare-t-il ses lignes ? Si oui on lui fait confiance (chez QC
  // 22 vrais rayons « _V » seraient pris pour des sous-zones) ; sinon on retombe
  // sur la détection structurelle.
  if (hasSous || hasZone) {
    return { rows, hasSous, hasType: colIdx.type !== undefined, sousZonesIgnorees: 0 };
  }
  const { zones, sousZonesIgnorees } = retirerSousZonesDerivees(rows);
  return {
    rows: zones,
    hasSous,
    hasType: colIdx.type !== undefined,
    sousZonesIgnorees,
  };
};

// Lit le dictionnaire de l'entreprise — celui de SON trigramme, voir
// findDictionnaireFile (le dossier « collecteur » est commun à toutes les
// sociétés). `exists: false` = cette société n'a pas de dictionnaire.
// Renvoie { fichier, nomFichier, trigramme, exists, rows:[{ gism1, libelle,
//   metrage, priorite, emplacement }], materialized, sousZonesIgnorees }.
//   rows            = les ZONES PARENTES seules (jamais les sous-zones).
//   materialized    = le fichier contient déjà les sous-zones matérialisées
//                     (colonne « type » présente + au moins une ligne « sous »).
//   sousZonesIgnorées = sous-zones écartées par détection structurelle (fichier
//                     sans colonne « type » renseignée).
export const readDictionnaire = async (entreprise) => {
  const { fichier, nomFichier, trigramme, exists } =
    findDictionnaireFile(entreprise);
  if (!exists) {
    return {
      fichier,
      nomFichier,
      trigramme,
      exists: false,
      rows: [],
      materialized: false,
      sousZonesIgnorees: 0,
    };
  }

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(fichier);
  const ws = wb.getWorksheet("Rayons") || wb.worksheets[0];
  const { rows, hasSous, hasType, sousZonesIgnorees } = parseWorksheetZones(ws);

  return {
    fichier,
    nomFichier,
    trigramme,
    exists: true,
    rows,
    materialized: hasType && hasSous,
    sousZonesIgnorees,
  };
};

/**
 * Index du dictionnaire pour la PRÉPARATION : `CODE|EMPLACEMENT` →
 * `{ libelle, priorite, emplacement }`.
 *
 * ⚠️ L'emplacement fait partie de la clé, et ce n'est pas un détail : un même
 * code de rayon existe au DOCK et au MAGASIN avec des libellés DIFFÉRENTS
 * (« A_1 » = EPI GANTS au dock, Ventilateurs muraux au magasin chez QC).
 * Indexer par code seul renvoyait le libellé du premier trouvé — donc le
 * mauvais une fois sur deux sur la fiche de préparation.
 *
 * Les sous-zones matérialisées (« A_1_B », type « sous ») sont ignorées : la
 * fiche parle du rayon, pas de sa découpe en mètres linéaires.
 */
// Cache de l'index — même logique que le cache articles : relire le xlsx sur
// le partage réseau à CHAQUE appel coûtait l'essentiel du temps de réponse des
// bips « Où ranger » (et se payait aussi sur les étiquettes et les sélections
// bipage/réappro). Invalidation sur mtime/taille du fichier (l'écran
// Dictionnaire des rayons le réécrit) + TTL de secours. L'index renvoyé est
// PARTAGÉ entre appelants : lecture seule par convention (lookupRayon).
const INDEX_TTL_MS = 10 * 60 * 1000;
const indexCache = new Map(); // fichier -> { at, mtimeMs, size, resultat }

const construireIndexRayons = async (entreprise) => {
  const index = new Map();
  let fichier = "";
  try {
    const dico = await readDictionnaire(entreprise);
    fichier = dico.fichier || "";
    if (!dico.exists) return { index, fichier, exists: false };
    for (const r of dico.rows || []) {
      const code = safeTrim(r.gism1).toUpperCase();
      if (!code) continue;
      const emplacement = normEmplacement(r.emplacement);
      const cle = `${code}|${emplacement}`;
      // Première ligne gagnante : un doublon exact (même code, même
      // emplacement) est une erreur de saisie, pas une seconde zone.
      if (index.has(cle)) continue;
      index.set(cle, {
        libelle: safeTrim(r.libelle),
        priorite: r.priorite,
        emplacement,
      });
    }
    return { index, fichier, exists: true };
  } catch {
    // Dictionnaire illisible (partage injoignable, fichier verrouillé) :
    // l'appelant retombera sur l'ancien fichier de gisements.
    return { index, fichier, exists: false };
  }
};

export const buildIndexRayons = async (entreprise) => {
  let fichier = "";
  let stat = null;
  try {
    fichier = resolveDictionnaireFile(entreprise);
    try {
      stat = fs.statSync(fichier);
    } catch {
      stat = null; // fichier absent ou partage injoignable
    }
    const memo = indexCache.get(fichier);
    if (
      memo &&
      Date.now() - memo.at < INDEX_TTL_MS &&
      memo.mtimeMs === (stat ? stat.mtimeMs : 0) &&
      memo.size === (stat ? stat.size : 0)
    ) {
      return memo.resultat;
    }
  } catch {
    // resolveDictionnaireFile peut jeter (chemins société incomplets) : on
    // laisse construireIndexRayons produire son résultat vide habituel.
  }

  const resultat = await construireIndexRayons(entreprise);
  if (fichier) {
    indexCache.set(fichier, {
      at: Date.now(),
      mtimeMs: stat ? stat.mtimeMs : 0,
      size: stat ? stat.size : 0,
      resultat,
    });
  }
  return resultat;
};

/**
 * Cherche un rayon par son code ET son emplacement.
 *
 * Repli : à défaut de correspondance exacte, le MÊME CODE à un autre
 * emplacement. Indispensable depuis que le type de zone est libre — la
 * préparation et le réappro interrogent le dictionnaire avec MAGASIN (GISM1)
 * ou DOCK (GISM2), et un rayon déclaré RESERVE ou QUAI ne sortirait sinon
 * AUCUN libellé sur la fiche papier, alors que le code, lui, est le bon.
 */
export const lookupRayon = (index, code, emplacement) => {
  const c = safeTrim(code).toUpperCase();
  if (!c || !index) return null;
  const exact = index.get(`${c}|${normEmplacement(emplacement)}`);
  if (exact) return exact;
  for (const [cle, valeur] of index) {
    if (cle.startsWith(`${c}|`)) return valeur;
  }
  return null;
};

// Analyse un buffer xlsx uploadé (import de masse) et renvoie ses lignes de zone
// [{ gism1, libelle, metrage, priorite, emplacement }].
export const parseWorkbookRows = async (buffer) => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.getWorksheet("Rayons") || wb.worksheets[0];
  return parseWorksheetZones(ws).rows;
};

// Clé d'identité d'un rayon : GISM1 (insensible à la casse) + EMPLACEMENT.
// ⚠️ L'emplacement fait partie de la clé — c'est l'identité d'une zone côté Mongo
// (index unique { entreprise, code, type }) et le dédoublonnage de
// zoneFicheService. Un même code existe légitimement en MAGASIN ET en DOCK
// (ex. QC : A_1 = « EPI GANTS » au dock et « Ventilateurs muraux » en magasin) ;
// une clé sur le seul GISM1 les fusionnait silencieusement, le dernier écrasant
// l'autre (53 rayons DOCK perdus sur l'import QC du 24/08/2026).
const dicoKeyOf = (r) =>
  `${safeTrim(r?.gism1).toUpperCase()}|${normEmplacement(r?.emplacement)}`;

// Normalise une ligne importée.
const normImportedRow = (imp) => ({
  gism1: safeTrim(imp?.gism1),
  libelle: safeTrim(imp?.libelle),
  metrage: Math.max(0, Math.round(Number(imp?.metrage) || 0)),
  priorite: normPriorite(imp?.priorite),
  emplacement: normEmplacement(imp?.emplacement),
});

// Intègre les lignes importées dans le dictionnaire existant.
// Deux modes (voir option `remplacer`) :
//   - fusion (défaut)  : les rayons existants sont mis à jour (seuls les champs
//     non vides de l'import écrasent), les nouveaux ajoutés, **les autres
//     conservés** — pour compléter un dictionnaire avec un fichier partiel.
//     ⚠️ Un rayon qui change d'emplacement crée une 2e entrée (la clé inclut
//     l'emplacement) ; utiliser le mode « remplacer » pour une resynchro.
//   - remplacer        : le fichier importé DEVIENT le dictionnaire ; les rayons
//     absents du fichier sont supprimés. C'est le mode d'une régénération
//     complète (script d'extraction).
// Renvoie { rows, ajoutes, misAJour, supprimes }.
export const mergeDictionnaire = (existing, imported, options = {}) => {
  const remplacer = options?.remplacer === true;

  const cleanExisting = (Array.isArray(existing) ? existing : []).filter((r) =>
    safeTrim(r?.gism1),
  );
  const clesExistantes = new Set(cleanExisting.map(dicoKeyOf));

  const byKey = new Map();
  const order = [];

  if (remplacer) {
    // Le fichier fait foi : on repart de zéro (doublons du fichier = dernier gagne).
    for (const imp of Array.isArray(imported) ? imported : []) {
      if (!safeTrim(imp?.gism1)) continue;
      const k = dicoKeyOf(imp);
      if (!byKey.has(k)) order.push(k);
      byKey.set(k, normImportedRow(imp));
    }
    const misAJour = order.filter((k) => clesExistantes.has(k)).length;
    return {
      rows: order.map((k) => byKey.get(k)),
      ajoutes: order.length - misAJour,
      misAJour,
      supprimes: [...clesExistantes].filter((k) => !byKey.has(k)).length,
    };
  }

  for (const r of cleanExisting) {
    const k = dicoKeyOf(r);
    if (!byKey.has(k)) order.push(k);
    byKey.set(k, { ...r });
  }

  let ajoutes = 0;
  let misAJour = 0;
  for (const imp of Array.isArray(imported) ? imported : []) {
    if (!safeTrim(imp?.gism1)) continue;
    const k = dicoKeyOf(imp);
    const norm = normImportedRow(imp);
    if (byKey.has(k)) {
      const cur = byKey.get(k);
      byKey.set(k, {
        ...cur,
        ...norm,
        // le libellé n'écrase que s'il est renseigné dans l'import
        libelle: norm.libelle || cur.libelle,
        priorite: norm.priorite ?? cur.priorite ?? null,
      });
      misAJour += 1;
    } else {
      order.push(k);
      byKey.set(k, norm);
      ajoutes += 1;
    }
  }

  return { rows: order.map((k) => byKey.get(k)), ajoutes, misAJour, supprimes: 0 };
};

// Construit la liste PLATE (zones + sous-zones) écrite dans le fichier :
//   pour chaque zone : 1 ligne « zone » (avec métrage) puis N lignes « sous »
//   (<GISM1>_A … ; N = max(1, métrage) → toujours au moins « _A »).
const buildFlatRows = (zones) => {
  const out = [];
  for (const z of Array.isArray(zones) ? zones : []) {
    const gism1 = safeTrim(z?.gism1);
    if (!gism1) continue;
    const libelle = safeTrim(z?.libelle);
    const metrage = Math.max(0, Math.round(Number(z?.metrage) || 0));
    const priorite = normPriorite(z?.priorite);
    const emplacement = normEmplacement(z?.emplacement);
    out.push({ gism1, libelle, metrage, priorite, emplacement, type: "zone" });
    const n = Math.max(1, metrage);
    // Les sous-zones héritent de la priorité/emplacement de leur zone.
    for (let i = 0; i < n; i++) {
      out.push({
        gism1: `${gism1}_${letterSuffix(i)}`,
        libelle,
        metrage: null,
        priorite,
        emplacement,
        type: "sous",
      });
    }
  }
  return out;
};

// Écrit le dictionnaire (zones + sous-zones matérialisées, colonne « type »).
// `zones` = [{ gism1, libelle, metrage }] (la source éditable).
export const writeDictionnaire = async (entreprise, zones) => {
  const fichier = resolveDictionnaireFile(entreprise);
  fs.mkdirSync(path.dirname(fichier), { recursive: true });

  const cleanZones = (Array.isArray(zones) ? zones : [])
    .map((r) => ({
      gism1: safeTrim(r?.gism1),
      libelle: safeTrim(r?.libelle),
      metrage: Math.max(0, Math.round(Number(r?.metrage) || 0)),
      priorite: normPriorite(r?.priorite),
      emplacement: normEmplacement(r?.emplacement),
    }))
    .filter((r) => r.gism1);

  const flat = buildFlatRows(cleanZones);

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Rayons");
  // Ordre imposé : GISM1/libelle/metrage en colonnes 1/2/3 (compat Analyse CA).
  ws.columns = [
    { header: "GISM1", key: "gism1", width: 18 },
    { header: "libelle", key: "libelle", width: 42 },
    { header: "metrage", key: "metrage", width: 10 },
    { header: "priorite", key: "priorite", width: 10 },
    { header: "emplacement", key: "emplacement", width: 14 },
    { header: "type", key: "type", width: 8 },
  ];
  ws.getRow(1).font = { bold: true };
  for (const r of flat) {
    ws.addRow({
      gism1: r.gism1,
      libelle: r.libelle,
      metrage: r.metrage == null ? null : r.metrage,
      priorite: r.priorite == null ? null : r.priorite,
      emplacement: r.emplacement,
      type: r.type,
    });
  }

  await wb.xlsx.writeFile(fichier);
  return { fichier, zoneCount: cleanZones.length, rowCount: flat.length };
};

// Génère un buffer xlsx des RAYONS uniquement — SANS sous-zones et SANS colonne
// « type ». `rows` = [{ gism1, libelle, metrage, priorite, emplacement }].
// `emplacement` optionnel : "MAGASIN" | "DOCK" pour ne garder que ces rayons.
// Renvoie { buffer, count }.
export const buildZonesWorkbookBuffer = async (rows, emplacement = null) => {
  const empl = emplacement ? normEmplacement(emplacement) : null;
  const zones = (Array.isArray(rows) ? rows : [])
    .map((r) => ({
      gism1: safeTrim(r?.gism1),
      libelle: safeTrim(r?.libelle),
      metrage: Math.max(0, Math.round(Number(r?.metrage) || 0)),
      priorite: normPriorite(r?.priorite),
      emplacement: normEmplacement(r?.emplacement),
    }))
    .filter((r) => r.gism1 && (!empl || r.emplacement === empl));

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Rayons");
  // GISM1/libelle/metrage en colonnes 1/2/3 (cohérent avec le fichier source).
  ws.columns = [
    { header: "GISM1", key: "gism1", width: 18 },
    { header: "libelle", key: "libelle", width: 42 },
    { header: "metrage", key: "metrage", width: 10 },
    { header: "priorite", key: "priorite", width: 10 },
    { header: "emplacement", key: "emplacement", width: 14 },
  ];
  ws.getRow(1).font = { bold: true };
  for (const z of zones) {
    ws.addRow({
      gism1: z.gism1,
      libelle: z.libelle,
      metrage: z.metrage,
      priorite: z.priorite == null ? null : z.priorite,
      emplacement: z.emplacement,
    });
  }
  const buffer = await wb.xlsx.writeBuffer();
  return { buffer, count: zones.length };
};

// Développe les lignes en items d'étiquettes { code, libelle }.
// `filtre` : Set de codes GISM1 à conserver (optionnel ; sinon tous).
// `sousZones` (défaut true) : true → 1 item par sous-zone (« <GISM1>_A », …) ;
//   false → 1 item par ZONE, code = GISM1 seul (sans suffixe _A/_B) — choix
//   offert à la génération des étiquettes quand le découpage n'est pas utilisé.
export const expandSubZones = (rows, filtre = null, sousZones = true) => {
  const items = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    const code = safeTrim(r?.gism1);
    if (!code) continue;
    if (filtre && !filtre.has(code)) continue;
    const libelle = safeTrim(r?.libelle);
    if (!sousZones) {
      items.push({ code, libelle });
      continue;
    }
    const n = Math.max(1, Math.round(Number(r?.metrage) || 0)); // toujours au moins 1 (_A)
    for (let i = 0; i < n; i++) {
      items.push({ code: `${code}_${letterSuffix(i)}`, libelle });
    }
  }
  return items;
};

export default {
  resolveDictionnaireFile,
  findDictionnaireFile,
  nomDictionnaireCanonique,
  retirerSousZonesDerivees,
  readDictionnaire,
  writeDictionnaire,
  parseWorkbookRows,
  mergeDictionnaire,
  expandSubZones,
  buildZonesWorkbookBuffer,
  letterSuffix,
  normEmplacement,
  normPriorite,
};
