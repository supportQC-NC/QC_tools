// backend/services/topArticlesService.js
//
// TOP ARTICLES VENDUS sur une PLAGE DE DATES.
//
// Règles (validées) :
//   - factures TYPFACT ∈ {F, A} ; les AVOIRS (A) sont déduits en NÉGATIF
//     (CA et quantités).
//   - CA HT d'une ligne = QTE × PVTE (prix tarif).
//   - lignes article uniquement : NART non vide et sans "!" (commentaires exclus).
//   - agrégation par NART -> top 100 par CA HT et top 100 par quantité.
//
// IMPORTANT : le cache facture ne conserve que l'année en cours et l'année
// précédente -> une plage plus ancienne ne remontera rien (le front l'indique).

import factureCacheService from "./factureCacheService.js";

const TOP_N = 100;

class TopArticlesService {
  num(v) {
    if (v === null || v === undefined || v === "") return 0;
    const n = typeof v === "number" ? v : parseFloat(String(v).replace(",", "."));
    return Number.isFinite(n) ? n : 0;
  }

  safeTrim(v) {
    if (v === null || v === undefined) return "";
    return String(v).trim();
  }

  estLigneArticle(ligne) {
    const nart = this.safeTrim(ligne.NART);
    return nart !== "" && !nart.includes("!");
  }

  // "YYYY-MM-DD" -> Date locale à minuit
  parseInputDate(v) {
    if (!v || typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
    const d = new Date(
      parseInt(v.slice(0, 4), 10),
      parseInt(v.slice(5, 7), 10) - 1,
      parseInt(v.slice(8, 10), 10),
    );
    return Number.isNaN(d.getTime()) ? null : d;
  }

  /**
   * @param {object} entreprise
   * @param {string} dateDebut - "YYYY-MM-DD"
   * @param {string} dateFin   - "YYYY-MM-DD"
   */
  async analyser(entreprise, dateDebut, dateFin) {
    const debut = this.parseInputDate(dateDebut);
    const fin = this.parseInputDate(dateFin);
    if (!debut || !fin) {
      throw new Error("Plage de dates invalide (date début / date fin requises).");
    }
    fin.setHours(23, 59, 59, 999); // inclure toute la journée de fin

    const cache = await factureCacheService.getFactures(entreprise);

    // Agrégation par article (NART)
    const parArticle = new Map();
    let nbFacturesAnalysees = 0;
    let caTotal = 0;
    let qteTotale = 0;
    let nbLignesAberrantes = 0; // lignes ignorées (prix/quantité corrompus)

    for (const f of cache.factureRecords) {
      const typ = this.safeTrim(f.TYPFACT).toUpperCase();
      if (typ !== "F" && typ !== "A") continue;

      const d = factureCacheService.parseDate(f.DATFACT);
      if (!d || d < debut || d > fin) continue;

      const signe = typ === "A" ? -1 : 1; // avoirs déduits en négatif
      const numfact = this.safeTrim(f.NUMFACT);
      const lignes = cache.detailByNumfact.get(numfact) || [];
      nbFacturesAnalysees += 1;

      for (const l of lignes) {
        if (!this.estLigneArticle(l)) continue;

        const nart = this.safeTrim(l.NART);
        const q = this.num(l.QTE);
        const pv = this.num(l.PVTE);
        const caLigne = q * pv;
        // Garde-fou anti-DONNÉES CORROMPUES : prix unitaire > 100 M XPF,
        // quantité > 1 M, OU CA d'une seule ligne > 500 M XPF sont aberrants en
        // quincaillerie (cf. anomalie Sitec qui faussait le CA de -353 Md). Ignorées.
        if (Math.abs(pv) > 1e8 || Math.abs(q) > 1e6 || Math.abs(caLigne) > 5e8) {
          nbLignesAberrantes += 1;
          continue;
        }
        const qte = signe * q;
        const ca = signe * caLigne; // QTE × PVTE

        if (!parArticle.has(nart)) {
          parArticle.set(nart, {
            nart,
            design: "",
            qte: 0,
            ca: 0,
            nbLignes: 0,
            factures: new Set(),
          });
        }
        const a = parArticle.get(nart);
        a.qte += qte;
        a.ca += ca;
        a.nbLignes += 1;
        a.factures.add(numfact);
        const design = this.safeTrim(l.DESIGN);
        if (design) a.design = design;

        caTotal += ca;
        qteTotale += qte;
      }
    }

    // Finalisation : liste + dérivés
    const articles = [...parArticle.values()].map((a) => ({
      nart: a.nart,
      design: a.design,
      qte: a.qte,
      ca: a.ca,
      nbLignes: a.nbLignes,
      nbFactures: a.factures.size,
      prixMoyen: a.qte !== 0 ? a.ca / a.qte : 0,
      partCa: caTotal !== 0 ? (a.ca / caTotal) * 100 : 0,
      partQte: qteTotale !== 0 ? (a.qte / qteTotale) * 100 : 0,
    }));

    const rang = (liste) => liste.map((a, i) => ({ ...a, rang: i + 1 }));

    const topCa = rang(
      [...articles].sort((x, y) => y.ca - x.ca).slice(0, TOP_N),
    );
    const topQte = rang(
      [...articles].sort((x, y) => y.qte - x.qte).slice(0, TOP_N),
    );

    return {
      nomDossierDBF: entreprise.nomDossierDBF,
      dateDebut,
      dateFin,
      generatedAt: new Date().toISOString(),
      totaux: {
        caTotal,
        qteTotale,
        nbArticlesDistincts: articles.length,
        nbFacturesAnalysees,
        nbLignesAberrantes,
      },
      topCa,
      topQte,
    };
  }
}

const topArticlesService = new TopArticlesService();
export default topArticlesService;