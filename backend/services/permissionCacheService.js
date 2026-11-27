// backend/services/permissionCacheService.js
//
// Cache TTL COURT des documents Permission et Entreprise lus par les
// middlewares d'accès (27/11/2026).
//
// Pourquoi : Mongo est un Atlas DISTANT — chaque lecture coûte un
// aller-retour réseau. Or la pile d'auth (`checkEntrepriseAccess`,
// `checkModuleAccess`, helpers d'`accessControl`) relisait le MÊME document
// Permission jusqu'à trois fois par requête HTTP, et l'Entreprise à chaque
// fois : 2 à 4 RTT de latence fixe ajoutés à TOUS les appels de l'API.
//
// Sécurité — les règles qui ne se négocient pas :
//   - TTL ≤ 60 s (même politique que TTL_MASQUE de dbfChampsService, déjà en
//     production pour le masque DBF) : un droit RETIRÉ cesse d'agir en une
//     minute au pire, immédiatement quand l'écriture passe par les
//     invalidations ci-dessous. Le cache ne peut jamais élargir un droit
//     au-delà de ce délai.
//   - toute ÉCRITURE de Permission (userControlleur, champsDbfController)
//     appelle `invaliderPermission(userId)` ; toute écriture d'Entreprise
//     (EntrepriseControlleur) appelle `invaliderEntreprise(id)`. Les scripts
//     CLI (seeder, migrations) ne le font pas : le TTL est leur filet.
//
// Formes servies :
//   - Permission : `.lean()` — les consommateurs ne font que LIRE
//     (allEntreprises, entreprises[], modules, analyse, commerciauxScope).
//   - Entreprise : document Mongoose HYDRATÉ — les getters du modèle
//     (cheminBase ↔ DBF_BASE_PATH…) doivent jouer, `.lean()` les perdrait.
//     ⚠️ Document PARTAGÉ entre requêtes : lecture seule stricte (vérifié :
//     aucun contrôleur ne mute ni ne sauve `req.entreprise`).

import Permission from "../models/PermissionModel.js";
import Entreprise from "../models/EntrepriseModel.js";

const TTL = 60 * 1000;

const cachePerm = new Map(); // userId -> { at, permission|null }
const cacheEnt = new Map(); // "id:<id>" | "dossier:<nom>" -> { at, doc|null }

/**
 * Permission d'un utilisateur, en lecture seule (lean), cachée 60 s.
 * « Pas de document Permission » (null) est AUSSI mis en cache : c'est une
 * réponse (admin hérité = super-admin, user = aucun droit).
 */
export const getPermissionLean = async (userId) => {
  const cle = String(userId);
  const hit = cachePerm.get(cle);
  if (hit && Date.now() - hit.at < TTL) return hit.permission;
  const permission = await Permission.findOne({ user: userId }).lean();
  cachePerm.set(cle, { at: Date.now(), permission });
  return permission;
};

/** À appeler après TOUTE écriture de Permission. Sans userId : purge totale. */
export const invaliderPermission = (userId) => {
  if (userId) cachePerm.delete(String(userId));
  else cachePerm.clear();
};

/**
 * Entreprise par id OU par nomDossierDBF, cachée 60 s. Document Mongoose
 * hydraté, PARTAGÉ : à traiter en lecture seule. Un identifiant inconnu
 * (null) est aussi caché — une URL erronée martelée ne doit pas marteler la
 * base.
 */
export const getEntrepriseCachee = async ({ id, nomDossierDBF }) => {
  const cle = id ? `id:${id}` : `dossier:${nomDossierDBF}`;
  const hit = cacheEnt.get(cle);
  if (hit && Date.now() - hit.at < TTL) return hit.doc;
  const doc = id
    ? await Entreprise.findById(id)
    : await Entreprise.findOne({ nomDossierDBF });
  cacheEnt.set(cle, { at: Date.now(), doc });
  // Le même document est joignable par ses deux clés : on remplit l'autre
  // entrée au passage pour qu'une invalidation par id couvre aussi l'accès
  // par dossier (et réciproquement, via la purge des deux clés plus bas).
  if (doc) {
    cacheEnt.set(`id:${doc._id}`, { at: Date.now(), doc });
    if (doc.nomDossierDBF) {
      cacheEnt.set(`dossier:${doc.nomDossierDBF}`, { at: Date.now(), doc });
    }
  }
  return doc;
};

/** À appeler après TOUTE écriture d'Entreprise. Sans argument : purge totale.
 *  La purge est TOTALE même avec un id : le nomDossierDBF a pu changer, et la
 *  collection est minuscule (quelques dizaines de sociétés). */
export const invaliderEntreprise = () => {
  cacheEnt.clear();
};
