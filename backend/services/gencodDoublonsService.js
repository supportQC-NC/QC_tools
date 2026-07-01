// gencodDoublonsService.js
// -----------------------------------------------------------------------------
// Doublons GENCODE — détecte les codes-barres (GENCOD) présents sur ≥ 2 articles
// dans la base article d'une entreprise. Réutilise articleService (cache).
// GENCOD vide (ou "0") est ignoré (ce n'est pas un doublon significatif).
// STOCK = ΣS1..S5. PVTE = prix de vente HT.
// -----------------------------------------------------------------------------

import articleService from "./articleService.js";
import fournissCacheService from "./fournissCacheService.js";

class GencodDoublonsService {
  constructor() {
    this.cache = new Map();
    this.cacheTTL = 10 * 60 * 1000;
    this.locks = new Map();
  }

  safeTrim(v) {
    if (v === null || v === undefined) return "";
    return String(v).trim();
  }

  num(v) {
    if (v === null || v === undefined || v === "") return 0;
    const n = typeof v === "number" ? v : parseFloat(String(v).replace(",", "."));
    return Number.isFinite(n) ? n : 0;
  }

  stockTotal(a) {
    return (
      this.num(a.S1) + this.num(a.S2) + this.num(a.S3) + this.num(a.S4) + this.num(a.S5)
    );
  }

  async buildReport(entreprise) {
    const artCache = await articleService.getArticles(entreprise);
    const articles = artCache.records || [];

    // Nom fournisseur (best effort)
    const fournByCode = new Map();
    try {
      const fourCache = await fournissCacheService.getFournisseurs(entreprise);
      (fourCache.records || []).forEach((f) => {
        const code = this.safeTrim(f.FOURN);
        if (code) fournByCode.set(code, this.safeTrim(f.NOM));
      });
    } catch (e) {
      /* fournisseurs indisponibles : on continue sans le nom */
    }

    // Regroupement par GENCOD (non vide)
    const byGencod = new Map();
    for (let i = 0; i < articles.length; i += 1) {
      const a = articles[i];
      const g = this.safeTrim(a.GENCOD);
      if (!g || g === "0") continue;
      if (!byGencod.has(g)) byGencod.set(g, []);
      byGencod.get(g).push(a);
    }

    // Ne garder que les GENCOD présents ≥ 2 fois
    const rows = [];
    let nbGencods = 0;
    for (const [gencod, arr] of byGencod) {
      if (arr.length < 2) continue;
      nbGencods += 1;
      arr.forEach((a) => {
        const fourn = this.safeTrim(a.FOURN);
        rows.push({
          gencod,
          nbDoublons: arr.length,
          nart: this.safeTrim(a.NART),
          design: this.safeTrim(a.DESIGN),
          design2: this.safeTrim(a.DESIGN2),
          refer: this.safeTrim(a.REFER),
          fourn,
          fournNom: fournByCode.get(fourn) || "",
          stock: this.stockTotal(a),
          pvte: this.num(a.PVTE),
        });
      });
    }

    // Tri : par GENCOD puis NART (les doublons se suivent)
    rows.sort((a, b) => {
      if (a.gencod !== b.gencod) return a.gencod < b.gencod ? -1 : 1;
      return a.nart < b.nart ? -1 : a.nart > b.nart ? 1 : 0;
    });

    return {
      nomDossierDBF: entreprise.nomDossierDBF,
      entrepriseNom: entreprise.nomComplet || entreprise.nom || entreprise.nomDossierDBF,
      generatedAt: new Date().toISOString(),
      totaux: {
        nbArticles: articles.length,
        nbGencodsDoublons: nbGencods,
        nbArticlesConcernes: rows.length,
      },
      rows,
    };
  }

  async getReport(entreprise) {
    const key = entreprise.nomDossierDBF;
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.builtAt < this.cacheTTL) return cached.data;
    if (this.locks.has(key)) return this.locks.get(key);

    const promise = (async () => {
      try {
        const data = await this.buildReport(entreprise);
        this.cache.set(key, { data, builtAt: Date.now() });
        this.locks.delete(key);
        return data;
      } catch (err) {
        this.locks.delete(key);
        throw err;
      }
    })();
    this.locks.set(key, promise);
    return promise;
  }

  invalidate(nomDossierDBF) {
    if (nomDossierDBF) this.cache.delete(nomDossierDBF);
    else this.cache.clear();
  }
}

const gencodDoublonsService = new GencodDoublonsService();
export default gencodDoublonsService;