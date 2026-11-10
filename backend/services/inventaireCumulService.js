// backend/services/inventaireCumulService.js
//
// CUMUL DES BIPAGES D'UNE ZONE D'INVENTAIRE (re-bipage d'une zone déjà bipée).
//
// Demande client du 10/11/2026 : une zone doit pouvoir être re-bipée — l'agent a
// oublié des références, un second agent vient « biper la suite ». Les nouveaux
// bipages S'AJOUTENT à ce qui a déjà été compté, et la fiche de contrôle complète
// est régénérée. On ne perd jamais l'ancien.
//
// Choix d'implémentation : la collecte déjà déposée n'est PAS réouverte. La
// reprise crée une collecte de PLUS (`estComplement`), pour que le suivi bipage
// et les statistiques créditent chaque agent de SON travail. C'est au moment du
// dépôt que l'on recompose la zone entière :
//
//   .DAT déposé          = cumul de toutes les collectes déposées de la zone
//   fiche de contrôle    = idem (le watcher relit le même cumul)
//   récap / écarts       = déjà cumulés par zone côté getRecapZones
//
// ⚠️ Les collectes marquées `annulee` sont exclues : « Recommencer la zone »
// (écran Détail des bipages) est une table rase, ses lignes ne doivent pas
// ressusciter au prochain bipage.
//
// ⚠️ La FUSION des lignes se fait par article, quantités ADDITIONNÉES — même
// règle que `addLigneCollecte` à l'intérieur d'une collecte (un article bipé
// deux fois cumule). Sans elle, le .DAT porterait deux lignes pour le même NART
// et la fiche afficherait un doublon là où l'agent a simplement complété son
// comptage.

import InventaireCollecte from "../models/InventaireCollecteModel.js";
import User from "../models/UserModel.js";
import { memeNart, memeCodeBarres } from "../utils/codeBarres.js";

const safe = (v) => (v == null ? "" : String(v)).trim();
const round3 = (v) => Math.round((Number(v) || 0) * 1000) / 1000;

const nomAgent = (u) => {
  if (!u) return "";
  if (typeof u === "string") return "";
  const n = `${safe(u.prenom)} ${safe(u.nom)}`.trim();
  return n || safe(u.email);
};

/**
 * Fusionne les lignes de plusieurs collectes en UNE liste par article.
 *
 * `collectes` : dans l'ordre chronologique de dépôt (la plus ancienne d'abord) —
 * c'est cet ordre que la fiche de contrôle restitue, l'agent qui complète voit
 * donc ses ajouts à la fin.
 *
 * Renvoie { lignes, agents, collectes, lignesBrutes } où chaque ligne porte
 * { nart, gencod, codeScanne, designation, quantite, isUnknown, isRenvoi,
 *   agentNom, agents[], scannedAt }.
 */
export const fusionnerLignesCollectes = (collectes = []) => {
  const lignes = [];
  const agents = [];
  let lignesBrutes = 0;

  for (const c of collectes) {
    const agent = nomAgent(c?.user);
    if (agent && !agents.includes(agent)) agents.push(agent);

    for (const l of c?.lignes || []) {
      lignesBrutes += 1;
      const nart = safe(l.nart);
      const gencod = safe(l.gencod);
      // Même tolérance que addLigneCollecte : les écritures d'ERP équivalentes
      // (« 12345 »/« 012345 », UPC-A/EAN-13) désignent le même article.
      const existante = lignes.find(
        (x) =>
          (nart && memeNart(x.nart, nart)) ||
          (gencod && memeCodeBarres(x.gencod, gencod)),
      );
      if (existante) {
        existante.quantite = round3(existante.quantite + round3(l.quantite));
        // On garde le PREMIER code bipé / la première désignation : la fiche ne
        // doit pas changer d'aspect selon l'ordre des reprises.
        if (!existante.codeScanne && safe(l.codeScanne)) {
          existante.codeScanne = safe(l.codeScanne);
        }
        if (!existante.designation && safe(l.designation)) {
          existante.designation = safe(l.designation);
        }
        if (agent && !existante.agents.includes(agent)) {
          existante.agents.push(agent);
        }
        continue;
      }
      lignes.push({
        nart,
        gencod,
        codeScanne: safe(l.codeScanne),
        designation: safe(l.designation),
        quantite: round3(l.quantite),
        isUnknown: !!l.isUnknown,
        isRenvoi: !!l.isRenvoi,
        agents: agent ? [agent] : [],
        scannedAt: l.scannedAt || null,
      });
    }
  }

  // `agentNom` d'une ligne : le ou les agents qui l'ont comptée. Une ligne
  // reprise par un second agent porte les deux (colonne « Agent » du Détail
  // des bipages), sinon le superviseur croit que le premier a tout fait.
  for (const l of lignes) l.agentNom = l.agents.join(" / ");

  return { lignes, agents, collectes: collectes.length, lignesBrutes };
};

/**
 * Charge les collectes DÉPOSÉES d'une zone (hors annulées) et renvoie le cumul.
 *
 * @param {object} opts
 * @param {*} opts.entrepriseId
 * @param {*} opts.sessionId        session d'inventaire (null = collectes hors session)
 * @param {string} opts.zoneCode
 * @param {string} opts.zoneType    emplacement (MAGASIN/DOCK), "" accepté
 * @param {object} [opts.collecteCourante]  collecte en cours de dépôt : elle est
 *   placée EN DERNIER et jamais comptée deux fois (re-dépôt d'une collecte déjà
 *   passée en « exporte »).
 * @returns {Promise<{lignes, agents, collectes, lignesBrutes, totalQuantite,
 *   anterieures}>} `anterieures` = nb de collectes déjà déposées avant celle-ci.
 */
export const chargerCumulZone = async ({
  entrepriseId,
  sessionId = null,
  zoneCode,
  zoneType = "",
  collecteCourante = null,
}) => {
  const filtre = {
    entreprise: entrepriseId,
    session: sessionId || null,
    zoneCode,
    zoneType: zoneType || "",
    status: "exporte",
    annulee: { $ne: true },
  };
  if (collecteCourante?._id) filtre._id = { $ne: collecteCourante._id };

  const anterieures = await InventaireCollecte.find(filtre)
    .sort({ exportedAt: 1, createdAt: 1 })
    .populate("user", "nom prenom email");

  // La collecte en cours de dépôt arrive avec un `user` NON peuplé (le flux
  // d'export ne peuple que l'entreprise) : on résout l'agent à part plutôt que
  // de peupler le document que l'appelant va enregistrer juste après.
  let courante = collecteCourante;
  if (courante?.user && !courante.user.nom && !courante.user.prenom) {
    const u = await User.findById(courante.user)
      .select("nom prenom email")
      .lean()
      .catch(() => null);
    if (u) courante = { user: u, lignes: courante.lignes };
  }

  const suite = courante ? [...anterieures, courante] : anterieures;
  const cumul = fusionnerLignesCollectes(suite);
  return {
    ...cumul,
    anterieures: anterieures.length,
    totalQuantite: round3(cumul.lignes.reduce((s, l) => s + l.quantite, 0)),
  };
};

/**
 * Collectes déjà DÉPOSÉES d'une zone (hors annulées) : sert à prévenir l'agent
 * « cette zone a déjà été bipée, voulez-vous continuer ? » au scan du QR, et à
 * marquer la nouvelle collecte comme complément.
 * @returns {Promise<null|{collectes, articles, quantite, dernierDepotAt, agents}>}
 *   null si la zone n'a jamais été déposée.
 */
export const etatZoneDejaBipee = async ({
  entrepriseId,
  sessionId = null,
  zoneCode,
  zoneType = "",
}) => {
  const deposees = await InventaireCollecte.find({
    entreprise: entrepriseId,
    session: sessionId || null,
    zoneCode,
    zoneType: zoneType || "",
    status: "exporte",
    annulee: { $ne: true },
  })
    .sort({ exportedAt: 1, createdAt: 1 })
    .populate("user", "nom prenom email");

  if (deposees.length === 0) return null;

  const { lignes, agents } = fusionnerLignesCollectes(deposees);
  return {
    collectes: deposees.length,
    premiereId: deposees[0]._id,
    articles: lignes.length,
    quantite: round3(lignes.reduce((s, l) => s + l.quantite, 0)),
    dernierDepotAt:
      deposees[deposees.length - 1].exportedAt ||
      deposees[deposees.length - 1].updatedAt ||
      null,
    agents,
  };
};

export default { fusionnerLignesCollectes, chargerCumulZone, etatZoneDejaBipee };
