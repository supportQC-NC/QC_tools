// backend/services/localisationInventaireService.js
//
// LOCALISATION INVENTAIRE : « où trouver cet article en magasin ? », répondu
// avec les BIPAGES d'un inventaire (l'actif ou un archivé — depuis le
// 24/11/2026 la réinitialisation ne purge plus LigneBipage/InventaireCollecte,
// chaque année reste donc interrogeable : Localisation inventaire 2026, 2027…).
//
// L'idée clé : l'ordre de bipage est un PLAN du rayon. Pour chaque zone où
// l'article a été compté, on renvoie aussi les lignes bipées juste AVANT et
// juste APRÈS dans la même séquence de scan (même .dat, champ `ordre`) — ce
// sont ses voisins physiques, les repères qui permettent à l'agent de le
// retrouver des yeux.
//
// Tout se lit dans Mongo (LigneBipage porte nart/gencod/désignation résolus à
// l'import) : AUCUNE dépendance au DBF — un inventaire archivé reste
// localisable même sans accès aux bases de la société.

import LigneBipage from "../models/LigneBipageModel.js";
import InventaireZoneSession from "../models/InventaireZoneSessionModel.js";
import { variantesCodeBarres, variantesNart } from "../utils/codeBarres.js";

// Nombre de voisins affichés de chaque côté de la ligne trouvée.
const NB_VOISINS = 3;
// Garde-fou : un code très répandu (article de caisse…) peut sortir dans
// des dizaines de zones ; au-delà, la liste n'aide plus personne.
const MAX_OCCURRENCES = 50;

/**
 * Inventaires interrogeables d'une société : l'actif d'abord, puis les
 * archivés du plus récent au plus ancien. `annee` sert de libellé par défaut
 * (« Localisation inventaire 2026 ») quand le nom n'en dit pas plus.
 */
export const listerInventaires = async (entrepriseId) => {
  const sessions = await InventaireZoneSession.find({ entreprise: entrepriseId })
    .select("nom statut createdAt archivedAt totalZones")
    .sort({ statut: 1, archivedAt: -1, createdAt: -1 })
    .lean();
  const avecLignes = await LigneBipage.aggregate([
    {
      $match: {
        session: { $in: sessions.map((s) => s._id) },
      },
    },
    { $group: { _id: "$session", nb: { $sum: 1 } } },
  ]);
  const nbParSession = new Map(avecLignes.map((r) => [String(r._id), r.nb]));
  return sessions
    .map((s) => ({
      _id: s._id,
      nom: s.nom || "",
      statut: s.statut,
      createdAt: s.createdAt,
      archivedAt: s.archivedAt,
      totalZones: s.totalZones || 0,
      annee: new Date(s.archivedAt || s.createdAt).getFullYear(),
      nbLignes: nbParSession.get(String(s._id)) || 0,
    }))
    // Un inventaire sans la moindre ligne (antérieur à l'arrêt des purges,
    // ou jamais bipé) ne peut rien localiser : on le laisse visible mais
    // l'écran le grise via nbLignes = 0.
    .sort((a, b) => (a.statut === "actif" ? -1 : b.statut === "actif" ? 1 : 0));
};

/**
 * Emplacements d'un inventaire = les TYPES portés par les fiches d'inventaire
 * (zones du snapshot de la session : MAGASIN, DOCK, réserve…), avec le nombre
 * de zones de chacun. Les zones sans type sortent sous "—".
 */
export const listerEmplacements = (session) => {
  const compte = new Map();
  for (const z of session.zones || []) {
    if (z.neutralisee) continue;
    const t = String(z.type || "").trim() || "—";
    compte.set(t, (compte.get(t) || 0) + 1);
  }
  return [...compte.entries()]
    .map(([emplacement, nbZones]) => ({ emplacement, nbZones }))
    .sort((a, b) => a.emplacement.localeCompare(b.emplacement, "fr"));
};

// Toutes les écritures équivalentes d'un code saisi ou douché : zéros de
// tête des GENCOD (UPC-A vs EAN-13, EAN-8 padé) ET du NART (« 12345 » vs
// « 012345 ») — mêmes règles que partout ailleurs (utils/codeBarres.js).
const variantesRecherche = (code) => {
  const s = new Set();
  for (const v of variantesCodeBarres(code)) s.add(v);
  for (const v of variantesNart(code)) s.add(v);
  return [...s].filter(Boolean);
};

/**
 * Localise un code dans un inventaire : chaque ligne bipée qui lui correspond
 * (NART, gencod catalogue ou code réellement scanné), avec ses voisins de
 * séquence. `emplacement` restreint aux zones de ce type ("" = partout).
 */
export const rechercherArticle = async ({ session, code, emplacement }) => {
  const variantes = variantesRecherche(code);
  if (!variantes.length) {
    return { variantes: [], occurrences: [], totalParZone: [] };
  }

  const filtre = {
    session: session._id,
    $or: [
      { nart: { $in: variantes } },
      { gencod: { $in: variantes } },
      { codeScanne: { $in: variantes } },
      { eanArticle: { $in: variantes } },
    ],
  };
  if (emplacement && emplacement !== "tous") {
    filtre.zoneType = emplacement === "—" ? "" : emplacement;
  }

  const lignes = await LigneBipage.find(filtre)
    .select(
      "nart gencod designation qteScan zoneCode zoneType datFileName ordre agentNom modeImport createdAt",
    )
    .sort({ zoneCode: 1, zoneType: 1, datFileName: 1, ordre: 1 })
    .limit(MAX_OCCURRENCES + 1)
    .lean();

  const tronque = lignes.length > MAX_OCCURRENCES;
  const retenues = tronque ? lignes.slice(0, MAX_OCCURRENCES) : lignes;

  // Libellés des zones : le snapshot de la session fait foi (couple
  // code + emplacement — le même code peut exister au magasin ET au dock).
  const libelleZone = new Map(
    (session.zones || []).map((z) => [
      `${z.code}||${String(z.type || "").trim()}`,
      z.libelle || "",
    ]),
  );

  const occurrences = [];
  for (const l of retenues) {
    // Voisins de séquence : même .dat (même dépôt de zone), ordre à ±N.
    // C'est la proximité PHYSIQUE sur le rayon au moment du comptage.
    const voisins = await LigneBipage.find({
      session: session._id,
      datFileName: l.datFileName,
      ordre: { $gte: (l.ordre || 0) - NB_VOISINS, $lte: (l.ordre || 0) + NB_VOISINS },
    })
      .select("nart gencod designation qteScan ordre")
      .sort({ ordre: 1 })
      .lean();
    occurrences.push({
      ligneId: l._id,
      nart: l.nart,
      gencod: l.gencod,
      designation: l.designation,
      qteScan: l.qteScan,
      zoneCode: l.zoneCode,
      zoneType: String(l.zoneType || "").trim() || "—",
      zoneLibelle:
        libelleZone.get(`${l.zoneCode}||${String(l.zoneType || "").trim()}`) ||
        "",
      datFileName: l.datFileName,
      ordre: l.ordre,
      agentNom: l.agentNom || "",
      modeImport: l.modeImport,
      bipeAt: l.createdAt,
      voisins: voisins.map((v) => ({
        nart: v.nart,
        gencod: v.gencod,
        designation: v.designation,
        qteScan: v.qteScan,
        ordre: v.ordre,
        cible: String(v._id) === String(l._id),
      })),
    });
  }

  // Total par zone : un article re-bipé sort en PLUSIEURS lignes (une par
  // séquence depuis le 18/11/2026) — le total rend la quantité lisible.
  const totaux = new Map();
  for (const o of occurrences) {
    const k = `${o.zoneCode}||${o.zoneType}`;
    const t = totaux.get(k) || {
      zoneCode: o.zoneCode,
      zoneType: o.zoneType,
      zoneLibelle: o.zoneLibelle,
      nbLignes: 0,
      totalQte: 0,
    };
    t.nbLignes += 1;
    t.totalQte += Number(o.qteScan) || 0;
    totaux.set(k, t);
  }

  return {
    variantes,
    occurrences,
    totalParZone: [...totaux.values()],
    tronque,
  };
};
