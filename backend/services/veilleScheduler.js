// backend/services/veilleScheduler.js
//
// Planificateur du module « Veille ». Toutes les 5 minutes :
//   1. sélectionne les veilles actives dont `prochainRunAt` est échu ;
//   2. les RÉCLAME atomiquement (verrou optimiste sur prochainRunAt) — si deux
//      instances du backend tournent, une seule génère le rapport ;
//   3. lance la génération en tâche de fond (elle dure souvent > 1 min).
//
// Même schéma que reportScheduler.js. Fuseau imposé : Pacific/Noumea.
import cron from "node-cron";
import VeilleConfig, { calculerProchainRun } from "../models/VeilleConfigModel.js";
import VeilleRapport from "../models/VeilleRapportModel.js";
import { lancerGeneration, isConfigured } from "./veilleService.js";

const TIMEZONE = "Pacific/Noumea";
const CADENCE = "*/5 * * * *";
// Les rapports plus vieux que ça sont purgés (la collection stocke du HTML
// complet : sans purge elle gonfle indéfiniment).
const RETENTION_JOURS = 180;

let enCours = false;

export const tourVeille = async (now = new Date()) => {
  if (!isConfigured()) return; // pas de clé OpenAI : rien à faire

  const dues = await VeilleConfig.find({
    actif: true,
    prochainRunAt: { $ne: null, $lte: now },
  });

  for (const config of dues) {
    const precedent = config.prochainRunAt;
    const suivant = calculerProchainRun(config.jour, config.heure, now);

    // Verrou optimiste : ne réussit que si prochainRunAt vaut encore `precedent`.
    // eslint-disable-next-line no-await-in-loop
    const pris = await VeilleConfig.findOneAndUpdate(
      { _id: config._id, prochainRunAt: precedent, actif: true },
      { $set: { prochainRunAt: suivant } },
      { new: true },
    );
    if (!pris) continue; // déjà réclamée par un autre tick / une autre instance

    try {
      // eslint-disable-next-line no-await-in-loop
      await lancerGeneration(pris, "auto");
      console.log(
        `[veille] génération lancée pour « ${pris.nom} » (user ${pris.user})`,
      );
    } catch (e) {
      console.error(`[veille] lancement impossible (${pris._id}) : ${e.message}`);
    }
  }
};

// Purge quotidienne des vieux rapports.
export const purgerAnciensRapports = async () => {
  const limite = new Date(Date.now() - RETENTION_JOURS * 24 * 3600 * 1000);
  const r = await VeilleRapport.deleteMany({ createdAt: { $lt: limite } });
  if (r.deletedCount) {
    console.log(`[veille] purge : ${r.deletedCount} rapport(s) de plus de ${RETENTION_JOURS} j supprimé(s)`);
  }
};

export const startVeilleScheduler = () => {
  cron.schedule(
    CADENCE,
    async () => {
      if (enCours) return;
      enCours = true;
      try {
        await tourVeille();
      } catch (e) {
        console.error("[veille] tour impossible :", e.message);
      } finally {
        enCours = false;
      }
    },
    { timezone: TIMEZONE },
  );

  // Purge une fois par jour, à 3h05 (heure de Nouméa).
  cron.schedule("5 3 * * *", () => purgerAnciensRapports().catch(() => {}), {
    timezone: TIMEZONE,
  });

  console.log(
    isConfigured()
      ? "[veille] planificateur démarré (vérification toutes les 5 min)"
      : "[veille] planificateur démarré mais INACTIF (OPENAI_API_KEY manquant)",
  );
};

export default { startVeilleScheduler, tourVeille, purgerAnciensRapports };
