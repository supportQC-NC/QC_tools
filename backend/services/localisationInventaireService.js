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
import { comparerCodeGisement } from "../utils/codeGisement.js";
// L'allée d'une zone suit EXACTEMENT la règle de la vérification point rouge
// (importée, jamais recopiée : deux définitions divergeraient, et le plan
// grouperait les rayons autrement que l'écran de vérification).
import { cleAllee } from "./verificationInventaireService.js";

// Nombre de voisins affichés de chaque côté de la ligne trouvée.
const NB_VOISINS = 3;
// Garde-fou : un code très répandu (article de caisse…) peut sortir dans
// des dizaines de zones ; au-delà, la liste n'aide plus personne.
const MAX_OCCURRENCES = 50;
// Suggestions de la barre de recherche : assez pour couvrir les variantes d'un
// même produit (une serrure en 5 couleurs), pas assez pour faire défiler.
const MAX_SUGGESTIONS = 12;
// Une suggestion par DÉSIGNATION n'a de sens qu'à partir de 2 caractères :
// en-dessous, la moitié de l'inventaire correspond.
const MIN_CARACTERES_TEXTE = 2;

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

const echapperRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * SUGGESTIONS de la barre de recherche (27/11/2026) : « marteau » doit
 * suffire. Jusqu'ici seul un code EXACT localisait un article — l'agent qui a
 * le produit en main mais pas son étiquette lisible n'avait aucune porte
 * d'entrée.
 *
 * Trois façons de matcher, dans cet ordre de pertinence :
 *   1. code EXACT (NART / gencod / code bipé, variantes de zéros de tête) ;
 *   2. code commençant par la saisie (NART tapé partiellement) ;
 *   3. DÉSIGNATION contenant les mots saisis — tous les mots, dans n'importe
 *      quel ordre (« marteau pein » trouve « MARTEAU DE PEINTRE »).
 *
 * Le regroupement se fait par NART : un article re-bipé dans dix zones est UNE
 * suggestion qui annonce « 10 zones », pas dix lignes. Les zones sont
 * renvoyées avec la suggestion pour que la réponse soit souvent lisible sans
 * même lancer la localisation.
 */
export const suggererArticles = async ({ session, q }) => {
  const saisie = String(q || "").trim();
  if (!saisie) return { suggestions: [] };

  const variantes = variantesRecherche(saisie);
  const ou = [];
  if (variantes.length) {
    ou.push(
      { nart: { $in: variantes } },
      { gencod: { $in: variantes } },
      { codeScanne: { $in: variantes } },
      { eanArticle: { $in: variantes } },
    );
  }
  // Préfixe de code : la saisie partielle d'un NART ou d'un gencod.
  if (/^\d+$/.test(saisie)) {
    const rxDebut = new RegExp(`^0*${echapperRegex(saisie)}`);
    ou.push({ nart: rxDebut }, { gencod: rxDebut });
  }
  // Désignation : TOUS les mots doivent être présents (lookahead par mot),
  // accents et casse indifférents dans la limite de ce que fait l'ERP (les
  // désignations DBF sont en majuscules non accentuées).
  const mots = saisie.split(/\s+/).filter((m) => m.length >= 1);
  if (saisie.length >= MIN_CARACTERES_TEXTE) {
    const lookaheads = mots.map((m) => `(?=.*${echapperRegex(m)})`).join("");
    ou.push({ designation: new RegExp(`^${lookaheads}`, "i") });
  }
  if (!ou.length) return { suggestions: [] };

  const groupes = await LigneBipage.aggregate([
    // ⚠️ TOUJOURS borné à LA session : un cumul inter-inventaires ferait
    // remonter un emplacement de l'an dernier (décision client).
    { $match: { session: session._id, $or: ou } },
    {
      $group: {
        _id: "$nart",
        // La désignation la plus longue est la moins tronquée des variantes.
        designation: { $max: "$designation" },
        gencod: { $max: "$gencod" },
        nbLignes: { $sum: 1 },
        totalQte: { $sum: "$qteScan" },
        zones: { $addToSet: { code: "$zoneCode", type: "$zoneType" } },
      },
    },
    { $limit: 200 },
  ]);

  const exactes = new Set(variantes);
  const saisieMaj = saisie.toUpperCase();
  const suggestions = groupes
    .map((g) => {
      const nart = g._id || "";
      const designation = g.designation || "";
      // Score de pertinence : code exact d'abord, puis désignation qui
      // COMMENCE par la saisie, puis le reste.
      let score = 3;
      if (exactes.has(nart) || exactes.has(g.gencod || "")) score = 0;
      else if (nart.startsWith(saisie.replace(/^0+/, ""))) score = 1;
      else if (designation.toUpperCase().startsWith(saisieMaj)) score = 2;
      const zones = (g.zones || [])
        .map((z) => ({
          zoneCode: z.code || "",
          zoneType: String(z.type || "").trim() || "—",
        }))
        .sort((a, b) => comparerCodeGisement(a.zoneCode, b.zoneCode));
      return {
        nart,
        gencod: g.gencod || "",
        designation,
        nbLignes: g.nbLignes,
        totalQte: Math.round((g.totalQte || 0) * 1000) / 1000,
        nbZones: zones.length,
        zones,
        score,
      };
    })
    .sort(
      (a, b) =>
        a.score - b.score ||
        b.nbZones - a.nbZones ||
        a.designation.localeCompare(b.designation, "fr"),
    );

  return {
    suggestions: suggestions.slice(0, MAX_SUGGESTIONS),
    tronque: suggestions.length > MAX_SUGGESTIONS,
  };
};

/**
 * PLAN SCHÉMATIQUE de l'inventaire (27/11/2026) : toutes les zones de la
 * session, rangées par emplacement puis par ALLÉE, chaque allée dans l'ordre
 * de parcours (`comparerCodeGisement`).
 *
 * ⚠️ Ce n'est PAS la géométrie réelle du magasin — personne ne l'a saisie.
 * C'est la seule structure que portent les données : le code de rayon
 * (allée + repère). L'écran doit le dire à l'utilisateur, sans quoi il lirait
 * le plan comme une carte fidèle.
 *
 * Chaque zone porte son nombre de lignes bipées : une zone à 0 n'a pas été
 * comptée, et c'est souvent LA réponse quand un article reste introuvable.
 */
export const construirePlan = async (session) => {
  // Densité par zone : une seule agrégation pour tout l'inventaire.
  const parZone = await LigneBipage.aggregate([
    { $match: { session: session._id } },
    {
      $group: {
        _id: { code: "$zoneCode", type: "$zoneType" },
        nbLignes: { $sum: 1 },
        totalQte: { $sum: "$qteScan" },
      },
    },
  ]);
  const densite = new Map(
    parZone.map((r) => [
      `${r._id.code}||${String(r._id.type || "").trim()}`,
      { nbLignes: r.nbLignes, totalQte: r.totalQte },
    ]),
  );

  // Emplacement → allée → zones.
  const parEmplacement = new Map();
  for (const z of session.zones || []) {
    const type = String(z.type || "").trim() || "—";
    const allee = cleAllee(z.code);
    if (!parEmplacement.has(type)) parEmplacement.set(type, new Map());
    const allees = parEmplacement.get(type);
    if (!allees.has(allee)) allees.set(allee, []);
    const d = densite.get(`${z.code}||${String(z.type || "").trim()}`);
    allees.get(allee).push({
      zoneCode: z.code,
      zoneLibelle: z.libelle || "",
      zoneType: type,
      neutralisee: !!z.neutralisee,
      // Phase « bipage » cochée : la zone a été comptée (ou déclarée comptée).
      bipee: !!z.bipage?.fait,
      controlee: !!z.controle?.fait,
      nbLignes: d?.nbLignes || 0,
      totalQte: Math.round((d?.totalQte || 0) * 1000) / 1000,
    });
  }

  const emplacements = [...parEmplacement.entries()]
    .map(([emplacement, allees]) => {
      const blocs = [...allees.entries()]
        .map(([allee, zones]) => ({
          allee,
          zones: zones.sort((a, b) =>
            comparerCodeGisement(a.zoneCode, b.zoneCode),
          ),
          nbZones: zones.length,
          nbBipees: zones.filter((z) => z.bipee && !z.neutralisee).length,
          nbLignes: zones.reduce((s, z) => s + z.nbLignes, 0),
        }))
        .sort((a, b) => comparerCodeGisement(a.allee, b.allee));
      return {
        emplacement,
        allees: blocs,
        nbZones: blocs.reduce((s, a) => s + a.nbZones, 0),
        nbLignes: blocs.reduce((s, a) => s + a.nbLignes, 0),
      };
    })
    // MAGASIN avant DOCK avant le reste : l'ordre dans lequel on cherche.
    .sort((a, b) => {
      const rang = (e) =>
        e === "MAGASIN" ? 0 : e === "DOCK" ? 1 : e === "—" ? 3 : 2;
      return (
        rang(a.emplacement) - rang(b.emplacement) ||
        a.emplacement.localeCompare(b.emplacement, "fr")
      );
    });

  return {
    emplacements,
    nbZones: emplacements.reduce((s, e) => s + e.nbZones, 0),
  };
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
      "nart gencod designation qteScan zoneCode zoneType datFileName ordre agentNom modeImport source createdAt",
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

  // Voisins de séquence : même .dat (même dépôt de zone), ordre à ±N. C'est la
  // proximité PHYSIQUE sur le rayon au moment du comptage.
  // ⚠️ UNE SEULE requête pour toutes les occurrences (27/11/2026) : la boucle
  // d'avant en lançait une par occurrence, soit jusqu'à 50 allers-retours
  // Mongo pour un code répandu.
  const voisinsParLigne = new Map();
  if (retenues.length) {
    const tous = await LigneBipage.find({
      session: session._id,
      $or: retenues.map((l) => ({
        datFileName: l.datFileName,
        ordre: {
          $gte: (l.ordre || 0) - NB_VOISINS,
          $lte: (l.ordre || 0) + NB_VOISINS,
        },
      })),
    })
      .select("nart gencod designation qteScan ordre datFileName")
      .sort({ ordre: 1 })
      .lean();
    // Redistribution : une ligne peut être voisine de PLUSIEURS occurrences
    // (deux bipages du même article à 2 positions d'écart).
    for (const l of retenues) {
      const cle = String(l._id);
      voisinsParLigne.set(
        cle,
        tous.filter(
          (v) =>
            v.datFileName === l.datFileName &&
            Math.abs((v.ordre || 0) - (l.ordre || 0)) <= NB_VOISINS,
        ),
      );
    }
  }

  const occurrences = [];
  for (const l of retenues) {
    const voisins = voisinsParLigne.get(String(l._id)) || [];
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
      // Provenance de la ligne : un bipage de terrain (« dat ») ne se lit pas
      // comme un ajout au contrôle ou un delta de vérification point rouge.
      source: l.source || "dat",
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

  // Ordre de PARCOURS pour les deux listes (27/11/2026) : le tri Mongo est
  // alphabétique sur la chaîne, donc « A_1, A_10, A_2d » — l'agent redescend
  // l'allée. `comparerCodeGisement` est le tri du rayon, celui de la
  // préparation de commande et du plan.
  const parParcours = (a, b) =>
    comparerCodeGisement(a.zoneCode, b.zoneCode) ||
    String(a.zoneType).localeCompare(String(b.zoneType), "fr");
  occurrences.sort(
    (a, b) => parParcours(a, b) || (a.ordre || 0) - (b.ordre || 0),
  );

  return {
    variantes,
    occurrences,
    totalParZone: [...totaux.values()].sort(parParcours),
    tronque,
  };
};
