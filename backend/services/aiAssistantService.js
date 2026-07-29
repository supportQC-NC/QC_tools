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
      name: "recherche_web",
      description:
        "Recherche sur le WEB (produits, références, nouveautés, fournisseurs, tendances). À utiliser pour SUGGÉRER des nouveautés à commander ou comparer des références externes. Les résultats sont des sources externes : cite-les, ne les présente jamais comme des données internes.",
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
];

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

// ── Exécution d'un outil (LECTURE SEULE) ────────────────────────────────────
const runTool = async (name, args, entreprise) => {
  const lim = Math.min(Math.max(parseInt(args.limit, 10) || 15, 1), 30);
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
      return { trouve: true, article: mapArticle(rec), brut: slim(rec, 20) };
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
      const p = defaultPeriod();
      const debut = args.date_debut || p.date_debut;
      const fin = args.date_fin || p.date_fin;
      const res = await analyserVentes(entreprise, debut, fin);
      const parQte = args.critere === "quantite";
      const topLim = Math.min(Math.max(parseInt(args.limit, 10) || 10, 1), 25);
      const liste = (parQte ? res.topQte : res.topCa).slice(0, topLim);
      return {
        periode: { debut, fin },
        critere: parQte ? "quantite" : "chiffre_affaires",
        ca_total_xpf: round(res.totaux.caTotal),
        nb_factures: res.totaux.nbFacturesAnalysees,
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
      const p = defaultPeriod();
      const debut = args.date_debut || p.date_debut;
      const fin = args.date_fin || p.date_fin;
      const res = await analyserVentes(entreprise, debut, fin);
      return {
        periode: { debut, fin },
        ca_total_xpf: round(res.totaux.caTotal),
        quantite_totale: round(res.totaux.qteTotale),
        nb_factures: res.totaux.nbFacturesAnalysees,
        nb_references_vendues: res.totaux.nbArticlesDistincts,
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
    case "recherche_web":
      return webSearch(args.query || "", parseInt(args.limit, 10) || 5);
    default:
      return { erreur: `Outil inconnu : ${name}` };
  }
};

// System prompt : cadre strict (quincaillerie + société courante + lecture seule).
const buildSystemPrompt = (entreprise) => {
  const nom = entreprise?.nom || entreprise?.trigramme || "la société";
  const today = new Date().toISOString().slice(0, 10);
  return [
    "Tu es l'assistant interne d'un groupe de quincailleries en Nouvelle-Calédonie.",
    `Nous sommes le ${today} (utilise TOUJOURS cette date pour interpréter « cette année », « ce mois-ci », « les 12 derniers mois », etc. — n'utilise jamais une autre année par défaut).`,
    `Tu travailles sur les données de la société « ${nom} » (société actuellement sélectionnée).`,
    "Pour les données INTERNES (articles, stock, prix, clients, fournisseurs, commandes, proformas, factures, chiffre d'affaires, meilleures ventes), tu passes EXCLUSIVEMENT par les outils fournis. N'invente JAMAIS de données internes : si un outil ne renvoie rien, dis-le clairement.",
    "Tu peux aussi faire des RECHERCHES WEB (outil recherche_web) pour proposer des nouveautés à commander, comparer des références externes ou repérer des tendances. Les résultats web sont des sources EXTERNES : cite-les (titre + lien) et ne les présente jamais comme des données internes.",
    "Analyse pertinente attendue : croise les ventes (meilleures ventes / CA) avec des idées de nouveautés (web) pour faire des SUGGESTIONS d'achat argumentées. Tu ne fais que SUGGÉRER : tu ne commandes rien et ne modifies rien (lecture seule). N'affirme jamais avoir passé une commande.",
    "Les montants sont en francs pacifique (XPF), sans décimales. Sois concis, factuel et professionnel. Réponds en français.",
    "Pour toute question hors du domaine (quincaillerie, ces données, ou recherches produits utiles au métier), décline poliment.",
  ].join(" ");
};

/**
 * Lance l'assistant en STREAMING avec boucle d'appels d'outils.
 * @param {Object} p
 * @param {Array}  p.history     - [{role:'user'|'assistant', content}] (dialogue passé)
 * @param {string} p.message     - nouveau message utilisateur
 * @param {Object} p.entreprise  - doc Entreprise (scope société)
 * @param {(t:string)=>void} p.onDelta - appelé pour chaque fragment de texte
 * @returns {Promise<string>} le texte complet de la réponse
 */
export const runAssistant = async ({ history = [], message, entreprise, onDelta }) => {
  const client = getClient();
  const messages = [
    { role: "system", content: buildSystemPrompt(entreprise) },
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
        result = await runTool(tc.function.name, args, entreprise);
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
