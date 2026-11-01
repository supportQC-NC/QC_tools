// backend/services/proformaAnalyseService.js
//
// ANALYSE PROFORMA : toutes les ENTÊTES de proforma.dbf d'une société sur une
// plage de dates, filtrées par code vendeur (REPRES). Le DÉTAIL (prodet.dbf)
// n'est JAMAIS chargé : la question posée est « quels documents ce vendeur
// a-t-il émis sur la période ? », pas leur contenu.
//
// Réutilise l'index d'entêtes de l'espace commercial (getIndexProformas) :
// même cache (TTL 10 min, ~1,5 s à froid chez QC pour 80 k entêtes), même
// préchauffage par startCommercialIndexWarmer(). Ne pas repasser par
// proformaCacheService, qui charge aussi le détail.
//
// Libellés d'état : entreprise.mappingEtatsProforma fait foi (jamais de
// libellés en dur) ; repli « État N » quand le mapping ne connaît pas l'état.
// ⚠️ Chez QC le mapping libelle ETAT=1 « Reservation » alors que ce n'en est
// pas une — ici on restitue le vocabulaire ERP tel quel : c'est un écran
// d'analyse admin, pas l'espace commercial.

import { getIndexProformas } from "./commercialService.js";

const safeTrim = (v) => (v === null || v === undefined ? "" : String(v).trim());

const num = (v) => {
  if (v === null || v === undefined || v === "") return 0;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};

const parseDate = (v) => {
  if (!v) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  const s = String(v).trim();
  if (/^\d{8}$/.test(s)) {
    const d = new Date(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
};

// Date LOCALE en YYYY-MM-DD (pas toISOString : à UTC+11 la date glisserait
// d'un jour).
const ymd = (d) => {
  if (!d) return null;
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

// Code représentant entier ; "" / null / NaN => 0 (MAGASIN). Même règle que
// l'analyse factures : l'ERP mélange « 12 », « 012 » et des espaces.
const repCode = (v) => {
  if (v === null || v === undefined || v === "") return 0;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : 0;
};

const padCode = (n) => String(n).padStart(2, "0");

// Libellé ERP de l'état (mappingEtatsProforma : Map Mongoose ou objet brut).
const libelleEtat = (entreprise, etat) => {
  const mapping = entreprise?.mappingEtatsProforma;
  const key = String(etat);
  if (mapping) {
    const val =
      typeof mapping.get === "function" ? mapping.get(key) : mapping[key];
    if (safeTrim(val)) return safeTrim(val);
  }
  return `État ${etat}`;
};

/**
 * @param {object} entreprise
 * @param {string} dateDebut   "YYYY-MM-DD"
 * @param {string} dateFin     "YYYY-MM-DD"
 * @param {string} codeVendeur code REPRES ("12") ; "" = tous les vendeurs
 */
export const analyserProformas = async (
  entreprise,
  dateDebut,
  dateFin,
  codeVendeur = "",
) => {
  const entetes = await getIndexProformas(entreprise);

  // Dictionnaire des vendeurs de la fiche société (tous types : le filtre est
  // un CODE, pas un profil). Premier arrivé fait foi en cas de doublon.
  const nomParCode = new Map();
  const vendeurs = [];
  for (const v of Array.isArray(entreprise.vendeurs) ? entreprise.vendeurs : []) {
    const code = repCode(v.code);
    if (nomParCode.has(code)) continue;
    const nom =
      [v.nom, v.prenom].filter(Boolean).join(" ").trim() ||
      `Vendeur ${padCode(code)}`;
    nomParCode.set(code, nom);
    vendeurs.push({ code: padCode(code), nom, type: v.type || "vendeur" });
  }

  const codeFiltre =
    codeVendeur === null || codeVendeur === undefined || codeVendeur === ""
      ? null
      : repCode(codeVendeur);

  const rows = [];
  let montantTotal = 0;
  const parEtat = new Map(); // etat -> { nb, montant }
  // Codes REPRES vus sur la période mais absents du dictionnaire : ils doivent
  // quand même être sélectionnables (onglet Vendeurs pas toujours renseigné).
  const codesInconnus = new Set();

  for (const p of entetes) {
    const d = parseDate(p.DATFACT);
    const dateIso = ymd(d);
    if (!dateIso || dateIso < dateDebut || dateIso > dateFin) continue;

    const rep = repCode(p.REPRES);
    if (!nomParCode.has(rep)) codesInconnus.add(rep);
    if (codeFiltre !== null && rep !== codeFiltre) continue;

    const etat = Math.trunc(num(p.ETAT));
    const montant = num(p.MONTANT);
    montantTotal += montant;

    if (!parEtat.has(etat)) parEtat.set(etat, { nb: 0, montant: 0 });
    const e = parEtat.get(etat);
    e.nb += 1;
    e.montant += montant;

    rows.push({
      numfact: safeTrim(p.NUMFACT),
      date: dateIso,
      tiers: safeTrim(p.TIERS),
      nom: safeTrim(p.NOM),
      etat,
      etatLabel: libelleEtat(entreprise, etat),
      montant,
      texte: safeTrim(p.TEXTE),
      repres: padCode(rep),
      represNom: nomParCode.get(rep) || `Vendeur ${padCode(rep)}`,
      dateChantier: ymd(parseDate(p.DATCHANT)),
    });
  }

  // Du plus récent au plus ancien (même convention que l'espace commercial).
  rows.sort(
    (a, b) =>
      String(b.date).localeCompare(String(a.date)) ||
      String(b.numfact).localeCompare(String(a.numfact)),
  );

  for (const code of [...codesInconnus].sort((a, b) => a - b)) {
    vendeurs.push({
      code: padCode(code),
      nom: `Vendeur ${padCode(code)}`,
      type: "autre",
    });
  }

  return {
    nomDossierDBF: entreprise.nomDossierDBF,
    dateDebut,
    dateFin,
    vendeur:
      codeFiltre === null
        ? null
        : {
            code: padCode(codeFiltre),
            nom: nomParCode.get(codeFiltre) || `Vendeur ${padCode(codeFiltre)}`,
          },
    totaux: {
      nbProformas: rows.length,
      montantTotal,
      montantMoyen: rows.length ? montantTotal / rows.length : 0,
      parEtat: [...parEtat.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([etat, e]) => ({
          etat,
          etatLabel: libelleEtat(entreprise, etat),
          nb: e.nb,
          montant: e.montant,
        })),
    },
    vendeurs,
    proformas: rows,
  };
};
