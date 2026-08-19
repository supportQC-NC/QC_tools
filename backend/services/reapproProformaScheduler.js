// backend/services/reapproProformaScheduler.js
//
// Job horaire : balaye les proformas de chaque société et crée les listes de
// réappro correspondantes (voir reapproProformaImportService.js pour la règle
// d'éligibilité). Démarré depuis server.js.
//
// Les sociétés sont traitées EN SÉRIE : le cache proforma (proforma.dbf +
// prodet.dbf) est lourd à froid, les paralléliser ferait tout charger en même
// temps. Un verrou empêche deux passages de se chevaucher si un tour déborde.
import cron from "node-cron";
import Entreprise from "../models/EntrepriseModel.js";
import { importerProformasReappro } from "./reapproProformaImportService.js";

let enCours = false;

export const tourImportProformas = async () => {
  if (enCours) {
    console.log("[reapproProforma] tour précédent encore en cours — passage ignoré");
    return;
  }
  enCours = true;
  const debut = Date.now();
  try {
    const entreprises = await Entreprise.find({ isActive: true });
    let totalCrees = 0;
    let totalMajs = 0;
    let totalSupprimes = 0;

    for (const entreprise of entreprises) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const r = await importerProformasReappro(entreprise);
        totalCrees += r.crees;
        totalMajs += r.majs;
        totalSupprimes += r.supprimes;
        if (r.crees || r.majs || r.supprimes) {
          console.log(
            `[reapproProforma] ${entreprise.nomDossierDBF}: ${r.crees} créée(s), ` +
              `${r.majs} maj, ${r.supprimes} supprimée(s) (${r.candidats} candidat(s), ${r.dureeMs}ms)`,
          );
        }
      } catch (e) {
        console.error(
          `[reapproProforma] ${entreprise.nomDossierDBF}: ${e.message}`,
        );
      }
    }

    if (totalCrees || totalMajs || totalSupprimes) {
      console.log(
        `[reapproProforma] tour terminé en ${Date.now() - debut}ms — ` +
          `${totalCrees} créée(s), ${totalMajs} maj, ${totalSupprimes} supprimée(s)`,
      );
    }
  } catch (e) {
    console.error("[reapproProforma] tour impossible:", e.message);
  } finally {
    enCours = false;
  }
};

export const startReapproProformaScheduler = () => {
  // Toutes les heures à la minute 5 (hors des minutes rondes déjà chargées).
  cron.schedule("5 * * * *", tourImportProformas, {
    timezone: "Pacific/Noumea",
  });
  console.log(
    "[reapproProforma] planificateur démarré (import horaire des proformas « reappro »)",
  );
};

export default { startReapproProformaScheduler, tourImportProformas };
