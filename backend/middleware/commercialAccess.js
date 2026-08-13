// backend/middleware/commercialAccess.js
//
// PROFIL COMMERCIAL — accès à l'espace dédié /api/commercial/*.
//
// Règle fondatrice du module (cahier des charges) : un commercial ne voit QUE ce
// qui le concerne. Le filtrage se fait TOUJOURS sur le couple
//     SOCIÉTÉ (entreprise) + CODE VENDEUR (REPRES)
// et jamais sur le seul code : le même homme est 12 chez QC, 08 chez KQ.
//
// Le profil est stocké dans Permission.commercial ({ actif, codes: [{entreprise, code}] }).
// Il est INDÉPENDANT des modules : un commercial peut recevoir en plus n'importe
// quel module via la gestion des droits habituelle.
//
// ⚠️ Le périmètre SOCIÉTÉ reste celui de Permission.entreprises (ou allEntreprises) :
// un code vendeur sur une société non accordée n'ouvre aucun accès.

import asyncHandler from "./asyncHandler.js";
import Permission from "../models/PermissionModel.js";
import Entreprise from "../models/EntrepriseModel.js";

/** Normalise un code REPRES pour comparaison ("08" === 8 === "8"). */
export const normalizeCode = (v) => {
  if (v === null || v === undefined) return "";
  const s = String(v).trim();
  if (!s) return "";
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? String(n) : s.toUpperCase();
};

/** Deux codes REPRES désignent-ils le même vendeur ? */
export const sameCode = (a, b) => normalizeCode(a) === normalizeCode(b);

/**
 * DICTIONNAIRE DES CODES REPRES — par société (onglet « Vendeurs » de la fiche
 * entreprise). Un code REPRES n'est pas forcément un commercial : ce peut être
 * une caisse, un vendeur magasin, un compte technique… Seuls les codes typés
 * `commercial` ouvrent droit à l'espace commercial.
 */
export const estCodeCommercial = (entreprise, code) =>
  (entreprise?.vendeurs || []).some(
    (v) => v.type === "commercial" && sameCode(v.code, code),
  );

/** Codes typés « commercial » d'une société (dictionnaire). */
export const codesCommerciauxDe = (entreprise) =>
  (entreprise?.vendeurs || [])
    .filter((v) => v.type === "commercial" && normalizeCode(v.code))
    .map((v) => normalizeCode(v.code));

/**
 * Sociétés du commercial AVEC le document Mongoose Entreprise (indispensable :
 * les getters cheminBase / cheminExportInventaire assurent la bascule dev/prod).
 * Ne renvoie que les sociétés à la fois ACCORDÉES à l'utilisateur ET pourvues
 * d'au moins un code vendeur.
 * @returns {Promise<{actif:boolean, societes:Array<{entreprise:Object, codes:string[]}>}>}
 */
export const getEntreprisesCommercial = async (user) => {
  if (!user) return { actif: false, societes: [] };

  const permission = await Permission.findOne({ user: user._id });
  if (!permission?.commercial?.actif) return { actif: false, societes: [] };

  const lignes = (permission.commercial.codes || []).filter(
    (l) => l?.entreprise && normalizeCode(l.code),
  );
  if (!lignes.length) return { actif: true, societes: [] };

  // Périmètre société (allEntreprises = tout).
  const autorisees = permission.allEntreprises
    ? null
    : new Set((permission.entreprises || []).map((e) => e.toString()));

  // Regroupement code(s) par société.
  const parEntreprise = new Map(); // idStr -> Set(codes normalisés)
  for (const l of lignes) {
    const id = l.entreprise.toString();
    if (autorisees && !autorisees.has(id)) continue;
    if (!parEntreprise.has(id)) parEntreprise.set(id, new Set());
    parEntreprise.get(id).add(normalizeCode(l.code));
  }
  if (!parEntreprise.size) return { actif: true, societes: [] };

  const docs = await Entreprise.find({
    _id: { $in: [...parEntreprise.keys()] },
    isActive: true,
  });

  const societes = docs
    .map((e) => ({
      entreprise: e,
      // Filtre par le DICTIONNAIRE de la société : un code retiré des
      // commerciaux (repassé « vendeur » / « autre ») ferme immédiatement
      // l'accès, sans avoir à retoucher les profils utilisateurs.
      codes: [...(parEntreprise.get(e._id.toString()) || [])].filter((c) =>
        estCodeCommercial(e, c),
      ),
    }))
    .filter((s) => s.codes.length > 0)
    .sort((a, b) =>
      a.entreprise.trigramme.localeCompare(b.entreprise.trigramme, "fr"),
    );

  return { actif: true, societes };
};

/** Vue JSON du profil (sans document Mongoose) — sert à l'API /profil. */
export const vueProfil = ({ actif, societes }) => ({
  actif,
  entreprises: (societes || []).map(({ entreprise: e, codes }) => ({
    _id: e._id,
    nomDossierDBF: e.nomDossierDBF,
    trigramme: e.trigramme,
    nomComplet: e.nomComplet,
    codes,
    // Identité du vendeur telle que configurée sur la fiche société.
    vendeurs: (e.vendeurs || [])
      .filter((v) => codes.some((c) => sameCode(c, v.code)))
      .map((v) => ({
        code: v.code,
        nom: [v.nom, v.prenom].filter(Boolean).join(" ").trim(),
        email: v.email || "",
      })),
  })),
});

/**
 * Profil commercial complet d'un utilisateur (vue JSON).
 * @returns {Promise<{actif:boolean, entreprises:Array}>}
 */
export const getProfilCommercial = async (user) =>
  vueProfil(await getEntreprisesCommercial(user));

/** Codes vendeur de l'utilisateur pour UNE société (tableau, éventuellement vide). */
export const getCodesPourEntreprise = async (user, entrepriseId) => {
  const { societes } = await getEntreprisesCommercial(user);
  const cible = String(entrepriseId);
  const found = societes.find((s) => s.entreprise._id.toString() === cible);
  return found ? found.codes : [];
};

/**
 * Middleware : réserve une route aux utilisateurs au profil commercial actif.
 * Attache req.commercialSocietes ([{ entreprise, codes }]).
 */
export const requireCommercial = asyncHandler(async (req, res, next) => {
  const profil = await getEntreprisesCommercial(req.user);
  if (!profil.actif) {
    res.status(403);
    throw new Error("Espace réservé aux commerciaux");
  }
  if (!profil.societes.length) {
    res.status(403);
    throw new Error(
      "Aucun code vendeur n'est rattaché à votre compte. Contactez un administrateur.",
    );
  }
  req.commercialSocietes = profil.societes;
  next();
});

/**
 * Middleware : à chaîner APRÈS checkEntrepriseAccess (req.entreprise chargée).
 * Vérifie que l'utilisateur possède un code vendeur SUR CETTE société et
 * attache req.codesCommercial (les seuls codes qu'il a le droit de consulter).
 */
export const checkCommercialEntreprise = asyncHandler(async (req, res, next) => {
  const societes =
    req.commercialSocietes ||
    (await getEntreprisesCommercial(req.user)).societes;
  const found = societes.find(
    (s) => s.entreprise._id.toString() === req.entreprise._id.toString(),
  );
  if (!found) {
    res.status(403);
    throw new Error(
      `Aucun code vendeur ne vous rattache à ${req.entreprise.nomComplet}`,
    );
  }
  req.commercialSocietes = societes;
  req.codesCommercial = found.codes;
  next();
});

export default {
  normalizeCode,
  sameCode,
  estCodeCommercial,
  codesCommerciauxDe,
  getEntreprisesCommercial,
  vueProfil,
  getProfilCommercial,
  getCodesPourEntreprise,
  requireCommercial,
  checkCommercialEntreprise,
};
