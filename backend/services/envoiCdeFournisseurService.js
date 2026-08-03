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
} from "./envoiCdeReportService.js";

import FournisseurEmail from "../models/FournisseurEmailModel.js";
import MessageFournisseur from "../models/MessageFournisseurModel.js";
import ResponsableCc from "../models/ResponsableCcModel.js";
import EnvoiCdeHistorique from "../models/EnvoiCdeHistoriqueModel.js";
import EnvoiCdeParametre from "../models/EnvoiCdeParametreModel.js";

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

// Construit le corps HTML final : on retire les balises html/body du modèle et
// on ré-enveloppe une seule fois avec la signature.
const construireCorpsHtml = (message) => {
  const inner = trim(message)
    .replace(/<\/?html>/gi, "")
    .replace(/<\/?body>/gi, "")
    .trim();
  return `<html><body>${inner}<br><br>${SIGNATURE_HTML}</body></html>`;
};

// ────────────────────────────────────────────────────────────────────────────
// LECTURE DES COMMANDES PRÉPARÉES (DBF)
// ────────────────────────────────────────────────────────────────────────────

// Liste paginée des commandes préparées (ETAT=1), enrichie du nom fournisseur.
export const getCommandesPreparees = async (entreprise, options = {}) => {
  const { page = 1, limit = 100, search = "", fourn } = options;

  const res = await commandeCacheService.getPaginated(entreprise, {
    page,
    limit,
    etat: ETAT_PREPAREE,
    search: search || undefined,
    fourn: fourn || undefined,
    withDetailTotals: true,
  });

  const commandes = await Promise.all(
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
        COUT_ACHAT_PREV: c.TOTAL_DETAIL || 0,
        NB_LIGNES: c.NB_LIGNES_DETAIL || 0,
      };
    }),
  );

  return { ...res, commandes };
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
      return {
        NL: Number(l.NL) || 0,
        NART: trim(l.NART),
        DESIGN: trim(art?.DESIGN || l.DESIGN),
        DESIFRN: trim(art?.DESIFRN),
        REFER: trim(art?.REFER || l.REFER),
        GENCOD: trim(art?.GENCOD),
        QTE: Number(l.QTE) || 0,
      };
    }),
  );

  const totaux = await commandeCacheService.getTotalsByNumcde(entreprise, numcde);

  return {
    numcde: trim(entete.NUMCDE),
    fourn: entete.FOURN,
    fournNom,
    datcde: entete.DATCDE,
    bateau: trim(entete.BATEAU),
    observ: trim(entete.OBSERV),
    montantPrev: totaux.totalQtePachat || 0,
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

  // Modèle de message (langue du fournisseur, avec repli).
  let tpl = await MessageFournisseur.findOne({
    entreprise: entreprise._id,
    langue,
  }).lean();
  if (!tpl) {
    tpl = await MessageFournisseur.findOne({
      entreprise: entreprise._id,
      langue: langue === "A" ? "F" : "A",
    }).lean();
  }
  // Repli final : modèle par défaut selon la langue (jamais de corps vide).
  let messageBrut = tpl?.message || getDefaultMessage(langue);

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
};
