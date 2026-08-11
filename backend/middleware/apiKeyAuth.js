// backend/middleware/apiKeyAuth.js
//
// Authentification des appels PARTENAIRE (/api/public/v1) par clé d'API.
// Rien à voir avec `protect` (cookie JWT) : ici aucun utilisateur, aucun cookie,
// aucune session — juste un en-tête `X-API-Key` (ou `Authorization: Bearer`).
//
// Chaîne complète d'une route publique :
//   apiKeyAuth  ->  limiterDebit  ->  requireScope(...)  ->  chargerEntrepriseApi
//
// Le contrôle de périmètre est en DEUX dimensions, comme côté interne :
//   - `scopes`      : quelle RESSOURCE (articles / clients) ;
//   - `entreprises` : quelle SOCIÉTÉ (:nomDossierDBF).
// Les deux doivent passer.

import crypto from "crypto";
import asyncHandler from "./asyncHandler.js";
import ApiKey from "../models/ApiKeyModel.js";
import Entreprise from "../models/EntrepriseModel.js";

// ---------------------------------------------------------------------------
// Utilitaires
// ---------------------------------------------------------------------------

/** Comparaison à temps constant de deux hex de même longueur. */
const memeHash = (a, b) => {
  const ba = Buffer.from(String(a), "utf8");
  const bb = Buffer.from(String(b), "utf8");
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
};

/** Clé présentée par l'appelant : en-tête dédié ou Bearer. */
const lireCle = (req) => {
  const entete = req.get("x-api-key");
  if (entete) return entete.trim();
  const auth = req.get("authorization") || "";
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return null;
};

/**
 * IP de l'appelant. Derrière le reverse-proxy de production, l'IP réelle est
 * dans X-Forwarded-For (premier élément de la liste).
 */
const ipAppelant = (req) => {
  const xff = req.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return (req.ip || req.socket?.remoteAddress || "").replace(/^::ffff:/, "");
};

// ---------------------------------------------------------------------------
// Traçabilité d'usage — écriture Mongo THROTTLÉE
// ---------------------------------------------------------------------------
// Un site marchand peut appeler très souvent ; on ne veut pas une écriture par
// requête. On accumule en mémoire et on pousse au plus une fois par clé et par
// FENETRE_STATS. Les compteurs perdus lors d'un redémarrage sont sans enjeu :
// c'est de l'indicateur, pas de la comptabilité.
const FENETRE_STATS = 60 * 1000;
const statsEnAttente = new Map(); // prefixe -> { appels, dernierFlush, ip }

const tracerUsage = (cle, ip) => {
  const courant = statsEnAttente.get(cle.prefixe) || {
    appels: 0,
    dernierFlush: 0,
  };
  courant.appels += 1;
  courant.ip = ip;
  statsEnAttente.set(cle.prefixe, courant);

  if (Date.now() - courant.dernierFlush < FENETRE_STATS) return;
  courant.dernierFlush = Date.now();
  const appels = courant.appels;
  courant.appels = 0;

  ApiKey.updateOne(
    { _id: cle._id },
    {
      $inc: { nbAppels: appels },
      $set: { derniereUtilisation: new Date(), derniereIp: ip },
    },
  ).catch((err) =>
    console.warn(`[ApiKey] Trace d'usage non enregistrée: ${err.message}`),
  );
};

// ---------------------------------------------------------------------------
// 1) Authentification
// ---------------------------------------------------------------------------

const apiKeyAuth = asyncHandler(async (req, res, next) => {
  const cleBrute = lireCle(req);
  if (!cleBrute) {
    res.status(401);
    throw new Error(
      "Clé d'API manquante : renseignez l'en-tête X-API-Key (ou Authorization: Bearer VOTRE_CLE).",
    );
  }

  const prefixe = ApiKey.prefixeDe(cleBrute);
  if (!prefixe) {
    res.status(401);
    throw new Error("Clé d'API invalide");
  }

  const cle = await ApiKey.findOne({ prefixe });
  // Comparaison systématique (même si la clé est introuvable) pour ne pas
  // révéler par le temps de réponse qu'un préfixe existe.
  const attendu = cle ? cle.hash : "0".repeat(64);
  const ok = memeHash(ApiKey.hacher(cleBrute), attendu);

  if (!cle || !ok) {
    res.status(401);
    throw new Error("Clé d'API invalide");
  }

  if (!cle.actif) {
    res.status(403);
    throw new Error("Clé d'API révoquée");
  }

  if (cle.expireLe && cle.expireLe.getTime() < Date.now()) {
    res.status(403);
    throw new Error(
      `Clé d'API expirée le ${cle.expireLe.toISOString().slice(0, 10)}`,
    );
  }

  const ip = ipAppelant(req);
  if (cle.ipsAutorisees.length > 0 && !cle.ipsAutorisees.includes(ip)) {
    res.status(403);
    throw new Error(`Adresse IP non autorisée pour cette clé (${ip})`);
  }

  req.apiKey = cle;
  req.apiKeyIp = ip;

  // Réutilise l'élagage global des champs DBF (middleware/masquerChampsDbf.js) :
  // `installerMasqueDbf` est monté sur /api et lit `req.masqueDbf` au moment du
  // res.json. Poser le masque ici suffit à faire respecter `champsExclus` sur
  // TOUTES les réponses JSON de l'API publique, sans travail par contrôleur.
  const exclus = [
    ...(cle.champsExclus?.article || []),
    ...(cle.champsExclus?.clients || []),
  ].map((c) => String(c).toUpperCase());
  req.masqueDbf = exclus.length ? new Set(exclus) : null;

  tracerUsage(cle, ip);
  next();
});

// ---------------------------------------------------------------------------
// 2) Limitation de débit (fenêtre fixe d'une minute, en mémoire process)
// ---------------------------------------------------------------------------
// Volontairement simple et sans dépendance : c'est un garde-fou contre une
// boucle folle côté partenaire, pas une protection anti-DDoS. Sur plusieurs
// instances de serveur, la limite s'applique par instance.
const compteurs = new Map(); // prefixe -> { debut, nb }

const limiterDebit = (req, res, next) => {
  const cle = req.apiKey;
  const max = cle?.limiteParMinute || 0;
  if (!max) return next();

  const maintenant = Date.now();
  let c = compteurs.get(cle.prefixe);
  if (!c || maintenant - c.debut >= 60_000) {
    c = { debut: maintenant, nb: 0 };
    compteurs.set(cle.prefixe, c);
  }
  c.nb += 1;

  const restant = Math.max(0, max - c.nb);
  res.set("X-RateLimit-Limit", String(max));
  res.set("X-RateLimit-Remaining", String(restant));
  res.set(
    "X-RateLimit-Reset",
    String(Math.ceil((c.debut + 60_000) / 1000)),
  );

  if (c.nb > max) {
    const attente = Math.ceil((c.debut + 60_000 - maintenant) / 1000);
    res.set("Retry-After", String(attente));
    res.status(429);
    return next(
      new Error(
        `Quota dépassé : ${max} requêtes/minute. Réessayez dans ${attente}s.`,
      ),
    );
  }

  next();
};

// ---------------------------------------------------------------------------
// 3) Contrôle de ressource (scope)
// ---------------------------------------------------------------------------

const requireScope = (scope) => (req, res, next) => {
  if (req.apiKey?.scopes?.includes(scope)) return next();
  res.status(403);
  next(
    new Error(
      `Cette clé d'API n'a pas la permission « ${scope} ». Scopes accordés : ${
        req.apiKey?.scopes?.join(", ") || "aucun"
      }.`,
    ),
  );
};

// ---------------------------------------------------------------------------
// 4) Contrôle de société (:nomDossierDBF) + chargement de l'entreprise
// ---------------------------------------------------------------------------

const chargerEntrepriseApi = asyncHandler(async (req, res, next) => {
  const { nomDossierDBF } = req.params;

  const entreprise = await Entreprise.findOne({ nomDossierDBF });
  // Volontairement le MÊME message que pour une société non autorisée : une clé
  // partenaire n'a pas à découvrir la liste des sociétés du groupe par sondage.
  const refuser = () => {
    res.status(403);
    throw new Error(
      `Société « ${nomDossierDBF} » inconnue ou non autorisée pour cette clé d'API`,
    );
  };

  if (!entreprise) refuser();

  const autorisee = (req.apiKey.entreprises || []).some(
    (id) => id.toString() === entreprise._id.toString(),
  );
  if (!autorisee) refuser();

  if (!entreprise.isActive) {
    res.status(403);
    throw new Error(`La société « ${nomDossierDBF} » est désactivée`);
  }

  req.entreprise = entreprise;
  next();
});

export { apiKeyAuth, limiterDebit, requireScope, chargerEntrepriseApi };
