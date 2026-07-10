// backend/config/reportRegistry.js
//
// Registre des rapports envoyables par email.
// Chaque entrée : clé stable, module de permission requis (re-vérifié à l'envoi),
// périodes supportées, et generate(entreprise, { periode, now }) -> { buffer, filename }.
//
// - analyse_ca a un générateur Excel dédié (mise en forme soignée).
// - les autres passent par le générateur générique multi-onglets (export de données).
//
// Exclus du menu Analyse (raisons techniques) :
//   • Filiales        -> périmètre par RÉSEAU (DQ/QC/LD), pas par entreprise.
//   • Performance Dock-> dossier serveur fixe, non lié à une entreprise.
//   • Collecteurs     -> gestion d'appareils, ce n'est pas un rapport daté.

import analyseCaGenerator from "../services/analyseCaGenerator.js";
import factureAnalyseService from "../services/factureAnalyseService.js";
import topArticlesService from "../services/topArticlesService.js";
import journalCaisseService from "../services/journalCaisseService.js";
import debitComptantService from "../services/debitComptantService.js";
import reapproLocalService from "../services/reapproLocalService.js";
import gencodDoublonsService from "../services/gencodDoublonsService.js";
import commerciauxService from "../services/commerciauxService.js";
import { autoSheets, buildTabularExcel } from "../services/genericReportExcel.js";
import { generateJournalCaisse } from "../services/journalCaisseReport.js";

// ── Helpers de période (heure locale serveur = Nouméa) ───────────────────────
const pad = (n) => String(n).padStart(2, "0");
const dstr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function monthRange(now, periode) {
  const enCours = periode === "mois_en_cours";
  const base = enCours ? now : new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const y = base.getFullYear();
  const m = base.getMonth();
  const debut = new Date(y, m, 1);
  const fin = enCours ? new Date(now) : new Date(y, m + 1, 0);
  return { dateDebut: dstr(debut), dateFin: dstr(fin) };
}

function ymCoupure(now, periode) {
  const base =
    periode === "mois_en_cours"
      ? now
      : new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${base.getFullYear()}-${pad(base.getMonth() + 1)}`;
}

function dayStr(now, periode) {
  const d =
    periode === "jour_meme"
      ? new Date(now)
      : new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  return dstr(d);
}

function debitParams(now, periode) {
  if (periode === "mois_en_cours") {
    const fin = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    return { dateFin: dstr(fin), nbJours: Math.max(1, now.getDate() - 1) };
  }
  // mois_precedent : tout le mois précédent
  const fin = new Date(now.getFullYear(), now.getMonth(), 0); // dernier jour mois préc.
  return { dateFin: dstr(fin), nbJours: fin.getDate() };
}

const MOIS = ["mois_precedent", "mois_en_cours"];

export const REPORT_REGISTRY = {
  analyse_ca: {
    key: "analyse_ca",
    label: "Analyse CA",
    moduleKey: "analyse_ca_admin",
    disponible: true,
    periodes: MOIS,
    periodeDefaut: "mois_precedent",
    async generate(entreprise, { periode, now }) {
      const { buffer, filename } = await analyseCaGenerator.generer(
        entreprise,
        ymCoupure(now, periode),
      );
      return { buffer, filename };
    },
  },

  facture_analyse: {
    key: "facture_analyse",
    label: "Analyse Facturation",
    moduleKey: "facture_analyse_admin",
    disponible: true,
    periodes: MOIS,
    periodeDefaut: "mois_precedent",
    async generate(entreprise, { periode, now }) {
      const { dateDebut, dateFin } = monthRange(now, periode);
      const data = await factureAnalyseService.analyser(entreprise, dateDebut, dateFin);
      return buildTabularExcel("Analyse Facturation", autoSheets(data), now);
    },
  },

  top_articles: {
    key: "top_articles",
    label: "Top Articles",
    moduleKey: "top_articles_admin",
    disponible: true,
    periodes: MOIS,
    periodeDefaut: "mois_precedent",
    async generate(entreprise, { periode, now }) {
      const { dateDebut, dateFin } = monthRange(now, periode);
      const data = await topArticlesService.analyser(entreprise, dateDebut, dateFin);
      return buildTabularExcel("Top Articles", autoSheets(data), now);
    },
  },

  journal_caisse: {
    key: "journal_caisse",
    label: "Journal de Caisse",
    moduleKey: "journal_caisse_admin",
    disponible: true,
    periodes: ["jour_precedent", "jour_meme"],
    periodeDefaut: "jour_precedent",
    async generate(entreprise, { periode, now }) {
      const data = await journalCaisseService.getJournal(entreprise, dayStr(now, periode));
      // Générateur dédié : Excel (3 onglets) + PDF, fidèles à l'écran.
      return generateJournalCaisse(entreprise, data, now);
    },
  },

  debit_comptant: {
    key: "debit_comptant",
    label: "Débit / Comptant",
    moduleKey: "debit_comptant_admin",
    disponible: true,
    periodes: MOIS,
    periodeDefaut: "mois_precedent",
    async generate(entreprise, { periode, now }) {
      const { dateFin, nbJours } = debitParams(now, periode);
      const data = await debitComptantService.getReport(entreprise, dateFin, nbJours);
      return buildTabularExcel("Debit Comptant", autoSheets(data), now);
    },
  },

  reappro_local: {
    key: "reappro_local",
    label: "Reappro Local",
    moduleKey: "reappro_local_admin",
    disponible: true,
    periodes: ["actuel"],
    periodeDefaut: "actuel",
    async generate(entreprise, { now }) {
      const data = await reapproLocalService.getReport(entreprise);
      return buildTabularExcel("Reappro Local", autoSheets(data), now);
    },
  },

  gencod_doublons: {
    key: "gencod_doublons",
    label: "Doublons GENCODE",
    moduleKey: "gencod_doublons_admin",
    disponible: true,
    periodes: ["actuel"],
    periodeDefaut: "actuel",
    async generate(entreprise, { now }) {
      const data = await gencodDoublonsService.getReport(entreprise);
      return buildTabularExcel("Doublons GENCODE", autoSheets(data), now);
    },
  },

  commerciaux: {
    key: "commerciaux",
    label: "Analyse Commerciaux",
    moduleKey: "commerciaux_admin",
    disponible: true,
    periodes: ["actuel"],
    periodeDefaut: "actuel",
    async generate(entreprise, { now }) {
      const data = await commerciauxService.getCommerciauxSummary(entreprise);
      return buildTabularExcel("Analyse Commerciaux", autoSheets(data), now);
    },
  },
};

// Tous les rapports actuellement envoyables.
export function listReports() {
  return Object.values(REPORT_REGISTRY).filter((r) => r.disponible);
}

// Récupère une entrée (ou null) par clé.
export function getReport(key) {
  return REPORT_REGISTRY[key] || null;
}

export default REPORT_REGISTRY;