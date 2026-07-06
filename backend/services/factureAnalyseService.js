// backend/services/factureAnalyseService.js
//
// Analyse des factures de TYPE "F" (TYPFACT === "F") sur une PLAGE DE DATES
// choisie par l'utilisateur.
//
// KPI globaux :
//   - montant total facturé (somme MONTANT), montant moyen / facture
//   - nombre de factures, nombre de factures à montant 0
//   - moyenne d'articles par facture (lignes detail.dbf HORS commentaires :
//     NART vide ou contenant "!")
//   - ventilation MENSUELLE (nb factures + montant) pour les graphiques
//
// KPI PAR VENDEUR (uniquement entreprise.vendeurs avec type === "vendeur") :
//   - nb factures, montant, part du montant total
//   - factures à 0, moyenne d'articles / facture, montant moyen / facture
//   - ventilation mensuelle (graphique du vendeur sélectionné)
//
// IMPORTANT : le cache facture (factureCacheService) ne conserve que l'année en
// cours et l'année précédente. Une plage hors de ces deux années ne remontera
// donc aucune facture (le front l'indique).

import factureCacheService from "./factureCacheService.js";

const MOIS_SHORT = [
  "Janv", "Févr", "Mars", "Avr", "Mai", "Juin",
  "Juil", "Août", "Sept", "Oct", "Nov", "Déc",
];

class FactureAnalyseService {
  num(v) {
    if (v === null || v === undefined || v === "") return 0;
    const n = typeof v === "number" ? v : parseFloat(String(v).replace(",", "."));
    return Number.isFinite(n) ? n : 0;
  }

  safeTrim(v) {
    if (v === null || v === undefined) return "";
    return String(v).trim();
  }

  // Code représentant entier ; "" / null / NaN => 0 (MAGASIN)
  repCode(v) {
    if (v === null || v === undefined || v === "") return 0;
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : 0;
  }

  // Une ligne de détail est un "article" si NART n'est ni vide ni un commentaire ("!")
  estLigneArticle(ligne) {
    const nart = this.safeTrim(ligne.NART);
    return nart !== "" && !nart.includes("!");
  }

  // "YYYY-MM-DD" (input date HTML) -> Date locale à minuit.
  parseInputDate(v) {
    if (!v) return null;
    const d =
      typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)
        ? new Date(
            parseInt(v.slice(0, 4), 10),
            parseInt(v.slice(5, 7), 10) - 1,
            parseInt(v.slice(8, 10), 10),
          )
        : new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  moisKey(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }

  // Liste ordonnée des mois couverts par la plage [debut..fin]
  buildMoisList(debut, fin) {
    const out = [];
    const cur = new Date(debut.getFullYear(), debut.getMonth(), 1);
    const end = new Date(fin.getFullYear(), fin.getMonth(), 1);
    while (cur <= end) {
      out.push({
        key: this.moisKey(cur),
        label: `${MOIS_SHORT[cur.getMonth()]} ${String(cur.getFullYear()).slice(2)}`,
      });
      cur.setMonth(cur.getMonth() + 1);
    }
    return out;
  }

  // Convertit une Map key->{nbFactures,montant} en tableau aligné sur moisList
  moisMapToArray(moisList, map) {
    return moisList.map((m) => {
      const e = map.get(m.key) || { nbFactures: 0, montant: 0 };
      return { mois: m.label, nbFactures: e.nbFactures, montant: e.montant };
    });
  }

  /**
   * @param {object} entreprise
   * @param {string} dateDebut - "YYYY-MM-DD"
   * @param {string} dateFin   - "YYYY-MM-DD"
   */
  async analyser(entreprise, dateDebut, dateFin) {
    const cache = await factureCacheService.getFactures(entreprise);

    const debut = this.parseInputDate(dateDebut);
    const fin = this.parseInputDate(dateFin);
    if (!debut || !fin) {
      throw new Error("Plage de dates invalide (date début / date fin requises).");
    }
    fin.setHours(23, 59, 59, 999); // inclure toute la journée de fin

    const moisList = this.buildMoisList(debut, fin);

    // Vendeurs "type = vendeur" de l'entreprise
    const vendeurs = Array.isArray(entreprise.vendeurs) ? entreprise.vendeurs : [];
    const parVendeur = new Map();
    vendeurs
      .filter((v) => (v.type || "vendeur") === "vendeur")
      .forEach((v) => {
        const code = this.repCode(v.code);
        const nom = [v.nom, v.prenom].filter(Boolean).join(" ").trim();
        parVendeur.set(code, {
          code: String(code).padStart(2, "0"),
          nom: nom || `Vendeur ${String(v.code || code)}`,
          nbFactures: 0,
          montant: 0,
          nbFacturesZero: 0,
          totalLignesArticle: 0,
          moisMap: new Map(),
        });
      });

    // Agrégats globaux
    let montantTotal = 0;
    let nbFactures = 0;
    let nbFacturesZero = 0;
    let totalLignesArticle = 0;
    const globalMoisMap = new Map();

    for (const f of cache.factureRecords) {
      // Type F uniquement
      if (this.safeTrim(f.TYPFACT).toUpperCase() !== "F") continue;

      // Filtre plage de dates
      const d = factureCacheService.parseDate(f.DATFACT);
      if (!d || d < debut || d > fin) continue;

      const montant = this.num(f.MONTANT);
      const numfact = this.safeTrim(f.NUMFACT);
      const lignes = cache.detailByNumfact.get(numfact) || [];
      const nbArticles = lignes.filter((l) => this.estLigneArticle(l)).length;

      // Global
      montantTotal += montant;
      nbFactures += 1;
      if (montant === 0) nbFacturesZero += 1;
      totalLignesArticle += nbArticles;

      const mk = this.moisKey(d);
      if (!globalMoisMap.has(mk)) globalMoisMap.set(mk, { nbFactures: 0, montant: 0 });
      const gm = globalMoisMap.get(mk);
      gm.nbFactures += 1;
      gm.montant += montant;

      // Par vendeur (uniquement type = vendeur)
      const rep = this.repCode(f.REPRES);
      if (parVendeur.has(rep)) {
        const v = parVendeur.get(rep);
        v.nbFactures += 1;
        v.montant += montant;
        if (montant === 0) v.nbFacturesZero += 1;
        v.totalLignesArticle += nbArticles;
        if (!v.moisMap.has(mk)) v.moisMap.set(mk, { nbFactures: 0, montant: 0 });
        const vm = v.moisMap.get(mk);
        vm.nbFactures += 1;
        vm.montant += montant;
      }
    }

    // Finalisation vendeurs : KPI dérivés + ventilation mensuelle alignée
    const vendeursListe = [...parVendeur.values()]
      .map((v) => ({
        code: v.code,
        nom: v.nom,
        nbFactures: v.nbFactures,
        montant: v.montant,
        nbFacturesZero: v.nbFacturesZero,
        totalLignesArticle: v.totalLignesArticle,
        moyenneArticlesParFacture:
          v.nbFactures !== 0 ? v.totalLignesArticle / v.nbFactures : 0,
        montantMoyenParFacture: v.nbFactures !== 0 ? v.montant / v.nbFactures : 0,
        partMontant: montantTotal !== 0 ? (v.montant / montantTotal) * 100 : 0,
        parMois: this.moisMapToArray(moisList, v.moisMap),
      }))
      .sort((a, b) => b.nbFactures - a.nbFactures);

    return {
      nomDossierDBF: entreprise.nomDossierDBF,
      dateDebut,
      dateFin,
      generatedAt: new Date().toISOString(),
      totaux: {
        nbFactures,
        montantTotal,
        moyenneArticlesParFacture:
          nbFactures !== 0 ? totalLignesArticle / nbFactures : 0,
        nbFacturesZero,
        montantMoyenParFacture: nbFactures !== 0 ? montantTotal / nbFactures : 0,
        totalLignesArticle,
      },
      parMois: this.moisMapToArray(moisList, globalMoisMap),
      vendeurs: vendeursListe,
    };
  }
}

const factureAnalyseService = new FactureAnalyseService();
export default factureAnalyseService;