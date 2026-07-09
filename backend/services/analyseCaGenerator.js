// backend/services/analyseCaGenerator.js
//
// ORCHESTRATEUR du module ANALYSE CA.
// Prépare les datasets (analyseCaDataService) puis :
//  - apercu()  : renvoie période + KPIs + liste des onglets (pour le dashboard
//                à l'écran) SANS construire le fichier ;
//  - generer() : construit le classeur Excel en appelant les 13 builders DANS
//                L'ORDRE du consolidateur Python (consolide.py) et renvoie le
//                buffer téléchargeable.
//
// Dépendances optionnelles :
//  - artplus.dbf : onglets Groupes / Familles / Sous_Familles OMIS si absent.
//  - dictionnaire rayons : onglet Rayons dégradé (libellé = code) si absent.

import ExcelJS from "exceljs";
import analyseCaDataService from "./analyseCaDataService.js";
import { buildTypeClientSheet } from "./analyseCa/typeClientSheet.js";
import { buildClientSheet } from "./analyseCa/clientSheet.js";
import { buildFournisseursSheet } from "./analyseCa/fournisseursSheet.js";
import { buildClassesSheets } from "./analyseCa/classesSheet.js";
import { buildLocatesSheet } from "./analyseCa/locatesSheet.js";
import { buildGroupesSheet } from "./analyseCa/groupesSheet.js";
import { buildFamillesSheet, buildSousFamillesSheet } from "./analyseCa/famillesSheet.js";
import { buildRayonsSheet } from "./analyseCa/rayonsSheet.js";
import { buildClientInterneSheet } from "./analyseCa/clientInterneSheet.js";
import { buildPromosSheets } from "./analyseCa/promosSheet.js";

// Ordre + couleurs officiels (consolide.py ORDRE_ONGLETS)
const ORDRE_ONGLETS = [
  "TYPES_CLIENT", "Client", "Fournisseurs", "Classes", "Sous_Classes",
  "Locates", "Groupes", "Familles", "Sous_Familles", "Rayons",
  "Client_Interne", "Promos", "Detail_Promos",
];
// Onglets dépendant d'artplus.dbf (omis si absent)
const ONGLETS_ARTPLUS = ["Groupes", "Familles", "Sous_Familles"];

const r0 = (n) => Math.round(n);

class AnalyseCaGenerator {
  // Nom de fichier : analyse_ca_{trigramme}_{MM}_{YYYY}.xlsx
  nomFichier(entreprise, periode) {
    const trig = String(entreprise.trigramme || "").trim().toLowerCase();
    const mm = String(periode.mois).padStart(2, "0");
    return `analyse_ca_${trig}_${mm}_${periode.anneeN}.xlsx`;
  }

  // KPIs synthétiques (détails EXTERNES) pour le dashboard.
  calculerKpis(datasets) {
    const somme = (rows) => {
      let ca = 0, cout = 0;
      const factures = new Set();
      const clients = new Set();
      const narts = new Set();
      for (const l of rows) {
        ca += l.QTE * l.PVTE * (1 - l.POURC / 100);
        cout += l.QTE * l.PREV;
        factures.add(l.NUMFACT);
        clients.add(l.TIERS_ID);
        narts.add(l.NART);
      }
      return {
        ca: r0(ca),
        marge: r0(ca - cout),
        nbFactures: factures.size,
        nbClients: clients.size,
        nbArticles: narts.size,
      };
    };
    const n = somme(datasets.detailsN);
    const n1 = somme(datasets.detailsN1);
    const evol = (a, b) => (b !== 0 ? ((a - b) / b) * 100 : a > 0 ? 100 : 0);
    return {
      caN: n.ca,
      caN1: n1.ca,
      evolCaPct: Math.round(evol(n.ca, n1.ca) * 10) / 10,
      margeN: n.marge,
      margeN1: n1.marge,
      tauxMargeN: n.ca !== 0 ? Math.round((n.marge / n.ca) * 1000) / 10 : 0,
      evolMargePct: Math.round(evol(n.marge, n1.marge) * 10) / 10,
      nbFacturesN: n.nbFactures,
      nbClientsN: n.nbClients,
      nbArticlesN: n.nbArticles,
    };
  }

  // Séries prêtes pour les graphiques du dashboard (détails EXTERNES).
  calculerCharts(datasets) {
    const MOIS_COURT = [
      "Jan", "Fév", "Mar", "Avr", "Mai", "Juin",
      "Juil", "Août", "Sep", "Oct", "Nov", "Déc",
    ];
    const norm = datasets.config.normalisationCategories || {};
    const artByNart = datasets.articleByNart;

    const moisDe = (dateFr) => {
      if (typeof dateFr !== "string") return null;
      const m = dateFr.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      return m ? parseInt(m[2], 10) : null;
    };
    const caLigne = (l) => l.QTE * l.PVTE * (1 - l.POURC / 100);
    const coutLigne = (l) => l.QTE * l.PREV;

    // 1) CA / marge par mois (N vs N-1)
    const parMois = Array.from({ length: 12 }, (_, i) => ({
      mois: i + 1, moisLabel: MOIS_COURT[i], caN: 0, caN1: 0, margeN: 0,
    }));
    for (const l of datasets.detailsN) {
      const m = moisDe(l.date_facture);
      if (m) {
        parMois[m - 1].caN += caLigne(l);
        parMois[m - 1].margeN += caLigne(l) - coutLigne(l);
      }
    }
    for (const l of datasets.detailsN1) {
      const m = moisDe(l.date_facture);
      if (m) parMois[m - 1].caN1 += caLigne(l);
    }
    const caParMois = parMois.map((r) => ({
      mois: r.mois,
      moisLabel: r.moisLabel,
      caN: r0(r.caN),
      caN1: r0(r.caN1),
      margeN: r0(r.margeN),
    }));

    // 2) Répartition du CA par type de client (normalisé)
    const parType = new Map();
    for (const l of datasets.detailsN) {
      const brut = (l.categorie_client || "").toString().trim().toUpperCase();
      const type = norm[brut] || brut || "INCONNU";
      parType.set(type, (parType.get(type) || 0) + caLigne(l));
    }
    const repartitionTypeClient = [...parType.entries()]
      .map(([type, ca]) => ({ type, ca: r0(ca) }))
      .filter((x) => x.ca > 0)
      .sort((a, b) => b.ca - a.ca);

    // 3) Top 10 articles par CA
    const parArticle = new Map();
    for (const l of datasets.detailsN) {
      const key = l.NART;
      parArticle.set(key, (parArticle.get(key) || 0) + caLigne(l));
    }
    const topArticles = [...parArticle.entries()]
      .map(([nart, ca]) => {
        const art = artByNart.get(String(nart).toUpperCase());
        return {
          nart,
          design: art && art.DESIGN ? String(art.DESIGN).slice(0, 30) : nart,
          ca: r0(ca),
        };
      })
      .filter((x) => x.ca > 0)
      .sort((a, b) => b.ca - a.ca)
      .slice(0, 10);

    // 4) Top 8 fournisseurs par CA (via l'article)
    const parFourn = new Map();
    for (const l of datasets.detailsN) {
      const art = artByNart.get(String(l.NART).toUpperCase());
      const code = art && art.FOURN ? String(art.FOURN).trim() : "—";
      const nom = art && art.NOM_FOURNISSEUR ? String(art.NOM_FOURNISSEUR) : code;
      const cur = parFourn.get(code) || { nom, ca: 0 };
      cur.ca += caLigne(l);
      parFourn.set(code, cur);
    }
    const topFournisseurs = [...parFourn.entries()]
      .map(([code, v]) => ({ code, nom: v.nom, ca: r0(v.ca) }))
      .filter((x) => x.ca > 0)
      .sort((a, b) => b.ca - a.ca)
      .slice(0, 8);

    return { caParMois, repartitionTypeClient, topArticles, topFournisseurs };
  }

  // Datasets + dépendances + KPIs (facteur commun apercu/generer).
  async prepareEtKpis(entreprise, moisCoupure) {
    const datasets = await analyseCaDataService.prepareDatasets(entreprise, moisCoupure);
    const [artplus, dictionnaire] = await Promise.all([
      analyseCaDataService.loadArtplus(entreprise),
      analyseCaDataService.loadDictionnaireRayons(entreprise),
    ]);
    const kpis = this.calculerKpis(datasets);
    return { datasets, artplus, dictionnaire, kpis };
  }

  // Liste des onglets produits / omis selon la présence d'artplus.
  listerOnglets(artplus) {
    const onglets = [];
    const omis = [];
    for (const nom of ORDRE_ONGLETS) {
      if (ONGLETS_ARTPLUS.includes(nom) && !artplus) omis.push(nom);
      else onglets.push(nom);
    }
    return { onglets, omis };
  }

  metaDe(datasets, artplus, dictionnaire) {
    const { onglets, omis } = this.listerOnglets(artplus);
    const p = datasets.periode;
    return {
      periode: {
        moisCoupure: p.moisCoupure,
        mois: p.mois,
        anneeN: p.anneeN,
        anneeN1: p.anneeN1,
        labelN: p.labelN,
        labelN1: p.labelN1,
      },
      onglets,
      ongletsOmis: omis,
      artplusPresent: !!artplus,
      dictionnairePresent: !!dictionnaire,
    };
  }

  /**
   * Aperçu pour le dashboard : période, KPIs, liste des onglets — SANS fichier.
   * @returns {Promise<{ periode, kpis, meta }>}
   */
  async apercu(entreprise, moisCoupure) {
    const { datasets, artplus, dictionnaire, kpis } =
      await this.prepareEtKpis(entreprise, moisCoupure);
    return {
      meta: this.metaDe(datasets, artplus, dictionnaire),
      kpis,
      charts: this.calculerCharts(datasets),
    };
  }

  /**
   * Génère le classeur Analyse CA (fichier téléchargeable).
   * @returns {Promise<{ buffer: Buffer, filename: string, meta, kpis }>}
   */
  async generer(entreprise, moisCoupure) {
    const { datasets, artplus, dictionnaire, kpis } =
      await this.prepareEtKpis(entreprise, moisCoupure);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "QC_tools";
    workbook.created = new Date();

    // ── Ordre EXACT du consolidateur (1..13) ────────────────────────────────
    buildTypeClientSheet(workbook, { datasets, artplus });   // 1
    buildClientSheet(workbook, { datasets });                // 2
    buildFournisseursSheet(workbook, { datasets });          // 3
    buildClassesSheets(workbook, { datasets });              // 4 + 5
    buildLocatesSheet(workbook, { datasets });               // 6
    if (artplus) buildGroupesSheet(workbook, { datasets, artplus });        // 7
    if (artplus) buildFamillesSheet(workbook, { datasets, artplus });       // 8
    if (artplus) buildSousFamillesSheet(workbook, { datasets, artplus });   // 9
    buildRayonsSheet(workbook, { datasets, dictionnaire });  // 10
    buildClientInterneSheet(workbook, { datasets });         // 11
    buildPromosSheets(workbook, { datasets });               // 12 + 13

    const buffer = await workbook.xlsx.writeBuffer();

    return {
      buffer: Buffer.from(buffer),
      filename: this.nomFichier(entreprise, datasets.periode),
      meta: this.metaDe(datasets, artplus, dictionnaire),
      kpis,
    };
  }
}

const analyseCaGenerator = new AnalyseCaGenerator();
export default analyseCaGenerator;