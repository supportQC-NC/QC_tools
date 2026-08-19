// backend/services/veilleService.js
//
// Module « Veille » : chaque semaine, l'IA prépare un récap des actualités du
// domaine suivi par l'utilisateur et le livre en PAGE HTML AUTONOME (ouverte
// dans un nouvel onglet depuis l'écran).
//
// Deux étapes, volontairement séparées :
//   1. RECHERCHE — on interroge le web (Tavily) une fois par thématique et on
//      récupère de vraies sources datées. Sans cette étape le modèle invente
//      des actualités et des liens : c'est le principal risque du module.
//   2. RÉDACTION — un seul appel OpenAI, qui reçoit les sources et n'a plus
//      qu'à trier, hiérarchiser et mettre en forme.
//
// On ne passe PAS par le function-calling de l'assistant IA : pour un job
// planifié, une recherche déterministe est plus prévisible et moins coûteuse.
//
// Clés .env : OPENAI_API_KEY (obligatoire), TAVILY_API_KEY (fortement
// recommandée), OPENAI_VEILLE_MODEL / OPENAI_VEILLE_MODEL_PRO (facultatives).
import OpenAI from "openai";
import VeilleConfig, { JOURS } from "../models/VeilleConfigModel.js";
import VeilleRapport from "../models/VeilleRapportModel.js";

const MODEL_STANDARD =
  process.env.OPENAI_VEILLE_MODEL || process.env.OPENAI_MODEL || "gpt-4o-mini";
const MODEL_QUALITE = process.env.OPENAI_VEILLE_MODEL_PRO || "gpt-4o";

let _client = null;
const getClient = () => {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error(
      "OPENAI_API_KEY manquant dans le .env — le module Veille est indisponible.",
    );
  }
  if (!_client) _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _client;
};

export const isConfigured = () => !!process.env.OPENAI_API_KEY;
export const rechercheWebConfiguree = () => !!process.env.TAVILY_API_KEY;

const trim = (v) => (v === null || v === undefined ? "" : String(v).trim());

// ────────────────────────────────────────────────────────────────────────────
// TRAME DU PROMPT
//
// C'est le « fond » du module : la structure est figée ici, seuls les {{champs}}
// sont saisis par l'utilisateur. Un utilisateur averti peut réécrire toute la
// trame (VeilleConfig.promptPersonnalise) en gardant les mêmes {{champs}}.
// ────────────────────────────────────────────────────────────────────────────
export const VEILLE_PROMPT_TEMPLATE = `Prépare-moi une veille hebdomadaire sur {{domaine}} (tâche récurrente tous les {{jour}} à {{heure}}).

OBJECTIF
Me faire un récap clair, visuel et rapide à lire des actualités de la semaine écoulée sur {{domaine}}, en {{zone}}.

THÉMATIQUES À COUVRIR
{{thematiques}}

STRUCTURE ATTENDUE
- Un titre accrocheur pour la semaine
- Une section par thématique, avec pour chaque info : le fait, pourquoi ça compte, et une idée d'action concrète pour {{activite}}
- Une sélection "Top {{topX}} à retenir cette semaine" en début de rapport
- Sources citées (nom + lien)

FORMAT DE SORTIE
Un fichier HTML autonome, au design {{style}} (façon {{reference}}) avec une hiérarchie visuelle claire.
Utilise cette palette de couleurs :
{{couleurs}}
Utilise ces typos :
{{typoTexte}} pour les textes
{{typoTitres}} pour les titres
Livre le fichier prêt à ouvrir dans le navigateur.`;

// ────────────────────────────────────────────────────────────────────────────
// ZONES GÉOGRAPHIQUES
//
// Liste fermée : l'écran en fait une liste déroulante, le service s'en sert
// pour cadrer la recherche d'actualités. `recherche` est le complément ajouté
// aux requêtes Tavily — volontairement VIDE pour « Monde entier », sinon on
// polluerait la requête avec un terme qui ne veut rien dire pour un moteur.
// ────────────────────────────────────────────────────────────────────────────
export const ZONES = [
  {
    valeur: "Nouvelle-Calédonie",
    recherche: "Nouvelle-Calédonie",
    // Mots-clés servant à rattacher une valeur libre existante à cette zone.
    // Pas d'abréviation courte type « nc » : elle matcherait « fra(nc)aise ».
    motsCles: ["caledonie", "noumea", "kanaky"],
  },
  {
    valeur: "Pacifique",
    recherche: "Pacifique Océanie",
    motsCles: ["pacifique", "oceanie", "polynesie", "vanuatu", "fidji"],
  },
  {
    valeur: "France",
    recherche: "France",
    motsCles: ["france", "metropole", "hexagone", "francais"],
  },
  {
    valeur: "Monde entier",
    recherche: "",
    motsCles: ["monde", "international", "mondial", "global"],
  },
];

export const ZONE_DEFAUT = ZONES[0].valeur;

const sansAccent = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // retire les signes diacritiques
    .toLowerCase();

// Ramène une valeur (y compris une saisie libre d'avant la liste déroulante,
// ex. « Nouvelle-Calédonie et Pacifique ») sur l'une des quatre zones.
export const normaliserZone = (valeur) => {
  const v = trim(valeur);
  if (!v) return ZONE_DEFAUT;
  const exact = ZONES.find((z) => z.valeur === v);
  if (exact) return exact.valeur;
  const n = sansAccent(v);
  // Premier mot-clé reconnu dans l'ordre de la liste (le plus précis d'abord).
  const trouve = ZONES.find((z) => z.motsCles.some((m) => n.includes(m)));
  return trouve ? trouve.valeur : ZONE_DEFAUT;
};

// Complément géographique injecté dans les requêtes de recherche.
const zoneRecherche = (valeur) =>
  ZONES.find((z) => z.valeur === normaliserZone(valeur))?.recherche ?? "";

// Valeurs proposées à la création d'une veille (l'écran pré-remplit avec ça).
export const VEILLE_DEFAUTS = {
  nom: "Ma veille hebdomadaire",
  jour: 1,
  heure: "08:00",
  domaine: "la quincaillerie et le bricolage",
  zone: ZONE_DEFAUT,
  thematiques:
    "Marché et concurrence\nNouveaux produits et fournisseurs\nRéglementation et normes\nLogistique et import\nTendances de consommation",
  activite: "un groupe de quincailleries en Nouvelle-Calédonie",
  topX: 5,
  style: "sobre et premium",
  reference: "newsletter premium",
  couleurs: ["#0F172A", "#6366F1", "#F8FAFC"],
  typoTexte: "Inter",
  typoTitres: "Playfair Display",
  qualite: "standard",
};

// Champs remplaçables — servent aussi à l'aide affichée dans l'écran.
export const VEILLE_CHAMPS = [
  { cle: "domaine", label: "Domaine suivi" },
  { cle: "zone", label: "Zone géographique" },
  { cle: "thematiques", label: "Thématiques à couvrir" },
  { cle: "activite", label: "Votre activité" },
  { cle: "topX", label: "Nombre d'infos « à retenir »" },
  { cle: "style", label: "Style du design" },
  { cle: "reference", label: "Référence visuelle" },
  { cle: "couleurs", label: "Palette de couleurs" },
  { cle: "typoTexte", label: "Typo des textes" },
  { cle: "typoTitres", label: "Typo des titres" },
  { cle: "jour", label: "Jour d'envoi" },
  { cle: "heure", label: "Heure d'envoi" },
];

// Liste des thématiques, nettoyée (une par ligne, puces éventuelles retirées).
export const listeThematiques = (config) =>
  String(config.thematiques || "")
    .split(/\r?\n/)
    .map((t) => t.replace(/^[-*•\s]+/, "").trim())
    .filter(Boolean);

// Remplit la trame avec les valeurs de la veille.
export const construirePrompt = (config) => {
  const trame = trim(config.promptPersonnalise) || VEILLE_PROMPT_TEMPLATE;
  const thematiques = listeThematiques(config);
  const valeurs = {
    domaine: trim(config.domaine) || "votre domaine",
    zone: normaliserZone(config.zone),
    thematiques: thematiques.length
      ? thematiques.map((t) => `- ${t}`).join("\n")
      : "- Actualités générales du domaine",
    activite: trim(config.activite) || "mon activité",
    topx: String(config.topX || 5),
    style: trim(config.style) || "sobre et premium",
    reference: trim(config.reference) || "newsletter premium",
    couleurs: (config.couleurs || []).filter(Boolean).join("\n"),
    typotexte: trim(config.typoTexte) || "Inter",
    typotitres: trim(config.typoTitres) || "Playfair Display",
    jour: JOURS[config.jour] || "lundi",
    heure: trim(config.heure) || "08:00",
  };
  return trame.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (m, cle) => {
    const v = valeurs[String(cle).toLowerCase()];
    return v === undefined ? m : v;
  });
};

// ────────────────────────────────────────────────────────────────────────────
// RECHERCHE D'ACTUALITÉS (Tavily)
// ────────────────────────────────────────────────────────────────────────────
const JOURS_FENETRE = 8; // « la semaine écoulée », avec un jour de marge
const MAX_SOURCES = 45;
// En dessous de ce nombre d'actualités exploitables, on relance la recherche
// SANS le filtre géographique : mieux vaut une vraie actualité internationale
// qu'un fait local inventé faute de matière (c'est exactement ce qui produisait
// des rapports « plausibles » mais sans aucune source réelle).
const SEUIL_ELARGISSEMENT = 5;

// Domaines qui ne sont jamais des sources d'actualité : annuaires, réseaux
// sociaux, places de marché, pages produit. Tavily en remonte beaucoup sur les
// requêtes de niche, et le modèle s'en sert alors comme « preuve ».
const HOTES_BRUIT = [
  "instagram.com", "facebook.com", "tiktok.com", "pinterest.",
  "x.com", "twitter.com", "youtube.com", "linkedin.com",
  "amazon.", "aliexpress.", "ebay.", "leboncoin.",
  "annuaire", "pagesjaunes", "biznc.nc", "societe.com", "verif.com",
  // Portails d'appels d'offres : listes qui se renouvellent en permanence,
  // remontent sur toutes les requêtes « matériaux » et n'apportent aucun fait.
  "francemarches.com", "marchesonline.com", "boamp.fr",
];
const CHEMINS_BRUIT = [
  "/annuaire", "/produit/", "/product/", "/boutique/", "/panier",
  "/categorie/", "/category/", "/collections/",
  "/appel-offre", "/appels-offre",
];

const estBruit = (s) => {
  const url = (s.url || "").toLowerCase();
  if (!url) return true;
  if (HOTES_BRUIT.some((h) => url.includes(h))) return true;
  if (CHEMINS_BRUIT.some((c) => url.includes(c))) return true;
  // Un extrait trop court ne permet ni de vérifier ni de rédiger.
  if ((s.extrait || "").length < 80) return true;
  return false;
};

const chercher = async (query, { topic = "news", days, depth = "basic", max = 6 } = {}) => {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 20000);
  try {
    const r = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: process.env.TAVILY_API_KEY,
        query: query.slice(0, 400),
        // topic "news" + days : Tavily ne remonte que des articles récents,
        // ce qui est tout l'intérêt d'une veille hebdomadaire. Le second
        // passage utilise topic "general" pour les analyses de fond, qui
        // n'ont pas de date de publication récente mais restent pertinentes.
        topic,
        ...(days ? { days } : {}),
        max_results: max,
        search_depth: depth,
        include_answer: false,
      }),
      signal: ctrl.signal,
    });
    if (!r.ok) return [];
    const data = await r.json();
    return (data.results || []).map((x) => ({
      titre: trim(x.title),
      url: trim(x.url),
      date: trim(x.published_date),
      extrait: String(x.content || "").slice(0, 900),
    }));
  } catch {
    // Une requête qui échoue ne doit pas faire tomber toute la veille.
    return [];
  } finally {
    clearTimeout(to);
  }
};

// Fusionne des lots de résultats EN ALTERNANCE (round-robin) pour qu'une seule
// thématique ne monopolise pas le budget de sources, en filtrant le bruit.
const fusionner = (lots, etiquettes, type, vues, sortie, plafond) => {
  const maxParLot = Math.max(...lots.map((l) => l.length), 0);
  for (let i = 0; i < maxParLot; i++) {
    for (let l = 0; l < lots.length; l++) {
      const s = lots[l][i];
      if (!s || !s.url || vues.has(s.url) || estBruit(s)) continue;
      vues.add(s.url);
      sortie.push({ ...s, type, thematique: etiquettes[l] });
      if (sortie.length >= plafond) return;
    }
  }
};

// Deux passes complémentaires :
//   - ACTUALITÉS : ce qui s'est passé cette semaine (topic news, fenêtre 8 j) ;
//   - TENDANCES  : analyses de fond, chiffres de marché, innovations — sans
//     contrainte de date. Ce sont elles qui donnent au rapport ses « liens pour
//     aller plus loin » et évitent une veille réduite à des brèves.
export const rechercherActualites = async (config) => {
  if (!rechercheWebConfiguree())
    return { sources: [], sansRechercheWeb: true, elargi: false };

  const domaine = trim(config.domaine);
  // « Monde entier » n'ajoute rien à la requête : la recherche reste mondiale.
  const zone = zoneRecherche(config.zone);
  const thematiques = listeThematiques(config).slice(0, 8);
  const nettoyer = (q) => q.replace(/\s+/g, " ").trim();

  const requetesActu = [
    nettoyer(`${domaine} ${zone} actualité`),
    ...thematiques.map((t) => nettoyer(`${t} ${domaine} ${zone}`)),
  ];
  const requetesFond = [
    nettoyer(`tendances ${domaine} ${zone}`),
    nettoyer(`marché ${domaine} ${zone} chiffres études`),
    nettoyer(`innovations nouveautés ${domaine}`),
  ];

  const [lotsActu, lotsFond] = await Promise.all([
    Promise.all(requetesActu.map((q) => chercher(q, { topic: "news", days: JOURS_FENETRE }))),
    Promise.all(
      requetesFond.map((q) =>
        chercher(q, { topic: "general", depth: "advanced", max: 5 }),
      ),
    ),
  ]);

  const vues = new Set();
  const sources = [];
  fusionner(lotsActu, requetesActu, "actualite", vues, sources, MAX_SOURCES);
  const nbActualites = sources.length;

  // Trop peu de matière locale : on relance les actualités sans la zone.
  let elargi = false;
  if (nbActualites < SEUIL_ELARGISSEMENT && zone) {
    const requetesLarges = [
      nettoyer(`${domaine} actualité`),
      ...thematiques.map((t) => nettoyer(`${t} ${domaine}`)),
    ];
    const lotsLarges = await Promise.all(
      requetesLarges.map((q) => chercher(q, { topic: "news", days: JOURS_FENETRE })),
    );
    fusionner(lotsLarges, requetesLarges, "actualite", vues, sources, MAX_SOURCES);
    elargi = sources.length > nbActualites;
  }

  fusionner(lotsFond, requetesFond, "tendance", vues, sources, MAX_SOURCES);

  return {
    sources,
    sansRechercheWeb: sources.length === 0,
    elargi,
    nbActualites: sources.filter((s) => s.type === "actualite").length,
    nbTendances: sources.filter((s) => s.type === "tendance").length,
  };
};

// ────────────────────────────────────────────────────────────────────────────
// GÉNÉRATION DU HTML
// ────────────────────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `Tu es un analyste de veille. Tu produis un rapport de veille hebdomadaire sous forme d'UNE page HTML autonome, prête à ouvrir dans un navigateur.

RÈGLE N°1 — LA TRAÇABILITÉ (c'est le cœur du travail)
Chaque affirmation factuelle du rapport DOIT être rattachée à une source numérotée de la liste fournie.
- Tu n'écris AUCUN fait, chiffre, nom d'entreprise, date ou tendance qui ne figure pas dans les extraits fournis. Pas de « les commerçants rapportent une hausse » si aucune source ne le dit : c'est une invention, et c'est le défaut le plus grave possible dans une veille.
- Tu n'inventes JAMAIS une URL. Tout lien du document est copié À L'IDENTIQUE depuis la liste des sources. Un lien inventé est détecté et neutralisé automatiquement après génération : il ne te sert à rien.
- Tu ne devines JAMAIS une date. Les seules dates utilisables sont celles fournies (date du jour, période couverte, dates des sources).
- Si une thématique n'a aucune source exploitable, sa section dit explicitement « Aucune actualité identifiée cette semaine sur cette thématique » — et rien d'autre. Une section vide et honnête vaut infiniment mieux qu'une section remplie de généralités.
- Écarte toi-même le bruit résiduel (annuaires, pages boutique, articles hors sujet) : ne t'en sers pas comme source.

STRUCTURE DE CHAQUE INFORMATION
- LE FAIT : ce qui s'est passé, avec l'appel de source « [n] » collé à la fin de la phrase.
- POURQUOI ÇA COMPTE : ton analyse (elle, peut être ton raisonnement, mais elle doit découler du fait).
- ACTION CONCRÈTE : une proposition opérationnelle.
- Ligne « Source : <a href="URL RÉELLE" target="_blank">Nom du média</a> » sous chaque information.

STRUCTURE DE CHAQUE CHAPITRE
- Traite 2 à 4 informations par thématique DÈS QUE les sources le permettent. Une seule info par chapitre alors que la liste en contient plusieurs sur le sujet, c'est un rapport bâclé. À l'inverse, s'il n'y a qu'une seule source pertinente, une seule info suffit.
- Chaque section se termine OBLIGATOIREMENT par un bloc dont le titre est exactement « Sources de ce chapitre » (reprends ces mots tels quels), listant en liens cliquables réels TOUTES les sources utilisées dans cette section : média, titre de l'article, date si connue. Ce bloc est ce qui permet au lecteur de vérifier le chapitre sans parcourir tout le rapport — ne l'omets jamais, même quand le chapitre ne contient qu'une seule information.
- Une section sans source exploitable affiche « Aucune actualité identifiée cette semaine sur cette thématique » et n'a alors pas de bloc de sources.

GABARIT D'UNE SECTION (structure à reproduire pour chaque thématique, en l'habillant avec tes styles)
<section class="theme">
  <h2>Titre de la thématique</h2>

  <article>
    <h3>Titre court de l'information</h3>
    <p><strong>Le fait :</strong> … [3]</p>
    <p><strong>Pourquoi ça compte :</strong> …</p>
    <p><strong>Action concrète :</strong> …</p>
    <p class="src">Source : <a href="URL EXACTE DE LA SOURCE 3" target="_blank">Nom du média</a></p>
  </article>

  <!-- répéter <article> pour chaque information de la thématique -->

  <div class="sources-chapitre">
    <h4>Sources de ce chapitre</h4>
    <ul>
      <li><a href="URL EXACTE" target="_blank">Titre de l'article</a> — Nom du média, date</li>
    </ul>
  </div>
</section>

SECTION FINALE « POUR ALLER PLUS LOIN »
Après les thématiques, ajoute une section reprenant les sources de type TENDANCE (analyses de fond, études, chiffres de marché, innovations) sous forme de liste de liens cliquables réels, chacun avec une phrase expliquant ce qu'on y trouve. C'est ce qui fait la différence entre un fil de brèves et une vraie veille.
Termine par la liste COMPLÈTE et numérotée de toutes les sources fournies que tu as réellement utilisées (numéro, titre, média, date, lien cliquable).

RÈGLES DE FORME
1. Ta réponse est UNIQUEMENT le document HTML complet, de "<!DOCTYPE html>" à "</html>". Aucun texte avant, aucun texte après, aucune clôture de bloc de code markdown.
2. Le document doit être AUTONOME : tout le CSS dans une balise <style>. AUCUN JavaScript, aucune balise <script> (elle serait bloquée à l'affichage).
3. Charge OBLIGATOIREMENT les polices demandées depuis Google Fonts dans le <head>, sinon elles ne s'afficheront pas : <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=NOM+DE+LA+POLICE:wght@400;600;700&display=swap">. Prévois une police de repli (sans-serif / serif) dans chaque déclaration font-family.
4. Tous les liens portent target="_blank" et restent visuellement identifiables comme des liens.
5. Le rendu doit être responsive et lisible à l'impression.
6. Rédige en français, sur un ton professionnel et direct.

QUALITÉ ATTENDUE
- Hiérarchie visuelle nette : titre de semaine, encadré "Top X à retenir" (chaque ligne du Top portant son appel de source), puis une section par thématique — chacune terminée par son bloc « Sources de ce chapitre » —, puis « Pour aller plus loin », puis la liste complète des sources.
- Exploite largement les sources fournies : un rapport qui n'en cite que trois sur vingt passe à côté de l'essentiel.
- Respecte scrupuleusement la palette de couleurs, les typographies et le style demandés.`;

// Le modèle renvoie souvent le HTML dans un bloc markdown ```html : on le
// déballe. Exporté pour être testable — c'est la pièce qui décide si le rapport
// est exploitable ou marqué en erreur.
export const extraireHtml = (reponse) => {
  let html = trim(reponse);
  const fence = html.match(/```(?:html)?\s*([\s\S]*?)```/i);
  if (fence) html = fence[1].trim();
  const debut = html.search(/<!doctype html|<html[\s>]/i);
  if (debut > 0) html = html.slice(debut);
  // Défense en profondeur : la CSP bloque déjà les scripts à l'affichage, mais
  // on ne stocke pas de code exécutable.
  return html
    .replace(/<\s*script\b[\s\S]*?<\s*\/\s*script\s*>/gi, "")
    .replace(/<\s*script\b[^>]*>/gi, "")
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, "")
    .replace(/\son\w+\s*=\s*'[^']*'/gi, "");
};

const extraireTitre = (html) => {
  const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (t) return trim(t[1]).slice(0, 200);
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1) return trim(h1[1].replace(/<[^>]*>/g, "")).slice(0, 200);
  return "Veille hebdomadaire";
};

const fmtJour = (d) =>
  d ? new Date(d).toLocaleDateString("fr-FR", { day: "2-digit", month: "long" }) : "";

const fmtJourComplet = (d) =>
  d
    ? new Date(d).toLocaleDateString("fr-FR", {
        weekday: "long",
        day: "2-digit",
        month: "long",
        year: "numeric",
      })
    : "";

// Bloc « sources » injecté dans le message utilisateur. Numéroté : le rapport
// doit rappeler ces numéros ([n]) à chaque affirmation.
const formaterSources = (sources) =>
  sources
    .map((s, i) =>
      [
        `[${i + 1}] ${s.titre}`,
        `    Type : ${s.type === "tendance" ? "TENDANCE (analyse de fond)" : "ACTUALITÉ de la semaine"}`,
        `    Recherche d'origine : ${s.thematique}`,
        `    Lien : ${s.url}`,
        s.date ? `    Date de publication : ${s.date}` : null,
        `    Extrait : ${s.extrait}`,
      ]
        .filter(Boolean)
        .join("\n"),
    )
    .join("\n\n");

// ────────────────────────────────────────────────────────────────────────────
// VÉRIFICATION DES LIENS
//
// Le modèle a beau avoir la consigne, il lui arrive de fabriquer une URL
// vraisemblable. On n'a pas à faire confiance : après génération, tout lien qui
// ne figure pas dans les sources fournies est NEUTRALISÉ (le texte est gardé,
// le lien retiré et signalé). C'est la seule garantie réelle que les liens du
// rapport pointent quelque part.
// ────────────────────────────────────────────────────────────────────────────
const normaliserUrl = (u) =>
  String(u || "")
    .trim()
    .replace(/[)\].,;]+$/, "")
    .replace(/\/+$/, "")
    .toLowerCase();

export const verifierLiens = (html, sources = []) => {
  const autorisees = new Set(sources.map((s) => normaliserUrl(s.url)).filter(Boolean));
  let neutralises = 0;

  // On garde la balise <a> et son contenu, on lui retire seulement son href :
  // elle devient inerte et non cliquable, sans toucher aux balises fermantes.
  const final = html.replace(
    /<a\b([^>]*?)href\s*=\s*("|')(.*?)\2([^>]*)>/gi,
    (balise, avant, quote, url, apres) => {
      const u = String(url).trim();
      // Ancres internes, mailto, ressources de mise en page : pas des sources.
      if (!/^https?:/i.test(u)) return balise;
      if (/fonts\.(googleapis|gstatic)\.com/i.test(u)) return balise;
      if (autorisees.has(normaliserUrl(u))) return balise;
      neutralises += 1;
      return `<a${avant}${apres} data-lien-non-verifie="1" title="Référence non vérifiable : ce lien ne provient pas des sources consultées">`;
    },
  );

  return { html: final, neutralises };
};

// Génère le rapport et met à jour le document VeilleRapport passé en argument.
// Isolé pour être appelable depuis le planificateur ET depuis le bouton
// « Générer maintenant » (qui rend la main tout de suite).
export const executerGeneration = async (rapportId) => {
  const rapport = await VeilleRapport.findById(rapportId);
  if (!rapport) return null;
  const config = await VeilleConfig.findById(rapport.config);
  if (!config) {
    rapport.statut = "erreur";
    rapport.erreur = "Veille supprimée entre-temps.";
    await rapport.save();
    return rapport;
  }

  const debut = Date.now();
  try {
    const { sources, sansRechercheWeb, elargi, nbActualites, nbTendances } =
      await rechercherActualites(config);

    const fin = new Date();
    const dep = new Date(fin.getTime() - 7 * 24 * 3600 * 1000);

    const contexte = [
      construirePrompt(config),
      "",
      // Date donnée explicitement : sans elle le modèle date le rapport de son
      // année d'entraînement (on a vu sortir « août 2023 »).
      `DATE DU JOUR : ${fmtJourComplet(fin)}.`,
      `SEMAINE COUVERTE : du ${fmtJour(dep)} au ${fmtJour(fin)} ${fin.getFullYear()}.`,
      "N'utilise aucune autre année que celles apparaissant ci-dessus ou dans les dates des sources.",
      "",
      elargi
        ? "NOTE : trop peu d'actualités trouvées sur la zone demandée — la recherche a été élargie " +
          "au-delà de cette zone. Précise-le en préambule du rapport quand tu cites une source hors zone."
        : null,
      sources.length
        ? `SOURCES DISPONIBLES (${sources.length} : ${nbActualites} actualité(s) de la semaine, ${nbTendances} analyse(s) de fond).\n` +
          "Tu ne peux utiliser QUE ces sources, et tu ne peux copier QUE ces URL.\n" +
          "Les sources de type TENDANCE alimentent la section « Pour aller plus loin ».\n\n" +
          formaterSources(sources)
        : "AUCUNE SOURCE WEB N'A PU ÊTRE RÉCUPÉRÉE. Écris un rapport COURT qui l'annonce " +
          "clairement en tête, n'affirme aucun fait daté et ne place aucun lien.",
    ]
      .filter((l) => l !== null)
      .join("\n");

    const modele = config.qualite === "qualite" ? MODEL_QUALITE : MODEL_STANDARD;
    const client = getClient();
    const reponse = await client.chat.completions.create({
      model: modele,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: contexte },
      ],
      temperature: 0.4,
      max_tokens: 16000,
    });

    const brut = reponse.choices?.[0]?.message?.content || "";
    const html = extraireHtml(brut);
    if (!html || !/<html[\s>]/i.test(html)) {
      throw new Error("Le modèle n'a pas renvoyé de page HTML exploitable.");
    }

    // Tout lien absent des sources consultées est rendu inerte.
    const { html: htmlVerifie, neutralises } = verifierLiens(html, sources);
    if (neutralises) {
      console.warn(
        `[veille] rapport ${rapportId} : ${neutralises} lien(s) inventé(s) neutralisé(s)`,
      );
    }

    rapport.html = htmlVerifie;
    rapport.titre = extraireTitre(htmlVerifie);
    rapport.periodeDebut = dep;
    rapport.periodeFin = fin;
    rapport.sources = sources.map((s) => ({
      titre: s.titre,
      url: s.url,
      date: s.date,
      type: s.type,
    }));
    rapport.sansRechercheWeb = sansRechercheWeb;
    rapport.rechercheElargie = !!elargi;
    rapport.liensNeutralises = neutralises;
    rapport.modele = modele;
    rapport.tokensPrompt = reponse.usage?.prompt_tokens || 0;
    rapport.tokensReponse = reponse.usage?.completion_tokens || 0;
    rapport.dureeMs = Date.now() - debut;
    rapport.statut = "termine";
    rapport.erreur = "";
    await rapport.save();

    config.dernierRunAt = new Date();
    await config.save();
  } catch (err) {
    rapport.statut = "erreur";
    rapport.erreur = String(err.message || err).slice(0, 500);
    rapport.dureeMs = Date.now() - debut;
    await rapport.save();
    console.error(`[veille] génération ${rapportId} échouée : ${rapport.erreur}`);
  }
  return rapport;
};

// Crée le rapport « en cours » puis lance la génération EN TÂCHE DE FOND.
// La requête HTTP rend la main immédiatement : une génération prend souvent
// plus d'une minute (recherches web + rédaction d'une page complète).
export const lancerGeneration = async (config, declencheur = "auto") => {
  const rapport = await VeilleRapport.create({
    user: config.user,
    config: config._id,
    nomVeille: config.nom,
    domaine: config.domaine,
    statut: "en_cours",
    declencheur,
  });
  // Pas de await : on n'attend pas la fin. Les erreurs sont journalisées dans
  // le rapport lui-même par executerGeneration.
  executerGeneration(rapport._id).catch((e) =>
    console.error("[veille] génération non rattrapée :", e.message),
  );
  return rapport;
};

export default {
  isConfigured,
  rechercheWebConfiguree,
  construirePrompt,
  rechercherActualites,
  lancerGeneration,
  executerGeneration,
  VEILLE_PROMPT_TEMPLATE,
  VEILLE_DEFAUTS,
  VEILLE_CHAMPS,
  ZONES,
  ZONE_DEFAUT,
  normaliserZone,
  verifierLiens,
  extraireHtml,
};
