// reapproLocalService.js
// -----------------------------------------------------------------------------
// Reappro Local — rapport de réapprovisionnement sur fournisseurs LOCAUX,
// par entreprise. Reproduit le script Python "four_locaux" en lisant les DBF.
//
// Par article :
//   vente_annuelle = Σ|V1..V12|
//   VTE_MOY_MOIS   = (Σ|V| × 30) / (360 − Σ|RUP1..RUP12|)   (repli Σ|V|/12 si ≤0)
//   CA_mois        = PVTE × vente_annuelle / 12   ;  CA_jour = CA_mois / 30
//   REAPPRO        = VTE_MOY_MOIS − STOCK − ENCDE
//   CA PERDU       = REAPPRO × PVTE  (si REAPPRO > 0, sinon 0)
//   A COMMANDER    = max(REAPPRO, 0)
//
// Filtres : NART ne commence pas par "000" ; pour QC on exclut gisements SAV/DOCK ;
//           on ne garde que A COMMANDER ≥ 1 ; puis uniquement fournisseurs LOCAL=O.
//
// Répartition (LOCAL=O) :
//   - GROUPE : AD1 = trigramme d'une entité du groupe -> croisement avec la base
//     article de cette entité (source.REFER = NART chez le fournisseur) :
//     NART FOUR, STOCK FOUR, ENCDE FOUR, STOP FOUR.
//     Exclusion des "arrêtés" : DESIGN fournisseur contient ** ET STOCK FOUR = 0.
//   - AUTRES FOUR LOCAUX : AD1 vide ou hors trigrammes (pas de croisement).
//
// Corrections BDD : REFER vide, ou NART introuvable chez le fournisseur du groupe.
//
// STOCK = ΣS1..S5. PVTE = prix de vente HT.
// -----------------------------------------------------------------------------

import Entreprise from "../models/EntrepriseModel.js";
import articleService from "./articleService.js";
import fournissCacheService from "./fournissCacheService.js";

// AD1 (trigramme) -> nomDossierDBF de l'entité du groupe (repris du script)
const GROUPE_AD1_MAPPING = {
  AVB: "avbimport",
  AW: "allwoods",
  BB: "bourailbricolage",
  DQ: "ducosquincaillerie",
  FMB: "fmb",
  KQ: "quinckone",
  LB: "lebroussard",
  LD: "ld",
  MQ: "meare",
  PB: "paitabricolage",
  QC: "qc",
  QK: "quincailleriekoumac",
  VKP: "quincaillerievkp",
  SIT: "sitec",
};
const GROUPE_TRIGRAMMES = new Set(Object.keys(GROUPE_AD1_MAPPING));

class ReapproLocalService {
  constructor() {
    this.cache = new Map();
    this.cacheTTL = 10 * 60 * 1000;
    this.locks = new Map();
    this.progress = new Map();
    this.supplierIndexCache = new Map(); // ad1 -> { nartIndex } (durée de vie du build)
  }

  // --- Helpers ---------------------------------------------------------------

  safeTrim(v) {
    if (v === null || v === undefined) return "";
    return String(v).trim();
  }

  num(v) {
    if (v === null || v === undefined || v === "") return 0;
    const n = typeof v === "number" ? v : parseFloat(String(v).replace(",", "."));
    return Number.isFinite(n) ? n : 0;
  }

  cleanNart(v) {
    let s = this.safeTrim(v);
    if (s.endsWith(".0")) s = s.slice(0, -2);
    return s;
  }

  venteAnnuelle(a) {
    let s = 0;
    for (let i = 1; i <= 12; i += 1) s += Math.abs(this.num(a[`V${i}`]));
    return s;
  }

  totalRup(a) {
    let s = 0;
    for (let i = 1; i <= 12; i += 1) s += Math.abs(this.num(a[`RUP${i}`]));
    return s;
  }

  stockTotal(a) {
    return (
      this.num(a.S1) + this.num(a.S2) + this.num(a.S3) + this.num(a.S4) + this.num(a.S5)
    );
  }

  vteMoyMois(vAn, rup) {
    const denom = 360 - rup;
    if (denom > 0) return Math.round(((vAn * 30) / denom) * 100) / 100;
    return Math.round((vAn / 12) * 100) / 100;
  }

  gisement(a) {
    return this.safeTrim(a.GISM1) || this.safeTrim(a.EMPLACE);
  }

  yieldLoop() {
    return new Promise((resolve) => setImmediate(resolve));
  }

  setProgress(key, phase, pct, message, extra = {}) {
    this.progress.set(key, {
      phase,
      pct: Math.round(pct),
      message,
      done: false,
      error: false,
      updatedAt: Date.now(),
      ...extra,
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

  // --- Construction du rapport -----------------------------------------------

  async buildReport(entreprise) {
    const key = entreprise.nomDossierDBF;
    const isQC = String(entreprise.nomDossierDBF).toLowerCase() === "qc";

    this.setProgress(key, "articles", 8, "Chargement des articles…");
    const artCache = await articleService.getArticles(entreprise);

    this.setProgress(key, "fourniss", 18, "Chargement des fournisseurs…");
    const fourCache = await fournissCacheService.getFournisseurs(entreprise);

    const articles = artCache.records || [];
    const fournByCode = new Map();
    (fourCache.records || []).forEach((r) => {
      if (r.FOURN !== undefined && r.FOURN !== null) {
        fournByCode.set(String(r.FOURN).trim(), r);
      }
    });

    // 1) Calcul + filtrage + on ne garde que LOCAL=O
    this.setProgress(key, "calcul", 30, "Calcul du réapprovisionnement…");
    const localRows = [];
    for (let i = 0; i < articles.length; i += 1) {
      if (i % 20000 === 0) {
        this.setProgress(
          key,
          "calcul",
          30 + (i / Math.max(1, articles.length)) * 30,
          `Calcul du réapprovisionnement… ${i.toLocaleString("fr-FR")} / ${articles.length.toLocaleString("fr-FR")}`,
        );
        // eslint-disable-next-line no-await-in-loop
        await this.yieldLoop();
      }
      const a = articles[i];
      const nart = this.cleanNart(a.NART);
      if (!nart || nart.startsWith("000")) continue;

      const gis = this.gisement(a);
      if (isQC && (gis.toUpperCase() === "SAV" || gis.toUpperCase() === "DOCK")) {
        continue;
      }

      const vAn = this.venteAnnuelle(a);
      const rup = this.totalRup(a);
      const vmm = this.vteMoyMois(vAn, rup);
      const stock = this.stockTotal(a);
      const encde = this.num(a.ENCDE);
      const pvte = this.num(a.PVTE);
      const reappro = Math.round(vmm - stock - encde);
      if (reappro < 1) continue; // A COMMANDER >= 1

      const fourn =
        a.FOURN !== undefined && a.FOURN !== null
          ? fournByCode.get(String(a.FOURN).trim())
          : null;
      const local = fourn ? this.safeTrim(fourn.LOCAL).toUpperCase() : "";
      if (local !== "O") continue; // fournisseurs locaux uniquement

      const ad1 = fourn ? this.safeTrim(fourn.AD1) : "";
      const caMois = Math.round((pvte * vAn) / 12);

      localRows.push({
        nart,
        design: this.safeTrim(a.DESIGN),
        pvte,
        groupeArt: this.safeTrim(a.GROUPE),
        codtar: this.safeTrim(a.CODTAR),
        refer: this.cleanNart(a.REFER),
        desifrn: this.safeTrim(a.DESIFRN),
        fourLocal: fourn ? this.safeTrim(fourn.NOM) : "",
        ad1,
        vteMoyMois: vmm,
        venteAnnuelle: vAn,
        caMois,
        caJour: Math.round(caMois / 30),
        stock,
        encde,
        reappro,
        caPerdu: reappro > 0 ? Math.round(reappro * pvte) : 0,
        aCommander: Math.max(reappro, 0),
      });
    }

    // 2) Répartition GROUPE / AUTRES
    const groupeRaw = [];
    const autres = [];
    localRows.forEach((r) => {
      const ad1Up = r.ad1.toUpperCase();
      if (r.ad1 !== "" && GROUPE_TRIGRAMMES.has(ad1Up)) groupeRaw.push(r);
      else autres.push(r);
    });

    // 3) Enrichissement GROUPE (croisement base fournisseur)
    this.setProgress(key, "groupe", 65, "Croisement avec les bases fournisseurs…");
    const entreprises = await Entreprise.find({});
    const byDossier = new Map();
    entreprises.forEach((e) => {
      if (e.nomDossierDBF) byDossier.set(String(e.nomDossierDBF).toLowerCase(), e);
    });

    // Index NART des bases fournisseur, par AD1 (chargé une fois)
    const supplierIndex = new Map(); // ad1Up -> Map(nartUpper -> article)
    const loadSupplier = async (ad1Up) => {
      if (supplierIndex.has(ad1Up)) return supplierIndex.get(ad1Up);
      const dossier = GROUPE_AD1_MAPPING[ad1Up];
      const ent = dossier ? byDossier.get(dossier.toLowerCase()) : null;
      if (!ent) {
        supplierIndex.set(ad1Up, null);
        return null;
      }
      try {
        const sc = await articleService.getArticles(ent);
        const idx = new Map();
        (sc.records || []).forEach((sa) => {
          const k = this.cleanNart(sa.NART).toUpperCase();
          if (k && !idx.has(k)) idx.set(k, sa);
        });
        supplierIndex.set(ad1Up, idx);
        return idx;
      } catch (e) {
        supplierIndex.set(ad1Up, null);
        return null;
      }
    };

    const corrections = [];
    const groupe = [];
    const ad1List = [...new Set(groupeRaw.map((r) => r.ad1.toUpperCase()))];
    for (let i = 0; i < ad1List.length; i += 1) {
      this.setProgress(
        key,
        "groupe",
        65 + ((i + 1) / Math.max(1, ad1List.length)) * 25,
        `Croisement fournisseur ${ad1List[i]}…`,
      );
      // eslint-disable-next-line no-await-in-loop
      await loadSupplier(ad1List[i]);
      // eslint-disable-next-line no-await-in-loop
      await this.yieldLoop();
    }

    groupeRaw.forEach((r) => {
      const ad1Up = r.ad1.toUpperCase();
      const idx = supplierIndex.get(ad1Up);
      const dossierFour = GROUPE_AD1_MAPPING[ad1Up] || r.ad1;

      let nartFour = "";
      let stockFour = null;
      let encdeFour = null;
      let stopFour = "";

      if (!r.refer) {
        corrections.push({
          nart: r.nart,
          design: r.design.slice(0, 50),
          ad1: r.ad1,
          fourLocal: r.fourLocal.slice(0, 30),
          refer: "",
          probleme: "REFER VIDE",
          action: `Renseigner le NART de cet article chez ${dossierFour}`,
        });
      } else if (idx) {
        const sa = idx.get(r.refer.toUpperCase());
        if (sa) {
          nartFour = this.cleanNart(sa.NART);
          stockFour = this.stockTotal(sa);
          encdeFour = Math.round(this.num(sa.ENCDE));
          const designFour = this.safeTrim(sa.DESIGN);
          if (designFour.includes("**") && stockFour === 0) stopFour = "A SUPPRIMER";
        } else {
          corrections.push({
            nart: r.nart,
            design: r.design.slice(0, 50),
            ad1: r.ad1,
            fourLocal: r.fourLocal.slice(0, 30),
            refer: r.refer,
            probleme: `NART ${r.refer} introuvable chez ${dossierFour}`,
            action: `Vérifier que REFER=${r.refer} correspond à un NART existant chez le fournisseur`,
          });
        }
      }

      if (!nartFour) {
        nartFour = r.desifrn && r.desifrn.length >= 6 ? r.desifrn.slice(0, 6) : "UNKNOWN";
      }

      // Exclure les arrêtés : STOP FOUR = A SUPPRIMER (DESIGN** + STOCK FOUR = 0)
      if (stopFour === "A SUPPRIMER" && stockFour === 0) return;

      groupe.push({
        ...r,
        nartFour,
        stockFour: stockFour === null ? "" : stockFour,
        encdeFour: encdeFour === null ? "" : encdeFour,
        stopFour,
      });
    });

    this.setProgress(key, "finalize", 95, "Finalisation…");

    const sumCommander = (arr) => arr.reduce((s, x) => s + x.aCommander, 0);
    const sumCaPerdu = (arr) => arr.reduce((s, x) => s + x.caPerdu, 0);

    return {
      nomDossierDBF: entreprise.nomDossierDBF,
      entrepriseNom: entreprise.nomComplet || entreprise.nom || entreprise.nomDossierDBF,
      generatedAt: new Date().toISOString(),
      totaux: {
        nbGroupe: groupe.length,
        nbAutres: autres.length,
        nbCorrections: corrections.length,
        aCommanderGroupe: sumCommander(groupe),
        caPerduGroupe: sumCaPerdu(groupe),
        caPerduAutres: sumCaPerdu(autres),
      },
      groupe,
      autres,
      corrections,
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
        this.setProgress(key, "done", 100, "Terminé", { done: true });
        this.locks.delete(key);
        return data;
      } catch (err) {
        this.setProgress(key, "error", 100, err.message || "Erreur", {
          error: true,
          done: true,
        });
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

const reapproLocalService = new ReapproLocalService();
export default reapproLocalService;