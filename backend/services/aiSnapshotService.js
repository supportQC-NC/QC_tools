// backend/services/aiSnapshotService.js
//
// Pré-calcul des ventes (12 derniers mois) par société → snapshots Mongo lus par
// l'assistant IA pour des réponses INSTANTANÉES sur CA / meilleures ventes.
// Rafraîchi chaque nuit (node-cron, TZ Pacific/Noumea).
import cron from "node-cron";
import Entreprise from "../models/EntrepriseModel.js";
import AiSalesSnapshot from "../models/AiSalesSnapshotModel.js";
import topArticlesService from "./topArticlesService.js";

const FRESH_MS = 48 * 60 * 60 * 1000; // un snapshot < 48 h est considéré frais

const ymd = (d) => d.toISOString().slice(0, 10);
const rollingPeriod = () => {
  const fin = new Date();
  const debut = new Date();
  debut.setMonth(debut.getMonth() - 12);
  return { debut: ymd(debut), fin: ymd(fin) };
};

// Recalcule et enregistre le snapshot d'UNE société (12 derniers mois).
export const refreshCompany = async (entreprise) => {
  const { debut, fin } = rollingPeriod();
  const res = await topArticlesService.analyser(entreprise, debut, fin);
  await AiSalesSnapshot.findOneAndUpdate(
    { entreprise: entreprise._id },
    {
      entreprise: entreprise._id,
      debut,
      fin,
      totaux: res.totaux,
      topCa: (res.topCa || []).slice(0, 25),
      topQte: (res.topQte || []).slice(0, 25),
      computedAt: new Date(),
    },
    { upsert: true },
  );
  return { debut, fin, total: res.totaux?.caTotal };
};

// Recalcule toutes les sociétés (séquentiel : évite de saturer le disque DBF).
export const refreshAll = async () => {
  const list = await Entreprise.find({});
  let ok = 0;
  for (const e of list) {
    try {
      await refreshCompany(e);
      ok += 1;
    } catch (err) {
      console.warn(`[aiSnapshot] ${e.nomDossierDBF} : ${err.message}`);
    }
  }
  console.log(`[aiSnapshot] ${ok}/${list.length} sociétés rafraîchies.`);
  return ok;
};

// Snapshot frais d'une société (ou null).
export const getFreshSnapshot = async (entreprise) => {
  const snap = await AiSalesSnapshot.findOne({ entreprise: entreprise._id }).lean();
  if (!snap || !snap.computedAt) return null;
  if (Date.now() - new Date(snap.computedAt).getTime() > FRESH_MS) return null;
  return snap;
};

// Cron nocturne (03:15, Pacific/Noumea).
export const startAiSnapshotScheduler = () => {
  cron.schedule(
    "15 3 * * *",
    () => {
      refreshAll().catch((e) => console.warn("[aiSnapshot] cron:", e.message));
    },
    { timezone: "Pacific/Noumea" },
  );
  console.log("🕒 Snapshot ventes IA planifié (03:15 Pacific/Noumea).");
};

export default { refreshCompany, refreshAll, getFreshSnapshot, startAiSnapshotScheduler };
