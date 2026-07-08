// backend/services/analyseCaDataService.js
//
// ANALYSE CA — SOCLE DE DONNÉES (équivalent fidèle de main.py du pipeline Python).
// Prépare, pour UN MOIS DE COUPURE choisi, les datasets que consomment les
// feuilles d'analyse (TYPES_CLIENT, Client, Fournisseurs, Classes, ...).
//
// ⚠ MULTI-ENTREPRISES : tous les paramètres de config.py (seuils, tiers
// internes/exclus, exclusions d'articles, noms de classes/locates,
// normalisation des catégories) sont désormais PAR ENTREPRISE, stockés dans
// entreprise.analyseCA (gérés dans la Gestion Entreprises). Les DÉFAUTS
// ci-dessous reprennent la configuration QC d'origine et s'appliquent quand
// l'entreprise n'a rien personnalisé.
//
// PÉRIODE : coupureN = dernier jour du mois choisi ; N = année de ce mois,
// données du 01/01/N à coupureN ; N-1 = même coupure, année - 1.
// ⚠ Le cache facture ne conserve que l'année en cours + précédente : si le mois
// choisi est dans l'année précédente, N-1 sera vide (signalé).
//
// CALCULS / FILTRES (identiques à main.py) :
//  - Détails : TYPFACT ∈ {F,A} ; exclusions NART contenant "!", préfixes
//    configurés (déf. "08"), codes exacts (déf. "000001") — filtre SQL
//    littéral : NART vide conservé ; PVTE aberrante exclue si prix catalogue
//    > 0 ET PVTE > catalogue × seuil (déf. 100) ; PVTE/PREV = ABS ; QTE telle
//    quelle (négative pour avoirs A / retours F) ; REMISE = |QTE| × PVTE ×
//    (POURC/100) arrondie à 2 déc.
//  - Factures : MONTANT / FACTREM / FACTREV positifs convertis en NÉGATIF si A.
//  - Clients : TIERS ≠ 1 exclu ; NOM nettoyé ; CATEGORIE normalisée (map
//    configurée) ; tiersForcerAutre -> catégorie AUTRE.
//  - Séparation : externes = TIERS_ID < seuil (hors tiersExclusCA) ;
//    internes = TIERS_ID ≥ seuil ET ∈ tiersInternesAutorises ; le reste exclu.
//  - Enrichissement : nom_client / categorie_client (jointure TIERS).
//  - Dates exposées au format DD/MM/YYYY (comme les CSV Python).
//
// artplus.dbf (facultatif — certaines entreprises ne l'ont pas) :
//  table attributs {NART, INTITULE, CONTENU} ; famille = INTITULE "07*",
//  sous-famille = "08*", groupe = "06*".
//
// Dictionnaire rayons (xlsx, feuille "rayons" : GISM1 / libelle / metrage) :
//  chemin = ANALYSE_CA_DICTIONNAIRE_PATH (env) + {trigramme}_dictionnaire_rayons.xlsx

import fs from "fs";
import path from "path";
import { DBFFile } from "dbffile";
import ExcelJS from "exceljs";
import factureCacheService from "./factureCacheService.js";
import clientCacheService from "./clientCacheService.js";
import articleCacheService from "./articleService.js";
import fournissCacheService from "./fournissCacheService.js";

// ── DÉFAUTS (config.py QC, version active) ───────────────────────────────────
export const ANALYSE_CA_DEFAULTS = {
  seuilTiersInterne: 9905,
  tiersInternesAutorises: [
    9994, 9915, 9913, 9925, 9914, 9910, 9916, 9905, 9920, 9912, 9998, 9995,
  ],
  tiersExclusCA: [2226], // BON DE CAISSE
  tiersForcerAutre: [],
  articlesExclusPrefixes: ["08"],
  articlesExclusExacts: ["000001"],
  seuilPvteAberrante: 100,
  nomsClasses: {
    10: "Visserie / Boulonnerie",
    20: "Outillage",
    30: "Quincaillerie",
    40: "Électricité",
    50: "Peinture",
    60: "Plomberie / Sanitaire",
    70: "Jardin / Extérieur",
    80: "Divers",
    90: "Matériaux",
  },
  nomsSousClasses: {},
  nomsLocates: {},
  normalisationCategories: {
    "PRO DEBIT EXPORT": "PRO DEBIT",
    "PRO DEBIT*": "PRO DEBIT",
    "PRO DEBIT MINE": "PRO DEBIT",
    PARTICULER: "PARTICULIER",
    COMPTANT: "PRO COMPTANT",
    EMPLOYEE: "EMPLOYE",
    ADMINISTRATIF: "ADMINISTRATION",
    "AGRICULTEUR                             PRO COMPTANT": "AGRICULTEUR",
    "COMPTE FERME": "AUTRE",
    INTERNE: "INTERNE",
  },
};

// Map mongoose OU objet -> objet simple
const mapToObject = (v) => {
  if (!v) return undefined;
  if (v instanceof Map) return Object.fromEntries(v);
  if (typeof v === "object" && !Array.isArray(v)) return { ...v };
  return undefined;
};

class AnalyseCaDataService {
  // ── Config PAR ENTREPRISE (entreprise.analyseCA fusionné avec les défauts) ─
  getConfig(entreprise) {
    const raw = entreprise?.analyseCA
      ? entreprise.analyseCA.toObject?.() ?? entreprise.analyseCA
      : {};

    const liste = (v, def) =>
      Array.isArray(v) && v.length > 0 ? v : def;

    const seuilTiersInterne = Number.isFinite(raw.seuilTiersInterne)
      ? raw.seuilTiersInterne
      : ANALYSE_CA_DEFAULTS.seuilTiersInterne;
    const seuilPvteAberrante = Number.isFinite(raw.seuilPvteAberrante)
      ? raw.seuilPvteAberrante
      : ANALYSE_CA_DEFAULTS.seuilPvteAberrante;

    return {
      seuilTiersInterne,
      seuilPvteAberrante,
      tiersInternesAutorises: new Set(
        liste(raw.tiersInternesAutorises, ANALYSE_CA_DEFAULTS.tiersInternesAutorises),
      ),
      // tiersExclusCA / tiersForcerAutre : une liste VIDE est un choix valide
      // -> on ne retombe sur le défaut que si le champ est absent.
      tiersExclusCA: new Set(
        Array.isArray(raw.tiersExclusCA)
          ? raw.tiersExclusCA
          : ANALYSE_CA_DEFAULTS.tiersExclusCA,
      ),
      tiersForcerAutre: new Set(
        Array.isArray(raw.tiersForcerAutre)
          ? raw.tiersForcerAutre
          : ANALYSE_CA_DEFAULTS.tiersForcerAutre,
      ),
      articlesExclusPrefixes: liste(
        raw.articlesExclusPrefixes,
        ANALYSE_CA_DEFAULTS.articlesExclusPrefixes,
      ),
      articlesExclusExacts: new Set(
        liste(raw.articlesExclusExacts, ANALYSE_CA_DEFAULTS.articlesExclusExacts),
      ),
      nomsClasses:
        mapToObject(raw.nomsClasses) ?? { ...ANALYSE_CA_DEFAULTS.nomsClasses },
      nomsSousClasses:
        mapToObject(raw.nomsSousClasses) ??
        { ...ANALYSE_CA_DEFAULTS.nomsSousClasses },
      nomsLocates:
        mapToObject(raw.nomsLocates) ?? { ...ANALYSE_CA_DEFAULTS.nomsLocates },
      normalisationCategories:
        mapToObject(raw.normalisationCategories) ??
        { ...ANALYSE_CA_DEFAULTS.normalisationCategories },
    };
  }

  // ── Helpers de base ────────────────────────────────────────────────────────
  num(v) {
    if (v === null || v === undefined || v === "") return 0;
    const n = typeof v === "number" ? v : parseFloat(String(v).replace(",", "."));
    return Number.isFinite(n) ? n : 0;
  }

  safeTrim(v) {
    if (v === null || v === undefined) return "";
    return String(v).trim();
  }

  // re.sub(r'\s+', ' ', texte.strip())
  nettoyerEspaces(v) {
    const s = this.safeTrim(v);
    return s === "" ? "" : s.replace(/\s+/g, " ");
  }

  normaliserCategorie(v, cfg) {
    const s = this.safeTrim(v);
    if (s === "") return s;
    const upper = s.toUpperCase();
    for (const [ancienne, nouvelle] of Object.entries(cfg.normalisationCategories)) {
      if (upper === ancienne.toUpperCase()) return nouvelle;
    }
    return s;
  }

  round2(n) {
    return Math.round(n * 100) / 100;
  }

  dateFr(d) {
    const p = (n) => String(n).padStart(2, "0");
    return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
  }

  // Article exclu ? (filtre SQL littéral de main.py : "!", préfixes, exacts —
  // un NART vide n'est PAS exclu par ce filtre)
  articleExclu(nart, cfg) {
    if (nart.includes("!")) return true;
    for (const p of cfg.articlesExclusPrefixes) {
      if (nart.startsWith(p)) return true;
    }
    if (cfg.articlesExclusExacts.has(nart)) return true;
    return false;
  }

  // "YYYY-MM" -> { coupureN, coupureN1, anneeN, anneeN1 }
  resolvePeriode(moisCoupure) {
    if (typeof moisCoupure !== "string" || !/^\d{4}-\d{2}$/.test(moisCoupure)) {
      throw new Error("Mois de coupure invalide (format attendu : YYYY-MM).");
    }
    const annee = parseInt(moisCoupure.slice(0, 4), 10);
    const mois = parseInt(moisCoupure.slice(5, 7), 10); // 1..12
    const coupureN = new Date(annee, mois, 0, 23, 59, 59, 999);
    const coupureN1 = new Date(annee - 1, mois, 0, 23, 59, 59, 999);
    return {
      moisCoupure,
      mois,
      anneeN: annee,
      anneeN1: annee - 1,
      coupureN,
      coupureN1,
      labelN: `01/01/${annee} → ${this.dateFr(coupureN)}`,
      labelN1: `01/01/${annee - 1} → ${this.dateFr(coupureN1)}`,
    };
  }

  // ── Référentiels ───────────────────────────────────────────────────────────

  // Articles (équiv. articles.csv) + index NART -> article
  async chargerArticles(entreprise) {
    const [artCache, fournCache] = await Promise.all([
      articleCacheService.getArticles(entreprise),
      fournissCacheService.getFournisseurs(entreprise),
    ]);

    const nomFournisseur = (fourn) => {
      const idx = fournCache.indexByFourn.get(fourn);
      if (idx === undefined) return "";
      return this.nettoyerEspaces(fournCache.records[idx]?.NOM);
    };

    const articles = [];
    const articleByNart = new Map(); // clé NART trim UPPER
    for (const r of artCache.records) {
      const nart = this.safeTrim(r.NART);
      if (!nart) continue;
      const a = {
        NART: nart,
        DESIGN: this.nettoyerEspaces(r.DESIGN),
        FOURN: this.safeTrim(r.FOURN),
        PREV: this.num(r.PREV),
        PVTE: this.num(r.PVTE),
        STOCK: this.num(r.STOCK),
        GROUPE: this.safeTrim(r.GROUPE),
        DEPREC: this.num(r.DEPREC),
        ATVA: this.num(r.ATVA),
        GISM1: this.safeTrim(r.GISM1),
        PVTETTC: this.num(r.PVTETTC),
        PVPROMO: this.num(r.PVPROMO),
        DATE_DEBUT_PROMO: r.DPROMOD ?? null,
        DATE_FIN_PROMO: r.DPROMOF ?? null,
        NOM_FOURNISSEUR: nomFournisseur(this.safeTrim(r.FOURN)),
      };
      articles.push(a);
      articleByNart.set(nart.toUpperCase(), a);
    }

    const fournisseurs = fournCache.records.map((r) => ({
      FOURN: this.safeTrim(r.FOURN),
      NOM: this.nettoyerEspaces(r.NOM),
    }));

    return { articles, articleByNart, fournisseurs };
  }

  // Clients (équiv. clients.csv) : TIERS ≠ 1, NOM nettoyé, CATEGORIE normalisée
  async chargerClients(entreprise, cfg) {
    const cache = await clientCacheService.getClients(entreprise);
    const clients = [];
    const clientByTiers = new Map(); // clé int TIERS -> {nom, categorie, ...}
    for (const r of cache.records) {
      const tiers = parseInt(this.safeTrim(r.TIERS), 10);
      if (!Number.isFinite(tiers) || tiers === 1) continue;
      let categorie = this.normaliserCategorie(r.CATEGORIE, cfg);
      if (cfg.tiersForcerAutre.has(tiers)) categorie = "AUTRE";
      const c = {
        NOM: this.nettoyerEspaces(r.NOM),
        TIERS: tiers,
        PROFES: this.safeTrim(r.PROFES),
        TYPE: this.safeTrim(r.TYPE),
        CATEGORIE: categorie,
      };
      clients.push(c);
      if (!clientByTiers.has(tiers)) clientByTiers.set(tiers, c);
    }
    return { clients, clientByTiers };
  }

  // ── Détails + factures d'une période (année N, ≤ coupure) ─────────────────
  chargerPeriode(cacheFactures, articleByNart, annee, coupure, cfg) {
    const details = [];
    const factures = [];

    for (const f of cacheFactures.factureRecords) {
      const typ = this.safeTrim(f.TYPFACT).toUpperCase();
      if (typ !== "F" && typ !== "A") continue;

      const d = factureCacheService.parseDate(f.DATFACT);
      if (!d || d.getFullYear() !== annee || d > coupure) continue;

      const numfact = this.safeTrim(f.NUMFACT);
      const tiersId = parseInt(this.safeTrim(f.TIERS), 10);
      const tiersNum = Number.isFinite(tiersId) ? tiersId : 0;
      const dateFr = this.dateFr(d);

      // ---- Entête facture (équiv. factures_n.csv) ----
      const signe = (champ) => {
        let v = this.num(champ);
        if (typ === "A" && v > 0) v = -v;
        return v;
      };
      factures.push({
        NUMFACT: numfact,
        TYPFACT: typ,
        DATFACT: dateFr,
        TIERS_ID: tiersNum,
        MONTANT: signe(f.MONTANT),
        FACTREM: signe(f.FACTREM),
        FACTREV: signe(f.FACTREV),
      });

      // ---- Lignes de détail (équiv. details_n.csv) ----
      const lignes = cacheFactures.detailByNumfact.get(numfact) || [];
      for (const l of lignes) {
        const nart = this.safeTrim(l.NART);
        if (this.articleExclu(nart, cfg)) continue;

        const pvte = Math.abs(this.num(l.PVTE));
        const prev = Math.abs(this.num(l.PREV));
        const qte = this.num(l.QTE);
        const pourc = this.num(l.POURC);

        // Filtre PVTE aberrante (vs prix catalogue article)
        const art = articleByNart.get(nart.toUpperCase());
        const pvteCat = art ? art.PVTE : 0;
        if (pvteCat > 0 && pvte > pvteCat * cfg.seuilPvteAberrante) continue;

        details.push({
          NUMFACT: numfact,
          NART: nart,
          QTE: qte,
          PVTE: pvte,
          PREV: prev,
          TYPFACT: typ,
          TIERS_ID: tiersNum,
          PVTTC: this.num(l.PVTTC),
          POURC: pourc,
          TAUX_TGC: this.num(l.TAUX_TGC),
          date_facture: dateFr,
          REMISE: this.round2(Math.abs(qte) * pvte * (pourc / 100)),
        });
      }
    }

    return { details, factures };
  }

  // Séparation externes / internes (tiersExclusCA retirés partout)
  separerInternesExternes(rows, cfg) {
    const ext = [];
    const int = [];
    for (const r of rows) {
      if (cfg.tiersExclusCA.has(r.TIERS_ID)) continue;
      if (r.TIERS_ID < cfg.seuilTiersInterne) ext.push(r);
      else if (cfg.tiersInternesAutorises.has(r.TIERS_ID)) int.push(r);
      // sinon : exclu
    }
    return { ext, int };
  }

  // Enrichissement nom_client / categorie_client
  enrichirClients(rows, clientByTiers) {
    for (const r of rows) {
      const c = clientByTiers.get(r.TIERS_ID);
      r.nom_client = c ? c.NOM : null;
      r.categorie_client = c ? c.CATEGORIE : null;
    }
    return rows;
  }

  // ── Point d'entrée : tous les datasets ────────────────────────────────────
  async prepareDatasets(entreprise, moisCoupure) {
    const periode = this.resolvePeriode(moisCoupure);
    const config = this.getConfig(entreprise);

    const [cacheFactures, refArticles, refClients] = await Promise.all([
      factureCacheService.getFactures(entreprise),
      this.chargerArticles(entreprise),
      this.chargerClients(entreprise, config),
    ]);

    const { articles, articleByNart, fournisseurs } = refArticles;
    const { clients, clientByTiers } = refClients;

    const n = this.chargerPeriode(
      cacheFactures, articleByNart, periode.anneeN, periode.coupureN, config,
    );
    const n1 = this.chargerPeriode(
      cacheFactures, articleByNart, periode.anneeN1, periode.coupureN1, config,
    );

    const detN = this.separerInternesExternes(n.details, config);
    const detN1 = this.separerInternesExternes(n1.details, config);
    const facN = this.separerInternesExternes(n.factures, config);
    const facN1 = this.separerInternesExternes(n1.factures, config);

    for (const rows of [
      detN.ext, detN.int, detN1.ext, detN1.int,
      facN.ext, facN.int, facN1.ext, facN1.int,
    ]) {
      this.enrichirClients(rows, clientByTiers);
    }

    return {
      periode,
      config,
      articles,
      articleByNart,
      fournisseurs,
      clients,
      clientByTiers,
      detailsN: detN.ext,
      detailsNInterne: detN.int,
      detailsN1: detN1.ext,
      detailsN1Interne: detN1.int,
      facturesN: facN.ext,
      facturesNInterne: facN.int,
      facturesN1: facN1.ext,
      facturesN1Interne: facN1.int,
    };
  }

  // ── artplus.dbf (facultatif) ───────────────────────────────────────────────
  // Retourne null si le fichier n'existe pas (entreprise sans artplus).
  // Sinon : Map NART(upper) -> { famille, sousFamille, groupe06 }
  async loadArtplus(entreprise) {
    const dbfPath = path.join(
      entreprise.cheminBase,
      entreprise.nomDossierDBF,
      "artplus.dbf",
    );
    if (!fs.existsSync(dbfPath)) return null;

    const dbf = await DBFFile.open(dbfPath);
    const records = await dbf.readRecords();

    const byNart = new Map();
    for (const r of records) {
      const nart = this.safeTrim(r.NART);
      const intitule = this.safeTrim(r.INTITULE);
      const contenu = this.safeTrim(r.CONTENU);
      if (!nart || !contenu) continue;
      const key = nart.toUpperCase();
      if (!byNart.has(key)) byNart.set(key, {});
      const e = byNart.get(key);
      if (intitule.startsWith("07")) e.famille = contenu;
      else if (intitule.startsWith("08")) e.sousFamille = contenu;
      else if (intitule.startsWith("06")) e.groupe06 = contenu;
    }
    return byNart;
  }

  // ── Dictionnaire rayons (xlsx, feuille "rayons") ──────────────────────────
  // Retourne null si absent. Sinon : Map GISM1 -> { libelle, metrage }
  async loadDictionnaireRayons(entreprise) {
    const base =
      process.env.ANALYSE_CA_DICTIONNAIRE_PATH ||
      "\\\\192.168.0.250\\Rcommun\\STOCK\\collecteur";
    const trigramme = this.safeTrim(entreprise.trigramme).toLowerCase();
    const filePath = path.join(base, `${trigramme}_dictionnaire_rayons.xlsx`);
    if (!fs.existsSync(filePath)) return null;

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(filePath);
    const ws = wb.getWorksheet("rayons") || wb.worksheets[0];
    if (!ws) return null;

    const byGism = new Map();
    ws.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return; // en-tête GISM1 / libelle / metrage
      const gism = this.safeTrim(row.getCell(1).value);
      if (!gism) return;
      byGism.set(gism, {
        libelle: this.safeTrim(row.getCell(2).value),
        metrage: this.num(row.getCell(3).value),
      });
    });
    return byGism;
  }
}

const analyseCaDataService = new AnalyseCaDataService();
export default analyseCaDataService;