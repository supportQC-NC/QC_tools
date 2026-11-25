// backend/services/verificationInventaireService.js
//
// VÉRIFICATION POINT ROUGE — la mécanique de croisement. Au papillonnage,
// l'agent écrit la quantité comptée sur un scotch ; au bipage, un point rouge
// est collé après chaque scan. Quand TOUTES les zones d'une allée sont
// contrôlées, un agent balaye l'allée RAYON PAR RAYON : il bipe d'abord le QR
// du rayon (l'étiquette de zone), puis chaque scotch SANS point rouge, et on
// cherche dans les bipages de CE RAYON si l'article y est, à la bonne quantité.
//
// ⚠️ Croisement STRICT PAR ZONE (demande client du 26/11/2026, remplace le
// croisement au niveau de l'allée entière) : un même article peut être à
// PLUSIEURS endroits de la même allée (scotch « 5 » en A_1 et « 3 » en A_3).
// Comparer un scotch au total de l'allée faisait mentir le verdict (5 ≠ 8 →
// faux écart) et la ligne de delta partait dans une zone choisie à la main.
// Chaque scotch se compare donc aux bipages du rayon bipé, et c'est là que la
// ligne de delta s'écrit — un article bipé dans une zone voisine ne compte pas.
//
// L'allée = PREMIÈRE lettre du code de zone (même convention que le filtre du
// Récap par zone : A_1, A_2d… → « A » ; un code ne commençant pas par une
// lettre tombe dans « # »).

import LigneBipage from "../models/LigneBipageModel.js";
import { variantesCodeBarres, variantesNart } from "../utils/codeBarres.js";

export const lettreAllee = (code) => {
  const c = String(code || "")
    .trim()
    .charAt(0)
    .toUpperCase();
  return /[A-Z]/.test(c) ? c : "#";
};

/**
 * Allées de la session (zones non neutralisées), avec leur état de contrôle :
 * la vérification d'une allée n'ouvre que quand TOUTES ses zones sont
 * contrôlées (arbitrage client du 24/11/2026).
 */
export const construireAllees = (session) => {
  const parLettre = new Map();
  for (const z of session.zones || []) {
    if (z.neutralisee) continue;
    const lettre = lettreAllee(z.code);
    let a = parLettre.get(lettre);
    if (!a) {
      a = { lettre, nbZones: 0, nbControlees: 0, zones: [] };
      parLettre.set(lettre, a);
    }
    a.nbZones += 1;
    if (z.controle?.fait) a.nbControlees += 1;
    a.zones.push({
      code: z.code,
      libelle: z.libelle || "",
      type: String(z.type || "").trim(),
      controleFait: !!z.controle?.fait,
    });
  }
  return [...parLettre.values()]
    .map((a) => ({ ...a, prete: a.nbControlees === a.nbZones }))
    .sort((a, b) => a.lettre.localeCompare(b.lettre, "fr"));
};

/**
 * Résout le QR de rayon bipé vers une (ou deux) zone(s) de l'ALLÉE, dans le
 * SNAPSHOT de la session (les EAN y sont figés à l'init, comme pour les
 * coupons). Priorités — mêmes conventions que `resoudreZone` du collecteur :
 *   1. EAN principal exact (le QR de la fiche de zone encode `eanPrincipal`) ;
 *   2. EAN de phase (papillonnage / bipage / contrôle — tolérance au mauvais
 *      coupon bipé) ;
 *   3. forme « code|emplacement » des fiches de zone ;
 *   4. code brut : TOUTES les correspondances (ambigu MAGASIN/DOCK — le client
 *      fait choisir l'emplacement quand il y en a plusieurs).
 */
export const resoudreZoneAllee = ({ session, allee, code }) => {
  const c = String(code || "").trim();
  if (!c) return [];
  const cMaj = c.toUpperCase();

  const zones = (session.zones || []).filter(
    (z) => !z.neutralisee && lettreAllee(z.code) === allee,
  );
  const resume = (z) => ({
    code: z.code,
    libelle: z.libelle || "",
    type: String(z.type || "").trim(),
  });

  let m = zones.filter((z) => z.eanPrincipal && z.eanPrincipal === c);
  if (m.length) return m.map(resume);

  m = zones.filter((z) =>
    [z.eanPapillonnage, z.eanBipage, z.eanControle].filter(Boolean).includes(c),
  );
  if (m.length) return m.map(resume);

  const idx = cMaj.indexOf("|");
  if (idx > 0) {
    const codeZone = cMaj.slice(0, idx).trim();
    const type = cMaj.slice(idx + 1).trim();
    m = zones.filter(
      (z) =>
        z.code.toUpperCase() === codeZone &&
        String(z.type || "").trim().toUpperCase() === type,
    );
    if (m.length) return m.map(resume);
  }

  return zones.filter((z) => z.code.toUpperCase() === cMaj).map(resume);
};

// Toutes les écritures équivalentes du code bipé + celles du NART résolu :
// la ligne stockée peut porter le gencod OU le nart, sous n'importe laquelle
// de leurs formes (zéros de tête).
const variantesRecherche = (code, nartResolu) => {
  const s = new Set();
  for (const v of variantesCodeBarres(code)) s.add(v);
  for (const v of variantesNart(code)) s.add(v);
  if (nartResolu) for (const v of variantesNart(nartResolu)) s.add(v);
  return [...s].filter(Boolean);
};

/**
 * Cherche le code dans les bipages du RAYON bipé (zone = code + emplacement) :
 * lignes trouvées et total — un article re-bipé sort en plusieurs lignes,
 * c'est le TOTAL de la zone que l'agent compare au scotch.
 */
export const rechercherDansZone = async ({
  session,
  zoneCode,
  zoneType,
  code,
  nartResolu,
}) => {
  const variantes = variantesRecherche(code, nartResolu);
  if (!variantes.length) return { lignes: [], totalQte: 0 };

  const lignes = await LigneBipage.find({
    session: session._id,
    zoneCode,
    zoneType,
    $or: [
      { nart: { $in: variantes } },
      { gencod: { $in: variantes } },
      { codeScanne: { $in: variantes } },
      { eanArticle: { $in: variantes } },
    ],
  })
    .select("zoneCode zoneType qteScan source agentNom designation nart gencod")
    .lean();

  const totalQte =
    Math.round(
      lignes.reduce((s, l) => s + (Number(l.qteScan) || 0), 0) * 1000,
    ) / 1000;

  return { lignes, totalQte };
};
