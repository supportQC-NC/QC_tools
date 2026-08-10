// backend/services/dbfChampsService.js
//
// Droits « champ par champ » sur les bases DBF.
//
// Principe : l'admin coche, pour une table, les champs AUTORISÉS. Au moment de
// l'enregistrement — seul instant où l'on connaît une société, donc la
// structure réelle du DBF — on calcule et on stocke le COMPLÉMENT, c'est-à-dire
// la liste des champs masqués. Le middleware n'a plus qu'à unir ces listes :
// il n'a besoin d'aucun accès disque et coûte zéro pour un utilisateur non
// restreint.
//
// Le masquage s'applique PAR NOM DE CHAMP sur toutes les réponses de l'API.
// C'est volontairement plus strict que fin : un champ masqué l'est partout où
// ce nom apparaît, ce qui évite qu'un écran oublié laisse fuir la donnée. Un
// champ explicitement autorisé sur une table n'est jamais masqué.

import { DBFFile } from "dbffile";
import path from "path";
import fs from "fs";
import Permission from "../models/PermissionModel.js";
import Entreprise from "../models/EntrepriseModel.js";
import { DBF_TABLE_BY_KEY, DBF_TABLES } from "../config/dbfTables.js";

const TTL_MASQUE = 60 * 1000; // 1 min : un droit retiré s'applique vite
const cacheMasque = new Map(); // userId -> { at, masque:Set|null }

const TTL_CHAMPS = 10 * 60 * 1000;
const cacheChamps = new Map(); // `${dossier}:${table}` -> { at, champs }

/**
 * Champs réellement présents dans le fichier DBF d'une société.
 * @returns {Promise<Array<{ name:string, type:string, size:number }>>}
 */
export const listerChamps = async (entreprise, table) => {
  const def = DBF_TABLE_BY_KEY[table];
  if (!def) throw new Error(`Table DBF inconnue : ${table}`);

  const cle = `${entreprise.nomDossierDBF}:${table}`;
  const enCache = cacheChamps.get(cle);
  if (enCache && Date.now() - enCache.at < TTL_CHAMPS) return enCache.champs;

  const chemin = path.join(
    entreprise.cheminBase,
    entreprise.nomDossierDBF,
    def.fichier,
  );
  if (!fs.existsSync(chemin)) {
    throw new Error(
      `${def.fichier} introuvable pour ${entreprise.nomDossierDBF}.`,
    );
  }

  const dbf = await DBFFile.open(chemin, { readMode: "loose" });
  const champs = dbf.fields.map((f) => ({
    name: f.name,
    type: f.type,
    size: f.size,
  }));

  cacheChamps.set(cle, { at: Date.now(), champs });
  return champs;
};

const TTL_UNION = 10 * 60 * 1000;
const cacheUnion = new Map(); // table -> { at, champs }

/**
 * Champs d'une table, en UNION sur toutes les sociétés actives.
 *
 * Les droits par champ sont GLOBAUX : ils valent pour toutes les sociétés
 * auxquelles l'utilisateur a accès (l'accès société lui-même reste géré par
 * checkEntrepriseAccess — sans accès, il ne voit aucun DBF de la société).
 * La liste proposée à l'admin ne doit donc dépendre d'aucune société en
 * particulier : on prend l'union, sinon un champ présent uniquement dans un
 * dossier serait invisible à la configuration puis masqué par surprise.
 *
 * @returns {Promise<Array<{ name, type, size, societes:number }>>}
 */
export const listerChampsUnion = async (table) => {
  const enCache = cacheUnion.get(table);
  if (enCache && Date.now() - enCache.at < TTL_UNION) return enCache.champs;

  const societes = await Entreprise.find({ isActive: { $ne: false } });
  const parNom = new Map();

  for (const societe of societes) {
    let champs = [];
    try {
      champs = await listerChamps(societe, table);
    } catch {
      continue; // table absente de ce dossier
    }
    for (const c of champs) {
      const cle = c.name.toUpperCase();
      const existant = parNom.get(cle);
      if (existant) existant.societes += 1;
      else parNom.set(cle, { ...c, name: cle, societes: 1 });
    }
  }

  const resultat = [...parNom.values()];
  cacheUnion.set(table, { at: Date.now(), champs: resultat });
  return resultat;
};

/**
 * Normalise la configuration reçue de l'admin et calcule les champs masqués.
 * Le complément est calculé sur l'UNION des structures : un champ qui n'existe
 * que dans certains dossiers est bien couvert.
 *
 * @param {object} config      { table: { mode, champs:[...] } }
 * @returns {Promise<object>}  même forme, `masques` calculé et `champs` nettoyé
 */
export const normaliserConfig = async (config = {}) => {
  const sortie = {};

  for (const t of DBF_TABLES) {
    const regle = config?.[t.key];
    if (!regle || regle.mode !== "liste") continue; // "tous" => rien à stocker

    let existants = [];
    try {
      existants = (await listerChampsUnion(t.key)).map((c) => c.name);
    } catch {
      existants = [];
    }

    const autorises = new Set(
      (regle.champs || []).map((c) => String(c).toUpperCase().trim()).filter(Boolean),
    );
    const masques = existants
      .map((c) => c.toUpperCase())
      .filter((c) => !autorises.has(c));

    sortie[t.key] = {
      mode: "liste",
      champs: [...autorises],
      masques,
    };
  }

  return sortie;
};

/**
 * Masque effectif d'un utilisateur : Set des noms de champs à retirer des
 * réponses, ou null s'il n'a aucune restriction (cas courant).
 */
export const masqueUtilisateur = async (user) => {
  if (!user?._id) return null;

  const cle = String(user._id);
  const enCache = cacheMasque.get(cle);
  if (enCache && Date.now() - enCache.at < TTL_MASQUE) return enCache.masque;

  const permission = await Permission.findOne({ user: user._id })
    .select("champsDbf")
    .lean();
  const config = permission?.champsDbf || {};

  const masque = new Set();
  const autorisesGlobal = new Set();

  for (const t of DBF_TABLES) {
    const regle = config[t.key];
    if (!regle || regle.mode !== "liste") continue;
    for (const c of regle.masques || []) masque.add(String(c).toUpperCase());
    for (const c of regle.champs || []) autorisesGlobal.add(String(c).toUpperCase());
  }

  // Une autorisation explicite sur une table l'emporte sur un masquage venu
  // d'une autre table portant le même nom de champ.
  for (const c of autorisesGlobal) masque.delete(c);

  const resultat = masque.size === 0 ? null : masque;
  cacheMasque.set(cle, { at: Date.now(), masque: resultat });
  return resultat;
};

// À appeler après modification des droits d'un utilisateur.
export const invaliderMasque = (userId) => {
  if (userId) cacheMasque.delete(String(userId));
  else cacheMasque.clear();
};

export default {
  listerChamps,
  listerChampsUnion,
  normaliserConfig,
  masqueUtilisateur,
  invaliderMasque,
};
