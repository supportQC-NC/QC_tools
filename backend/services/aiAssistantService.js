// backend/services/aiAssistantService.js
//
// Assistant IA « métier » : un LLM (OpenAI) cadré sur la quincaillerie, qui NE
// répond QU'À PARTIR des données de la société via des OUTILS en LECTURE SEULE
// (function-calling) branchés sur les caches DBF existants (articles, clients,
// fournisseurs, commandes, proformas, factures). Aucune écriture. Réponse
// streamée token par token (voir le contrôleur SSE).
//
// Clé + modèle via .env : OPENAI_API_KEY (obligatoire), OPENAI_MODEL (déf. gpt-4o-mini).
import OpenAI from "openai";
import articleCacheService from "./articleService.js";
import clientCacheService from "./clientCacheService.js";
import fournissCacheService from "./fournissCacheService.js";
import commandeCacheService from "./commandeService.js";
import proformaCacheService from "./proformaCacheService.js";
import factureCacheService from "./factureCacheService.js";
import topArticlesService from "./topArticlesService.js";
import { buildAnalyseReappro } from "./analyseReapproService.js";
import { getFreshSnapshot } from "./aiSnapshotService.js";
// Données MongoDB (app) — annuaire/équipes, tâches, inventaires, mailing.
import Team from "../models/TeamModel.js";
import Task, { TASK_STATUTS } from "../models/TaskModel.js";
import Inventaire from "../models/InventaireModel.js";
import MailCampaign from "../models/MailCampaignModel.js";

const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const MAX_ROUNDS = 6; // garde-fou anti-boucle d'appels d'outils

let _client = null;
const getClient = () => {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error(
      "OPENAI_API_KEY manquant dans le .env — l'assistant IA est indisponible.",
    );
  }
  if (!_client) _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _client;
};

export const isConfigured = () => !!process.env.OPENAI_API_KEY;

// ── Helpers de normalisation ────────────────────────────────────────────────
const safe = (v) => (v == null ? "" : String(v)).trim();
const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};
// Retire les clés vides/undefined (économie de tokens).
const compact = (obj) => {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null || v === "") continue;
    out[k] = v;
  }
  return out;
};
// Enregistrement DBF « allégé » : garde les champs scalaires non vides (cap).
const slim = (rec, max = 30) => {
  if (!rec || typeof rec !== "object") return {};
  const out = {};
  let n = 0;
  for (const [k, v] of Object.entries(rec)) {
    if (n >= max) break;
    if (v == null || v === "") continue;
    const t = typeof v;
    if (t === "string" || t === "number" || t === "boolean") {
      out[k] = t === "string" ? v.trim() : v;
      n++;
    } else if (v instanceof Date) {
      out[k] = v.toISOString().slice(0, 10);
      n++;
    }
  }
  return out;
};

const round = (n) => Math.round(Number(n) || 0);
// Dates par défaut : période des 12 derniers mois, au format YYYY-MM-DD.
const ymd = (d) => d.toISOString().slice(0, 10);
const defaultPeriod = () => {
  const fin = new Date();
  const debut = new Date();
  debut.setMonth(debut.getMonth() - 12);
  return { date_debut: ymd(debut), date_fin: ymd(fin) };
};

const mapArticle = (r) =>
  compact({
    ref: safe(r.NART),
    designation: safe(r.DESIGN),
    prix_ttc_xpf: r.PVTETTC ? num(r.PVTETTC) : undefined,
    prix_promo_xpf: r.PVPROMO ? num(r.PVPROMO) : undefined,
    promo_active: articleCacheService.isPromoActive
      ? articleCacheService.isPromoActive(r) || undefined
      : undefined,
    gencod: safe(r.GENCOD) || undefined,
    stock: articleCacheService.calculateStockTotal
      ? articleCacheService.calculateStockTotal(r)
      : undefined,
    gisement: safe(r.GISM1) || undefined,
    groupe: safe(r.GROUPE) || undefined,
    fournisseur: r.FOURN != null ? r.FOURN : undefined,
    unite: safe(r.KL) || undefined,
  });

// ── Définition des OUTILS exposés au modèle ─────────────────────────────────
const TOOLS = [
  {
    type: "function",
    function: {
      name: "rechercher_articles",
      description:
        "Recherche des articles de la quincaillerie par texte libre (désignation, référence NART, code-barres GENCOD). Renvoie prix TTC (XPF), stock, gisement, groupe.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Termes de recherche" },
          en_stock: {
            type: "boolean",
            description: "Ne garder que les articles en stock",
          },
          limit: { type: "integer", description: "Nb max de résultats (déf. 15)" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "article_details",
      description:
        "Détails complets d'UN article précis par référence (NART) OU code-barres (GENCOD).",
      parameters: {
        type: "object",
        properties: {
          ref: { type: "string", description: "Référence article (NART)" },
          gencod: { type: "string", description: "Code-barres EAN-13" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "rechercher_clients",
      description:
        "Recherche des clients de la société par nom, code tiers, ville… Renvoie les infos client (hors données bancaires).",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          limit: { type: "integer", description: "Nb max (déf. 15)" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "rechercher_fournisseurs",
      description: "Recherche des fournisseurs de la société.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          limit: { type: "integer" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "commande_details",
      description:
        "Détails d'une commande fournisseur par numéro : entête + lignes (articles, quantités) + totaux.",
      parameters: {
        type: "object",
        properties: { numero: { type: "string", description: "Numéro de commande" } },
        required: ["numero"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "proforma_details",
      description: "Détails d'une proforma (devis) par numéro : entête + lignes.",
      parameters: {
        type: "object",
        properties: { numero: { type: "string", description: "Numéro de proforma" } },
        required: ["numero"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "facture_details",
      description: "Détails d'une facture par numéro : entête + lignes.",
      parameters: {
        type: "object",
        properties: { numero: { type: "string", description: "Numéro de facture" } },
        required: ["numero"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "top_articles",
      description:
        "Meilleures ventes (best-sellers) sur une période, d'après les factures : classement par chiffre d'affaires OU par quantité vendue. Par défaut : 12 derniers mois.",
      parameters: {
        type: "object",
        properties: {
          date_debut: { type: "string", description: "Début AAAA-MM-JJ (déf. il y a 12 mois)" },
          date_fin: { type: "string", description: "Fin AAAA-MM-JJ (déf. aujourd'hui)" },
          critere: {
            type: "string",
            enum: ["ca", "quantite"],
            description: "Classer par chiffre d'affaires (déf.) ou par quantité",
          },
          limit: { type: "integer", description: "Nb d'articles (déf. 10, max 25)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "chiffre_affaires",
      description:
        "Chiffre d'affaires TOTAL (factures, avoirs déduits) sur une période, + nb de factures et de références vendues. Par défaut : 12 derniers mois.",
      parameters: {
        type: "object",
        properties: {
          date_debut: { type: "string", description: "Début AAAA-MM-JJ" },
          date_fin: { type: "string", description: "Fin AAAA-MM-JJ" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "articles_par_categorie",
      description:
        "Liste les articles d'un GROUPE (famille) ou d'un GISEMENT (emplacement) donné.",
      parameters: {
        type: "object",
        properties: {
          groupe: { type: "string", description: "Code groupe/famille" },
          gisement: { type: "string", description: "Code gisement (GISM1)" },
          limit: { type: "integer", description: "Nb max (déf. 20)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "marge_article",
      description:
        "Marge / rentabilité d'UN article (par référence NART ou GENCOD) : prix de vente HT, coût (prix de revient), marge unitaire et TAUX de marge %.",
      parameters: {
        type: "object",
        properties: {
          ref: { type: "string", description: "Référence article (NART)" },
          gencod: { type: "string", description: "Code-barres EAN-13" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "rentabilite_top_ventes",
      description:
        "Croise les MEILLEURES VENTES avec la MARGE de chaque article : taux de marge % et marge totale générée (XPF). Pour repérer les best-sellers les plus/moins rentables. Défaut : 12 derniers mois.",
      parameters: {
        type: "object",
        properties: {
          date_debut: { type: "string", description: "Début AAAA-MM-JJ" },
          date_fin: { type: "string", description: "Fin AAAA-MM-JJ" },
          limit: { type: "integer", description: "Nb d'articles (déf. 10, max 20)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "articles_a_reapprovisionner",
      description:
        "Articles à RÉAPPROVISIONNER / en RUPTURE (réassort), priorisés par CA perdu : stock, ventes moyennes/mois, quantité à commander, CA perdu, fournisseur. Idéal pour préparer les commandes.",
      parameters: {
        type: "object",
        properties: {
          seulement_ruptures: { type: "boolean", description: "Ne garder que les articles en rupture (stock <= 0)" },
          limit: { type: "integer", description: "Nb d'articles (déf. 15, max 40)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "recherche_web",
      description:
        "Recherche sur le WEB (produits, références, NOUVEAUTÉS et tendances qui font le buzz, fournisseurs). À utiliser pour SUGGÉRER des nouveautés à vendre en quincaillerie / bricolage. Les résultats sont des sources externes : cite-les avec leur lien, ne les présente jamais comme des données internes.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Requête de recherche web" },
          limit: { type: "integer", description: "Nb de résultats (déf. 5)" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "lister_societes",
      description:
        "Liste les sociétés du périmètre courant (celles auxquelles l'utilisateur a accès). Utile pour savoir sur quelles sociétés tu peux répondre et récupérer leurs trigrammes.",
      parameters: { type: "object", properties: {} },
    },
  },
  // ── Données MongoDB (app) — scope-aware : société précise (societe) OU toutes
  //    les sociétés du périmètre si `societe` non fourni. ──
  {
    type: "function",
    function: {
      name: "equipes",
      description:
        "Équipes internes : nom, responsable, nombre de membres, société. Annuaire « qui gère quelle équipe ».",
      parameters: {
        type: "object",
        properties: {
          societe: { type: "string", description: "Trigramme (facultatif : sinon toutes les sociétés du périmètre)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "taches",
      description:
        "Tâches internes (avancement) : titre, statut, priorité, assignés, échéance, société. Filtrable par statut.",
      parameters: {
        type: "object",
        properties: {
          statut: { type: "string", enum: TASK_STATUTS, description: "Filtrer par statut" },
          societe: { type: "string", description: "Trigramme (facultatif)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "inventaires",
      description:
        "Sessions d'inventaire : nom, statut (en_cours/termine/exporte), articles comptés, quantité, responsable, société. Par défaut les inventaires en cours.",
      parameters: {
        type: "object",
        properties: {
          statut: { type: "string", enum: ["en_cours", "termine", "exporte"], description: "Filtrer par statut" },
          societe: { type: "string", description: "Trigramme (facultatif)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "mailing_stats",
      description:
        "Campagnes email : nom, statut, nb destinataires, envoyés, échecs, société.",
      parameters: {
        type: "object",
        properties: {
          societe: { type: "string", description: "Trigramme (facultatif)" },
        },
      },
    },
  },
];

// En multi-sociétés, chaque outil DE DONNÉES accepte un paramètre `societe`
// (trigramme) pour cibler une société précise. On l'injecte automatiquement.
for (const t of TOOLS) {
  const skip = ["recherche_web", "lister_societes"];
  if (skip.includes(t.function.name)) continue;
  const p = t.function.parameters;
  if (p && p.type === "object") {
    p.properties.societe = {
      type: "string",
      description:
        "Trigramme de la société ciblée. OBLIGATOIRE quand le périmètre contient plusieurs sociétés.",
    };
  }
}

// Résout l'entreprise concernée par un appel d'outil selon le périmètre.
const norm = (s) => String(s || "").trim().toLowerCase();
const resolveEntreprise = (args, ctx) => {
  const list = ctx.entreprises || [];
  if (list.length === 1) return list[0];
  if (list.length === 0) throw new Error("Aucune société accessible.");
  const key = norm(args.societe);
  if (!key) {
    throw new Error(
      "Plusieurs sociétés dans le périmètre : précise le trigramme via le paramètre `societe`. Disponibles : " +
        list.map((x) => x.trigramme).join(", ") + ".",
    );
  }
  const found = list.find(
    (x) => norm(x.trigramme) === key || norm(x.nomDossierDBF) === key || norm(x.nom) === key,
  );
  if (!found)
    throw new Error(
      `Société « ${args.societe} » hors du périmètre. Disponibles : ${list.map((x) => x.trigramme).join(", ")}.`,
    );
  return found;
};

// Ids d'entreprises ciblées pour les requêtes Mongo (société précise via `societe`,
// sinon TOUTES les sociétés du périmètre — les requêtes Mongo restent légères).
const scopeIds = (args, ctx) => {
  if (args.societe) return [resolveEntreprise(args, ctx)._id];
  return (ctx.entreprises || []).map((e) => e._id);
};
const fullName = (u) => (u ? `${u.prenom || ""} ${u.nom || ""}`.trim() : "");

// Recherche web via Tavily (clé optionnelle TAVILY_API_KEY). Résultats = sources
// EXTERNES : à citer, jamais présentées comme des données internes.
const webSearch = async (query, limit) => {
  const key = process.env.TAVILY_API_KEY;
  if (!key)
    return { erreur: "Recherche web non configurée (TAVILY_API_KEY manquant dans le .env)." };
  if (!query || !query.trim()) return { erreur: "Requête vide." };
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 12000);
    const r = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: key,
        query: query.slice(0, 400),
        max_results: Math.min(Math.max(limit || 5, 1), 8),
        search_depth: "basic",
        include_answer: false,
      }),
      signal: ctrl.signal,
    });
    clearTimeout(to);
    if (!r.ok) return { erreur: `Recherche web indisponible (HTTP ${r.status}).` };
    const data = await r.json();
    return {
      source: "web (externe)",
      resultats: (data.results || []).map((x) => ({
        titre: x.title,
        url: x.url,
        extrait: String(x.content || "").slice(0, 500),
      })),
    };
  } catch (e) {
    return { erreur: `Recherche web échouée : ${e.message}` };
  }
};

// Mémoïsation de l'agrégation factures (lourde sur les grosses sociétés) :
// évite de tout recalculer quand une même question demande top ventes ET CA,
// ou en cas de questions rapprochées. TTL court (2 min).
const _analyseCache = new Map(); // key -> { at, promise }
const ANALYSE_TTL = 2 * 60 * 1000;
const analyserVentes = (entreprise, debut, fin) => {
  const key = `${entreprise.nomDossierDBF}|${debut}|${fin}`;
  const hit = _analyseCache.get(key);
  if (hit && Date.now() - hit.at < ANALYSE_TTL) return hit.promise;
  const promise = topArticlesService.analyser(entreprise, debut, fin).catch((e) => {
    _analyseCache.delete(key); // ne pas mettre une erreur en cache
    throw e;
  });
  _analyseCache.set(key, { at: Date.now(), promise });
  return promise;
};

// Ventes pour un outil : si aucune date explicite → snapshot pré-calculé (INSTANTANÉ)
// s'il est frais, sinon calcul live (12 derniers mois). Dates explicites → live.
const getVentesForTool = async (entreprise, args) => {
  const explicit = args.date_debut || args.date_fin;
  if (!explicit) {
    const snap = await getFreshSnapshot(entreprise);
    if (snap)
      return {
        debut: snap.debut,
        fin: snap.fin,
        totaux: snap.totaux || {},
        topCa: snap.topCa || [],
        topQte: snap.topQte || [],
        source: "snapshot",
      };
  }
  const p = defaultPeriod();
  const debut = args.date_debut || p.date_debut;
  const fin = args.date_fin || p.date_fin;
  const res = await analyserVentes(entreprise, debut, fin);
  return { debut, fin, totaux: res.totaux, topCa: res.topCa, topQte: res.topQte, source: "live" };
};

// Marge d'un article (à partir de PREV = prix de revient, PVTE = vente HT).
const computeMargin = (r) => {
  const cout = num(r.PREV);
  const pvHt = num(r.PVTE) || (r.PVTETTC ? num(r.PVTETTC) / (1 + num(r.ATVA) / 100) : 0);
  if (!pvHt) return null;
  const marge = pvHt - cout;
  return compact({
    prix_vente_ht: round(pvHt),
    cout_ht: round(cout),
    marge_ht: round(marge),
    taux_marge_pct: pvHt ? Math.round((marge / pvHt) * 1000) / 10 : undefined,
  });
};

// ── Exécution d'un outil (LECTURE SEULE) ────────────────────────────────────
const runTool = async (name, args, ctx) => {
  const lim = Math.min(Math.max(parseInt(args.limit, 10) || 15, 1), 30);

  // Outils sans société : périmètre + web.
  if (name === "lister_societes") {
    return {
      societes: (ctx.entreprises || []).map((e) => ({
        trigramme: e.trigramme,
        nom: e.nom,
        dossier: e.nomDossierDBF,
      })),
    };
  }
  if (name === "recherche_web") {
    return webSearch(args.query || "", parseInt(args.limit, 10) || 5);
  }

  // ── Outils MongoDB (app) : scope-aware (société précise ou tout le périmètre) ──
  if (name === "equipes") {
    const teams = await Team.find({ entreprise: { $in: scopeIds(args, ctx) } })
      .populate("responsable", "prenom nom")
      .populate("entreprise", "trigramme")
      .select("nom responsable membres entreprise")
      .limit(100)
      .lean();
    return {
      equipes: teams.map((t) => ({
        nom: t.nom,
        societe: t.entreprise?.trigramme || "",
        responsable: fullName(t.responsable),
        nb_membres: (t.membres || []).length,
      })),
    };
  }
  if (name === "taches") {
    const q = { entreprise: { $in: scopeIds(args, ctx) }, archive: { $ne: true } };
    if (args.statut && TASK_STATUTS.includes(args.statut)) q.statut = args.statut;
    const tasks = await Task.find(q)
      .populate("assignes", "prenom nom")
      .populate("entreprise", "trigramme")
      .select("titre statut priorite deadline assignes entreprise")
      .sort({ updatedAt: -1 })
      .limit(80)
      .lean();
    return {
      taches: tasks.map((t) => ({
        titre: t.titre,
        statut: t.statut,
        priorite: t.priorite,
        societe: t.entreprise?.trigramme || "",
        assignes: (t.assignes || []).map(fullName),
        echeance: t.deadline ? new Date(t.deadline).toISOString().slice(0, 10) : null,
      })),
    };
  }
  if (name === "inventaires") {
    const q = { entreprise: { $in: scopeIds(args, ctx) } };
    q.status = ["en_cours", "termine", "exporte"].includes(args.statut)
      ? args.statut
      : "en_cours";
    const invs = await Inventaire.find(q)
      .populate("user", "prenom nom")
      .populate("entreprise", "trigramme")
      .select("nom status totalArticles totalQuantite user entreprise updatedAt")
      .sort({ updatedAt: -1 })
      .limit(50)
      .lean();
    return {
      inventaires: invs.map((i) => ({
        nom: i.nom,
        statut: i.status,
        societe: i.entreprise?.trigramme || "",
        par: fullName(i.user),
        articles_comptes: i.totalArticles,
        quantite_totale: i.totalQuantite,
        maj: i.updatedAt ? new Date(i.updatedAt).toISOString().slice(0, 10) : null,
      })),
    };
  }
  if (name === "mailing_stats") {
    const camps = await MailCampaign.find({ entreprise: { $in: scopeIds(args, ctx) } })
      .populate("entreprise", "trigramme")
      .select("nom status recipientsTotal sentCount failedCount entreprise updatedAt")
      .sort({ updatedAt: -1 })
      .limit(50)
      .lean();
    return {
      campagnes: camps.map((c) => ({
        nom: c.nom,
        statut: c.status,
        societe: c.entreprise?.trigramme || "",
        destinataires: c.recipientsTotal,
        envoyes: c.sentCount,
        echecs: c.failedCount,
      })),
    };
  }

  // Outils DE DONNÉES DBF : on résout la société ciblée (mono = auto, multi = `societe`).
  const entreprise = resolveEntreprise(args, ctx);
  switch (name) {
    case "rechercher_articles": {
      const r = await articleCacheService.search(entreprise, args.query || "", {
        limit: lim,
        enStock: !!args.en_stock,
      });
      return {
        total_trouve: r.totalFound,
        articles: (r.articles || []).map(mapArticle),
      };
    }
    case "article_details": {
      let rec = null;
      if (args.ref) rec = await articleCacheService.findByNart(entreprise, args.ref);
      if (!rec && args.gencod)
        rec = await articleCacheService.findByGencod(entreprise, args.gencod);
      if (!rec) return { trouve: false };
      return {
        trouve: true,
        article: mapArticle(rec),
        marge: computeMargin(rec) || undefined,
        brut: slim(rec, 20),
      };
    }
    case "rechercher_clients": {
      const r = await clientCacheService.search(entreprise, args.query || "", {
        limit: lim,
      });
      const list = Array.isArray(r) ? r : r.clients || r.results || [];
      return { clients: list.slice(0, lim).map((c) => slim(c, 22)) };
    }
    case "rechercher_fournisseurs": {
      const r = await fournissCacheService.search(entreprise, args.query || "", {
        limit: lim,
      });
      const list = Array.isArray(r) ? r : r.fournisseurs || r.results || [];
      return { fournisseurs: list.slice(0, lim).map((f) => slim(f, 20)) };
    }
    case "commande_details": {
      const numcde = safe(args.numero);
      const entete = await commandeCacheService.findByNumcde(entreprise, numcde);
      if (!entete) return { trouve: false };
      const lignes = await commandeCacheService.getDetailsByNumcde(entreprise, numcde);
      let totaux = null;
      try {
        totaux = await commandeCacheService.getTotalsByNumcde(entreprise, numcde);
      } catch { /* optionnel */ }
      return {
        trouve: true,
        entete: slim(entete, 20),
        lignes: (lignes || []).slice(0, 60).map((l) => slim(l, 12)),
        totaux,
      };
    }
    case "proforma_details": {
      const numfact = safe(args.numero);
      const entete = await proformaCacheService.findByNumfact(entreprise, numfact);
      if (!entete) return { trouve: false };
      const lignes = await proformaCacheService.getProdetByNumfact(entreprise, numfact);
      return {
        trouve: true,
        entete: slim(entete, 20),
        lignes: (lignes || []).slice(0, 60).map((l) => slim(l, 12)),
      };
    }
    case "facture_details": {
      const numfact = safe(args.numero);
      const entete = await factureCacheService.findByNumfact(entreprise, numfact);
      if (!entete) return { trouve: false };
      const lignes = await factureCacheService.getDetailByNumfact(entreprise, numfact);
      return {
        trouve: true,
        entete: slim(entete, 20),
        lignes: (lignes || []).slice(0, 60).map((l) => slim(l, 12)),
      };
    }
    case "top_articles": {
      const v = await getVentesForTool(entreprise, args);
      const parQte = args.critere === "quantite";
      const topLim = Math.min(Math.max(parseInt(args.limit, 10) || 10, 1), 25);
      const liste = (parQte ? v.topQte : v.topCa).slice(0, topLim);
      return {
        periode: { debut: v.debut, fin: v.fin },
        critere: parQte ? "quantite" : "chiffre_affaires",
        ca_total_xpf: round(v.totaux.caTotal),
        nb_factures: v.totaux.nbFacturesAnalysees,
        top: liste.map((a) => ({
          rang: a.rang,
          ref: a.nart,
          designation: a.design,
          quantite: round(a.qte),
          ca_xpf: round(a.ca),
          part_ca_pct: Math.round((a.partCa || 0) * 10) / 10,
        })),
      };
    }
    case "chiffre_affaires": {
      const v = await getVentesForTool(entreprise, args);
      return {
        periode: { debut: v.debut, fin: v.fin },
        ca_total_xpf: round(v.totaux.caTotal),
        quantite_totale: round(v.totaux.qteTotale),
        nb_factures: v.totaux.nbFacturesAnalysees,
        nb_references_vendues: v.totaux.nbArticlesDistincts,
      };
    }
    case "marge_article": {
      let rec = null;
      if (args.ref) rec = await articleCacheService.findByNart(entreprise, args.ref);
      if (!rec && args.gencod)
        rec = await articleCacheService.findByGencod(entreprise, args.gencod);
      if (!rec) return { trouve: false };
      const marge = computeMargin(rec);
      if (!marge) return { trouve: true, marge_disponible: false, article: mapArticle(rec) };
      return { trouve: true, article: mapArticle(rec), marge };
    }
    case "rentabilite_top_ventes": {
      const v = await getVentesForTool(entreprise, args);
      const topLim = Math.min(Math.max(parseInt(args.limit, 10) || 10, 1), 20);
      const liste = v.topCa.slice(0, topLim);
      const out = [];
      for (const a of liste) {
        let rec = null;
        try {
          rec = await articleCacheService.findByNart(entreprise, a.nart);
        } catch { /* ignore */ }
        const marge = rec ? computeMargin(rec) : null;
        out.push(
          compact({
            rang: a.rang,
            ref: a.nart,
            designation: a.design,
            quantite: round(a.qte),
            ca_xpf: round(a.ca),
            taux_marge_pct: marge?.taux_marge_pct,
            marge_generee_xpf: marge ? round(marge.marge_ht * a.qte) : undefined,
          }),
        );
      }
      return { periode: { debut: v.debut, fin: v.fin }, articles: out };
    }
    case "articles_a_reapprovisionner": {
      const rea = await buildAnalyseReappro(entreprise, { maxRows: 400 });
      let rows = rea.rows || [];
      if (args.seulement_ruptures) rows = rows.filter((r) => r.enRupture);
      const n = Math.min(Math.max(parseInt(args.limit, 10) || 15, 1), 40);
      return {
        kpis: rea.kpis,
        articles: rows.slice(0, n).map((r) =>
          compact({
            ref: r.nart,
            designation: r.design,
            fournisseur: r.fournNom || undefined,
            gisement: r.gisement || undefined,
            stock: r.stock,
            en_rupture: r.enRupture || undefined,
            vente_moy_mois: round(r.vteMoyMois),
            a_commander: r.reappro,
            ca_perdu_mois_xpf: round(r.caPerdu),
          }),
        ),
      };
    }
    case "articles_par_categorie": {
      let arts = [];
      if (args.groupe)
        arts = await articleCacheService.findArticlesByGroupe(entreprise, [args.groupe]);
      else if (args.gisement)
        arts = await articleCacheService.findArticlesByGism1(entreprise, [args.gisement]);
      else return { erreur: "Fournir un groupe OU un gisement." };
      return {
        total: (arts || []).length,
        articles: (arts || []).slice(0, lim).map(mapArticle),
      };
    }
    default:
      return { erreur: `Outil inconnu : ${name}` };
  }
};

// System prompt : cadre strict (quincaillerie + périmètre société + lecture seule).
const buildSystemPrompt = (entreprises, mode) => {
  const today = new Date().toISOString().slice(0, 10);
  const lignes = [
    "Tu es l'assistant interne expert d'un groupe de quincailleries en Nouvelle-Calédonie. Tu connais bien le marché du bricolage, de l'outillage, du jardin, de la maison et du bâtiment.",
    `Nous sommes le ${today} (utilise TOUJOURS cette date pour interpréter « cette année », « ce mois-ci », « les 12 derniers mois », etc. — jamais une autre année par défaut).`,
  ];

  if (mode === "societe" && entreprises.length === 1) {
    const e = entreprises[0];
    lignes.push(
      `PÉRIMÈTRE : tu réponds UNIQUEMENT sur la société « ${e.nom || e.trigramme} » (trigramme ${e.trigramme}). N'utilise le paramètre \`societe\` d'aucun outil pour sortir de cette société.`,
    );
  } else {
    const liste = entreprises.map((e) => `${e.trigramme} (${e.nom})`).join(", ");
    lignes.push(
      `PÉRIMÈTRE : l'utilisateur a accès à PLUSIEURS sociétés : ${liste}. Pour interroger une société, passe son TRIGRAMME dans le paramètre \`societe\` des outils. Pour une question transverse (comparaison / agrégat), appelle l'outil pour CHAQUE société concernée puis synthétise. Tu ne dois JAMAIS répondre sur une société hors de cette liste.`,
    );
  }

  lignes.push(
    "Pour les données INTERNES — ERP/DBF (articles, stock, prix, MARGE/rentabilité, clients, fournisseurs, commandes, proformas, factures, chiffre d'affaires, meilleures ventes, RÉASSORT/ruptures) ET application/Mongo (équipes, tâches & avancement, sessions d'inventaire, campagnes mailing) — tu passes EXCLUSIVEMENT par les outils. N'invente JAMAIS de données internes ; si un outil ne renvoie rien, dis-le.",
    "RECHERCHE WEB (outil recherche_web) : sers-t'en pour trouver des NOUVEAUTÉS et tendances qui font le buzz, pertinentes pour une quincaillerie (outillage, énergie/solaire, jardin, maison connectée, sécurité, DIY…), et croise-les avec les MEILLEURES VENTES pour proposer un assortiment argumenté. Cite toujours tes sources web avec leur lien (format markdown [titre](url)). Les résultats web sont EXTERNES : ne les présente jamais comme des données internes.",
    "Tu ne fais que SUGGÉRER : tu es en LECTURE SEULE, tu ne commandes/modifies rien et n'affirmes jamais avoir passé une commande.",
    "Format : réponds en français, en MARKDOWN clair (titres, listes à puces, gras, liens cliquables). Montants en XPF sans décimales. Sois concis et actionnable.",
    "Pour toute demande hors domaine (quincaillerie, ces données, ou recherches produits utiles au métier), décline poliment.",
  );
  return lignes.join(" ");
};

/**
 * Lance l'assistant en STREAMING avec boucle d'appels d'outils.
 * @param {Object} p
 * @param {Array}  p.history     - [{role:'user'|'assistant', content}] (dialogue passé)
 * @param {string} p.message     - nouveau message utilisateur
 * @param {Array}  p.entreprises - docs Entreprise du périmètre (>=1)
 * @param {string} p.mode        - "societe" | "all"
 * @param {(t:string)=>void} p.onDelta - appelé pour chaque fragment de texte
 * @returns {Promise<string>} le texte complet de la réponse
 */
export const runAssistant = async ({
  history = [],
  message,
  entreprises = [],
  mode = "societe",
  onDelta,
}) => {
  const client = getClient();
  const ctx = { entreprises, mode };
  const messages = [
    { role: "system", content: buildSystemPrompt(entreprises, mode) },
    ...history
      .filter((m) => m && (m.role === "user" || m.role === "assistant") && m.content)
      .slice(-16)
      .map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: String(message || "").slice(0, 4000) },
  ];

  let full = "";
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const stream = await client.chat.completions.create({
      model: MODEL,
      messages,
      tools: TOOLS,
      tool_choice: "auto",
      temperature: 0.2,
      stream: true,
    });

    let content = "";
    const toolCalls = [];
    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta;
      if (!delta) continue;
      if (delta.content) {
        content += delta.content;
        full += delta.content;
        if (onDelta) onDelta(delta.content);
      }
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const i = tc.index;
          if (!toolCalls[i])
            toolCalls[i] = { id: tc.id, type: "function", function: { name: "", arguments: "" } };
          if (tc.id) toolCalls[i].id = tc.id;
          if (tc.function?.name) toolCalls[i].function.name += tc.function.name;
          if (tc.function?.arguments)
            toolCalls[i].function.arguments += tc.function.arguments;
        }
      }
    }

    // Pas d'outil demandé -> réponse finale.
    if (toolCalls.length === 0) break;

    // Sinon : on rejoue le tour assistant + les résultats d'outils.
    messages.push({
      role: "assistant",
      content: content || null,
      tool_calls: toolCalls,
    });
    for (const tc of toolCalls) {
      let args = {};
      try {
        args = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
      } catch {
        args = {};
      }
      let result;
      try {
        result = await runTool(tc.function.name, args, ctx);
      } catch (e) {
        result = { erreur: e.message || "Échec de l'outil" };
      }
      messages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: JSON.stringify(result).slice(0, 12000),
      });
    }
  }

  return full;
};

export default { runAssistant, isConfigured };
