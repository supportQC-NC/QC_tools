// backend/services/envoiCdeFournisseurService.js
//
// Cœur métier du module « Envoi Commande Fournisseur » (portage de l'Access
// ENVOI_CDE_FOURN / formListCdePrepar.btSendFrs).
//
// Source des commandes : fichiers DBF (lecture seule via les caches existants) —
// commandes « préparées » = cmdref.ETAT === 1.
// Coordonnées d'envoi : collections Mongo migrées depuis Access.
//
// Sécurité : `appliquerModeTest` redirige TOUS les envois vers des adresses de
// test tant que ENVOI_CDE_TEST_MODE n'est pas explicitement à "false".
import commandeCacheService from "./commandeService.js";
import fournissCacheService from "./fournissCacheService.js";
import articleCacheService from "./articleService.js";
import sendEmail from "../utils/sendEmail.js";
import {
  genererExcelCommande,
  genererPdfCommande,
  buildBaseName,
  logoFromEntreprise,
  parserEmailsExcel,
} from "./envoiCdeReportService.js";

import Entreprise from "../models/EntrepriseModel.js";
import FournisseurEmail from "../models/FournisseurEmailModel.js";
import MessageFournisseur, {
  assurerSchemaMessages,
} from "../models/MessageFournisseurModel.js";
import ResponsableCc from "../models/ResponsableCcModel.js";
import EnvoiCdeHistorique from "../models/EnvoiCdeHistoriqueModel.js";
import EnvoiCdeParametre from "../models/EnvoiCdeParametreModel.js";
import EnvoiCdeAr from "../models/EnvoiCdeArModel.js";

const ETAT_PREPAREE = 1;

const trim = (v) => (v === null || v === undefined ? "" : String(v).trim());

// ────────────────────────────────────────────────────────────────────────────
// SIGNATURE + CORPS HTML (portage de publicHTML.SignatureMail / HTMLCreateMailBody)
// ────────────────────────────────────────────────────────────────────────────
const SIGNATURE_HTML =
  "--<br><br>" +
  "Tel: +687 27 04 19 - Fax: 27 42 66<br>" +
  "Z.I DUCOS - BP512<br>" +
  "98845 Noumea Cedex<br>" +
  "NOUVELLE CALEDONIE<br>" +
  "www.quincaillerie.nc";

// Modèles par défaut utilisés si une société n'a pas de modèle pour la langue
// (repli à l'envoi + proposition dans l'écran « Modèles de message »).
export const DEFAULT_MESSAGE_F =
  "<html>\n<body>\n<p>Bonjour,<br /><br />\n" +
  "Ci-joint, notre nouvelle commande.<br />\n" +
  "Merci de nous accuser reception <u><b>en repondant a toutes les personnes en copie de ce mail.</b></u><br /><br />\n" +
  "Dans l'attente de vous lire.<br />\nCordialement<br /><br />\n" +
  "*Ce message est un mail automatique.\n</p>\n</body>\n</html>";

export const DEFAULT_MESSAGE_A =
  "<html>\n<body>\n<p>Hey there,<br /><br />\n" +
  "Please find attached to this mail our new order.<br />\n" +
  "When answering, please <u><b>contact all the recipients of this mail.</b></u><br /><br />\n" +
  "We look forward hearing back from you.<br /><br />\n" +
  "*This e-mail is generated automatically.\n</p>\n</body>\n</html>";

export const getDefaultMessage = (langue) =>
  langue === "A" ? DEFAULT_MESSAGE_A : DEFAULT_MESSAGE_F;

// ── Modèles de RELANCE (onglet Historique) ────────────────────────────────────
// Le sujet est éditable (contrairement à celui d'une commande, figé par fidélité
// à l'Access). Les {{variables}} sont remplacées à l'envoi, dans le sujet ET dans
// le corps.
export const DEFAULT_RELANCE_F =
  "<p>Bonjour,<br><br>" +
  "Sauf erreur de notre part, nous n'avons pas encore recu d'accuse de reception " +
  "pour la (les) commande(s) suivante(s) : <b>{{commandes}}</b>, adressee(s) le {{date_envoi}}.<br><br>" +
  "Merci de nous confirmer sa (leur) bonne prise en compte ainsi que le delai de livraison prevu, " +
  "<u><b>en repondant a toutes les personnes en copie de ce mail.</b></u><br><br>" +
  "Dans l'attente de vous lire.<br>Cordialement</p>";

export const DEFAULT_RELANCE_A =
  "<p>Hello,<br><br>" +
  "We have not yet received an acknowledgement of receipt for the following order(s): " +
  "<b>{{commandes}}</b>, sent on {{date_envoi}}.<br><br>" +
  "Please confirm that they have been taken into account, along with the expected delivery time, " +
  "<u><b>replying to all the recipients of this mail.</b></u><br><br>" +
  "We look forward hearing back from you.</p>";

export const DEFAULT_SUJET_RELANCE_F = "Relance - commande(s) {{commandes}}";
export const DEFAULT_SUJET_RELANCE_A = "Reminder - order(s) {{commandes}}";

export const getDefaultRelance = (langue) =>
  langue === "A"
    ? { message: DEFAULT_RELANCE_A, sujet: DEFAULT_SUJET_RELANCE_A }
    : { message: DEFAULT_RELANCE_F, sujet: DEFAULT_SUJET_RELANCE_F };

// ── Modèles de CONFIRMATION D'AR (onglet Accusés de réception) ───────────────
// Envoyé au fournisseur quand IL a confirmé la commande : on lui accuse à notre
// tour réception de son AR, en rappelant le MONTANT TOTAL retenu.
export const DEFAULT_AR_F =
  "<p>Bonjour,<br><br>" +
  "Nous accusons bonne reception de votre confirmation pour la commande " +
  "<b>{{commande}}</b> du {{date_commande}}, d'un montant total de " +
  "<b>{{montant_total}}</b>.<br><br>" +
  "Merci de nous informer sans delai de toute modification de prix, de quantite " +
  "ou de delai de livraison.<br><br>" +
  "Cordialement</p>";

export const DEFAULT_AR_A =
  "<p>Hello,<br><br>" +
  "We hereby acknowledge your confirmation of order <b>{{commande}}</b> dated " +
  "{{date_commande}}, for a total amount of <b>{{montant_total}}</b>.<br><br>" +
  "Please inform us immediately of any change in price, quantity or delivery " +
  "time.<br><br>" +
  "Best regards</p>";

export const DEFAULT_SUJET_AR_F =
  "Confirmation AR - commande {{commande}} - {{montant_total}}";
export const DEFAULT_SUJET_AR_A =
  "Order acknowledgement - order {{commande}} - {{montant_total}}";

export const getDefaultAr = (langue) =>
  langue === "A"
    ? { message: DEFAULT_AR_A, sujet: DEFAULT_SUJET_AR_A }
    : { message: DEFAULT_AR_F, sujet: DEFAULT_SUJET_AR_F };

// Variables proposées dans l'éditeur (l'UI lit cette liste pour son menu
// « Insérer un champ » — un seul endroit à maintenir).
export const VARIABLES_RELANCE = [
  { cle: "commandes", label: "N° des commandes", exemple: "12345, 12346" },
  { cle: "nb_commandes", label: "Nombre de commandes", exemple: "2" },
  { cle: "fournisseur", label: "Nom du fournisseur", exemple: "BOSCH FRANCE" },
  { cle: "code_fournisseur", label: "Code fournisseur", exemple: "200" },
  { cle: "date_envoi", label: "Date du 1er envoi", exemple: "12/08/2026" },
  { cle: "societe", label: "Nom de la société", exemple: "QUINCAILLERIE CALEDONIENNE" },
  { cle: "date_du_jour", label: "Date du jour", exemple: "19/08/2026" },
];

// Champs insérables dans un mail de confirmation d'AR.
export const VARIABLES_AR = [
  { cle: "commande", label: "N° de la commande", exemple: "333022" },
  {
    cle: "montant_total",
    label: "Montant total (devise incluse)",
    exemple: "1 248 F",
  },
  { cle: "montant", label: "Montant total (nombre seul)", exemple: "1 248" },
  { cle: "devise", label: "Devise de la commande", exemple: "F" },
  { cle: "date_commande", label: "Date de la commande", exemple: "12/08/2026" },
  { cle: "date_envoi", label: "Date d'envoi de la commande", exemple: "13/08/2026" },
  { cle: "nb_lignes", label: "Nombre de lignes", exemple: "17" },
  { cle: "fournisseur", label: "Nom du fournisseur", exemple: "BOSCH FRANCE" },
  { cle: "code_fournisseur", label: "Code fournisseur", exemple: "200" },
  { cle: "societe", label: "Nom de la société", exemple: "QUINCAILLERIE CALEDONIENNE" },
  { cle: "date_du_jour", label: "Date du jour", exemple: "20/08/2026" },
];

// Remplace {{variable}} par sa valeur (insensible à la casse et aux espaces).
// Une variable inconnue est laissée telle quelle : l'auteur voit son erreur.
const appliquerVariables = (texte, vars = {}) =>
  String(texte || "").replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (m, cle) => {
    const v = vars[String(cle).toLowerCase()];
    return v === undefined || v === null ? m : String(v);
  });

// Nettoyage du HTML saisi dans l'éditeur visuel : on retire ce qui n'a rien à
// faire dans un email (scripts, iframes, gestionnaires d'événements, liens
// javascript:). Appliqué à l'ENREGISTREMENT — le serveur ne fait jamais
// confiance au HTML reçu, même si l'éditeur nettoie déjà de son côté.
export const nettoyerHtmlMessage = (html) =>
  String(html || "")
    .replace(
      /<\s*(script|style|iframe|object|embed|link|meta|form)\b[\s\S]*?<\s*\/\s*\1\s*>/gi,
      "",
    )
    .replace(/<\s*(script|style|iframe|object|embed|link|meta|form)\b[^>]*>/gi, "")
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, "")
    .replace(/\son\w+\s*=\s*'[^']*'/gi, "")
    .replace(/\son\w+\s*=\s*[^\s>]+/gi, "")
    .replace(/(href|src)\s*=\s*("|')\s*javascript:[^"']*\2/gi, '$1="#"');

// Charge le modèle (société, type, langue) avec repli : autre langue, puis
// modèle par défaut. Ne renvoie JAMAIS un corps vide.
const chargerModele = async (entrepriseId, type, langue) => {
  await assurerSchemaMessages();
  let tpl = await MessageFournisseur.findOne({
    entreprise: entrepriseId,
    type,
    langue,
  }).lean();
  if (!tpl) {
    tpl = await MessageFournisseur.findOne({
      entreprise: entrepriseId,
      type,
      langue: langue === "A" ? "F" : "A",
    }).lean();
  }
  const defauts =
    type === "relance"
      ? getDefaultRelance(langue)
      : type === "ar"
        ? getDefaultAr(langue)
        : { message: getDefaultMessage(langue), sujet: "" };
  return {
    message: trim(tpl?.message) || defauts.message,
    sujet: trim(tpl?.sujet) || defauts.sujet,
  };
};

// Construit le corps HTML final : on retire les balises html/body du modèle et
// on ré-enveloppe une seule fois avec la signature. `complement` (optionnel)
// s'insère entre le message et la signature — utilisé par la relance pour le
// tableau récapitulatif des commandes.
const construireCorpsHtml = (message, complement = "") => {
  const inner = trim(message)
    .replace(/<\/?html>/gi, "")
    .replace(/<\/?body>/gi, "")
    .trim();
  const extra = trim(complement) ? `${complement}<br><br>` : "";
  return `<html><body>${inner}<br><br>${extra}${SIGNATURE_HTML}</body></html>`;
};

// Échappe le HTML d'un texte SIMPLE saisi par un utilisateur non technicien.
const escapeHtml = (s) =>
  String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

// Corps HTML à partir d'un texte simple (retours ligne -> <br>) + signature.
const construireCorpsTexte = (texte) => {
  const html = escapeHtml(texte).replace(/\r?\n/g, "<br>");
  return `<html><body>${html}<br><br>${SIGNATURE_HTML}</body></html>`;
};

// ────────────────────────────────────────────────────────────────────────────
// LECTURE DES COMMANDES PRÉPARÉES (DBF)
// ────────────────────────────────────────────────────────────────────────────

// Sentinelle du filtre « bateau vide ».
export const BATEAU_VIDE = "__vide__";

// ────────────────────────────────────────────────────────────────────────────
// MONTANT TOTAL D'UNE COMMANDE  (Σ QTE × prix d'achat de la ligne)
//
// ⚠️ Ordre des sources VÉRIFIÉ sur les données de production (qc, cmdetail.dbf) :
//   1. cmdetail.MONTANT — prix d'achat unitaire RÉELLEMENT commandé, dans la
//      devise de la commande (cmdref.CDVISE). C'est celui qu'on annonce au
//      fournisseur ;
//   2. cmdetail.PACHAT — coût RENDU local (fret + taxes) : il vaut 0/null tant
//      que la commande n'est pas réceptionnée, donc sur 100 % des commandes
//      préparées. C'est pour ça que le total « coût achat prév. » de l'ERP
//      (`montantPrev`) affichait 0 partout ;
//   3. article.PACHAT — repli si la ligne ne porte aucun prix.
// (Le module « Historique prix d'achat » prend l'ordre INVERSE : lui cherche le
// coût rendu, pas le prix commandé — ne pas aligner les deux.)
// ────────────────────────────────────────────────────────────────────────────
const prixLigneCommande = async (entreprise, ligne) => {
  const prix = Number(ligne.MONTANT) || Number(ligne.PACHAT) || 0;
  if (prix) return prix;
  if (!ligne.NART) return 0;
  try {
    const art = await articleCacheService.findByNart(entreprise, ligne.NART);
    return Number(art?.PACHAT) || 0;
  } catch {
    return 0;
  }
};

// Total d'un lot de lignes brutes (enregistrements cmdetail).
export const calculerMontantLignes = async (entreprise, lignesBrutes = []) => {
  let total = 0;
  for (const l of lignesBrutes) {
    total += (Number(l.QTE) || 0) * (await prixLigneCommande(entreprise, l));
  }
  return Math.round(total * 100) / 100;
};

// Total d'une commande depuis son n°. Renvoie 0 si la commande n'a plus de
// lignes lisibles (commande archivée par l'ERP).
export const calculerMontantCommande = async (entreprise, numcde) => {
  try {
    const lignes = await commandeCacheService.getDetailsByNumcde(entreprise, numcde);
    return calculerMontantLignes(entreprise, lignes || []);
  } catch {
    return 0;
  }
};

// Devise d'affichage : les commandes locales n'ont pas de CDVISE renseigné.
const deviseCommande = (entete) => trim(entete?.CDVISE) || "F";

// Montant formaté pour un mail (séparateur d'espace insécable + devise).
export const formaterMontant = (montant, devise = "F") =>
  `${(Number(montant) || 0).toLocaleString("fr-FR", {
    maximumFractionDigits: 2,
  })} ${devise || "F"}`.trim();

// Liste des commandes préparées (ETAT=1), enrichie du nom fournisseur.
// - tri par défaut : BATEAU = "OK" en tête, puis le reste (par date décroissante) ;
// - filtre optionnel par bateau (valeur exacte, ou BATEAU_VIDE pour « sans bateau ») ;
// - renvoie aussi la liste des bateaux distincts (pour le dropdown de filtre).
export const getCommandesPreparees = async (entreprise, options = {}) => {
  const { search = "", fourn, bateau } = options;

  // Libellé d'état depuis la config entreprise (mappingEtatsCommande, Map n° -> libellé).
  const mapping = entreprise.mappingEtatsCommande;
  const libelleEtat = (etat) => {
    const key = String(etat);
    if (mapping && typeof mapping.get === "function") return mapping.get(key) || "";
    if (mapping && typeof mapping === "object") return mapping[key] || "";
    return "";
  };

  // On récupère TOUTES les commandes préparées (tri/filtre bateau global).
  const res = await commandeCacheService.getPaginated(entreprise, {
    page: 1,
    limit: 1000000,
    etat: ETAT_PREPAREE,
    search: search || undefined,
    fourn: fourn || undefined,
    withDetailTotals: true,
  });

  let commandes = await Promise.all(
    res.commandes.map(async (c) => {
      let nom = "";
      try {
        const frs = await fournissCacheService.findByFourn(entreprise, c.FOURN);
        nom = frs ? trim(frs.NOM) : "";
      } catch {
        nom = "";
      }
      return {
        NUMCDE: trim(c.NUMCDE),
        FOURN: c.FOURN,
        NOM: nom,
        DATCDE: c.DATCDE,
        BATEAU: trim(c.BATEAU),
        OBSERV: trim(c.OBSERV),
        ETAT: c.ETAT,
        ETAT_LABEL: libelleEtat(c.ETAT),
        COUT_ACHAT_PREV: c.TOTAL_DETAIL || 0,
        // Montant total réel de la commande (Σ QTE × prix ligne) : le
        // COUT_ACHAT_PREV de l'ERP vaut 0 tant que rien n'est réceptionné.
        MONTANT_TOTAL: await calculerMontantCommande(entreprise, trim(c.NUMCDE)),
        DEVISE: deviseCommande(c),
        NB_LIGNES: c.NB_LIGNES_DETAIL || 0,
      };
    }),
  );

  // Liste des bateaux distincts (avant filtrage) pour le dropdown.
  // Regroupement INSENSIBLE À LA CASSE (ex. "P/VERIF" et "p/verif" -> une entrée).
  const compteur = new Map();
  for (const c of commandes) {
    const raw = c.BATEAU || BATEAU_VIDE;
    const key = raw === BATEAU_VIDE ? BATEAU_VIDE : raw.toUpperCase();
    const cur = compteur.get(key) || { value: key, count: 0 };
    cur.count += 1;
    compteur.set(key, cur);
  }
  const bateaux = [...compteur.values()].sort((a, b) => {
    // "OK" en tête, puis "(vide)" en fin, sinon alpha.
    const rank = (v) =>
      v.value === "OK" ? 0 : v.value === BATEAU_VIDE ? 2 : 1;
    return rank(a) - rank(b) || a.value.localeCompare(b.value);
  });

  // Filtre bateau optionnel.
  if (bateau) {
    if (bateau === BATEAU_VIDE) {
      commandes = commandes.filter((c) => !c.BATEAU);
    } else {
      const bl = bateau.toLowerCase();
      commandes = commandes.filter((c) => (c.BATEAU || "").toLowerCase() === bl);
    }
  }

  // Tri par défaut : BATEAU = "OK" d'abord (le reste garde l'ordre date décroissante).
  commandes.sort(
    (a, b) =>
      (a.BATEAU.toUpperCase() === "OK" ? 0 : 1) -
      (b.BATEAU.toUpperCase() === "OK" ? 0 : 1),
  );

  return { totalRecords: commandes.length, commandes, bateaux };
};

// Entête d'une commande (cmdref) + nom fournisseur.
const getEntete = async (entreprise, numcde) => {
  const entete = await commandeCacheService.findByNumcde(entreprise, numcde);
  if (!entete) return null;
  let nom = "";
  try {
    const frs = await fournissCacheService.findByFourn(entreprise, entete.FOURN);
    nom = frs ? trim(frs.NOM) : "";
  } catch {
    nom = "";
  }
  return { entete, fournNom: nom };
};

// Détail (lignes) d'une commande, enrichi des infos article (DESIFRN, GENCOD…).
export const getDetailCommande = async (entreprise, numcde) => {
  const info = await getEntete(entreprise, numcde);
  if (!info) return null;
  const { entete, fournNom } = info;

  const lignesBrutes = await commandeCacheService.getDetailsByNumcde(
    entreprise,
    numcde,
  );

  const lignes = await Promise.all(
    lignesBrutes.map(async (l) => {
      let art = null;
      try {
        if (l.NART) art = await articleCacheService.findByNart(entreprise, l.NART);
      } catch {
        art = null;
      }
      // Prix retenu pour le montant total (cf. prixLigneCommande). Il est exposé
      // à part de PACHAT pour ne RIEN changer aux pièces jointes Excel/PDF, qui
      // impriment le PACHAT de la fiche article depuis l'origine du module.
      const qte = Number(l.QTE) || 0;
      const prix = Number(l.MONTANT) || Number(l.PACHAT) || Number(art?.PACHAT) || 0;
      return {
        NL: Number(l.NL) || 0,
        NART: trim(l.NART),
        DESIGN: trim(art?.DESIGN || l.DESIGN),
        DESIFRN: trim(art?.DESIFRN),
        REFER: trim(art?.REFER || l.REFER),
        GENCOD: trim(art?.GENCOD),
        QTE: qte,
        // Prix d'achat depuis la fiche article (article.PACHAT).
        PACHAT: Number(art?.PACHAT) || 0,
        // Prix d'achat commandé + montant de la ligne (QTE × prix).
        PRIX: prix,
        MONTANT_LIGNE: Math.round(qte * prix * 100) / 100,
      };
    }),
  );

  const totaux = await commandeCacheService.getTotalsByNumcde(entreprise, numcde);
  const montantTotal =
    Math.round(lignes.reduce((s, l) => s + l.MONTANT_LIGNE, 0) * 100) / 100;

  return {
    numcde: trim(entete.NUMCDE),
    fourn: entete.FOURN,
    fournNom,
    datcde: entete.DATCDE,
    bateau: trim(entete.BATEAU),
    observ: trim(entete.OBSERV),
    // Total ERP « coût rendu » : 0 tant que la commande n'est pas réceptionnée.
    montantPrev: totaux.totalQtePachat || 0,
    // Montant total exploitable = Σ (QTE × prix d'achat de la ligne).
    montantTotal,
    devise: deviseCommande(entete),
    nbLignes: lignes.length,
    lignes,
  };
};

// ────────────────────────────────────────────────────────────────────────────
// COORDONNÉES D'ENVOI (Mongo)
// ────────────────────────────────────────────────────────────────────────────

// Contrôle bloquant (portage des MsgBox de l'Access) : chaque commande doit
// avoir un fournisseur renseigné dans FournisseurEmail avec au moins un mail.
export const verifierFournisseurs = async (entreprise, numcdes = []) => {
  const problemes = [];
  for (const numcde of numcdes) {
    const info = await getEntete(entreprise, numcde);
    if (!info) {
      problemes.push({ numcde, raison: "Commande introuvable dans les fichiers." });
      continue;
    }
    const fourn = info.entete.FOURN;
    const fe = await FournisseurEmail.findOne({
      entreprise: entreprise._id,
      fournId: fourn,
    }).lean();

    if (!fe) {
      problemes.push({
        numcde,
        fourn,
        nom: info.fournNom,
        raison: `Fournisseur ${fourn} absent de la table des emails.`,
      });
      continue;
    }
    if (!fe.emails || fe.emails.filter(Boolean).length === 0) {
      problemes.push({
        numcde,
        fourn,
        nom: info.fournNom,
        raison: `Aucun email renseigné pour le fournisseur ${fourn}.`,
      });
      continue;
    }
    if (!fe.langue) {
      problemes.push({
        numcde,
        fourn,
        nom: info.fournNom,
        raison: `Langue non renseignée pour le fournisseur ${fourn}.`,
      });
    }
  }
  return { ok: problemes.length === 0, problemes };
};

// Résout tout ce qui compose l'email d'une commande (sert l'aperçu ET l'envoi).
export const resoudreEnvoi = async (entreprise, numcde) => {
  const detail = await getDetailCommande(entreprise, numcde);
  if (!detail) {
    return { erreur: `Commande ${numcde} introuvable.` };
  }

  const fe = await FournisseurEmail.findOne({
    entreprise: entreprise._id,
    fournId: detail.fourn,
  }).lean();

  if (!fe || !fe.emails || fe.emails.filter(Boolean).length === 0) {
    return {
      erreur: `Pas d'email pour le fournisseur ${detail.fourn} (${detail.fournNom}).`,
      detail,
    };
  }

  const langue = fe.langue === "A" ? "A" : "F";

  // Modèle de message (langue du fournisseur, avec repli langue puis défaut).
  let messageBrut = (await chargerModele(entreprise._id, "commande", langue))
    .message;

  // Cas particulier historique : LD + fournisseur 200 -> mention adhérent Weldom.
  const trig = (entreprise.trigramme || "").toUpperCase();
  if (trig === "LD" && Number(detail.fourn) === 200) {
    messageBrut = messageBrut.replace(
      /Bonjour,\s*(<br\s*\/?>\s*){2}/i,
      (m) => `${m}Adherant WELDOM N. 1734/001<br /><br />`,
    );
  }

  const html = construireCorpsHtml(messageBrut);

  // Responsable / CC de la société.
  const resp = await ResponsableCc.findOne({ entreprise: entreprise._id }).lean();
  const ccResp = resp?.emails || [];

  const destinataires = fe.emails.filter(Boolean);
  // CC = responsable de la société + transitaire du fournisseur (EXACTEMENT
  // comme l'Access : MAIL_ENVOI ... mailCC & ";" & mailTransitaire).
  // Le champ MAILCCi existe dans la table mais n'était PAS envoyé par l'Access.
  const cc = [...ccResp, ...(fe.emailsTransitaire || [])].filter(Boolean);

  const stamp = buildBaseName(trig, detail.numcde);
  const sujet = `${entreprise.nomComplet || trig} new_cmd_${detail.numcde}_${stamp.split("_").pop()}`;

  return {
    detail,
    langue,
    fournNom: detail.fournNom,
    destinataires,
    cc,
    sujet,
    html,
    baseName: stamp,
  };
};

// ────────────────────────────────────────────────────────────────────────────
// MODE TEST (garde-fou) — piloté par société depuis l'interface (BDD).
// ────────────────────────────────────────────────────────────────────────────

const DEFAULT_TEST_EMAILS =
  "support@quincaillerie.nc,communication@quincaillerie.nc,krysto.contact@gmail.com";

// Adresses de test par défaut (repli si la société n'en a pas défini).
const defaultTestEmails = () =>
  String(process.env.ENVOI_CDE_TEST_EMAILS || DEFAULT_TEST_EMAILS)
    .split(/[;,]/)
    .map((s) => s.trim())
    .filter(Boolean);

// Paramètres d'une société. SÉCURITÉ : si aucun document -> mode test ACTIF.
export const getParametres = async (entreprise) => {
  const doc = await EnvoiCdeParametre.findOne({
    entreprise: entreprise._id,
  }).lean();
  return {
    testMode: doc ? doc.testMode !== false : true,
    testEmails:
      doc && doc.testEmails && doc.testEmails.length
        ? doc.testEmails
        : defaultTestEmails(),
  };
};

// Met à jour les paramètres et renvoie l'état effectif.
export const setParametres = async (entreprise, { testMode, testEmails } = {}) => {
  const update = {};
  if (typeof testMode === "boolean") update.testMode = testMode;
  if (Array.isArray(testEmails)) update.testEmails = testEmails;
  await EnvoiCdeParametre.findOneAndUpdate(
    { entreprise: entreprise._id },
    { $set: update },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
  return getParametres(entreprise);
};

// Redirige les destinataires selon les paramètres résolus (params obligatoire).
export const appliquerModeTest = ({ destinataires, cc, sujet }, params) => {
  if (params?.testMode) {
    return {
      to: params.testEmails,
      cc: [],
      sujet: `[TEST] ${sujet}`,
      testMode: true,
    };
  }
  return { to: destinataires, cc, sujet, testMode: false };
};

// ────────────────────────────────────────────────────────────────────────────
// ENVOI
// ────────────────────────────────────────────────────────────────────────────
export const envoyerCommandes = async (entreprise, numcdes = [], user = null) => {
  const resultats = [];
  // Paramètres résolus une fois pour tout le lot (mode test + adresses).
  const params = await getParametres(entreprise);
  // Logo société (base64) — en-tête PDF + pièce jointe, comme l'Access.
  const logo = logoFromEntreprise(entreprise);

  for (const numcde of numcdes) {
    const base = { numcde };
    try {
      const r = await resoudreEnvoi(entreprise, numcde);
      if (r.erreur) {
        resultats.push({ ...base, statut: "erreur", message: r.erreur });
        continue;
      }

      // Pièces jointes (Excel + PDF).
      const [xls, pdf] = await Promise.all([
        genererExcelCommande(
          {
            numcde: r.detail.numcde,
            fournId: r.detail.fourn,
            fournNom: r.detail.fournNom,
            nomSociete: entreprise.nomComplet || entreprise.trigramme,
            datcde: r.detail.datcde,
          },
          r.detail.lignes,
        ),
        genererPdfCommande(
          {
            numcde: r.detail.numcde,
            fournId: r.detail.fourn,
            fournNom: r.detail.fournNom,
            nomSociete: entreprise.nomComplet || entreprise.trigramme,
            datcde: r.detail.datcde,
            bateau: r.detail.bateau,
            logo: logo?.buffer || null,
          },
          r.detail.lignes,
        ),
      ]);

      const attachments = [
        {
          filename: `${r.baseName}.xlsx`,
          content: xls,
          contentType:
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        },
        {
          filename: `${r.baseName}.pdf`,
          content: pdf,
          contentType: "application/pdf",
        },
      ];

      // Logo société en pièce jointe (comme l'Access : {SOC}.jpg).
      if (logo) {
        attachments.push({
          filename: `${(entreprise.trigramme || "SOC").toUpperCase()}.${logo.ext}`,
          content: logo.buffer,
          contentType: logo.contentType,
        });
      }

      const { to, cc, sujet, testMode } = appliquerModeTest(
        {
          destinataires: r.destinataires,
          cc: r.cc,
          sujet: r.sujet,
        },
        params,
      );

      await sendEmail({
        module: "envoi_cde_fournisseur",
        email: to,
        cc: cc.length ? cc : undefined,
        subject: sujet,
        html: r.html,
        attachments,
      });

      await EnvoiCdeHistorique.create({
        entreprise: entreprise._id,
        nomDossierDBF: entreprise.nomDossierDBF,
        numcde: r.detail.numcde,
        fournId: r.detail.fourn,
        fournNom: r.detail.fournNom,
        sujet,
        langue: r.langue,
        destinataires: to,
        cc,
        destinatairesReels: r.destinataires,
        nbLignes: r.detail.nbLignes,
        montantPrev: r.detail.montantPrev,
        montantTotal: r.detail.montantTotal,
        devise: r.detail.devise,
        testMode,
        envoyePar: user?._id || null,
        statut: "envoye",
      });

      resultats.push({
        numcde: r.detail.numcde,
        statut: "envoye",
        testMode,
        destinataires: to,
        fournNom: r.detail.fournNom,
      });
    } catch (err) {
      // Journalise l'échec.
      try {
        await EnvoiCdeHistorique.create({
          entreprise: entreprise._id,
          nomDossierDBF: entreprise.nomDossierDBF,
          numcde,
          envoyePar: user?._id || null,
          statut: "erreur",
          erreur: err.message,
        });
      } catch {
        /* ignore log error */
      }
      resultats.push({ ...base, statut: "erreur", message: err.message });
    }
  }

  const nbOk = resultats.filter((r) => r.statut === "envoye").length;
  const nbErr = resultats.length - nbOk;
  return { nbOk, nbErr, testMode: params.testMode, resultats };
};

// ────────────────────────────────────────────────────────────────────────────
// RELANCE FOURNISSEUR (depuis l'onglet Historique)
//
// On coche une ou plusieurs commandes déjà envoyées, et on relance. Les
// commandes sont REGROUPÉES PAR FOURNISSEUR : un fournisseur relancé sur 3
// commandes reçoit UN mail listant les 3, pas 3 mails.
// Le corps vient du modèle « relance » de la langue du fournisseur (onglet
// Modèles de message), avec ses {{variables}}.
// ────────────────────────────────────────────────────────────────────────────

// Formate une date DBF (Date ou "AAAAMMJJ") en jj/mm/aaaa.
const fmtDateFr = (v) => {
  if (!v) return "";
  let d = null;
  if (typeof v === "string" && /^\d{8}$/.test(v)) {
    d = new Date(+v.slice(0, 4), +v.slice(4, 6) - 1, +v.slice(6, 8));
  } else {
    const p = new Date(v);
    if (!isNaN(p.getTime())) d = p;
  }
  if (!d || isNaN(d.getTime())) return String(v);
  return d.toLocaleDateString("fr-FR");
};

// Tableau récapitulatif des commandes relancées, inséré avant la signature.
// Styles en ligne : les clients mail ignorent les feuilles de style.
const tableauRelance = (commandes, langue) => {
  const t =
    langue === "A"
      ? { cde: "Order", date: "Order date", lignes: "Lines", envoi: "Sent on" }
      : { cde: "Commande", date: "Date commande", lignes: "Lignes", envoi: "Envoyée le" };
  const th =
    'style="border:1px solid #cccccc;padding:6px 10px;background:#f2f2f2;text-align:left;font-size:13px;"';
  const td = 'style="border:1px solid #cccccc;padding:6px 10px;font-size:13px;"';
  const lignes = commandes
    .map(
      (c) =>
        `<tr><td ${td}><b>${c.numcde}</b></td><td ${td}>${fmtDateFr(c.datcde)}</td>` +
        `<td ${td}>${c.nbLignes || ""}</td><td ${td}>${fmtDateFr(c.dateEnvoi)}</td></tr>`,
    )
    .join("");
  return (
    '<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-family:Arial,sans-serif;">' +
    `<tr><th ${th}>${t.cde}</th><th ${th}>${t.date}</th><th ${th}>${t.lignes}</th><th ${th}>${t.envoi}</th></tr>` +
    `${lignes}</table>`
  );
};

// Prépare les relances : résout fournisseur, destinataires, sujet et corps.
// Sert l'aperçu ET l'envoi (aucune duplication de logique).
export const resoudreRelances = async (entreprise, numcdes = []) => {
  const liste = [...new Set(numcdes.map((n) => trim(n)).filter(Boolean))];
  if (!liste.length) return [];

  // Date du PREMIER envoi de chaque commande : c'est celle qu'on rappelle au
  // fournisseur (« commande adressée le… »), pas celle d'un éventuel renvoi.
  const envois = await EnvoiCdeHistorique.find({
    entreprise: entreprise._id,
    type: "commande",
    statut: "envoye",
    numcde: { $in: liste },
  })
    .sort({ createdAt: 1 })
    .select("numcde fournId fournNom createdAt")
    .lean();
  const premierEnvoi = new Map();
  for (const e of envois) if (!premierEnvoi.has(e.numcde)) premierEnvoi.set(e.numcde, e);

  // Regroupement par fournisseur.
  const groupes = new Map(); // fournId -> { fournId, fournNom, commandes[] }
  const erreurs = [];

  for (const numcde of liste) {
    const detail = await getDetailCommande(entreprise, numcde);
    const histo = premierEnvoi.get(numcde);
    // La commande peut avoir disparu des DBF (réceptionnée, purgée) : on se
    // rabat sur le fournisseur mémorisé dans l'historique d'envoi.
    const fournId = detail ? Number(detail.fourn) : Number(histo?.fournId);
    if (!fournId && fournId !== 0) {
      erreurs.push({ numcde, raison: `Fournisseur introuvable pour ${numcde}.` });
      continue;
    }
    const cle = String(fournId);
    if (!groupes.has(cle)) {
      groupes.set(cle, {
        fournId,
        fournNom: detail?.fournNom || histo?.fournNom || "",
        commandes: [],
      });
    }
    groupes.get(cle).commandes.push({
      numcde: detail?.numcde || numcde,
      datcde: detail?.datcde || null,
      nbLignes: detail?.nbLignes || 0,
      dateEnvoi: histo?.createdAt || null,
      // Lignes conservées pour régénérer les pièces jointes si demandé.
      lignes: detail?.lignes || null,
      bateau: detail?.bateau || "",
    });
  }

  // Responsable / CC de la société (identique à l'envoi de commande).
  const resp = await ResponsableCc.findOne({ entreprise: entreprise._id }).lean();
  const ccResp = resp?.emails || [];
  const nomSociete = entreprise.nomComplet || entreprise.trigramme || "";

  const resultats = [];
  for (const g of groupes.values()) {
    const fe = await FournisseurEmail.findOne({
      entreprise: entreprise._id,
      fournId: g.fournId,
    }).lean();

    const base = {
      fournId: g.fournId,
      fournNom: g.fournNom || fe?.fournLbl || "",
      commandes: g.commandes,
      numcdes: g.commandes.map((c) => c.numcde),
    };

    if (!fe || !(fe.emails || []).filter(Boolean).length) {
      resultats.push({
        ...base,
        erreur: `Pas d'email pour le fournisseur ${g.fournId} (${base.fournNom}).`,
      });
      continue;
    }

    const langue = fe.langue === "A" ? "A" : "F";
    const tpl = await chargerModele(entreprise._id, "relance", langue);

    const vars = {
      commandes: base.numcdes.join(", "),
      nb_commandes: base.numcdes.length,
      fournisseur: base.fournNom,
      code_fournisseur: g.fournId,
      date_envoi: fmtDateFr(
        g.commandes.map((c) => c.dateEnvoi).filter(Boolean)[0] || null,
      ),
      societe: nomSociete,
      date_du_jour: fmtDateFr(new Date()),
    };

    resultats.push({
      ...base,
      langue,
      destinataires: fe.emails.filter(Boolean),
      // CC = responsable société + transitaire fournisseur (comme une commande).
      cc: [...ccResp, ...(fe.emailsTransitaire || [])].filter(Boolean),
      sujet: appliquerVariables(tpl.sujet, vars),
      html: construireCorpsHtml(
        appliquerVariables(tpl.message, vars),
        tableauRelance(g.commandes, langue),
      ),
    });
  }

  // Les commandes non résolues remontent aussi, pour être affichées à l'écran.
  for (const e of erreurs) {
    resultats.push({ fournId: null, fournNom: "", numcdes: [e.numcde], erreur: e.raison });
  }
  return resultats;
};

// Envoie les relances. `avecPieces` rejoint l'Excel + le PDF de chaque commande
// (utile quand le fournisseur a perdu la commande d'origine).
export const envoyerRelances = async (
  entreprise,
  numcdes = [],
  { avecPieces = true } = {},
  user = null,
) => {
  const params = await getParametres(entreprise);
  const groupes = await resoudreRelances(entreprise, numcdes);
  const logo = logoFromEntreprise(entreprise);
  const nomSociete = entreprise.nomComplet || entreprise.trigramme;
  const trig = (entreprise.trigramme || "").toUpperCase();

  const resultats = [];
  for (const g of groupes) {
    if (g.erreur) {
      resultats.push({
        fournId: g.fournId,
        fournNom: g.fournNom,
        numcdes: g.numcdes,
        statut: "erreur",
        message: g.erreur,
      });
      continue;
    }

    try {
      // Pièces jointes : une paire Excel/PDF par commande encore lisible en DBF.
      const attachments = [];
      if (avecPieces) {
        for (const c of g.commandes) {
          if (!c.lignes || !c.lignes.length) continue;
          const meta = {
            numcde: c.numcde,
            fournId: g.fournId,
            fournNom: g.fournNom,
            nomSociete,
            datcde: c.datcde,
          };
          const baseName = buildBaseName(trig, c.numcde);
          const [xls, pdf] = await Promise.all([
            genererExcelCommande(meta, c.lignes),
            genererPdfCommande(
              { ...meta, bateau: c.bateau, logo: logo?.buffer || null },
              c.lignes,
            ),
          ]);
          attachments.push(
            {
              filename: `${baseName}.xlsx`,
              content: xls,
              contentType:
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            },
            { filename: `${baseName}.pdf`, content: pdf, contentType: "application/pdf" },
          );
        }
      }

      const { to, cc, sujet, testMode } = appliquerModeTest(
        { destinataires: g.destinataires, cc: g.cc, sujet: g.sujet },
        params,
      );

      await sendEmail({
        module: "envoi_cde_fournisseur",
        email: to,
        cc: cc.length ? cc : undefined,
        subject: sujet,
        html: g.html,
        attachments: attachments.length ? attachments : undefined,
      });

      await EnvoiCdeHistorique.create({
        entreprise: entreprise._id,
        nomDossierDBF: entreprise.nomDossierDBF,
        type: "relance",
        numcde: g.numcdes.join(", "),
        numcdes: g.numcdes,
        fournId: g.fournId,
        fournNom: g.fournNom,
        sujet,
        langue: g.langue,
        destinataires: to,
        cc,
        destinatairesReels: g.destinataires,
        nbLignes: g.commandes.reduce((s, c) => s + (c.nbLignes || 0), 0),
        testMode,
        envoyePar: user?._id || null,
        statut: "envoye",
      });

      resultats.push({
        fournId: g.fournId,
        fournNom: g.fournNom,
        numcdes: g.numcdes,
        statut: "envoye",
        testMode,
        destinataires: to,
      });
    } catch (err) {
      try {
        await EnvoiCdeHistorique.create({
          entreprise: entreprise._id,
          nomDossierDBF: entreprise.nomDossierDBF,
          type: "relance",
          numcde: g.numcdes.join(", "),
          numcdes: g.numcdes,
          fournId: g.fournId,
          fournNom: g.fournNom,
          envoyePar: user?._id || null,
          statut: "erreur",
          erreur: err.message,
        });
      } catch {
        /* ignore log error */
      }
      resultats.push({
        fournId: g.fournId,
        fournNom: g.fournNom,
        numcdes: g.numcdes,
        statut: "erreur",
        message: err.message,
      });
    }
  }

  const nbOk = resultats.filter((r) => r.statut === "envoye").length;
  return {
    nbOk,
    nbErr: resultats.length - nbOk,
    testMode: params.testMode,
    resultats,
  };
};

// ────────────────────────────────────────────────────────────────────────────
// ACCUSÉS DE RÉCEPTION (AR)
//
// Le fournisseur confirme la commande (mail, téléphone…) : on marque l'AR reçu
// depuis l'onglet « Accusés de réception », et un mail de confirmation lui part
// avec le MONTANT TOTAL retenu.
//
// Contrairement à la relance, on ne regroupe PAS par fournisseur : un AR porte
// sur UNE commande et sur SON montant — deux commandes confirmées font deux
// mails, chacun avec son montant.
// ────────────────────────────────────────────────────────────────────────────

// ⚠️ Quelques DATCDE de l'ERP sont aberrantes (saisies fausses : années 766,
// 1466, 1966… — 12 commandes sur 449 chez QC). On ne les écrit PAS dans un mail
// destiné au fournisseur : on retombe alors sur la date d'envoi de la commande.
// Les écrans, eux, continuent d'afficher la date telle qu'elle est dans l'ERP.
const dateFiable = (v) => {
  const d = v instanceof Date ? v : new Date(v);
  return !isNaN(d.getTime()) && d.getFullYear() >= 1990 && d.getFullYear() <= 2100;
};

// Tableau récapitulatif inséré avant la signature du mail d'AR.
const tableauAr = (cde, langue) => {
  const t =
    langue === "A"
      ? { cde: "Order", date: "Order date", lignes: "Lines", montant: "Total amount" }
      : { cde: "Commande", date: "Date commande", lignes: "Lignes", montant: "Montant total" };
  const th =
    'style="border:1px solid #cccccc;padding:6px 10px;background:#f2f2f2;text-align:left;font-size:13px;"';
  const td = 'style="border:1px solid #cccccc;padding:6px 10px;font-size:13px;"';
  return (
    '<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-family:Arial,sans-serif;">' +
    `<tr><th ${th}>${t.cde}</th><th ${th}>${t.date}</th><th ${th}>${t.lignes}</th>` +
    `<th ${th}>${t.montant}</th></tr>` +
    `<tr><td ${td}><b>${cde.numcde}</b></td><td ${td}>${fmtDateFr(cde.datcde)}</td>` +
    `<td ${td}>${cde.nbLignes || ""}</td>` +
    `<td ${td}><b>${formaterMontant(cde.montantTotal, cde.devise)}</b></td></tr></table>`
  );
};

// Liste de suivi : toutes les commandes déjà envoyées, avec leur statut d'AR.
// La source des commandes est l'HISTORIQUE des envois (type "commande"), pas les
// DBF : une commande réceptionnée quitte l'état « préparée » mais son AR reste à
// suivre. Le montant n'est calculé que pour la page affichée (lecture DBF).
export const getListeAr = async (entreprise, options = {}) => {
  const { statut = "", search = "", page = 1, limit = 50 } = options;

  const envois = await EnvoiCdeHistorique.aggregate([
    {
      $match: {
        entreprise: entreprise._id,
        type: "commande",
        statut: "envoye",
      },
    },
    { $sort: { createdAt: 1 } },
    {
      $group: {
        _id: "$numcde",
        dateEnvoi: { $first: "$createdAt" },
        dernierEnvoi: { $last: "$createdAt" },
        fournId: { $last: "$fournId" },
        fournNom: { $last: "$fournNom" },
        nbEnvois: { $sum: 1 },
      },
    },
    { $sort: { dateEnvoi: -1 } },
  ]);

  const suivis = await EnvoiCdeAr.find({ entreprise: entreprise._id })
    .populate("confirmePar", "nom prenom email")
    .lean();
  const parNumcde = new Map(suivis.map((s) => [s.numcde, s]));

  let rows = envois.map((e) => {
    const s = parNumcde.get(e._id);
    return {
      numcde: e._id,
      fournId: s?.fournId ?? e.fournId,
      fournNom: s?.fournNom || e.fournNom || "",
      dateEnvoi: e.dateEnvoi,
      dernierEnvoi: e.dernierEnvoi,
      nbEnvois: e.nbEnvois,
      statut: s?.statut === "confirme" ? "confirme" : "en_attente",
      montantRetenu: s?.montantTotal ?? null,
      montantCorrige: !!s?.montantCorrige,
      dateConfirmation: s?.dateConfirmation || null,
      confirmePar: s?.confirmePar || null,
      mailEnvoye: !!s?.mailEnvoye,
    };
  });

  if (statut === "en_attente" || statut === "confirme") {
    rows = rows.filter((r) => r.statut === statut);
  }
  if (search) {
    const rx = new RegExp(String(search).trim(), "i");
    rows = rows.filter(
      (r) => rx.test(r.numcde) || rx.test(r.fournNom) || rx.test(String(r.fournId ?? "")),
    );
  }

  const total = rows.length;
  const nbAttente = rows.filter((r) => r.statut === "en_attente").length;
  const p = Math.max(1, parseInt(page) || 1);
  const l = Math.max(1, parseInt(limit) || 50);
  const pageRows = rows.slice((p - 1) * l, p * l);

  // Enrichissement DBF (date, lignes, montant calculé) pour la page seulement.
  const commandes = [];
  for (const r of pageRows) {
    let entete = null;
    try {
      entete = await commandeCacheService.findByNumcde(entreprise, r.numcde);
    } catch {
      entete = null;
    }
    // Une seule lecture des lignes : elle sert au comptage ET au montant.
    let lignes = [];
    try {
      lignes = (await commandeCacheService.getDetailsByNumcde(entreprise, r.numcde)) || [];
    } catch {
      lignes = [];
    }
    const nbLignes = lignes.length;
    const montantCalcule = entete ? await calculerMontantLignes(entreprise, lignes) : 0;
    commandes.push({
      ...r,
      datcde: entete?.DATCDE || null,
      bateau: trim(entete?.BATEAU),
      etat: entete?.ETAT ?? null,
      devise: deviseCommande(entete),
      nbLignes,
      montantCalcule,
      // Montant à afficher/proposer : celui retenu à la confirmation s'il existe.
      montantTotal: r.montantRetenu ?? montantCalcule,
      // La commande n'est plus dans les DBF (archivage annuel de l'ERP).
      archivee: !entete,
    });
  }

  return { total, nbAttente, page: p, limit: l, commandes };
};

// Résout ce qui partira pour chaque AR (sert l'aperçu ET l'envoi).
// `commandes` = [{ numcde, montantTotal? }] — montantTotal absent => recalculé.
export const resoudreAr = async (entreprise, commandes = []) => {
  const resp = await ResponsableCc.findOne({ entreprise: entreprise._id }).lean();
  const ccResp = resp?.emails || [];
  const nomSociete = entreprise.nomComplet || entreprise.trigramme || "";

  // Date du 1er envoi de chaque commande (rappelée dans le mail).
  const numcdes = commandes.map((c) => trim(c.numcde)).filter(Boolean);
  const envois = await EnvoiCdeHistorique.find({
    entreprise: entreprise._id,
    type: "commande",
    statut: "envoye",
    numcde: { $in: numcdes },
  })
    .sort({ createdAt: 1 })
    .select("numcde fournId fournNom createdAt")
    .lean();
  const premierEnvoi = new Map();
  for (const e of envois) if (!premierEnvoi.has(e.numcde)) premierEnvoi.set(e.numcde, e);

  const resultats = [];
  for (const c of commandes) {
    const numcde = trim(c.numcde);
    if (!numcde) continue;

    const detail = await getDetailCommande(entreprise, numcde);
    const histo = premierEnvoi.get(numcde);
    const suivi = await EnvoiCdeAr.findOne({
      entreprise: entreprise._id,
      numcde,
    }).lean();

    const fournId = detail
      ? Number(detail.fourn)
      : Number(histo?.fournId ?? suivi?.fournId);
    const fournNom = detail?.fournNom || histo?.fournNom || suivi?.fournNom || "";
    const montantCalcule = detail ? detail.montantTotal : (suivi?.montantCalcule ?? 0);
    // Montant retenu : celui saisi par l'opérateur, sinon le calcul.
    const saisi = c.montantTotal;
    const montantTotal =
      saisi === undefined || saisi === null || saisi === ""
        ? montantCalcule
        : Math.round((Number(saisi) || 0) * 100) / 100;
    const devise = detail?.devise || suivi?.devise || "F";

    const dateEnvoi = histo?.createdAt || null;
    const base = {
      numcde,
      fournId: isNaN(fournId) ? null : fournId,
      fournNom,
      // Date annoncée au fournisseur (cf. dateFiable).
      datcde: dateFiable(detail?.datcde) ? detail.datcde : dateEnvoi,
      nbLignes: detail?.nbLignes || 0,
      dateEnvoi,
      montantCalcule,
      montantTotal,
      montantCorrige: Math.abs(montantTotal - montantCalcule) > 0.009,
      devise,
      archivee: !detail,
    };

    if (base.fournId === null) {
      resultats.push({ ...base, erreur: `Fournisseur introuvable pour ${numcde}.` });
      continue;
    }

    const fe = await FournisseurEmail.findOne({
      entreprise: entreprise._id,
      fournId: base.fournId,
    }).lean();

    if (!fe || !(fe.emails || []).filter(Boolean).length) {
      resultats.push({
        ...base,
        fournNom: fournNom || fe?.fournLbl || "",
        erreur: `Pas d'email pour le fournisseur ${base.fournId} (${fournNom}).`,
      });
      continue;
    }

    const langue = fe.langue === "A" ? "A" : "F";
    const tpl = await chargerModele(entreprise._id, "ar", langue);

    const vars = {
      commande: numcde,
      montant_total: formaterMontant(montantTotal, devise),
      montant: (montantTotal || 0).toLocaleString("fr-FR", {
        maximumFractionDigits: 2,
      }),
      devise,
      date_commande: fmtDateFr(base.datcde),
      date_envoi: fmtDateFr(base.dateEnvoi),
      nb_lignes: base.nbLignes,
      fournisseur: base.fournNom,
      code_fournisseur: base.fournId,
      societe: nomSociete,
      date_du_jour: fmtDateFr(new Date()),
    };

    resultats.push({
      ...base,
      langue,
      destinataires: fe.emails.filter(Boolean),
      // CC = responsable société + transitaire fournisseur (comme une commande).
      cc: [...ccResp, ...(fe.emailsTransitaire || [])].filter(Boolean),
      sujet: appliquerVariables(tpl.sujet, vars),
      html: construireCorpsHtml(
        appliquerVariables(tpl.message, vars),
        tableauAr(base, langue),
      ),
    });
  }
  return resultats;
};

// Confirme les AR : on ENREGISTRE d'abord (l'AR est un fait constaté), puis on
// tente le mail. Un échec d'envoi ne fait pas perdre la confirmation.
export const confirmerAr = async (
  entreprise,
  commandes = [],
  { envoyerMail = true } = {},
  user = null,
) => {
  const params = await getParametres(entreprise);
  const prepares = await resoudreAr(entreprise, commandes);

  const resultats = [];
  for (const a of prepares) {
    // Enregistrement du suivi (même si le fournisseur n'a pas d'email : l'AR
    // reste un fait à tracer, seul le mail est impossible).
    await EnvoiCdeAr.findOneAndUpdate(
      { entreprise: entreprise._id, numcde: a.numcde },
      {
        $set: {
          nomDossierDBF: entreprise.nomDossierDBF,
          fournId: a.fournId,
          fournNom: a.fournNom,
          statut: "confirme",
          montantTotal: a.montantTotal,
          montantCalcule: a.montantCalcule,
          montantCorrige: a.montantCorrige,
          devise: a.devise,
          dateConfirmation: new Date(),
          confirmePar: user?._id || null,
        },
      },
      { upsert: true, setDefaultsOnInsert: true },
    );

    if (a.erreur) {
      resultats.push({
        numcde: a.numcde,
        fournNom: a.fournNom,
        montantTotal: a.montantTotal,
        statut: "confirme_sans_mail",
        message: a.erreur,
      });
      continue;
    }

    if (!envoyerMail) {
      resultats.push({
        numcde: a.numcde,
        fournNom: a.fournNom,
        montantTotal: a.montantTotal,
        statut: "confirme_sans_mail",
        message: "Confirmation enregistrée sans envoi de mail.",
      });
      continue;
    }

    const { to, cc, sujet, testMode } = appliquerModeTest(
      { destinataires: a.destinataires, cc: a.cc, sujet: a.sujet },
      params,
    );

    try {
      await sendEmail({
        module: "envoi_cde_fournisseur",
        email: to,
        cc: cc.length ? cc : undefined,
        subject: sujet,
        html: a.html,
      });

      await EnvoiCdeAr.updateOne(
        { entreprise: entreprise._id, numcde: a.numcde },
        { $set: { mailEnvoye: true } },
      );

      await EnvoiCdeHistorique.create({
        entreprise: entreprise._id,
        nomDossierDBF: entreprise.nomDossierDBF,
        type: "ar",
        numcde: a.numcde,
        numcdes: [a.numcde],
        fournId: a.fournId,
        fournNom: a.fournNom,
        sujet,
        langue: a.langue,
        destinataires: to,
        cc,
        destinatairesReels: a.destinataires,
        nbLignes: a.nbLignes,
        montantTotal: a.montantTotal,
        devise: a.devise,
        testMode,
        envoyePar: user?._id || null,
        statut: "envoye",
      });

      resultats.push({
        numcde: a.numcde,
        fournNom: a.fournNom,
        montantTotal: a.montantTotal,
        devise: a.devise,
        statut: "envoye",
        testMode,
        destinataires: to,
      });
    } catch (err) {
      try {
        await EnvoiCdeHistorique.create({
          entreprise: entreprise._id,
          nomDossierDBF: entreprise.nomDossierDBF,
          type: "ar",
          numcde: a.numcde,
          numcdes: [a.numcde],
          fournId: a.fournId,
          fournNom: a.fournNom,
          montantTotal: a.montantTotal,
          devise: a.devise,
          envoyePar: user?._id || null,
          statut: "erreur",
          erreur: err.message,
        });
      } catch {
        /* ignore log error */
      }
      resultats.push({
        numcde: a.numcde,
        fournNom: a.fournNom,
        montantTotal: a.montantTotal,
        statut: "erreur",
        message: err.message,
      });
    }
  }

  const nbOk = resultats.filter((r) => r.statut === "envoye").length;
  const nbSansMail = resultats.filter((r) => r.statut === "confirme_sans_mail").length;
  return {
    nbOk,
    nbSansMail,
    nbErr: resultats.filter((r) => r.statut === "erreur").length,
    nbConfirmes: resultats.length,
    testMode: params.testMode,
    resultats,
  };
};

// Repasse des AR « en attente » (erreur de saisie). Le montant déjà retenu est
// conservé : il resservira de proposition à la prochaine confirmation.
export const annulerAr = async (entreprise, numcdes = []) => {
  const liste = [...new Set(numcdes.map((n) => trim(n)).filter(Boolean))];
  if (!liste.length) return { modifies: 0 };
  const r = await EnvoiCdeAr.updateMany(
    { entreprise: entreprise._id, numcde: { $in: liste } },
    {
      $set: {
        statut: "en_attente",
        dateConfirmation: null,
        confirmePar: null,
        mailEnvoye: false,
      },
    },
  );
  return { modifies: r.modifiedCount || 0 };
};

// ────────────────────────────────────────────────────────────────────────────
// ENVOI EN MASSE (vœux / annonces) — message TEXTE simple, FR et/ou EN.
// cible : "francais" | "anglais" | "selection" (+ fournIds).
// « toujours laisser la partie transitaire » -> le transitaire reste en copie.
// En MODE TEST : on n'envoie PAS un mail par fournisseur (anti-flood) ; on envoie
// un seul mail de contrôle par langue vers les adresses de test.
// ────────────────────────────────────────────────────────────────────────────
export const compterCiblesMasse = async (entreprise, cible, fournIds = []) => {
  const base = { entreprise: entreprise._id, actif: { $ne: false } };
  let q = base;
  if (cible === "francais") q = { ...base, langue: "F" };
  else if (cible === "anglais") q = { ...base, langue: "A" };
  else if (cible === "selection")
    q = { ...base, fournId: { $in: (fournIds || []).map(Number) } };
  const docs = await FournisseurEmail.find(q).lean();
  const avecMail = docs.filter((d) => (d.emails || []).filter(Boolean).length);
  return {
    total: avecMail.length,
    francais: avecMail.filter((d) => d.langue !== "A").length,
    anglais: avecMail.filter((d) => d.langue === "A").length,
  };
};

export const envoyerMasse = async (entreprise, payload = {}, user = null) => {
  const {
    cible = "selection",
    fournIds = [],
    sujetF = "",
    messageF = "",
    sujetA = "",
    messageA = "",
  } = payload;

  const params = await getParametres(entreprise);

  // Résolution des destinataires.
  const base = { entreprise: entreprise._id, actif: { $ne: false } };
  let q = base;
  if (cible === "francais") q = { ...base, langue: "F" };
  else if (cible === "anglais") q = { ...base, langue: "A" };
  else if (cible === "selection")
    q = { ...base, fournId: { $in: (fournIds || []).map(Number) } };
  const cibles = (await FournisseurEmail.find(q).lean()).filter(
    (d) => (d.emails || []).filter(Boolean).length,
  );

  const contenu = (langue) =>
    langue === "A"
      ? { sujet: trim(sujetA), message: messageA }
      : { sujet: trim(sujetF), message: messageF };

  const resultats = [];

  if (params.testMode) {
    // Anti-flood : un seul mail de contrôle par langue réellement ciblée.
    const languesCiblees = [...new Set(cibles.map((d) => (d.langue === "A" ? "A" : "F")))];
    for (const langue of languesCiblees) {
      const { sujet, message } = contenu(langue);
      const nb = cibles.filter((d) => (d.langue === "A" ? "A" : "F") === langue).length;
      if (!trim(message) || !sujet) {
        resultats.push({ langue, statut: "erreur", message: `Sujet/message ${langue} manquant.`, nbDestinataires: nb });
        continue;
      }
      try {
        await sendEmail({
        module: "envoi_cde_fournisseur",
          email: params.testEmails,
          subject: `[TEST x${nb}] ${sujet}`,
          html: construireCorpsTexte(message),
        });
        await EnvoiCdeHistorique.create({
          entreprise: entreprise._id,
          nomDossierDBF: entreprise.nomDossierDBF,
          type: "masse",
          numcde: `MASSE-${langue}`,
          fournNom: `Message groupé ${langue} (${nb} fournisseurs)`,
          sujet,
          langue,
          destinataires: params.testEmails,
          nbDestinataires: nb,
          testMode: true,
          envoyePar: user?._id || null,
          statut: "envoye",
        });
        resultats.push({ langue, statut: "envoye", nbDestinataires: nb, testMode: true });
      } catch (err) {
        resultats.push({ langue, statut: "erreur", message: err.message, nbDestinataires: nb });
      }
    }
    const nbOk = resultats.filter((r) => r.statut === "envoye").length;
    return { testMode: true, nbOk, nbErr: resultats.length - nbOk, nbCibles: cibles.length, resultats };
  }

  // MODE RÉEL : un mail par fournisseur, dans sa langue.
  for (const fe of cibles) {
    const langue = fe.langue === "A" ? "A" : "F";
    const { sujet, message } = contenu(langue);
    if (!trim(message) || !sujet) {
      resultats.push({ fournId: fe.fournId, statut: "ignore", message: `Message ${langue} vide.` });
      continue;
    }
    const to = (fe.emails || []).filter(Boolean);
    // « toujours laisser la partie transitaire » -> transitaire en copie.
    const cc = (fe.emailsTransitaire || []).filter(Boolean);
    try {
      await sendEmail({
        module: "envoi_cde_fournisseur",
        email: to,
        cc: cc.length ? cc : undefined,
        subject: sujet,
        html: construireCorpsTexte(message),
      });
      await EnvoiCdeHistorique.create({
        entreprise: entreprise._id,
        nomDossierDBF: entreprise.nomDossierDBF,
        type: "masse",
        numcde: `MASSE-${fe.fournId}`,
        fournId: fe.fournId,
        fournNom: fe.fournLbl,
        sujet,
        langue,
        destinataires: to,
        cc,
        destinatairesReels: to,
        nbDestinataires: 1,
        testMode: false,
        envoyePar: user?._id || null,
        statut: "envoye",
      });
      resultats.push({ fournId: fe.fournId, fournNom: fe.fournLbl, langue, statut: "envoye", destinataires: to });
    } catch (err) {
      resultats.push({ fournId: fe.fournId, fournNom: fe.fournLbl, statut: "erreur", message: err.message });
    }
  }
  const nbOk = resultats.filter((r) => r.statut === "envoye").length;
  return {
    testMode: false,
    nbOk,
    nbErr: resultats.filter((r) => r.statut === "erreur").length,
    nbIgnore: resultats.filter((r) => r.statut === "ignore").length,
    nbCibles: cibles.length,
    resultats,
  };
};

// ────────────────────────────────────────────────────────────────────────────
// IMPORT EXCEL DES EMAILS FOURNISSEURS (upload utilisateur) + SUPPRESSION MASSE
// ────────────────────────────────────────────────────────────────────────────
export const importerEmailsExcel = async (entreprise, buffer) => {
  const lignes = await parserEmailsExcel(buffer);
  let importes = 0;
  const erreurs = [];
  for (const l of lignes) {
    if (l.fournId === null) {
      erreurs.push({ ligne: l._ligne, raison: "FOURN_ID manquant ou non numérique." });
      continue;
    }
    if (!l.emails.length) {
      erreurs.push({ ligne: l._ligne, raison: `Aucun email (fourn ${l.fournId}).` });
      continue;
    }
    try {
      await FournisseurEmail.updateOne(
        { entreprise: entreprise._id, fournId: l.fournId },
        {
          $set: {
            fournLbl: l.fournLbl || "",
            langue: l.langue === "A" ? "A" : "F",
            emails: l.emails,
            emailsTransitaire: l.emailsTransitaire,
            emailsCC: l.emailsCC,
          },
          $setOnInsert: { actif: true },
        },
        { upsert: true },
      );
      importes += 1;
    } catch (e) {
      erreurs.push({ ligne: l._ligne, raison: e.message });
    }
  }
  return { total: lignes.length, importes, erreurs };
};

// Suppression : soit une liste d'_id, soit TOUS les fournisseurs de la société.
export const supprimerEmails = async (entreprise, { ids, all } = {}) => {
  if (all) {
    const r = await FournisseurEmail.deleteMany({ entreprise: entreprise._id });
    return { deleted: r.deletedCount || 0 };
  }
  if (Array.isArray(ids) && ids.length) {
    const r = await FournisseurEmail.deleteMany({
      entreprise: entreprise._id,
      _id: { $in: ids },
    });
    return { deleted: r.deletedCount || 0 };
  }
  return { deleted: 0 };
};

// ────────────────────────────────────────────────────────────────────────────
// IMPORT DE LA BASE DE RÉFÉRENCE (fichiers commités -> Mongo), PAR SOCIÉTÉ.
// Permet de peupler la prod (VPS) sans CLI : upsert des emails/modèles/responsable
// de la société courante depuis backend/data/*.js (migrés depuis Access).
// ────────────────────────────────────────────────────────────────────────────
// Charge les 3 fichiers de données migrés depuis Access.
const chargerDonneesReference = async () => {
  const [
    { default: fournisseurEmails },
    { default: messagesFournisseur },
    { default: responsablesCc },
  ] = await Promise.all([
    import("../data/fournisseurEmails.js"),
    import("../data/messagesFournisseur.js"),
    import("../data/responsablesCc.js"),
  ]);
  return { fournisseurEmails, messagesFournisseur, responsablesCc };
};

// Upsert des emails/modèles/responsable d'UNE société à partir de ses lignes.
const upsertReferencePourEntreprise = async (
  entrepriseId,
  { emails = [], messages = [], responsable = null },
) => {
  let nbEmails = 0;
  for (const row of emails) {
    await FournisseurEmail.updateOne(
      { entreprise: entrepriseId, fournId: row.fournId },
      {
        $set: {
          fournLbl: row.fournLbl || "",
          langue: row.langue === "A" ? "A" : "F",
          emails: row.emails || [],
          emailsTransitaire: row.emailsTransitaire || [],
          emailsCC: row.emailsCC || [],
        },
        $setOnInsert: { actif: true },
      },
      { upsert: true },
    );
    nbEmails += 1;
  }
  let nbMessages = 0;
  for (const row of messages) {
    await MessageFournisseur.updateOne(
      { entreprise: entrepriseId, langue: row.langue },
      { $set: { message: row.message || "" } },
      { upsert: true },
    );
    nbMessages += 1;
  }
  let nbResp = 0;
  if (responsable) {
    await ResponsableCc.updateOne(
      { entreprise: entrepriseId },
      { $set: { nom: responsable.nom || "", emails: responsable.emails || [] } },
      { upsert: true },
    );
    nbResp = 1;
  }
  return { emails: nbEmails, messages: nbMessages, responsables: nbResp };
};

// Import PAR SOCIÉTÉ (bouton de l'écran). Matching robuste :
// nomDossierDBF OU code société (et) OU trigramme.
export const importerReference = async (entreprise) => {
  const { fournisseurEmails, messagesFournisseur, responsablesCc } =
    await chargerDonneesReference();

  const dossier = String(entreprise.nomDossierDBF || "").toLowerCase();
  const trig = String(entreprise.trigramme || "").toUpperCase();
  const match = (row) =>
    (row.nomDossierDBF && String(row.nomDossierDBF).toLowerCase() === dossier) ||
    (row.et && String(row.et).toUpperCase() === trig) ||
    (row.trigramme && String(row.trigramme).toUpperCase() === trig);

  return upsertReferencePourEntreprise(entreprise._id, {
    emails: fournisseurEmails.filter(match),
    messages: messagesFournisseur.filter(match),
    responsable: responsablesCc.find(match) || null,
  });
};

// Import GLOBAL (toutes les sociétés d'un coup) — équivalent du CLI, exposé en UI.
// Résout chaque ligne vers son entreprise par nomDossierDBF puis par trigramme (et).
export const importerReferenceGlobale = async () => {
  const { fournisseurEmails, messagesFournisseur, responsablesCc } =
    await chargerDonneesReference();

  const entreprises = await Entreprise.find({}, "trigramme nomDossierDBF").lean();
  const parDossier = new Map();
  const parTrig = new Map();
  for (const e of entreprises) {
    if (e.nomDossierDBF) parDossier.set(String(e.nomDossierDBF).toLowerCase(), e);
    if (e.trigramme) parTrig.set(String(e.trigramme).toUpperCase(), e);
  }
  const resoudre = (row) =>
    (row.nomDossierDBF && parDossier.get(String(row.nomDossierDBF).toLowerCase())) ||
    (row.et && parTrig.get(String(row.et).toUpperCase())) ||
    (row.trigramme && parTrig.get(String(row.trigramme).toUpperCase())) ||
    null;

  // Regroupe les lignes par entreprise résolue.
  const groupes = new Map(); // entrepriseId -> { ent, emails, messages, responsable }
  const ignores = new Set();
  const ajouter = (row, cle) => {
    const ent = resoudre(row);
    if (!ent) {
      ignores.add(row.nomDossierDBF || row.et || row.trigramme || "?");
      return;
    }
    const id = String(ent._id);
    if (!groupes.has(id))
      groupes.set(id, { ent, emails: [], messages: [], responsable: null });
    const g = groupes.get(id);
    if (cle === "email") g.emails.push(row);
    else if (cle === "message") g.messages.push(row);
    else if (cle === "responsable") g.responsable = row;
  };
  fournisseurEmails.forEach((r) => ajouter(r, "email"));
  messagesFournisseur.forEach((r) => ajouter(r, "message"));
  responsablesCc.forEach((r) => ajouter(r, "responsable"));

  const parSociete = [];
  const total = { emails: 0, messages: 0, responsables: 0 };
  for (const { ent, emails, messages, responsable } of groupes.values()) {
    const n = await upsertReferencePourEntreprise(ent._id, {
      emails,
      messages,
      responsable,
    });
    total.emails += n.emails;
    total.messages += n.messages;
    total.responsables += n.responsables;
    parSociete.push({ trigramme: ent.trigramme, nomDossierDBF: ent.nomDossierDBF, ...n });
  }
  parSociete.sort((a, b) => b.emails - a.emails);
  return { ...total, parSociete, ignores: [...ignores] };
};

export default {
  getCommandesPreparees,
  getDetailCommande,
  verifierFournisseurs,
  resoudreEnvoi,
  envoyerCommandes,
  appliquerModeTest,
  getParametres,
  setParametres,
  getDefaultMessage,
  getDefaultRelance,
  getDefaultAr,
  nettoyerHtmlMessage,
  resoudreRelances,
  envoyerRelances,
  calculerMontantCommande,
  getListeAr,
  resoudreAr,
  confirmerAr,
  annulerAr,
  importerReference,
  importerReferenceGlobale,
  importerEmailsExcel,
  supprimerEmails,
  compterCiblesMasse,
  envoyerMasse,
};
