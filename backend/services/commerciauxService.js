// commerciauxService.js
// -----------------------------------------------------------------------------
// Service d'analyse des ventes par commercial.
//
// Principe (repris du script Python d'analyse) :
//   - Le PORTEFEUILLE d'un commercial = tous les clients dont client.REPRES
//     correspond au code du commercial.
//   - On croise avec facture.dbf (TIERS) pour calculer le CA / la marge réalisés
//     sur ce portefeuille, année N (courante) vs N-1.
//   - On distingue le CA réalisé PAR le commercial (facture.REPRES = son code)
//     du CA capté par UN AUTRE représentant sur ses clients (facture.REPRES ≠).
//
// Filtres factures : TYPFACT ∈ {A, F}. Les avoirs (A) sont comptés en négatif.
// Marge = MONTANT - FACTREV (FACTREV = coût de revient ; 0 si le champ est absent).
//
// La liste des commerciaux = vendeurs nommés de l'entreprise
//   + codes REPRES "orphelins" trouvés dans les clients (nommés "Commercial X")
//   + MAGASIN (REPRES = 0 ou absent).
//
// Résultat mis en cache par entreprise (TTL court) car le calcul parcourt
// l'ensemble des factures de la fenêtre N+N-1.
// -----------------------------------------------------------------------------

import clientCacheService from "./clientCacheService.js";
import factureCacheService from "./factureCacheService.js";

const MOIS = [
  "janvier",
  "février",
  "mars",
  "avril",
  "mai",
  "juin",
  "juillet",
  "août",
  "septembre",
  "octobre",
  "novembre",
  "décembre",
];

class CommerciauxService {
  constructor() {
    this.cache = new Map(); // nomDossierDBF -> { data, builtAt }
    this.cacheTTL = 5 * 60 * 1000;
    this.locks = new Map();
  }

  // --- Helpers ---------------------------------------------------------------

  num(v) {
    if (v === null || v === undefined || v === "") return 0;
    const n = typeof v === "number" ? v : parseFloat(String(v).replace(",", "."));
    return Number.isFinite(n) ? n : 0;
  }

  // Code représentant entier ; "" / null / NaN / 0 => 0 (MAGASIN)
  repCode(v) {
    if (v === null || v === undefined || v === "") return 0;
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : 0;
  }

  parseYM(v) {
    if (!v) return null;
    const d = v instanceof Date ? v : new Date(v);
    if (Number.isNaN(d.getTime())) return null;
    return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
  }

  // Évolution en % (gère la division par zéro comme le script Python)
  evol(courant, precedent) {
    if (precedent !== 0) {
      return ((courant - precedent) / Math.abs(precedent)) * 100;
    }
    return courant === 0 ? 0 : 100;
  }

  // KPI agrégés à partir d'une liste de commerciaux (réutilisé côté
  // contrôleur pour les utilisateurs restreints à certains commerciaux).
  computeTotaux(commerciaux) {
    const list = commerciaux || [];
    const caN = list.reduce((s, x) => s + (x.caN || 0), 0);
    const caN1 = list.reduce((s, x) => s + (x.caN1 || 0), 0);
    const margeN = list.reduce((s, x) => s + (x.margeN || 0), 0);
    const margeN1 = list.reduce((s, x) => s + (x.margeN1 || 0), 0);
    const nbFactures = list.reduce((s, x) => s + (x.nbFactures || 0), 0);
    const nbClients = list.reduce((s, x) => s + (x.nbClients || 0), 0);
    const nbFacturesN1 = list.reduce((s, x) => s + (x.nbFacturesN1 || 0), 0);
    const nbClientsCroissance = list.reduce(
      (s, x) => s + (x.nbClientsCroissance || 0),
      0,
    );
    const nbClientsBaisse = list.reduce(
      (s, x) => s + (x.nbClientsBaisse || 0),
      0,
    );
    const nbClientsNouveaux = list.reduce(
      (s, x) => s + (x.nbClientsNouveaux || 0),
      0,
    );
    const nbClientsPerdus = list.reduce(
      (s, x) => s + (x.nbClientsPerdus || 0),
      0,
    );
    // Meilleur commercial du périmètre (liste triée ou non)
    const top = list.reduce(
      (best, x) => (best === null || (x.caN || 0) > best.caN ? x : best),
      null,
    );
    return {
      caN,
      caN1,
      evolCa: this.evol(caN, caN1),
      margeN,
      margeN1,
      evolMarge: this.evol(margeN, margeN1),
      pctMarge: caN !== 0 ? (margeN / caN) * 100 : 0,
      pctMargeN1: caN1 !== 0 ? (margeN1 / caN1) * 100 : 0,
      nbCommerciaux: list.length,
      nbFactures,
      nbClients,
      panierMoyen: nbFactures !== 0 ? caN / nbFactures : 0,
      caMoyenParClient: nbClients !== 0 ? caN / nbClients : 0,
      nbFacturesN1,
      evolNbFactures: this.evol(nbFactures, nbFacturesN1),
      nbClientsCroissance,
      nbClientsBaisse,
      nbClientsNouveaux,
      nbClientsPerdus,
      topCommercial: top
        ? { code: top.code, nom: top.nom, caN: top.caN }
        : null,
    };
  }

  // --- Construction de l'analyse complète ------------------------------------

  async buildAnalyse(entreprise) {
    const today = new Date();
    const anneeN = today.getFullYear();
    const anneeN1 = anneeN - 1;
    // Bornage N-1 à la même date que N (comparaison year-to-date) :
    // on ne compte N-1 que jusqu'au jour/mois d'aujourd'hui.
    const cutoffMonth = today.getMonth() + 1;
    const cutoffDay = today.getDate();

    const [clientCache, factureCache] = await Promise.all([
      clientCacheService.getClients(entreprise),
      factureCacheService.getFactures(entreprise),
    ]);

    const clients = clientCache.records || [];
    const factures = factureCache.factureRecords || [];

    // 1) Noms des commerciaux depuis les vendeurs de l'entreprise
    const nomsCommerciaux = new Map(); // code(int) -> "NOM Prénom"
    const vendeurs = Array.isArray(entreprise.vendeurs) ? entreprise.vendeurs : [];
    vendeurs.forEach((v) => {
      const code = this.repCode(v.code);
      if (code === 0) return;
      const nom = [v.nom, v.prenom].filter(Boolean).join(" ").trim();
      nomsCommerciaux.set(code, nom || `Commercial ${code}`);
    });

    // 2) Agrégation des factures par TIERS (année N et N-1)
    //    byTiers[tiers] = {
    //      N:  { ca, marge, nb, byRepCa:Map, byRepNb:Map, mois:[12] },
    //      N1: { ca, marge, nb }
    //    }
    const byTiers = new Map();
    // Totaux de CA réalisé par chaque représentant (année N), tous clients confondus
    const caParRepGlobalN = new Map(); // repCode -> ca

    const emptyAgg = () => ({
      N: {
        ca: 0,
        marge: 0,
        nb: 0,
        byRepCa: new Map(),
        byRepNb: new Map(),
        mois: new Array(12).fill(0),
      },
      N1: { ca: 0, marge: 0, nb: 0, mois: new Array(12).fill(0) },
    });

    for (let i = 0; i < factures.length; i += 1) {
      const f = factures[i];
      const typ = (f.TYPFACT ? String(f.TYPFACT).trim().toUpperCase() : "");
      if (typ !== "A" && typ !== "F") continue;

      const ym = this.parseYM(f.DATFACT);
      if (!ym) continue;
      if (ym.year !== anneeN && ym.year !== anneeN1) continue;

      const tiers =
        f.TIERS !== undefined && f.TIERS !== null
          ? String(f.TIERS).trim()
          : "";
      if (!tiers) continue;

      let montant = this.num(f.MONTANT);
      let factrev = this.num(f.FACTREV);
      if (typ === "A") {
        montant = -Math.abs(montant);
        factrev = -Math.abs(factrev);
      }
      const marge = montant - factrev;
      const rep = this.repCode(f.REPRES);

      if (!byTiers.has(tiers)) byTiers.set(tiers, emptyAgg());
      const agg = byTiers.get(tiers);

      if (ym.year === anneeN) {
        agg.N.ca += montant;
        agg.N.marge += marge;
        agg.N.nb += 1;
        agg.N.mois[ym.month - 1] += montant;
        agg.N.byRepCa.set(rep, (agg.N.byRepCa.get(rep) || 0) + montant);
        agg.N.byRepNb.set(rep, (agg.N.byRepNb.get(rep) || 0) + 1);
        caParRepGlobalN.set(rep, (caParRepGlobalN.get(rep) || 0) + montant);
      } else {
        // N-1 borné à la date du jour (comparaison year-to-date)
        const avantArret =
          ym.month < cutoffMonth ||
          (ym.month === cutoffMonth && ym.day <= cutoffDay);
        if (avantArret) {
          agg.N1.ca += montant;
          agg.N1.marge += marge;
          agg.N1.nb += 1;
          agg.N1.mois[ym.month - 1] += montant;
        }
      }
    }

    // 3) Stat par client + regroupement par commercial
    //    commerciaux: Map code -> { code, nom, clients:[], ... }
    const commerciaux = new Map();
    const getCommercial = (code) => {
      if (!commerciaux.has(code)) {
        let nom;
        if (code === 0) nom = "MAGASIN";
        else nom = nomsCommerciaux.get(code) || `Commercial ${code}`;
        commerciaux.set(code, {
          code,
          nom,
          estVendeur: code !== 0 && nomsCommerciaux.has(code),
          clients: [],
          moisN: new Array(12).fill(0),
          moisN1: new Array(12).fill(0),
        });
      }
      return commerciaux.get(code);
    };

    // S'assurer que tous les vendeurs nommés apparaissent même sans client
    nomsCommerciaux.forEach((_, code) => getCommercial(code));

    for (let i = 0; i < clients.length; i += 1) {
      const c = clients[i];
      const tiers =
        c.TIERS !== undefined && c.TIERS !== null ? String(c.TIERS).trim() : "";
      if (!tiers) continue;

      const agg = byTiers.get(tiers);
      if (!agg) continue; // pas de facture N/N-1 -> ignoré (comme le script)
      if (agg.N.nb === 0 && agg.N1.nb === 0) continue;

      const repClient = this.repCode(c.REPRES);

      const caN = agg.N.ca;
      const caN1 = agg.N1.ca;
      const margeN = agg.N.marge;
      const margeN1 = agg.N1.marge;
      const nbN = agg.N.nb;
      const nbN1 = agg.N1.nb;

      // CA réalisé par le commercial attitré sur CE client (année N) vs autres
      const caParSoiN = agg.N.byRepCa.get(repClient) || 0;
      const caAutresN = caN - caParSoiN;
      const nbParSoiN = agg.N.byRepNb.get(repClient) || 0;

      const stat = {
        tiers,
        nomTiers:
          c.NOM !== undefined && c.NOM !== null ? String(c.NOM).trim() : "",
        categorie:
          c.CATEGORIE !== undefined && c.CATEGORIE !== null
            ? String(c.CATEGORIE).trim()
            : "",
        profes:
          c.PROFES !== undefined && c.PROFES !== null
            ? String(c.PROFES).trim()
            : "",
        remise: this.num(c.REMISE),
        caN,
        caN1,
        evolCA: this.evol(caN, caN1),
        margeN,
        margeN1,
        evolMarge: this.evol(margeN, margeN1),
        pctMarge: caN !== 0 ? (margeN / caN) * 100 : 0,
        nbFacture: nbN,
        nbFactureN1: nbN1,
        evolNbFact: this.evol(nbN, nbN1),
        // % des factures (année N) du client réalisées par son commercial attitré
        tauxFacturation: nbN > 0 ? (nbParSoiN / nbN) * 100 : 0,
        caParSoiN,
        caAutresN,
        tauxContribution: 0, // calculé ensuite (relatif au commercial)
        mois: agg.N.mois.slice(),
      };

      const com = getCommercial(repClient);
      com.clients.push(stat);
      for (let m = 0; m < 12; m += 1) com.moisN[m] += agg.N.mois[m];
      for (let m = 0; m < 12; m += 1) com.moisN1[m] += agg.N1.mois[m];
    }

    // 4) KPI agrégés par commercial + taux de contribution + CA hors portefeuille
    const result = [];
    commerciaux.forEach((com) => {
      const caN = com.clients.reduce((s, x) => s + x.caN, 0);
      const caN1 = com.clients.reduce((s, x) => s + x.caN1, 0);
      const margeN = com.clients.reduce((s, x) => s + x.margeN, 0);
      const margeN1 = com.clients.reduce((s, x) => s + x.margeN1, 0);
      const nbFactures = com.clients.reduce((s, x) => s + x.nbFacture, 0);
      const caParSoiN = com.clients.reduce((s, x) => s + x.caParSoiN, 0);
      const caAutresN = com.clients.reduce((s, x) => s + x.caAutresN, 0);

      // Taux de contribution = CA client / CA total du portefeuille
      com.clients.forEach((x) => {
        x.tauxContribution = caN !== 0 ? (x.caN / caN) * 100 : 0;
      });
      // Tri par CA décroissant
      com.clients.sort((a, b) => b.caN - a.caN);

      // CA total réellement facturé par ce commercial (tous clients, même hors portefeuille)
      const caTotalRealiseN = caParRepGlobalN.get(com.code) || 0;
      const caHorsPortefeuilleN = caTotalRealiseN - caParSoiN;

      // KPI additionnels du portefeuille
      const nbFacturesN1 = com.clients.reduce((s2, x) => s2 + x.nbFactureN1, 0);
      // Segmentation des clients (N vs N-1 à date) :
      //   nouveaux = pas de CA N-1 mais du CA N ; perdus = l'inverse ;
      //   croissance / baisse = clients actifs sur les deux périodes.
      let nbClientsCroissance = 0;
      let nbClientsBaisse = 0;
      let nbClientsNouveaux = 0;
      let nbClientsPerdus = 0;
      com.clients.forEach((x) => {
        if (x.caN1 === 0 && x.caN > 0) nbClientsNouveaux += 1;
        else if (x.caN === 0 && x.caN1 > 0) nbClientsPerdus += 1;
        else if (x.caN > x.caN1) nbClientsCroissance += 1;
        else if (x.caN < x.caN1) nbClientsBaisse += 1;
      });
      // Clients déjà triés par CA décroissant -> le 1er est le top client
      const topClient = com.clients.length
        ? {
            tiers: com.clients[0].tiers,
            nomTiers: com.clients[0].nomTiers,
            caN: com.clients[0].caN,
          }
        : null;

      result.push({
        code: com.code,
        nom: com.nom,
        estVendeur: com.estVendeur,
        nbClients: com.clients.length,
        caN,
        caN1,
        evolCA: this.evol(caN, caN1),
        margeN,
        margeN1,
        evolMarge: this.evol(margeN, margeN1),
        pctMarge: caN !== 0 ? (margeN / caN) * 100 : 0,
        pctMargeN1: caN1 !== 0 ? (margeN1 / caN1) * 100 : 0,
        nbFactures,
        nbFacturesN1,
        evolNbFactures: this.evol(nbFactures, nbFacturesN1),
        panierMoyen: nbFactures !== 0 ? caN / nbFactures : 0,
        caMoyenParClient:
          com.clients.length !== 0 ? caN / com.clients.length : 0,
        nbClientsCroissance,
        nbClientsBaisse,
        nbClientsNouveaux,
        nbClientsPerdus,
        topClient,
        // Comparaison portefeuille
        caParSoiN, // CA réalisé par le commercial sur SON portefeuille
        caAutresN, // CA capté par d'autres représentants sur son portefeuille
        tauxFacturation: caN !== 0 ? (caParSoiN / caN) * 100 : 0,
        caTotalRealiseN, // CA total facturé par ce commercial (tous clients)
        caHorsPortefeuilleN, // ventes faites hors de son portefeuille
        moisN: com.moisN,
        moisN1: com.moisN1,
        clients: com.clients,
      });
    });

    // Tri des commerciaux par CA décroissant
    result.sort((a, b) => b.caN - a.caN);

    return {
      nomDossierDBF: entreprise.nomDossierDBF,
      anneeN,
      anneeN1,
      mois: MOIS,
      // Date d'arrêt du comparatif N-1 (jour/mois d'aujourd'hui)
      dateArret: `${String(cutoffDay).padStart(2, "0")}/${String(cutoffMonth).padStart(2, "0")}`,
      generatedAt: new Date().toISOString(),
      totaux: this.computeTotaux(result),
      commerciaux: result,
    };
  }

  // --- Cache -----------------------------------------------------------------

  async getAnalyse(entreprise) {
    const key = entreprise.nomDossierDBF;
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.builtAt < this.cacheTTL) {
      return cached.data;
    }
    // Verrou simple pour éviter les calculs concurrents
    if (this.locks.has(key)) return this.locks.get(key);

    const promise = (async () => {
      const data = await this.buildAnalyse(entreprise);
      this.cache.set(key, { data, builtAt: Date.now() });
      this.locks.delete(key);
      return data;
    })();
    this.locks.set(key, promise);
    return promise;
  }

  // Résumé : commerciaux sans la liste détaillée des clients (payload léger)
  async getCommerciauxSummary(entreprise) {
    const analyse = await this.getAnalyse(entreprise);
    return {
      ...analyse,
      commerciaux: analyse.commerciaux.map(({ clients, ...rest }) => ({
        ...rest,
        // on garde juste le nb de clients (déjà présent) — pas la liste
      })),
    };
  }

  // Détail d'un commercial (avec ses clients)
  async getCommercialDetail(entreprise, code) {
    const analyse = await this.getAnalyse(entreprise);
    const c = parseInt(code, 10);
    const com = analyse.commerciaux.find((x) => x.code === c);
    if (!com) return null;
    return {
      nomDossierDBF: analyse.nomDossierDBF,
      anneeN: analyse.anneeN,
      anneeN1: analyse.anneeN1,
      mois: analyse.mois,
      dateArret: analyse.dateArret,
      generatedAt: analyse.generatedAt,
      commercial: com,
    };
  }

  invalidate(nomDossierDBF) {
    this.cache.delete(nomDossierDBF);
  }
}

const commerciauxService = new CommerciauxService();
export default commerciauxService;