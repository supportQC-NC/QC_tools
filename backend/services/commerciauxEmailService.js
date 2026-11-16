// backend/services/commerciauxEmailService.js
//
// ANNUAIRE EMAIL DES COMMERCIAUX — classeur Excel tenu PAR LE CLIENT à la
// racine du partage Bases : `<cheminBase>\commerciaux.xlsx` (le getter du
// modèle Entreprise traduit déjà `cheminBase` en production via DBF_BASE_PATH,
// donc le même code marche sur le poste Windows et sur le VPS).
//
// Structure constatée le 17/11/2026 : un ONGLET PAR SOCIÉTÉ (nom = trigramme :
// QC, AW, DQ, VKP…), colonnes REPRES | EMAIL | NOM — sauf VKP où la première
// colonne s'appelle CODVEND. Une cellule EMAIL peut porter PLUSIEURS adresses,
// séparées par « ; » (ou « , »). Les codes mélangent « 01 », « 1 » et des
// nombres : la comparaison doit être tolérante (même règle que resolveVendeur).
//
// Premier usage : prévenir le commercial qui a créé la proforma quand sa
// commande a été préparée (preparationReportService). Lecture seule ; cache
// TTL + invalidation mtime/taille, le fichier est édité à la main.

import fs from "fs";
import path from "path";

const CACHE_TTL_MS = 10 * 60 * 1000;
// chemin -> { at, mtimeMs, size, onglets: Map(TRIG -> [{code, emails, nom}]) }
const caches = new Map();

const trim = (v) => (v == null ? "" : String(v)).trim();

/** Valeur TEXTE d'une cellule exceljs (formules et riches compris). */
const cellTexte = (cell) => {
  const v = cell?.value;
  if (v == null) return "";
  if (typeof v === "object") {
    if (v.text !== undefined) return trim(v.text);
    if (v.result !== undefined) return trim(v.result);
    if (Array.isArray(v.richText))
      return trim(v.richText.map((r) => r.text).join(""));
    return "";
  }
  return trim(v);
};

/** Découpe une cellule EMAIL en adresses plausibles (séparateurs ; ou ,). */
const parseEmails = (valeur) =>
  trim(valeur)
    .split(/[;,]/)
    .map((e) => e.trim())
    .filter((e) => /^\S+@\S+\.\S+$/.test(e));

/**
 * Même code vendeur ? Égalité de chaînes d'abord, puis NUMÉRIQUE : l'Excel
 * mélange « 01 », « 1 » et des nombres, et proforma.REPRES est un numérique.
 */
export const memeCodeVendeur = (a, b) => {
  const sa = trim(a);
  const sb = trim(b);
  if (!sa || !sb) return false;
  if (sa === sb) return true;
  const na = Number(sa);
  const nb = Number(sb);
  return Number.isFinite(na) && Number.isFinite(nb) && na === nb;
};

const cheminClasseur = (entreprise) => {
  const base = trim(entreprise?.cheminBase);
  return base ? path.join(base, "commerciaux.xlsx") : "";
};

const chargerClasseur = async (chemin) => {
  const mod = await import("exceljs").catch(() => {
    throw new Error("Module 'exceljs' introuvable. Lancez : npm i exceljs");
  });
  const ExcelJS = mod.default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(chemin);

  const onglets = new Map();
  for (const ws of wb.worksheets) {
    const rows = [];
    // Colonnes par EN-TÊTE (ligne 1) : REPRES ou CODVEND (VKP) pour le code,
    // EMAIL, NOM — avec repli sur les positions 1/2/3 si l'en-tête manque.
    let colCode = 1;
    let colEmail = 2;
    let colNom = 3;
    const entete = ws.getRow(1);
    for (let c = 1; c <= Math.max(6, entete.cellCount || 0); c++) {
      const h = cellTexte(entete.getCell(c)).toUpperCase();
      if (h === "REPRES" || h === "CODVEND") colCode = c;
      else if (h === "EMAIL") colEmail = c;
      else if (h === "NOM") colNom = c;
    }
    const premierCode = cellTexte(entete.getCell(colCode)).toUpperCase();
    const debut =
      premierCode === "REPRES" || premierCode === "CODVEND" ? 2 : 1;

    for (let i = debut; i <= ws.rowCount; i++) {
      const row = ws.getRow(i);
      const code = cellTexte(row.getCell(colCode));
      if (!code) continue;
      rows.push({
        code,
        emails: parseEmails(cellTexte(row.getCell(colEmail))),
        nom: cellTexte(row.getCell(colNom)),
      });
    }
    onglets.set(trim(ws.name).toUpperCase(), rows);
  }
  return onglets;
};

const getOnglets = async (chemin) => {
  const stat = fs.statSync(chemin); // lève si le fichier n'existe pas
  const cache = caches.get(chemin);
  const frais =
    cache &&
    Date.now() - cache.at < CACHE_TTL_MS &&
    cache.mtimeMs === stat.mtimeMs &&
    cache.size === stat.size;
  if (frais) return cache.onglets;

  const onglets = await chargerClasseur(chemin);
  caches.set(chemin, {
    at: Date.now(),
    mtimeMs: stat.mtimeMs,
    size: stat.size,
    onglets,
  });
  return onglets;
};

/**
 * Adresse(s) email du commercial `repres` pour cette société.
 * @returns {Promise<{emails: string[], nom: string}|null>} null = vendeur
 *   absent de l'onglet (ou onglet absent). Lève si le classeur est illisible —
 *   l'appelant distingue ainsi « pas d'adresse » de « fichier en défaut ».
 */
export const getCommercialEmail = async (entreprise, repres) => {
  const code = trim(repres);
  if (!code) return null;
  const chemin = cheminClasseur(entreprise);
  if (!chemin) throw new Error("Société sans cheminBase.");

  const onglets = await getOnglets(chemin);
  const rows = onglets.get(trim(entreprise?.trigramme).toUpperCase());
  if (!rows) return null;

  const fiche = rows.find((r) => memeCodeVendeur(r.code, code));
  if (!fiche) return null;
  return { emails: fiche.emails, nom: fiche.nom };
};

export default { getCommercialEmail, memeCodeVendeur };
