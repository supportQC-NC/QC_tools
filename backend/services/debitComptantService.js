// debitComptantService.js
// -----------------------------------------------------------------------------
// Débit/Comptant — rapport des ventes COMPTANT sur une période de N jours.
// Portage de rapport_commerciaux.py.
//
// ⚠️ facture.dbf (~1.5M) et surtout detail.dbf (~5.8M lignes) sont trop gros pour
// être chargés d'un bloc en mémoire. On lit donc les DBF en STREAMING (par paquets)
// et on ne conserve que l'utile :
//   - facture.dbf : uniquement les factures F / non supprimées / comptant / dans la
//     plage de dates (quelques centaines de lignes) + le set des NUMFACT retenus.
//   - detail.dbf  : on agrège la remise à la volée, uniquement pour les NUMFACT
//     retenus (lignes TYPFACT='F'). Aucune ligne n'est stockée.
//
// Filtre : TYPFACT='F' ; SUPPR!='*' ; DBCPT='C' ; DATFACT dans [debut, fin] ;
//          client dont OBSERV ne contient PAS "COMPTANT" (rapport principal).
// Remise/facture : MONTANT_REMISE = Σ(PVTE-PREV)*QTE ; POURC_MOY = moyenne(POURC).
// Onglet GROUPE : clients CATEGORIE contenant "GROUPE" ayant payé comptant.
// -----------------------------------------------------------------------------

import { DBFFile } from "dbffile";
import path from "path";
import clientCacheService from "./clientCacheService.js";

const DBCPT_COMPTANT = "C";
const CHUNK = 20000;

class DebitComptantService {
  constructor() {
    this.cache = new Map();
    this.cacheTTL = 5 * 60 * 1000;
    this.locks = new Map();
    this.progress = new Map();
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

  dateInt(v) {
    if (v === null || v === undefined || v === "") return null;
    if (v instanceof Date && !Number.isNaN(v.getTime())) {
      return v.getFullYear() * 10000 + (v.getMonth() + 1) * 100 + v.getDate();
    }
    const s = String(v).trim();
    let m = s.match(/^(\d{4})[-/](\d{2})[-/](\d{2})/);
    if (m) return +m[1] * 10000 + +m[2] * 100 + +m[3];
    m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (m) return +m[1] * 10000 + +m[2] * 100 + +m[3];
    m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (m) return +m[3] * 10000 + +m[2] * 100 + +m[1];
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) {
      return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
    }
    return null;
  }

  ymdToInt(ymd) {
    const m = String(ymd).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    return +m[1] * 10000 + +m[2] * 100 + +m[3];
  }

  computeDebut(dateFin, nbJours) {
    const m = String(dateFin).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return dateFin;
    const d = new Date(+m[1], +m[2] - 1, +m[3]);
    d.setDate(d.getDate() - (Math.max(1, nbJours) - 1));
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  intToStr(di) {
    if (!di) return "";
    const p = (n) => String(n).padStart(2, "0");
    return `${p(di % 100)}/${p(Math.floor(di / 100) % 100)}/${Math.floor(di / 10000)}`;
  }

  buildVendeurMap(entreprise) {
    const map = new Map();
    (entreprise.vendeurs || []).forEach((v) => {
      if (v && v.code !== undefined && v.code !== null) {
        const nom = [v.nom, v.prenom].filter(Boolean).join(" ").trim();
        map.set(String(v.code).trim(), nom);
      }
    });
    return map;
  }

  yieldLoop() {
    return new Promise((resolve) => setImmediate(resolve));
  }

  setProgress(key, phase, pct, message) {
    this.progress.set(key, {
      phase,
      pct: Math.round(pct),
      message,
      done: false,
      error: false,
      updatedAt: Date.now(),
    });
  }

  getProgress(key) {
    return (
      this.progress.get(key) || {
        phase: "idle",
        pct: 0,
        message: "",
        done: false,
        error: false,
      }
    );
  }

  // Lit un DBF par paquets ; appelle onRecord(record) pour chaque ligne.
  async streamDbf(dbfPath, onRecord, onChunk) {
    const dbf = await DBFFile.open(dbfPath, { readMode: "loose" });
    const total = dbf.recordCount || 0;
    let processed = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      // eslint-disable-next-line no-await-in-loop
      const rows = await dbf.readRecords(CHUNK);
      if (!rows || rows.length === 0) break;
      for (let i = 0; i < rows.length; i += 1) onRecord(rows[i]);
      processed += rows.length;
      if (onChunk) onChunk(processed, total);
      // eslint-disable-next-line no-await-in-loop
      await this.yieldLoop();
    }
    return total;
  }

  async buildReport(entreprise, dateFin, nbJours, progressKey) {
    const basePath = path.join(entreprise.cheminBase, entreprise.nomDossierDBF);
    const factureDbfPath = path.join(basePath, "facture.dbf");
    const detailDbfPath = path.join(basePath, "detail.dbf");

    const vendeurMap = this.buildVendeurMap(entreprise);

    // --- Clients (petit fichier via le cache existant) ---
    this.setProgress(progressKey, "clients", 5, "Chargement des clients…");
    const clientData = await clientCacheService.getClients(entreprise);
    const clientByTiers = new Map();
    const tiersRetenus = new Set();
    const tiersGroupe = new Set();
    (clientData.records || []).forEach((c) => {
      const tiers = this.safeTrim(c.TIERS);
      if (!tiers) return;
      const observ = this.safeTrim(c.OBSERV);
      const categorie = this.safeTrim(c.CATEGORIE);
      clientByTiers.set(tiers, {
        nom: this.safeTrim(c.NOM),
        categorie,
        observ,
      });
      if (!observ.toUpperCase().includes("COMPTANT")) tiersRetenus.add(tiers);
      if (categorie.toUpperCase().includes("GROUPE")) tiersGroupe.add(tiers);
    });

    const finInt = this.ymdToInt(dateFin);
    const dateDebut = this.computeDebut(dateFin, nbJours);
    const debutInt = this.ymdToInt(dateDebut);

    // --- STREAM facture.dbf : ne garder que F/comptant/non supprimé/plage ---
    this.setProgress(progressKey, "factures", 10, "Lecture des factures…");
    const factRows = []; // {numfact, dateInt, tiers, repres, montant}
    const retained = new Set();
    await this.streamDbf(
      factureDbfPath,
      (f) => {
        if (this.safeTrim(f.TYPFACT).toUpperCase() !== "F") return;
        if (this.safeTrim(f.SUPPR) === "*") return;
        if (this.safeTrim(f.DBCPT).toUpperCase() !== DBCPT_COMPTANT) return;
        const di = this.dateInt(f.DATFACT);
        if (di === null || di < debutInt || di > finInt) return;
        const numfact = this.safeTrim(f.NUMFACT);
        if (!numfact) return;
        factRows.push({
          numfact,
          dateInt: di,
          tiers: this.safeTrim(f.TIERS),
          repres: this.safeTrim(f.REPRES),
          montant: this.num(f.MONTANT),
        });
        retained.add(numfact);
      },
      (processed, total) => {
        const pct = total ? 10 + (processed / total) * 35 : 25;
        this.setProgress(
          progressKey,
          "factures",
          pct,
          `Lecture des factures… ${processed.toLocaleString("fr-FR")} / ${total.toLocaleString("fr-FR")}`,
        );
      },
    );

    // --- STREAM detail.dbf : agrège la remise pour les NUMFACT retenus ---
    this.setProgress(progressKey, "detail", 45, "Lecture des lignes de détail…");
    const remiseMap = new Map(); // numfact -> {mr, sp, n}
    if (retained.size > 0) {
      await this.streamDbf(
        detailDbfPath,
        (l) => {
          const numfact = this.safeTrim(l.NUMFACT);
          if (!numfact || !retained.has(numfact)) return;
          if (this.safeTrim(l.TYPFACT).toUpperCase() !== "F") return;
          const mr = (this.num(l.PVTE) - this.num(l.PREV)) * this.num(l.QTE);
          let e = remiseMap.get(numfact);
          if (!e) {
            e = { mr: 0, sp: 0, n: 0 };
            remiseMap.set(numfact, e);
          }
          e.mr += mr;
          e.sp += this.num(l.POURC);
          e.n += 1;
        },
        (processed, total) => {
          const pct = total ? 45 + (processed / total) * 45 : 70;
          this.setProgress(
            progressKey,
            "detail",
            pct,
            `Lecture du détail… ${processed.toLocaleString("fr-FR")} / ${total.toLocaleString("fr-FR")}`,
          );
        },
      );
    }

    // --- Construction des lignes ---
    this.setProgress(progressKey, "agg", 92, "Agrégation…");
    const detailFactures = [];
    const groupeFactures = [];
    factRows.forEach((f) => {
      const cli = clientByTiers.get(f.tiers) || {};
      const rem = remiseMap.get(f.numfact);
      const montantRemise = rem ? Math.round(rem.mr) : 0;
      const pourcMoy = rem && rem.n > 0 ? rem.sp / rem.n : 0;
      const base = {
        numfact: f.numfact,
        dateInt: f.dateInt,
        date: this.intToStr(f.dateInt),
        tiers: f.tiers,
        nom: cli.nom || "Client inconnu",
        observ: cli.observ || "",
        categorie: cli.categorie || "",
        repres: f.repres,
        vendeurNom: vendeurMap.get(f.repres) || "",
        montant: f.montant,
        montantRemise,
        pourcMoy,
      };
      if (tiersRetenus.has(f.tiers)) detailFactures.push(base);
      if (tiersGroupe.has(f.tiers)) groupeFactures.push(base);
    });

    // --- Agrégations vendeur / client ---
    const recapVendeurMap = new Map();
    const recapClientMap = new Map();
    detailFactures.forEach((r) => {
      let v = recapVendeurMap.get(r.repres);
      if (!v) {
        v = { repres: r.repres, vendeurNom: r.vendeurNom, nbFactures: 0, montantTotal: 0, remiseValeur: 0, _sp: 0 };
        recapVendeurMap.set(r.repres, v);
      }
      v.nbFactures += 1;
      v.montantTotal += r.montant;
      v.remiseValeur += r.montantRemise;
      v._sp += r.pourcMoy;

      let c = recapClientMap.get(r.tiers);
      if (!c) {
        c = { tiers: r.tiers, nom: r.nom, nbFactures: 0, montantTotal: 0, remiseValeur: 0, _sp: 0 };
        recapClientMap.set(r.tiers, c);
      }
      c.nbFactures += 1;
      c.montantTotal += r.montant;
      c.remiseValeur += r.montantRemise;
      c._sp += r.pourcMoy;
    });

    const finalize = (arr) =>
      arr
        .map((x) => ({
          ...x,
          montantTotal: Math.round(x.montantTotal),
          remiseValeur: Math.round(x.remiseValeur),
          remisePctMoy: x.nbFactures > 0 ? Math.round((x._sp / x.nbFactures) * 100) / 100 : 0,
          _sp: undefined,
        }))
        .sort((a, b) => b.montantTotal - a.montantTotal);

    const recapVendeur = finalize([...recapVendeurMap.values()]);
    const recapClient = finalize([...recapClientMap.values()]);

    const recapGroupeMap = new Map();
    groupeFactures.forEach((r) => {
      let g = recapGroupeMap.get(r.tiers);
      if (!g) {
        g = { tiers: r.tiers, nom: r.nom, categorie: r.categorie, observ: r.observ, nbFactures: 0, montantTotal: 0 };
        recapGroupeMap.set(r.tiers, g);
      }
      g.nbFactures += 1;
      g.montantTotal += r.montant;
    });
    const recapGroupe = [...recapGroupeMap.values()]
      .map((g) => ({ ...g, montantTotal: Math.round(g.montantTotal) }))
      .sort((a, b) => b.montantTotal - a.montantTotal);

    const detail = detailFactures.slice().sort((a, b) => {
      if (a.repres !== b.repres) return a.repres < b.repres ? -1 : 1;
      return a.numfact < b.numfact ? -1 : a.numfact > b.numfact ? 1 : 0;
    });

    return {
      nomDossierDBF: entreprise.nomDossierDBF,
      entrepriseNom: entreprise.nomComplet || entreprise.nom || entreprise.nomDossierDBF,
      periode: {
        dateDebut,
        dateFin,
        nbJours,
        txt: `du ${this.intToStr(debutInt)} au ${this.intToStr(finInt)}`,
      },
      totaux: {
        nbFactures: detailFactures.length,
        montantTotal: recapVendeur.reduce((s, x) => s + x.montantTotal, 0),
        remiseTotal: recapVendeur.reduce((s, x) => s + x.remiseValeur, 0),
        nbVendeurs: recapVendeur.length,
        nbClients: recapClient.length,
        nbGroupe: recapGroupe.length,
      },
      recapVendeur,
      recapClient,
      detailFactures: detail,
      recapGroupe,
      generatedAt: new Date().toISOString(),
    };
  }

  async getReport(entreprise, dateFin, nbJours) {
    const key = `${entreprise.nomDossierDBF}_${dateFin}_${nbJours}`;
    const progressKey = entreprise.nomDossierDBF;
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.builtAt < this.cacheTTL) return cached.data;
    if (this.locks.has(key)) return this.locks.get(key);

    const promise = (async () => {
      try {
        const data = await this.buildReport(entreprise, dateFin, nbJours, progressKey);
        this.cache.set(key, { data, builtAt: Date.now() });
        this.setProgress(progressKey, "done", 100, "Terminé");
        this.progress.set(progressKey, { ...this.getProgress(progressKey), done: true });
        this.locks.delete(key);
        return data;
      } catch (err) {
        this.setProgress(progressKey, "error", 100, err.message || "Erreur");
        this.progress.set(progressKey, { ...this.getProgress(progressKey), done: true, error: true });
        this.locks.delete(key);
        throw err;
      }
    })();
    this.locks.set(key, promise);
    return promise;
  }

  invalidate(nomDossierDBF) {
    if (!nomDossierDBF) {
      this.cache.clear();
      return;
    }
    [...this.cache.keys()]
      .filter((k) => k.startsWith(`${nomDossierDBF}_`))
      .forEach((k) => this.cache.delete(k));
  }
}

const debitComptantService = new DebitComptantService();
export default debitComptantService;