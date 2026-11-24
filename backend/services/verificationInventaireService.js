// backend/services/verificationInventaireService.js
//
// VÉRIFICATION POINT ROUGE — la mécanique de croisement. Au papillonnage,
// l'agent écrit la quantité comptée sur un scotch ; au bipage, un point rouge
// est collé après chaque scan. Quand TOUTES les zones d'une allée sont
// contrôlées, un agent balaye l'allée : chaque scotch SANS point rouge est
// bipé, et on cherche dans les bipages de l'ALLÉE si l'article y est, à la
// bonne quantité.
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
 * Cherche le code dans les bipages de l'ALLÉE (toutes zones dont le code
 * commence par la lettre, tous emplacements confondus) : lignes trouvées et
 * total — un article re-bipé sort en plusieurs lignes, c'est le TOTAL que
 * l'agent compare au scotch.
 */
export const rechercherDansAllee = async ({
  session,
  allee,
  code,
  nartResolu,
}) => {
  const variantes = variantesRecherche(code, nartResolu);
  if (!variantes.length) return { lignes: [], totalQte: 0 };

  const lignes = await LigneBipage.find({
    session: session._id,
    $or: [
      { nart: { $in: variantes } },
      { gencod: { $in: variantes } },
      { codeScanne: { $in: variantes } },
      { eanArticle: { $in: variantes } },
    ],
  })
    .select("zoneCode zoneType qteScan source agentNom designation nart gencod")
    .lean();

  // Filtre d'allée EN MÉMOIRE (une poignée de lignes par article) : la
  // première lettre n'est pas indexable proprement côté Mongo.
  const dansAllee = lignes.filter((l) => lettreAllee(l.zoneCode) === allee);
  const totalQte =
    Math.round(
      dansAllee.reduce((s, l) => s + (Number(l.qteScan) || 0), 0) * 1000,
    ) / 1000;

  return { lignes: dansAllee, totalQte };
};
