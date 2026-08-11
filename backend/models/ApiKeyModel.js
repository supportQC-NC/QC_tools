// backend/models/ApiKeyModel.js
//
// Clés d'API « partenaire » — accès machine-à-machine à l'API publique
// (/api/public/v1), en LECTURE SEULE, pour un prestataire externe
// (ex. le site marchand SITEC).
//
// Pourquoi un modèle dédié plutôt qu'un simple utilisateur + JWT :
//   - un prestataire n'est pas un employé : pas de compte, pas de cookie, pas de
//     session ; une clé longue durée envoyée en en-tête convient mieux ;
//   - le périmètre doit être verrouillé DEUX FOIS (sociétés autorisées ET
//     ressources autorisées), indépendamment du modèle Permission interne ;
//   - une clé se révoque / se renouvelle sans toucher aux comptes internes.
//
// La clé en clair n'est JAMAIS stockée : seul son SHA-256 l'est. Elle n'est
// affichée qu'une fois, à la création (voir backend/scripts/apiKeys.js).
// Le `prefixe` (début de la clé, non secret) sert à retrouver la ligne en base
// et à identifier la clé dans les logs sans divulguer le secret.

import mongoose from "mongoose";
import crypto from "crypto";

// Ressources exposables. Une clé ne peut jamais faire plus que lire.
export const SCOPES_API = ["articles:read", "clients:read"];

const PREFIXE_CLE = "qcapi_";
const TAILLE_PREFIXE = 12; // caractères significatifs après "qcapi_"

const apiKeySchema = new mongoose.Schema(
  {
    // Libellé lisible : à qui appartient la clé, pour quel usage.
    nom: {
      type: String,
      required: [true, "Nom de la clé requis"],
      trim: true,
    },
    // Début de la clé (non secret) — sert de clé de recherche.
    prefixe: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    // SHA-256 hex de la clé complète. Le secret lui-même n'est pas stocké.
    hash: {
      type: String,
      required: true,
    },
    // Sociétés (Entreprise) accessibles avec cette clé. Vide = aucune.
    entreprises: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Entreprise",
      },
    ],
    // Ressources autorisées (cf. SCOPES_API).
    scopes: {
      type: [String],
      enum: SCOPES_API,
      default: [],
    },
    // Champs DBF à NE PAS renvoyer, par table (noms DBF en MAJUSCULES).
    // Vide = tous les champs sont exposés (comportement par défaut).
    // Exemple pour retirer les identifiants extranet des clients :
    //   { clients: ["LOGIN", "INTPASS"] }
    champsExclus: {
      article: { type: [String], default: [] },
      clients: { type: [String], default: [] },
    },
    // Liste blanche d'IP appelantes. Vide = pas de restriction d'IP.
    ipsAutorisees: {
      type: [String],
      default: [],
    },
    // Garde-fou de débit (fenêtre glissante d'une minute, en mémoire process).
    limiteParMinute: {
      type: Number,
      default: 120,
    },
    actif: {
      type: Boolean,
      default: true,
    },
    // Expiration facultative. null = pas d'expiration.
    expireLe: {
      type: Date,
      default: null,
    },
    // Traçabilité d'usage (écriture throttlée, cf. middleware/apiKeyAuth.js).
    derniereUtilisation: { type: Date, default: null },
    derniereIp: { type: String, default: "" },
    nbAppels: { type: Number, default: 0 },
    notes: { type: String, default: "" },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true },
);

// Le secret ne doit jamais fuiter par une sérialisation distraite.
apiKeySchema.set("toJSON", {
  transform: (doc, ret) => {
    delete ret.hash;
    return ret;
  },
});

/** SHA-256 hex d'une clé en clair. */
apiKeySchema.statics.hacher = function (cle) {
  return crypto.createHash("sha256").update(String(cle), "utf8").digest("hex");
};

/**
 * Génère une nouvelle clé.
 * @returns {{cle: string, prefixe: string, hash: string}} `cle` est le secret
 *          en clair — à transmettre au prestataire, il ne sera plus jamais
 *          récupérable ensuite.
 */
apiKeySchema.statics.genererCle = function () {
  // base64url : 32 octets -> 43 caractères sans caractère à échapper en URL.
  const secret = crypto.randomBytes(32).toString("base64url");
  const cle = `${PREFIXE_CLE}${secret}`;
  return {
    cle,
    prefixe: `${PREFIXE_CLE}${secret.slice(0, TAILLE_PREFIXE)}`,
    hash: this.hacher(cle),
  };
};

/** Préfixe déduit d'une clé présentée par un appelant (recherche en base). */
apiKeySchema.statics.prefixeDe = function (cle) {
  const brut = String(cle || "");
  if (!brut.startsWith(PREFIXE_CLE)) return null;
  const secret = brut.slice(PREFIXE_CLE.length);
  if (secret.length < TAILLE_PREFIXE) return null;
  return `${PREFIXE_CLE}${secret.slice(0, TAILLE_PREFIXE)}`;
};

const ApiKey = mongoose.model("ApiKey", apiKeySchema);

export default ApiKey;
