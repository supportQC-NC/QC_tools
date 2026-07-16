// backend/services/analyseReapproService.js
//
// Analyse de réapprovisionnement / ruptures par entreprise.
// Portage JS de la partie ANALYTIQUE du script Python (main.py) — on réutilise
// la couche de données existante (articleService, fournissCacheService) et les
// MÊMES formules que reapproLocalService, donc aucun lecteur CSV/DBF à re-porter.
//
// Formules (identiques au réappro local) :
//   vente_annuelle = Σ|V1..V12|
//   jours_rupture  = Σ|RUP1..RUP12|
//   stock          = ΣS1..S5
//   vte_moy_mois   = (vAn*30)/(360 - jours_rupture)  (sinon vAn/12)
//   reappro        = round(vte_moy_mois - stock - ENCDE)
//   CA_mois        = round(PVTE × vAn / 12)
//
// Sortie : KPIs globaux + tableau des articles à réapprovisionner (priorisés
// par CA perdu) + ruptures par lieu de stockage (S1..S5).

import articleService from "./articleService.js";
import fournissCacheService from "./fournissCacheService.js";

const num = (v) => {
  const n = Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};
const safeTrim = (v) => (v == null ? "" : String(v)).trim();
const cleanNart = (v) => safeTrim(v).toUpperCase();

const venteAnnuelle = (a) => {
  let s = 0;
  for (let i = 1; i <= 12; i += 1) s += Math.abs(num(a[`V${i}`]));
  return s;
};
const joursRupture = (a) => {
  let s = 0;
  for (let i = 1; i <= 12; i += 1) s += Math.abs(num(a[`RUP${i}`]));
  return s;
};
const stockTotal = (a) =>
  num(a.S1) + num(a.S2) + num(a.S3) + num(a.S4) + num(a.S5);

const vteMoyMois = (vAn, rup) => {
  const denom = 360 - rup;
  if (denom > 0) return Math.round(((vAn * 30) / denom) * 100) / 100;
  return Math.round((vAn / 12) * 100) / 100;
};
const gisement = (a) => safeTrim(a.GISM1) || safeTrim(a.EMPLACE);

const yieldLoop = () => new Promise((resolve) => setImmediate(resolve));

/**
 * Construit l'analyse réappro/ruptures d'une entreprise.
 * @param {object} entreprise  (doit avoir nomDossierDBF)
 * @param {object} [opts]      { maxRows = 500 }  taille du tableau renvoyé
 * @returns {Promise<{kpis, rows, ruptureParLieu, generatedAt}>}
 */
export const buildAnalyseReappro = async (entreprise, opts = {}) => {
  const maxRows = opts.maxRows || 500;
  const isQC = String(entreprise.nomDossierDBF).toLowerCase() === "qc";

  const [artCache, fourCache] = await Promise.all([
    articleService.getArticles(entreprise),
    fournissCacheService.getFournisseurs(entreprise),
  ]);
  const articles = artCache.records || [];

  const fournByCode = new Map();
  (fourCache.records || []).forEach((r) => {
    if (r.FOURN !== undefined && r.FOURN !== null) {
      fournByCode.set(String(r.FOURN).trim(), r);
    }
  });

  // Compteurs KPI
  let nbActifs = 0; // articles avec des ventes (vAn > 0)
  let nbARepro = 0; // reappro >= 1
  let nbEnRupture = 0; // vente > 0 et stock <= 0
  let caMoisTotal = 0; // Σ CA_mois (articles actifs)
  let caPerduMois = 0; // Σ (reappro × PVTE) sur les articles à réappro
  let nbReapproMagasin = 0; // S1 = 0 mais STOCK > 0 (rayon à réassortir)
  const ruptureParLieu = { S1: 0, S2: 0, S3: 0, S4: 0, S5: 0 };

  const rows = []; // réappro fournisseur (à commander)
  const magasinRows = []; // réappro magasin (rayon vide, stock en réserve)

  for (let i = 0; i < articles.length; i += 1) {
    if (i % 20000 === 0 && i > 0) {
      // eslint-disable-next-line no-await-in-loop
      await yieldLoop();
    }
    const a = articles[i];
    const nart = cleanNart(a.NART);
    if (!nart) continue;
    // On ne tient pas compte des articles dont le NART est inférieur à 100000
    // (codes techniques / internes).
    const nartNum = parseInt(nart, 10);
    if (!Number.isNaN(nartNum) && nartNum < 100000) continue;

    const gis = gisement(a);
    if (isQC && (gis.toUpperCase() === "SAV" || gis.toUpperCase() === "DOCK")) {
      continue;
    }

    const vAn = venteAnnuelle(a);
    const rup = joursRupture(a);
    const vmm = vteMoyMois(vAn, rup);
    const stock = stockTotal(a);
    const encde = num(a.ENCDE);
    const pvte = num(a.PVTE);
    const caMois = Math.round((pvte * vAn) / 12);

    const actif = vAn > 0;
    if (actif) {
      nbActifs += 1;
      caMoisTotal += caMois;
      // Rupture par lieu : lieu utilisé (Sx <= 0) alors que l'article se vend.
      for (const s of ["S1", "S2", "S3", "S4", "S5"]) {
        if (num(a[s]) <= 0) ruptureParLieu[s] += 1;
      }
      if (stock <= 0) nbEnRupture += 1;
    }

    // Réappro MAGASIN : rayon (S1) vide mais stock présent ailleurs (S2..S5).
    const s1 = num(a.S1);
    if (s1 === 0 && stock > 0) {
      nbReapproMagasin += 1;
      const fournM =
        a.FOURN != null ? fournByCode.get(String(a.FOURN).trim()) : null;
      magasinRows.push({
        nart,
        design: safeTrim(a.DESIGN),
        fourn: a.FOURN != null ? String(a.FOURN).trim() : "",
        fournNom: fournM ? safeTrim(fournM.NOM) : "",
        gisement: gis,
        pvte,
        venteAnnuelle: vAn,
        vteMoyMois: vmm,
        s1, // = 0
        stock, // = stock en réserve (S2..S5) puisque S1 = 0
      });
    }

    const reappro = Math.round(vmm - stock - encde);
    if (reappro < 1) continue; // rien à commander

    nbARepro += 1;
    const caPerdu = Math.max(0, Math.round(reappro * pvte));
    caPerduMois += caPerdu;

    const fourn =
      a.FOURN !== undefined && a.FOURN !== null
        ? fournByCode.get(String(a.FOURN).trim())
        : null;

    rows.push({
      nart,
      design: safeTrim(a.DESIGN),
      fourn: a.FOURN != null ? String(a.FOURN).trim() : "",
      fournNom: fourn ? safeTrim(fourn.NOM) : "",
      local: fourn ? safeTrim(fourn.LOCAL).toUpperCase() === "O" : false,
      refer: cleanNart(a.REFER),
      groupe: safeTrim(a.GROUPE),
      gisement: gis,
      pvte,
      venteAnnuelle: vAn,
      vteMoyMois: vmm,
      stock,
      encde,
      reappro,
      caMois,
      caPerdu,
      enRupture: stock <= 0,
    });
  }

  // Priorisation : le CA perdu décroissant (impact business).
  rows.sort((x, y) => y.caPerdu - x.caPerdu);
  // Réappro magasin : les articles qui se vendent le plus en premier.
  magasinRows.sort((x, y) => y.vteMoyMois - x.vteMoyMois);

  // Liste des gisements (GISM1) présents en réappro magasin, pour le filtre/envoi.
  const gisMap = new Map();
  magasinRows.forEach((r) => {
    const g = r.gisement || "(sans gisement)";
    gisMap.set(g, (gisMap.get(g) || 0) + 1);
  });
  const gisementsMagasin = [...gisMap.entries()]
    .map(([gisement, nb]) => ({ gisement, nb }))
    .sort((a, b) => b.nb - a.nb);

  const tauxRuptureQte =
    nbActifs > 0 ? Math.round((nbEnRupture / nbActifs) * 1000) / 10 : 0;
  const tauxRuptureValeur =
    caMoisTotal > 0 ? Math.round((caPerduMois / caMoisTotal) * 1000) / 10 : 0;

  return {
    entreprise: {
      nomDossierDBF: entreprise.nomDossierDBF,
      nom: entreprise.nom || entreprise.nomComplet || entreprise.nomDossierDBF,
    },
    kpis: {
      nbArticles: articles.length,
      nbActifs,
      nbARepro,
      nbEnRupture,
      tauxRuptureQte, // %
      caMoisTotal,
      caPerduMois,
      tauxRuptureValeur, // %
      nbReapproMagasin,
    },
    ruptureParLieu: ["S1", "S2", "S3", "S4", "S5"].map((s) => ({
      lieu: s,
      nbRupture: ruptureParLieu[s],
    })),
    rows: rows.slice(0, maxRows),
    totalRows: rows.length,
    rowsMagasin: magasinRows.slice(0, maxRows),
    totalMagasin: magasinRows.length,
    gisementsMagasin,
    generatedAt: new Date().toISOString(),
  };
};

/**
 * Renvoie TOUS les articles à réappro magasin (S1 = 0, STOCK > 0, NART ≥ 100000)
 * d'une entreprise pour un ou plusieurs gisements (GISM1) donnés.
 * Sert à constituer le contenu d'une demande de réappro (non limité au top N).
 */
export const getMagasinArticlesByGisements = async (entreprise, gisements) => {
  const wanted = new Set((gisements || []).map((g) => String(g).trim()));
  const isQC = String(entreprise.nomDossierDBF).toLowerCase() === "qc";

  const [artCache, fourCache] = await Promise.all([
    articleService.getArticles(entreprise),
    fournissCacheService.getFournisseurs(entreprise),
  ]);
  const articles = artCache.records || [];
  const fournByCode = new Map();
  (fourCache.records || []).forEach((r) => {
    if (r.FOURN !== undefined && r.FOURN !== null) {
      fournByCode.set(String(r.FOURN).trim(), r);
    }
  });

  const out = [];
  for (let i = 0; i < articles.length; i += 1) {
    if (i % 20000 === 0 && i > 0) {
      // eslint-disable-next-line no-await-in-loop
      await yieldLoop();
    }
    const a = articles[i];
    const nart = cleanNart(a.NART);
    if (!nart) continue;
    const nartNum = parseInt(nart, 10);
    if (!Number.isNaN(nartNum) && nartNum < 100000) continue;

    const gis = gisement(a);
    if (isQC && (gis.toUpperCase() === "SAV" || gis.toUpperCase() === "DOCK")) {
      continue;
    }
    const gLabel = gis || "(sans gisement)";
    if (wanted.size && !wanted.has(gLabel) && !wanted.has(gis)) continue;

    const s1 = num(a.S1);
    const stock = stockTotal(a);
    if (!(s1 === 0 && stock > 0)) continue;

    const fournM =
      a.FOURN != null ? fournByCode.get(String(a.FOURN).trim()) : null;
    out.push({
      nart,
      design: safeTrim(a.DESIGN),
      fourn: a.FOURN != null ? String(a.FOURN).trim() : "",
      fournNom: fournM ? safeTrim(fournM.NOM) : "",
      gencod: safeTrim(a.GENCOD),
      gisement: gLabel,
      s1,
      stock,
      vteMoyMois: vteMoyMois(venteAnnuelle(a), joursRupture(a)),
    });
  }
  return out;
};

export default { buildAnalyseReappro, getMagasinArticlesByGisements };