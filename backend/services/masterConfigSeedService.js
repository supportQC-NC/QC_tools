// backend/services/masterConfigSeedService.js
//
// Logique d'import du « Socle config rapports » (master report), réutilisable
// par le CLI (seedMasterConfig.js) ET par l'endpoint « Importer la config »
// (bouton dans le hub /admin/config-rapports).
//
// NON-DESTRUCTIF : n'écrit QUE ce qui est absent.
//   - collections dédiées : upsert `$setOnInsert` (les documents existants ne
//     sont jamais modifiés) ;
//   - champs Entreprise : remplis uniquement s'ils sont VIDES (Map size 0,
//     tableau length 0, chaîne "").
// Idempotent : un 2e run ne touche pas ce qui a déjà une valeur.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import Entreprise from "../models/EntrepriseModel.js";
import AbonnementRapportClient from "../models/masterConfig/AbonnementRapportClientModel.js";
import GroupePrioritaire from "../models/masterConfig/GroupePrioritaireModel.js";
import GroupeSpecial from "../models/masterConfig/GroupeSpecialModel.js";
import MailCompta from "../models/masterConfig/MailComptaModel.js";
import ListEnvoiFactAuto from "../models/masterConfig/ListEnvoiFactAutoModel.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, "..", "data", "masterConfig");
const load = (file) =>
  JSON.parse(fs.readFileSync(path.join(DATA, file), "utf-8"));

// Les Access « master report » identifient chaque société par un CODE interne
// (colonne Societe / ET / idSociete) qui NE correspond PAS toujours au
// `trigramme` de l'Entreprise en base. Cette table traduit code Access ->
// trigramme. Sans elle, KONE/MEARE/SITEC et les magasins Broussard seraient
// « ignorés » au seed. Un code absent de la table retombe sur lui-même
// (AVB/AW/FMB/HD/LD/QC matchent déjà tels quels).
const TRIGRAMME_BY_CODE = {
  HD: "WEL", // HOME DEPOT : trigramme réel en base = WEL (nomDossierDBF=homedepot)
  KONE: "KQ",
  MEARE: "MQ",
  SITEC: "SIT",
  LEBROUSSARD: "LB",
  PAITABRICOLAGE: "PB",
  QUINCAILLERIEKOUMAC: "QK",
  QUINCAILLERIEVKP: "VKP",
};
const codeToTrig = (code) => {
  const up = String(code || "").toUpperCase();
  return TRIGRAMME_BY_CODE[up] || up;
};

const splitMails = (str) =>
  str
    ? String(str)
        .split(/[;,]/)
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

const isEmptyArr = (v) => !Array.isArray(v) || v.length === 0;
const isEmptyStr = (v) => v == null || String(v).trim() === "";
// mappingEtats* est un Map Mongoose (ou objet). Vide = aucune clé.
const isEmptyMap = (m) => {
  if (!m) return true;
  if (typeof m.size === "number") return m.size === 0;
  return Object.keys(m).length === 0;
};

/**
 * Importe la config depuis backend/data/masterConfig/*.json, sans écraser
 * l'existant. Retourne un récapitulatif chiffré.
 */
export const runMasterConfigSeed = async () => {
  const ents = await Entreprise.find({});
  const entByTrig = new Map();
  for (const e of ents) entByTrig.set(String(e.trigramme).toUpperCase(), e);

  const ignores = new Set();
  const touched = new Set();
  const resolveDoc = (code) => {
    const d = entByTrig.get(codeToTrig(code));
    if (!d) ignores.add(String(code || ""));
    return d;
  };

  const res = {
    abonnements: 0,
    groupesPrioritaires: 0,
    groupesSpeciaux: 0,
    mailsCompta: 0,
    facturesAuto: 0,
    entreprisesMaj: 0,
    ignores: [],
  };

  // ─── Abonnements clients ───────────────────────────────────────────────────
  for (const r of load("dataClients.json")) {
    const doc = resolveDoc(r.ET);
    if (!doc) continue;
    for (const email of splitMails(r.EMAIL)) {
      const out = await AbonnementRapportClient.updateOne(
        { entreprise: doc._id, tiers: Number(r.TIERS), email: email.toLowerCase() },
        {
          $setOnInsert: {
            newsletter: !!r.NEWSLETTER,
            facturePdf: !!r.FACTURE_PDF,
            rapportTgc: !!r.RAPPORT_TGC,
            xlsExterne: !!r.XLS_EXTERNE,
            xlsInterne: !!r.XLS_INTERNE,
            baseCollecteur: r.BASE_COLLECTEUR || "",
            bloquer: !!r.BLOQUER,
          },
        },
        { upsert: true },
      );
      if (out.upsertedCount) res.abonnements += 1;
    }
  }

  // ─── Groupes prioritaires ──────────────────────────────────────────────────
  // Liste par société : le JSON Access n'en porte pas, on sème donc la même
  // base de départ dans CHAQUE société (elle sera ensuite complétée depuis
  // article.dbf via le bouton « Compléter depuis les articles »).
  for (const r of load("groupePrioritaire.json")) {
    if (!r.GROUPE) continue;
    for (const ent of ents) {
      const out = await GroupePrioritaire.updateOne(
        { entreprise: ent._id, groupe: String(r.GROUPE).toUpperCase() },
        { $setOnInsert: { description: r.Description || "" } },
        { upsert: true },
      );
      if (out.upsertedCount) res.groupesPrioritaires += 1;
    }
  }

  // ─── Groupes spéciaux ──────────────────────────────────────────────────────
  for (const r of load("groupeSpecial.json")) {
    const doc = resolveDoc(r.Societe);
    if (!doc) continue;
    const out = await GroupeSpecial.updateOne(
      { entreprise: doc._id, codeListe: String(r.CODE_LISTE).trim() },
      {
        $setOnInsert: {
          lblListe: r.LBL_LISTE || "",
          format: r.FORMAT || "",
          codeJpg: r.CODEJPG || "",
        },
      },
      { upsert: true },
    );
    if (out.upsertedCount) res.groupesSpeciaux += 1;
  }

  // ─── Emails compta par client ──────────────────────────────────────────────
  for (const r of load("mailCompta.json")) {
    const doc = resolveDoc(r.idSociete);
    if (!doc) continue;
    const out = await MailCompta.updateOne(
      { entreprise: doc._id, idClient: Number(r.idClient) },
      {
        $setOnInsert: {
          nomClient: r.nomClient || "",
          mailCompta: splitMails(r.mailCompta),
          nomCompta: r.nomCompta || "",
        },
      },
      { upsert: true },
    );
    if (out.upsertedCount) res.mailsCompta += 1;
  }

  // ─── Factures auto ─────────────────────────────────────────────────────────
  for (const r of load("listEnvoiFactAuto.json")) {
    const doc = resolveDoc(r.Societe);
    if (!doc) continue;
    const out = await ListEnvoiFactAuto.updateOne(
      { entreprise: doc._id, idClient: String(r.id_client || "") },
      {
        $setOnInsert: {
          client: r.Client || "",
          mails: splitMails(r.Mail),
          mailsCC: splitMails(r.MailCC),
          mailsMaintenance: splitMails(r.mailMaintenance),
        },
      },
      { upsert: true },
    );
    if (out.upsertedCount) res.facturesAuto += 1;
  }

  // ─── États + emails → Entreprise (uniquement si le champ est VIDE) ─────────
  // États commande : par société (colonne Societe), clé = trigramme.
  const ecBySoc = {};
  for (const r of load("etatCommandeGroupe.json")) {
    const trig = codeToTrig(r.Societe);
    (ecBySoc[trig] ||= {})[String(r.id_Etat)] = r.descriptionEtat || "";
  }
  // États proforma : jeu GLOBAL par défaut (etatProforma.json) + surcharges
  // PAR SOCIÉTÉ (etatProformaGroupe.json). Les libellés diffèrent réellement
  // selon la config ERP : DEVIS/CDE… (AVB/AW/HD/QC/LD/SITEC) vs PROPOSE/ACCEPTE
  // (FMB/KONE/MEARE + magasins Broussard).
  const epMap = {};
  for (const r of load("etatProforma.json")) epMap[String(r.ETAT)] = r.Description || "";
  const epBySoc = {};
  for (const r of load("etatProformaGroupe.json")) {
    const trig = codeToTrig(r.Societe);
    (epBySoc[trig] ||= {})[String(r.ETAT)] = r.Description || "";
  }
  const erMap = {};
  for (const r of load("etatReservation.json"))
    erMap[String(r.idEtatReservation)] = r.description || "";

  for (const [trig, doc] of entByTrig) {
    if (ecBySoc[trig] && isEmptyMap(doc.mappingEtatsCommande)) {
      doc.mappingEtatsCommande = new Map(Object.entries(ecBySoc[trig]));
      touched.add(doc);
    }
    // surcharge société si dispo, sinon jeu global
    const proforma = epBySoc[trig] || epMap;
    if (Object.keys(proforma).length && isEmptyMap(doc.mappingEtatsProforma)) {
      doc.mappingEtatsProforma = new Map(Object.entries(proforma));
      touched.add(doc);
    }
    if (Object.keys(erMap).length && isEmptyMap(doc.mappingEtatsReservation)) {
      doc.mappingEtatsReservation = new Map(Object.entries(erMap));
      touched.add(doc);
    }
  }

  for (const r of load("parametres.json")) {
    const doc = resolveDoc(r.Societe);
    if (!doc) continue;
    let changed = false;
    if (isEmptyArr(doc.emailsChgtPrixVente)) {
      const v = splitMails(r.mailChgtPrixVente);
      if (v.length) { doc.emailsChgtPrixVente = v; changed = true; }
    }
    if (isEmptyArr(doc.emailsPropoReappro)) {
      const v = splitMails(r.mailPropoReappro);
      if (v.length) { doc.emailsPropoReappro = v; changed = true; }
    }
    if (isEmptyArr(doc.mailCompta)) {
      const v = splitMails(r.mailCompta);
      if (v.length) { doc.mailCompta = v; changed = true; }
    }
    if (isEmptyStr(doc.nomCompta) && !isEmptyStr(r.nomCompta)) {
      doc.nomCompta = r.nomCompta; changed = true;
    }
    if (changed) touched.add(doc);
  }

  for (const doc of touched) await doc.save();
  res.entreprisesMaj = touched.size;
  res.ignores = [...ignores].filter(Boolean);
  return res;
};

export default { runMasterConfigSeed };
