// backend/services/performanceReapproService.js
// -----------------------------------------------------------------------------
// PERFORMANCE RÉAPPRO MAGASIN — combien d'articles, chaque jour, n'ont rien en
// rayon alors qu'il reste du stock ailleurs.
//
// Règle unique : `S1 = 0` ET `S2..S5 > 0`. Elle vit dans
// `bipageSelectionService.estAReapprovisionner` et est partagée avec la liste
// « rayon vide » de l'écran Listes de réappro — les deux écrans ne peuvent donc
// pas afficher deux nombres différents pour la même question.
//
// ⚠️ Pourquoi une photo quotidienne en Mongo (`ReapproSnapshot`) plutôt qu'un
// calcul à la volée : la fiche article ne porte que l'état du JOUR, S1..S5 sont
// écrasés à chaque mouvement. Sans photo, aucun historique n'est reconstituable
// — et c'est bien l'évolution qui intéresse, pas le chiffre d'aujourd'hui.
//
// Deux alimentations, une seule règle :
//   - `prendrePhoto()`   — le planificateur, chaque soir, sur la fiche article ;
//   - `rejouerArchives()`— rattrapage des journées passées depuis les classeurs
//                          reapro_mag déjà archivés sur le partage Rcommun.
//     Les colonnes `Magasin / DOCK / BUREAU / SCEB / MECALAC` de ces classeurs
//     sont les S1..S5 du jour et `vente_annuelle` la somme V1..V12 : la même
//     règle s'y applique mot pour mot, l'historique n'est donc pas perdu quand
//     on abandonne la lecture directe des classeurs.
//
// Aucune écriture DBF ni Excel : on ne fait que lire.
// -----------------------------------------------------------------------------

import fs from "fs";
import path from "path";
// ⚠️ SheetJS et pas ExcelJS : ces classeurs portent un onglet « GRAPHIQUES »
// avec un graphe incorporé, sur lequel le lecteur d'ExcelJS 4.4 plante
// (« Cannot read properties of undefined (reading 'anchors') ») — 11 fichiers
// sur 12 étaient silencieusement ignorés. L'ÉCRITURE de l'export, elle, reste
// ExcelJS : SheetJS communautaire ne sait pas styler.
import XLSX from "xlsx";
import cron from "node-cron";

import Entreprise from "../models/EntrepriseModel.js";
import ReapproSnapshot from "../models/ReapproSnapshotModel.js";
import articleService from "./articleService.js";
import fournissCacheService from "./fournissCacheService.js";
import { resoudreDossiersReapproMag } from "../utils/reapproMagPaths.js";
import {
  estAReapprovisionner,
  ventes12Mois,
  stockReserves,
  estTechnique,
  estRenvoi,
  estHorsRayon,
} from "./bipageSelectionService.js";

// 0 = dimanche, comme Date#getDay() : on suit la convention JS pour éviter les
// décalages d'indice entre le filtre de l'écran et celui du serveur.
const JOURS_SEMAINE = [
  "dimanche",
  "lundi",
  "mardi",
  "mercredi",
  "jeudi",
  "vendredi",
  "samedi",
];
const ORDRE_SEMAINE = [1, 2, 3, 4, 5, 6, 0]; // lundi → dimanche

const safeTrim = (v) => (v == null ? "" : String(v)).trim();
const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

// Les classeurs écrivent les nombres en texte avec la virgule comme séparateur
// de MILLIERS (« 7,238 » = 7238). Un parseFloat direct rendrait 7.
const numTexte = (v) => {
  const n = parseFloat(String(v ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

// Date locale « yyyy-mm-dd » — jamais `new Date("2026-09-17")`, qui serait lu en
// UTC et pourrait reculer d'un jour selon le fuseau du serveur (le VPS de
// production n'est pas à Nouméa).
const enDate = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(safeTrim(iso));
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
};
// ⚠️ La journée est une notion LOCALE au magasin. Le VPS de production tourne en
// UTC : `new Date()` y donnerait la date UTC, qui n'est pas celle de Nouméa
// (UTC+11) — un relevé pris en soirée serait daté du lendemain, ou un relevé du
// matin daté de la veille. On lit donc toujours l'horloge de Nouméa.
// `en-CA` parce que c'est la locale qui formate nativement en yyyy-mm-dd.
const FUSEAU = "Pacific/Noumea";
const fmtDateNoumea = new Intl.DateTimeFormat("en-CA", {
  timeZone: FUSEAU,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const fmtHeureNoumea = new Intl.DateTimeFormat("en-GB", {
  timeZone: FUSEAU,
  hour: "2-digit",
  hour12: false,
});
/** Jour en cours à Nouméa, "yyyy-mm-dd". */
export const dateDuJour = () => fmtDateNoumea.format(new Date());
/** Heure en cours à Nouméa, 0-23. */
const heureLocale = () => parseInt(fmtHeureNoumea.format(new Date()), 10) || 0;

// -----------------------------------------------------------------------------
// Tranches de ventes (Σ|V1..V12|)
//
// L'apport principal de cette refonte : 2 000 articles « à réappro » ne disent
// pas si le magasin perd des ventes ou traîne du stock mort. Les bornes sont
// exprimées en RYTHME, la seule lecture qui parle au terrain.
// -----------------------------------------------------------------------------
const TRANCHES = [
  { cle: "forte", min: 52, libelle: "≥ 1 vente / semaine" },
  { cle: "moyenne", min: 12, libelle: "1 / mois à 1 / semaine" },
  { cle: "faible", min: 1, libelle: "< 1 vente / mois" },
  { cle: "aucune", min: 0, libelle: "aucune vente sur 12 mois" },
];
const trancheDe = (ventes) => {
  if (ventes >= 52) return "forte";
  if (ventes >= 12) return "moyenne";
  if (ventes >= 1) return "faible";
  return "aucune";
};

const trancheVide = () => ({ aucune: 0, faible: 0, moyenne: 0, forte: 0 });

// Agrégateur commun aux deux sources : on empile des articles, il rend le
// contenu d'un `ReapproSnapshot`. Avoir UN seul agrégateur garantit que la
// photo du jour et une journée rejouée se comptent de la même façon.
const creerAgregat = () => {
  const parFourn = new Map();
  const agg = {
    total: 0,
    ventesTotal: 0,
    tranches: trancheVide(),
    sansStock: 0,
    sansGisement: 0,
    articlesCatalogue: 0,
  };
  return {
    agg,
    /** Un article retenu par la règle. */
    ajouter({ fourn, fournNom, ventes, gisement }) {
      agg.total += 1;
      agg.ventesTotal += ventes;
      agg.tranches[trancheDe(ventes)] += 1;
      if (!gisement) agg.sansGisement += 1;
      const code = fourn || "";
      if (!parFourn.has(code)) {
        parFourn.set(code, { code, nom: fournNom || "", nb: 0, ventes: 0 });
      }
      const f = parFourn.get(code);
      f.nb += 1;
      f.ventes += ventes;
      // Le nom peut manquer sur une ligne et pas sur une autre : on garde le
      // premier non vide plutôt que d'écraser avec du vide.
      if (!f.nom && fournNom) f.nom = fournNom;
    },
    resultat() {
      return {
        ...agg,
        // Les plus gros d'abord : c'est l'ordre dans lequel l'écran les lit.
        parFournisseur: [...parFourn.values()].sort(
          (a, b) => b.nb - a.nb || (a.nom || a.code).localeCompare(b.nom || b.code),
        ),
      };
    },
  };
};

// -----------------------------------------------------------------------------
// 1. Photo du jour, depuis la fiche article
// -----------------------------------------------------------------------------

/**
 * Compte les articles à réapprovisionner d'une société à l'instant T.
 * Lecture seule, via les caches DBF existants (article + fourniss).
 *
 * @param {object} entreprise document Entreprise
 * @returns {Promise<object>} contenu d'un ReapproSnapshot (sans date ni société)
 */
export const calculerPhoto = async (entreprise) => {
  const debut = Date.now();
  const [artCache, fourCache] = await Promise.all([
    articleService.getArticles(entreprise),
    fournissCacheService.getFournisseurs(entreprise),
  ]);

  const fournByCode = new Map();
  (fourCache.records || []).forEach((r) => {
    if (r.FOURN !== undefined && r.FOURN !== null) {
      fournByCode.set(String(r.FOURN).trim(), r);
    }
  });

  const isQC = safeTrim(entreprise.nomDossierDBF).toLowerCase() === "qc";
  const { agg, ajouter, resultat } = creerAgregat();

  (artCache.records || []).forEach((a) => {
    const nart = safeTrim(a.NART);
    if (!nart) return;
    agg.articlesCatalogue += 1;

    if (estAReapprovisionner(a, isQC)) {
      const code = a.FOURN != null ? String(a.FOURN).trim() : "";
      const fiche = fournByCode.get(code);
      ajouter({
        fourn: code,
        fournNom: fiche ? safeTrim(fiche.NOM) : "",
        ventes: ventes12Mois(a),
        gisement: safeTrim(a.GISM1) || safeTrim(a.EMPLACE),
      });
      return;
    }

    // Rayon vide mais rien en réserve : il n'y a RIEN à descendre. Ce n'est pas
    // du réappro mais un défaut d'approvisionnement — compté à part pour ne pas
    // être reproché au dock, jamais mélangé au total.
    if (
      num(a.S1) === 0 &&
      stockReserves(a) <= 0 &&
      !estTechnique(a) &&
      !estRenvoi(a) &&
      !estHorsRayon(safeTrim(a.GISM1) || safeTrim(a.EMPLACE), isQC)
    ) {
      agg.sansStock += 1;
    }
  });

  return { ...resultat(), source: "dbf", dureeMs: Date.now() - debut };
};

/**
 * Prend la photo d'une société et l'enregistre (une seule par jour : un second
 * passage met à jour, ce qui rend le job rejouable sans effet de bord).
 */
export const prendrePhoto = async (entreprise, dateIso = null) => {
  const date = dateIso || dateDuJour();
  const photo = await calculerPhoto(entreprise);
  await ReapproSnapshot.findOneAndUpdate(
    { entreprise: entreprise._id, date },
    {
      $set: {
        ...photo,
        entreprise: entreprise._id,
        nomDossierDBF: entreprise.nomDossierDBF,
        date,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  return { date, ...photo };
};

// -----------------------------------------------------------------------------
// 2. Rattrapage de l'historique depuis les classeurs reapro_mag archivés
//
// Les classeurs portent, par article, les stocks par dépôt et la vente annuelle
// — de quoi appliquer EXACTEMENT la même règle qu'en DBF. C'est ce qui permet
// d'abandonner leur lecture à la volée sans perdre les mois déjà écoulés.
//
// Deux limites, assumées et marquées par `source: "xlsx"` :
//   - l'onglet DONNEES est déjà pré-filtré par le générateur (il ne contient
//     que des articles à rayon vide) : on ne peut pas y recompter `sansStock`
//     autrement que sur ce périmètre ;
//   - `GENDOUBL` n'y figure pas : les articles renvoyés vers un autre code ne
//     peuvent pas être écartés, la journée rejouée est donc très légèrement
//     haute par rapport à une photo DBF.
// -----------------------------------------------------------------------------

const ONGLET = "DONNEES";

// ⚠️ LES COLONNES DE DÉPÔT NE PORTENT PAS LE MÊME NOM D'UNE SOCIÉTÉ À L'AUTRE.
// Le générateur écrit les dépôts RÉELS de chaque société, relevé au 17/09/2026 :
//   qc                 : Magasin, DOCK, BUREAU, SCEB, MECALAC
//   ducosquincaillerie : MAGASIN, DOCK, PAITA
//   lebroussard, sitec, allwoods, avbimport : S1, S2, S3, S4, S5
// Les coder en dur (le cas de QC) fait tomber les autres à zéro article SANS
// aucune erreur : la colonne est simplement absente, la réserve vaut 0, et la
// journée s'enregistre vide. On DÉTECTE donc les colonnes, on ne les suppose pas.
//
// Deux conventions, dans cet ordre :
//   1. `S1..S5` présentes -> ce sont les champs de la fiche article, sans
//      ambiguïté : S1 = rayon, S2..S5 = réserves.
//   2. sinon, les dépôts sont les colonnes situées entre le bloc `CA*` et
//      `date_entree_rupture` ; la PREMIÈRE est le magasin, les suivantes les
//      réserves. Vrai pour les trois nommages constatés, et robuste à un dépôt
//      ajouté ou renommé.
//
// ⚠️ L'ancre de gauche est la DERNIÈRE colonne dont le nom commence par « CA »,
// pas une colonne nommée exactement `CA` : les classeurs d'avant avril 2026
// n'ont que `CA_mois` et `CA_jour`, la colonne `CA` est apparue ensuite.
// Chercher `CA` exactement faisait rejeter tout le début de l'historique.
const PREFIXE_AVANT_DEPOTS = "CA";
const COL_APRES_DEPOTS = "date_entree_rupture";

/**
 * Localise les colonnes de dépôt dans l'en-tête.
 * @returns {{rayon:number, reserves:number[]}|null} null si introuvables — on
 *          préfère refuser la journée plutôt que l'enregistrer à zéro.
 */
const reperColonnesDepots = (entetes) => {
  const iSansCasse = (nom) =>
    entetes.findIndex((e) => e.toUpperCase() === nom.toUpperCase());

  const s1 = iSansCasse("S1");
  if (s1 >= 0) {
    const reserves = ["S2", "S3", "S4", "S5"].map(iSansCasse).filter((i) => i >= 0);
    if (reserves.length) return { rayon: s1, reserves };
  }

  const fin = iSansCasse(COL_APRES_DEPOTS);
  if (fin < 0) return null;
  // Dernière colonne « CA… » AVANT les dépôts.
  let debut = -1;
  for (let i = 0; i < fin; i += 1) {
    if (entetes[i].toUpperCase().startsWith(PREFIXE_AVANT_DEPOTS)) debut = i;
  }
  if (debut < 0 || fin <= debut + 1) return null;
  const reserves = [];
  for (let i = debut + 2; i < fin; i += 1) reserves.push(i);
  if (!reserves.length) return null;
  return { rayon: debut + 1, reserves };
};

/** Onglet DONNEES -> { entetes, lignes } en tableaux de cellules. */
const lireClasseur = (cheminFichier) => {
  const wb = XLSX.readFile(cheminFichier, {
    cellFormula: false,
    cellHTML: false,
    cellStyles: false,
  });
  const nom = (wb.SheetNames || []).find(
    (n) => safeTrim(n).toUpperCase() === ONGLET,
  );
  if (!nom) return null;
  const tout = XLSX.utils.sheet_to_json(wb.Sheets[nom], {
    header: 1,
    raw: false,
    defval: "",
  });
  if (!tout.length) return null;
  return { entetes: (tout[0] || []).map(safeTrim), lignes: tout.slice(1) };
};

/** Une journée archivée -> contenu de snapshot, même règle qu'en DBF. */
const rejouerFichier = (cheminFichier, isQC) => {
  const debut = Date.now();
  const classeur = lireClasseur(cheminFichier);
  if (!classeur) return null;
  const { entetes, lignes } = classeur;

  const depots = reperColonnesDepots(entetes);
  if (!depots) return null;

  const col = (nom) => entetes.findIndex((e) => e.toUpperCase() === nom.toUpperCase());
  const iNart = col("NART");
  const iFourn = col("FOURN");
  const iNom = col("NOM");
  const iGis = col("GISEMENT");
  const iVentes = col("vente_annuelle");
  if (iNart < 0) return null;

  const { agg, ajouter, resultat } = creerAgregat();
  lignes.forEach((ligne) => {
    const cel = (i) => (i >= 0 ? ligne[i] : "");
    const r = {
      NART: cel(iNart),
      FOURN: cel(iFourn),
      NOM: cel(iNom),
      GISEMENT: cel(iGis),
      vente_annuelle: cel(iVentes),
    };
    const nart = safeTrim(r.NART);
    if (!nart) return;
    // Pas de `articlesCatalogue` ici : l'onglet DONNEES n'est pas le catalogue
    // mais la liste déjà filtrée du jour — le renseigner ferait croire que le
    // magasin ne compte que 2 300 références.

    // Articles techniques : même borne que `estTechnique`.
    const n = parseInt(nart, 10);
    if (!Number.isNaN(n) && n < 100000) return;

    const gisement = safeTrim(r.GISEMENT);
    if (estHorsRayon(gisement, isQC)) return;

    if (numTexte(ligne[depots.rayon]) !== 0) return; // déjà en rayon
    const reserves = depots.reserves.reduce((s, i) => s + numTexte(ligne[i]), 0);
    if (reserves <= 0) {
      agg.sansStock += 1;
      return;
    }

    ajouter({
      fourn: safeTrim(r.FOURN),
      fournNom: safeTrim(r.NOM),
      ventes: numTexte(r.vente_annuelle),
      gisement,
    });
  });

  return { ...resultat(), source: "xlsx", dureeMs: Date.now() - debut };
};

/**
 * Rejoue toutes les journées archivées d'une société qui n'ont pas encore de
 * photo. Les journées déjà en base ne sont pas touchées, sauf `force` : une
 * photo DBF est toujours plus fiable qu'une journée rejouée, on ne l'écrase pas.
 *
 * @param {object} entreprise
 * @param {object} [options]
 * @param {boolean} [options.force=false] rejouer même les journées déjà en base
 * @param {number}  [options.max=0]       borne de sécurité (0 = pas de borne)
 */
export const rejouerArchives = async (entreprise, options = {}) => {
  const force = options.force === true;
  const max = parseInt(options.max, 10) || 0;

  const { dirs, candidats } = resoudreDossiersReapproMag();
  if (!dirs.length) {
    return {
      ok: false,
      dossiers: [],
      candidats,
      message:
        "Aucun dossier reapro_mag accessible depuis le serveur : aucune journée " +
        "archivée ne peut être récupérée. Le relevé quotidien, lui, n'en a pas " +
        "besoin (il lit la fiche article).",
      rejouees: 0,
      ignorees: 0,
    };
  }

  const dossier = safeTrim(entreprise.nomDossierDBF).toLowerCase();
  const isQC = dossier === "qc";
  // Les classeurs sont nommés reapro_mag_<societe>_yyyy-mm-dd.xlsx.
  const motif = new RegExp(
    `^reapro_mag_${dossier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}_(\\d{4}-\\d{2}-\\d{2})\\.xlsx$`,
    "i",
  );

  // TOUS les dossiers lisibles sont balayés et les journées RÉUNIES : aucun ne
  // porte l'historique complet (voir l'en-tête de utils/reapproMagPaths.js).
  // Dédoublonnage par date — quand une journée existe dans deux dossiers, les
  // deux classeurs décrivent le même jour, le premier trouvé suffit.
  const parDate = new Map();
  dirs.forEach((dir) => {
    fs.readdirSync(dir).forEach((nom) => {
      const m = motif.exec(nom);
      if (!m) return;
      if (!parDate.has(m[1])) {
        parDate.set(m[1], { chemin: path.join(dir, nom), date: m[1] });
      }
    });
  });
  const fichiers = [...parDate.values()].sort((a, b) =>
    a.date.localeCompare(b.date),
  );

  const existantes = await ReapproSnapshot.find(
    { entreprise: entreprise._id },
    { date: 1, source: 1 },
  ).lean();
  const dejaLa = new Set(existantes.map((d) => d.date));
  // ⚠️ Un relevé pris sur la fiche article (`dbf`) est plus fiable qu'une
  // journée rejouée depuis un classeur : il voit tout le catalogue, connaît les
  // renvois GENDOUBL et compte vraiment `sansStock`. `force` sert à recalculer
  // des journées rejouées (règle corrigée, colonnes mal détectées) — jamais à
  // dégrader un relevé DBF en le remplaçant par une reconstitution.
  const protegees = new Set(
    existantes.filter((d) => d.source === "dbf").map((d) => d.date),
  );

  let rejouees = 0;
  let ignorees = 0;
  const erreurs = [];

  for (const f of fichiers) {
    if (protegees.has(f.date)) {
      ignorees += 1;
      continue;
    }
    if (!force && dejaLa.has(f.date)) {
      ignorees += 1;
      continue;
    }
    if (max && rejouees >= max) break;
    try {
      // eslint-disable-next-line no-await-in-loop
      const photo = rejouerFichier(f.chemin, isQC);
      if (!photo) {
        // Onglet manquant OU colonnes de dépôt introuvables : on REFUSE la
        // journée. L'enregistrer quand même la mettrait à zéro, ce qui passe
        // pour une vraie mesure et fausse toute la courbe.
        erreurs.push(`${f.date} : onglet ${ONGLET} ou colonnes de dépôt absents`);
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      await ReapproSnapshot.findOneAndUpdate(
        { entreprise: entreprise._id, date: f.date },
        {
          $set: {
            ...photo,
            entreprise: entreprise._id,
            nomDossierDBF: entreprise.nomDossierDBF,
            date: f.date,
          },
        },
        { upsert: true, setDefaultsOnInsert: true },
      );
      rejouees += 1;
    } catch (e) {
      erreurs.push(`${f.date} : ${e.message}`);
    }
  }

  const bornes = fichiers.length
    ? ` (${fichiers[0].date} → ${fichiers[fichiers.length - 1].date})`
    : "";
  return {
    ok: true,
    dossiers: dirs,
    fichiers: fichiers.length,
    rejouees,
    ignorees,
    erreurs,
    message: fichiers.length
      ? `${rejouees} journée(s) récupérée(s) sur ${fichiers.length} rapport(s) ` +
        `disponible(s)${bornes}.`
      : `Aucun rapport reapro_mag_${dossier}_*.xlsx dans ${dirs.join(", ")}.`,
  };
};

// -----------------------------------------------------------------------------
// 3. Lecture de la série
// -----------------------------------------------------------------------------

/**
 * Critères de l'écran. La moyenne « historique » reste l'étalon par défaut :
 * filtrer l'affichage ne doit pas déplacer le repère dans le dos de
 * l'utilisateur. Il la recentre explicitement avec `baseMoyenne=selection`.
 *
 * ⚠️ Plus de seuils min/max sur le volume : filtrer les journées d'après la
 * valeur qu'on est en train de mesurer, puis les comparer à une moyenne
 * calculée sur les survivantes, est circulaire — plus on serrait les seuils,
 * plus tout paraissait « dans la moyenne ». Les journées non représentatives se
 * traitent par `exclureZero` (fichier absent / dock fermé), qui dit ce qu'il
 * exclut.
 */
export const normaliserCriteres = (q = {}) => {
  const iso = (v) => {
    const s = safeTrim(v);
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
  };
  const bool = (v) => v === true || v === "1" || v === "true";

  // jours=1,2,3 (0 = dimanche). Vide, absent ou complet = aucun filtre.
  let jours = String(q.jours ?? "")
    .split(",")
    .map((v) => parseInt(v, 10))
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
  jours = [...new Set(jours)].sort((a, b) => a - b);
  if (!jours.length || jours.length === 7) jours = null;

  let debut = iso(q.debut);
  let fin = iso(q.fin);
  if (debut && fin && debut > fin) [debut, fin] = [fin, debut];

  // Tranches de ventes retenues : c'est le filtre qui remplace utilement les
  // seuils de volume — « montre-moi les articles qui se vendent » est une
  // question métier, « montre-moi les journées entre 1500 et 2400 » n'en est pas.
  let tranches = String(q.tranches ?? "")
    .split(",")
    .map((v) => safeTrim(v).toLowerCase())
    .filter((v) => TRANCHES.some((t) => t.cle === v));
  tranches = [...new Set(tranches)];
  if (!tranches.length || tranches.length === TRANCHES.length) tranches = null;

  return {
    debut,
    fin,
    jours,
    exclureZero: bool(q.exclureZero),
    tranches,
    fourn: safeTrim(q.fourn),
    baseMoyenne: q.baseMoyenne === "selection" ? "selection" : "globale",
  };
};

/** Statistiques d'un jeu de journées. */
const statistiques = (rows) => {
  const valeurs = rows.map((r) => r.articles).sort((a, b) => a - b);
  const nbJours = valeurs.length;
  const total = valeurs.reduce((s, v) => s + v, 0);
  const moyenne = nbJours ? total / nbJours : 0;
  // Médiane : deux journées à l'arrêt suffisent à tirer la moyenne vers le bas
  // — la médiane dit si c'est le rythme ou un accident.
  const mediane = !nbJours
    ? 0
    : nbJours % 2
      ? valeurs[(nbJours - 1) / 2]
      : (valeurs[nbJours / 2 - 1] + valeurs[nbJours / 2]) / 2;
  return {
    nbJours,
    total,
    moyenne,
    moyenneArrondie: Math.round(moyenne),
    mediane: Math.round(mediane),
    max: nbJours ? valeurs[nbJours - 1] : 0,
    min: nbJours ? valeurs[0] : 0,
  };
};

/** Pourquoi une journée est écartée — chaîne vide si elle est retenue. */
const motifExclusion = (row, criteres) => {
  const d = enDate(row.date);
  if (criteres.debut && row.date < criteres.debut) return "hors période";
  if (criteres.fin && row.date > criteres.fin) return "hors période";
  if (criteres.jours && d && !criteres.jours.includes(d.getDay())) {
    return `jour de semaine écarté (${JOURS_SEMAINE[d.getDay()]})`;
  }
  if (criteres.exclureZero && row.articles === 0) return "journée sans activité";
  return "";
};

/**
 * Applique les filtres « contenu » (tranche de ventes, fournisseur) à une photo
 * et rend le nombre d'articles retenus ce jour-là.
 *
 * ⚠️ Les deux filtres ne se croisent pas : la photo stocke des agrégats, pas la
 * liste des articles. Demander « KAPRIOL ET ≥ 1 vente/semaine » supposerait de
 * stocker une ventilation fournisseur × tranche, soit ~1 200 combinaisons par
 * jour pour un besoin que personne n'a exprimé. Le fournisseur l'emporte, et
 * l'écran dit lequel des deux s'applique.
 */
const compterAvecFiltres = (snap, criteres) => {
  if (criteres.fourn) {
    const f = (snap.parFournisseur || []).find((x) => x.code === criteres.fourn);
    return { articles: f ? f.nb : 0, ventes: f ? f.ventes : 0 };
  }
  if (criteres.tranches) {
    const t = snap.tranches || {};
    return {
      articles: criteres.tranches.reduce((s, c) => s + (t[c] || 0), 0),
      ventes: 0, // non ventilé par tranche : on n'invente pas un chiffre
    };
  }
  return { articles: snap.total || 0, ventes: snap.ventesTotal || 0 };
};

/**
 * Série complète prête pour l'écran ET pour l'export Excel : les deux partagent
 * ce calcul, ils ne peuvent donc pas diverger.
 */
export const getRapport = async (entreprise, query = {}) => {
  const criteres = normaliserCriteres(query);
  const snaps = await ReapproSnapshot.find({ entreprise: entreprise._id })
    .sort({ date: 1 })
    .lean();

  const toutes = snaps.map((s) => {
    const { articles, ventes } = compterAvecFiltres(s, criteres);
    return {
      date: s.date,
      articles,
      ventes,
      total: s.total || 0,
      tranches: s.tranches || trancheVide(),
      sansStock: s.sansStock || 0,
      sansGisement: s.sansGisement || 0,
      source: s.source,
      parFournisseur: s.parFournisseur || [],
    };
  });

  const retenues = [];
  const ecartees = [];
  toutes.forEach((r) => {
    const motif = motifExclusion(r, criteres);
    if (motif) ecartees.push({ date: r.date, articles: r.articles, motif });
    else retenues.push(r);
  });

  const statsGlobales = statistiques(toutes);
  const stats = statistiques(retenues);
  const moyenne =
    criteres.baseMoyenne === "selection" ? stats.moyenne : statsGlobales.moyenne;

  const parVolume = [...retenues].sort((a, b) => b.articles - a.articles);
  const rangs = new Map(parVolume.map((r, i) => [r.date, i + 1]));
  let cumul = 0;
  const rows = retenues.map((r) => {
    cumul += r.articles;
    const d = enDate(r.date);
    return {
      date: r.date,
      articles: r.articles,
      total: r.total,
      tranches: r.tranches,
      sansStock: r.sansStock,
      sansGisement: r.sansGisement,
      source: r.source,
      jourSemaine: d ? d.getDay() : null,
      jourSemaineLabel: d ? JOURS_SEMAINE[d.getDay()] : "",
      ecart: Math.round(r.articles - moyenne),
      pct: moyenne ? ((r.articles - moyenne) / moyenne) * 100 : 0,
      cumul,
      rang: rangs.get(r.date) || null,
    };
  });

  // Ventilation fournisseur sur la PÉRIODE retenue : moyenne par jour, pas
  // somme — additionner des photos compterait dix fois le même article présent
  // dix jours de suite. C'est la question « quel fournisseur pèse combien sur
  // une journée type », pas « combien de lignes cumulées ».
  const fournAgg = new Map();
  retenues.forEach((r) => {
    (r.parFournisseur || []).forEach((f) => {
      if (!fournAgg.has(f.code)) {
        fournAgg.set(f.code, {
          code: f.code,
          nom: f.nom || "",
          cumul: 0,
          ventes: 0,
          jours: 0,
        });
      }
      const a = fournAgg.get(f.code);
      a.cumul += f.nb || 0;
      a.ventes += f.ventes || 0;
      a.jours += 1;
      if (!a.nom && f.nom) a.nom = f.nom;
    });
  });
  const nbJoursRetenus = retenues.length || 1;
  const parFournisseur = [...fournAgg.values()]
    .map((f) => ({
      code: f.code,
      nom: f.nom,
      // Moyenne sur TOUTES les journées retenues (pas seulement celles où le
      // fournisseur apparaît) : sinon un fournisseur vu une seule journée
      // afficherait la même intensité qu'un fournisseur présent tous les jours.
      moyenne: f.cumul / nbJoursRetenus,
      moyenneArrondie: Math.round(f.cumul / nbJoursRetenus),
      ventesMoyennes: Math.round(f.ventes / nbJoursRetenus),
      jours: f.jours,
      cumul: f.cumul,
    }))
    .sort((a, b) => b.moyenne - a.moyenne || (a.nom || a.code).localeCompare(b.nom || b.code));

  // Moyenne des tranches sur la période : la lecture « qualité » de la charge.
  const tranchesMoy = trancheVide();
  retenues.forEach((r) => {
    Object.keys(tranchesMoy).forEach((k) => {
      tranchesMoy[k] += (r.tranches && r.tranches[k]) || 0;
    });
  });
  Object.keys(tranchesMoy).forEach((k) => {
    tranchesMoy[k] = Math.round(tranchesMoy[k] / nbJoursRetenus);
  });

  const parJourSemaine = ORDRE_SEMAINE.map((jour) => {
    const label = JOURS_SEMAINE[jour];
    const lignes = rows.filter((r) => r.jourSemaine === jour);
    const total = lignes.reduce((s, r) => s + r.articles, 0);
    const moy = lignes.length ? total / lignes.length : 0;
    return {
      jour,
      label,
      nbJours: lignes.length,
      total,
      moyenne: moy,
      moyenneArrondie: Math.round(moy),
      ecart: Math.round(moy - moyenne),
    };
  }).filter((j) => j.nbJours > 0);

  const dates = toutes.map((r) => r.date);
  const derniere = toutes[toutes.length - 1] || null;

  return {
    societe: entreprise.nomDossierDBF,
    // `nom` n'est pas renseigné sur les fiches société : c'est `nomComplet`
    // qui porte le libellé (« Quincaillerie Calédonienne »).
    societeNom:
      entreprise.nomComplet || entreprise.nom || entreprise.nomDossierDBF,
    criteres,
    tranchesRef: TRANCHES,
    bornes: { premiere: dates[0] || "", derniere: dates[dates.length - 1] || "" },
    rows,
    ecartees,
    parJourSemaine,
    parFournisseur,
    tranchesMoyennes: tranchesMoy,
    // Contexte du dernier jour connu : ce qui n'est PAS du réappro (rien en
    // réserve) et ce qui l'est mais sans emplacement connu.
    dernier: derniere
      ? {
          date: derniere.date,
          total: derniere.total,
          sansStock: derniere.sansStock,
          sansGisement: derniere.sansGisement,
          tranches: derniere.tranches,
        }
      : null,
    stats,
    statsGlobales,
    moyenne,
    moyenneArrondie: Math.round(moyenne),
    baseMoyenneLabel:
      criteres.baseMoyenne === "selection"
        ? "journées retenues par les critères"
        : "toutes les journées disponibles",
    message: toutes.length
      ? ""
      : "Aucune photo enregistrée pour cette société. La première est prise " +
        "cette nuit ; le bouton « Rattraper l'historique » rejoue les journées " +
        "déjà archivées dans reapro_mag.",
    generatedAt: new Date().toISOString(),
  };
};

// -----------------------------------------------------------------------------
// 4. Planificateur
// -----------------------------------------------------------------------------

let enCours = false;

// ⚠️ L'HEURE DU RELEVÉ FAIT PARTIE DE LA DÉFINITION DE L'INDICATEUR.
//
// 18:00, après la fermeture : le point porte alors l'état de FIN de la journée
// qu'il date, une fois le réappro de la journée fait. Ce qui reste est ce qui
// n'a pas été descendu.
//
// Un relevé pris au petit matin donnerait presque la même valeur — rien ne bouge
// dans l'ERP entre la fermeture et l'ouverture — mais il la rangerait sous la
// date du LENDEMAIN : chaque point décrirait la veille. C'est la seule raison
// pour laquelle l'heure compte ici, et elle suffit.
//
// Constante de code, comme la fenêtre de 15 jours des listes de réappro : pas de
// variable d'environnement pour ce module.
const HEURE_RELEVE = "0 18 * * *"; // tous les jours à 18:00
// Filet : le stock n'a AUCUN historique (S1..S5 sont écrasés à chaque
// mouvement). Un relevé manqué à 18:00 — backend redémarré, coupure — est perdu
// pour toujours, il n'existe aucun moyen de le recalculer après coup. D'où un
// second passage tardif qui ne traite QUE les sociétés encore sans relevé.
const HEURE_RATTRAPAGE = "30 22 * * *";
// Ingestion des rapports archivés. Tourne TOUTE SEULE : dès qu'un classeur
// apparaît sur le partage pour une journée absente de la base, il est avalé.
// Personne n'a à cliquer quoi que ce soit — le bouton de l'écran ne sert plus
// qu'à forcer un tour immédiat.
// Coût nul quand il n'y a rien de neuf : on liste les dossiers et on ne lit que
// les classeurs dont la date manque en base.
const HEURE_INGESTION = "20 5 * * *";

/**
 * Un tour = une photo par société active. EN SÉRIE : le cache article est lourd
 * à froid (90 000+ références chez QC), les paralléliser ferait tout charger en
 * même temps.
 *
 * @param {object}  [options]
 * @param {boolean} [options.seulementSiManquant=false]
 *        ne traiter que les sociétés qui n'ont pas encore de relevé pour la
 *        journée en cours — le passage de rattrapage n'écrase jamais un relevé
 *        déjà pris à l'heure voulue.
 */
export const tourPhotos = async (options = {}) => {
  const seulementSiManquant = options.seulementSiManquant === true;
  if (enCours) {
    console.log("[reapproSnapshot] tour précédent encore en cours — ignoré");
    return { ignore: true };
  }
  enCours = true;
  const debut = Date.now();
  const date = dateDuJour();
  const resultats = [];
  try {
    const entreprises = await Entreprise.find({ isActive: true });

    // Un seul aller-retour Mongo pour savoir qui a déjà son relevé du jour.
    const dejaLa = new Set(
      seulementSiManquant
        ? (
            await ReapproSnapshot.find({ date }, { entreprise: 1 }).lean()
          ).map((d) => String(d.entreprise))
        : [],
    );

    for (const entreprise of entreprises) {
      if (seulementSiManquant && dejaLa.has(String(entreprise._id))) continue;
      try {
        // eslint-disable-next-line no-await-in-loop
        const r = await prendrePhoto(entreprise, date);
        resultats.push({ societe: entreprise.nomDossierDBF, ...r });
        console.log(
          `[reapproSnapshot] ${entreprise.nomDossierDBF} ${r.date} : ` +
            `${r.total} article(s) à réappro (${r.sansGisement} sans gisement, ` +
            `${r.sansStock} sans stock) en ${r.dureeMs}ms`,
        );
      } catch (e) {
        console.error(
          `[reapproSnapshot] ${entreprise.nomDossierDBF}: ${e.message}`,
        );
      }
    }
    if (resultats.length || !seulementSiManquant) {
      console.log(
        `[reapproSnapshot] tour${seulementSiManquant ? " de rattrapage" : ""} ` +
          `terminé en ${Date.now() - debut}ms — ${resultats.length} société(s)`,
      );
    }
  } catch (e) {
    console.error("[reapproSnapshot] tour impossible:", e.message);
  } finally {
    enCours = false;
  }
  return { date, resultats };
};

let ingestionEnCours = false;

/**
 * Avale tous les rapports archivés encore absents de la base, pour toutes les
 * sociétés actives. Idempotent : une journée déjà en base n'est jamais relue, et
 * un relevé pris sur la fiche article n'est jamais écrasé.
 *
 * C'est ce qui rend les fichiers du partage définitivement accessoires : une
 * fois avalés, tout vit en base et plus rien ne dépend de leur présence.
 */
export const tourIngestionArchives = async () => {
  if (ingestionEnCours) return { ignore: true };
  ingestionEnCours = true;
  const debut = Date.now();
  let total = 0;
  try {
    const entreprises = await Entreprise.find({ isActive: true });
    for (const entreprise of entreprises) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const r = await rejouerArchives(entreprise);
        if (!r.ok) {
          // Partage injoignable : ce n'est pas une panne du module, le relevé
          // quotidien lit la fiche article. On le dit une fois, sans bruit.
          console.log(`[reapproSnapshot] ingestion : ${r.message}`);
          break;
        }
        if (r.rejouees) {
          total += r.rejouees;
          console.log(
            `[reapproSnapshot] ingestion ${entreprise.nomDossierDBF} : ` +
              `${r.rejouees} journée(s) ajoutée(s)`,
          );
        }
        if (r.erreurs && r.erreurs.length) {
          console.warn(
            `[reapproSnapshot] ingestion ${entreprise.nomDossierDBF} : ` +
              `${r.erreurs.length} rapport(s) refusé(s) — ${r.erreurs.slice(0, 2).join(" ; ")}`,
          );
        }
      } catch (e) {
        console.error(
          `[reapproSnapshot] ingestion ${entreprise.nomDossierDBF}: ${e.message}`,
        );
      }
    }
    if (total) {
      console.log(
        `[reapproSnapshot] ingestion terminée en ${Date.now() - debut}ms — ` +
          `${total} journée(s) ajoutée(s)`,
      );
    }
  } catch (e) {
    console.error("[reapproSnapshot] ingestion impossible:", e.message);
  } finally {
    ingestionEnCours = false;
  }
  return { total };
};

export const startReapproSnapshotScheduler = () => {
  cron.schedule(HEURE_RELEVE, () => tourPhotos(), { timezone: FUSEAU });
  cron.schedule(HEURE_RATTRAPAGE, () => tourPhotos({ seulementSiManquant: true }), {
    timezone: FUSEAU,
  });

  cron.schedule(HEURE_INGESTION, () => tourIngestionArchives(), {
    timezone: FUSEAU,
  });

  // Au démarrage, une fois Mongo et les caches établis :
  //   - on avale les rapports archivés encore absents (coût nul s'il n'y a rien
  //     de neuf), pour que personne n'ait jamais à lancer un rattrapage ;
  //   - si le backend était arrêté toute la soirée, les deux crons du relevé
  //     sont passés sans lui et la journée serait perdue pour toujours : on la
  //     complète.
  setTimeout(() => {
    tourIngestionArchives()
      .then(() => {
        if (heureLocale() >= 18) return tourPhotos({ seulementSiManquant: true });
        return null;
      })
      .catch((e) => console.error("[reapproSnapshot] démarrage:", e.message));
  }, 60 * 1000).unref?.();

  console.log(
    "[reapproSnapshot] planificateur démarré — relevé quotidien 18:00 " +
      "(heure de Nouméa), rattrapage des sociétés manquantes 22:30, " +
      "ingestion des rapports archivés 05:20 et au démarrage",
  );
};

export default {
  calculerPhoto,
  prendrePhoto,
  rejouerArchives,
  tourIngestionArchives,
  getRapport,
  normaliserCriteres,
  tourPhotos,
  startReapproSnapshotScheduler,
  TRANCHES,
};

export { JOURS_SEMAINE, TRANCHES };
