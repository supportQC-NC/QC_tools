// backend/services/bipageSelectionService.js
//
// Sélection d'articles à biper à partir d'un critère de RANGEMENT de la fiche
// article. Utilisé par les demandes de bipage créées depuis le web.
//
// ⚠️ Ne pas confondre avec `getMagasinArticlesByGisements` d'analyseReapproService,
// que le module réappro utilise pour les GISEMENTS : celui-là ne retient que les
// articles absents du rayon mais présents en stock (S1 = 0 et stock > 0), ce qui
// est la question du réappro. Ici la question est le COMPTAGE : on veut tous les
// articles du groupe, éventuellement bornés à ceux qui ont du stock.
import articleService from "./articleService.js";
import fournissCacheService from "./fournissCacheService.js";

const safeTrim = (v) => (v == null ? "" : String(v)).trim();

const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

// Stock total, tous dépôts : la fiche article porte S1..S5.
const stockTotal = (a) =>
  num(a.S1) + num(a.S2) + num(a.S3) + num(a.S4) + num(a.S5);

/**
 * Articles d'un ou plusieurs GROUPE (famille de la fiche article).
 *
 * @param {object} entreprise            document Entreprise
 * @param {string[]} groupes             codes GROUPE demandés
 * @param {object} [options]
 * @param {boolean} [options.avecStockSeulement=true]
 *        true  : seuls les articles dont le stock total est non nul — le cas
 *                courant, un groupe entier compte souvent des milliers de
 *                références dont la plupart n'ont jamais été en rayon ;
 *        false : tout le groupe (l'agent verra aussi les articles à 0).
 * @returns {Promise<Map<string, Array>>} code GROUPE -> articles à biper
 */
export const getArticlesParGroupes = async (
  entreprise,
  groupes,
  options = {},
) => {
  const { avecStockSeulement = true } = options;
  const voulus = new Set(
    (groupes || []).map((g) => safeTrim(g)).filter(Boolean),
  );
  const parGroupe = new Map();
  if (voulus.size === 0) return parGroupe;

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

  // L'index par GROUPE existe déjà dans le cache article : on ne balaie pas les
  // 100 000 articles pour trois groupes.
  voulus.forEach((code) => {
    const indices = artCache.indexByGroupe?.get(code) || [];
    const articles = [];
    indices.forEach((i) => {
      const a = artCache.records[i];
      if (!a) return;
      const nart = safeTrim(a.NART);
      if (!nart) return;
      // Articles techniques de l'ERP (« ARTICLE TGC 11 % », frais de port…) :
      // NART sous 100000, jamais en rayon. Même exclusion que le service
      // réappro pour les gisements — sans elle, chaque demande de groupe
      // démarre sur des lignes que personne ne peut biper.
      const nartNum = parseInt(nart, 10);
      if (!Number.isNaN(nartNum) && nartNum < 100000) return;
      const stock = stockTotal(a);
      if (avecStockSeulement && stock === 0) return;
      const fournM =
        a.FOURN != null ? fournByCode.get(String(a.FOURN).trim()) : null;
      articles.push({
        nart,
        design: safeTrim(a.DESIGN),
        fourn: a.FOURN != null ? String(a.FOURN).trim() : "",
        fournNom: fournM ? safeTrim(fournM.NOM) : "",
        // ⚠️ Le GENCOD peut commencer par des zéros : on le laisse tel quel
        // (cf. utils/codeBarres.js) — le retirer rendrait l'article « inconnu »
        // au scan.
        gencod: safeTrim(a.GENCOD),
        stock,
      });
    });
    articles.sort((x, y) => x.nart.localeCompare(y.nart));
    parGroupe.set(code, articles);
  });

  return parGroupe;
};

export default { getArticlesParGroupes };
