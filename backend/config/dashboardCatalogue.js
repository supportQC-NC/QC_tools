// backend/config/dashboardCatalogue.js
//
// SOURCE DE VÉRITÉ du tableau de bord unique.
//   - WIDGETS  : les blocs prêts à l'emploi, chacun gardé par un module.
//   - DATASETS : les sources interrogeables par les tuiles KPI sur mesure.
//
// Ce fichier est MIROIRÉ dans frontend/src/config/dashboardCatalogue.js
// (mêmes clés, plus le rendu React). Toute évolution doit toucher les deux,
// exactement comme adminModules.js.
//
// `module: null` = visible par tout utilisateur connecté (données perso).
// `scopeSociete: true` = le bloc/dataset porte sur la société sélectionnée dans
// l'en-tête ; l'accès à cette société est revérifié côté serveur.

// ─── Widgets du catalogue ────────────────────────────────────────────────────
export const DASHBOARD_WIDGETS = [
  {
    key: "mes_taches",
    label: "Mes tâches",
    description: "Répartition de mes tâches par statut, retards inclus.",
    module: null,
    scopeSociete: false,
    tailleDefaut: "tiers",
  },
  {
    key: "kpi_perso",
    label: "Mes compteurs",
    description: "Tâches, inventaires, relevés et réappros en cours.",
    module: null,
    scopeSociete: false,
    tailleDefaut: "pleine",
  },
  {
    key: "mon_activite",
    label: "Mon activité (14 jours)",
    description: "Courbe de mes inventaires, relevés et réceptions.",
    module: null,
    scopeSociete: false,
    tailleDefaut: "moitie",
  },
  {
    key: "acces_rapides",
    label: "Accès rapides",
    description: "Raccourcis vers les écrans auxquels j'ai accès.",
    module: null,
    scopeSociete: false,
    tailleDefaut: "pleine",
  },
  {
    key: "global_effectifs",
    label: "Utilisateurs & sociétés",
    description: "Compteurs Mongo toutes sociétés confondues.",
    module: "dashboard_admin",
    scopeSociete: false,
    tailleDefaut: "moitie",
  },
  {
    key: "global_receptions",
    label: "Réceptions & conformité",
    description: "Volume de réceptions et taux de conformité.",
    module: "dashboard_admin",
    scopeSociete: false,
    tailleDefaut: "moitie",
  },
  {
    key: "commandes_etat",
    label: "Commandes par état",
    description: "Répartition des commandes de la société par état.",
    module: "commandes",
    scopeSociete: true,
    tailleDefaut: "moitie",
  },
  {
    key: "prochains_bateaux",
    label: "Prochaines arrivées",
    description: "Bateaux attendus et nombre de commandes associées.",
    module: "commandes",
    scopeSociete: true,
    tailleDefaut: "tiers",
  },
  {
    key: "top_fournisseurs",
    label: "Top fournisseurs",
    description: "Fournisseurs les plus commandés.",
    module: "commandes",
    scopeSociete: true,
    tailleDefaut: "tiers",
  },
  {
    key: "meilleures_ventes",
    label: "Meilleures ventes (12 mois)",
    description: "Articles les plus vendus sur douze mois.",
    module: "stock",
    scopeSociete: true,
    tailleDefaut: "moitie",
  },
  {
    key: "ruptures",
    label: "Ruptures",
    description: "Articles qui se vendent mais dont le stock est à zéro.",
    module: "stock",
    scopeSociete: true,
    tailleDefaut: "moitie",
  },
  {
    key: "ca_societe",
    label: "Chiffre d'affaires",
    description: "CA de la société sélectionnée (snapshot analyse CA).",
    module: "analyse_ca_admin",
    scopeSociete: true,
    tailleDefaut: "moitie",
  },
  {
    key: "ca_comparaison",
    label: "Comparaison CA entre sociétés",
    description: "CA comparé des sociétés auxquelles j'ai accès.",
    module: "analyse_ca_admin",
    scopeSociete: false,
    tailleDefaut: "moitie",
  },
];

export const WIDGET_BY_KEY = DASHBOARD_WIDGETS.reduce((acc, w) => {
  acc[w.key] = w;
  return acc;
}, {});

// ─── Opérateurs de filtre ────────────────────────────────────────────────────
export const OPERATEURS = [
  { key: "egal", label: "est égal à", types: ["texte", "nombre", "booleen"] },
  { key: "different", label: "est différent de", types: ["texte", "nombre"] },
  { key: "contient", label: "contient", types: ["texte"] },
  { key: "sup", label: "est supérieur à", types: ["nombre"] },
  { key: "supEgal", label: "est supérieur ou égal à", types: ["nombre"] },
  { key: "inf", label: "est inférieur à", types: ["nombre"] },
  { key: "infEgal", label: "est inférieur ou égal à", types: ["nombre"] },
  { key: "vide", label: "est vide", types: ["texte", "nombre"] },
  { key: "nonVide", label: "n'est pas vide", types: ["texte", "nombre"] },
];

export const OPERATEUR_KEYS = OPERATEURS.map((o) => o.key);

// ─── Datasets interrogeables par les tuiles KPI ──────────────────────────────
// `champs` sert à la fois aux filtres et aux mesures somme/moyenne
// (seuls les champs de type "nombre" sont sommables).
//
// `origine` : "dbf" = fichier DBF de l'ERP, "mongo" = collection applicative.
// LE CROISEMENT DE DEUX SOURCES EST RÉSERVÉ AUX SOURCES DBF. Les collections
// Mongo (tâches, sessions) restent interrogeables seules.
export const KPI_DATASETS = {
  articles: {
    label: "Articles",
    description: "Base article.dbf de la société sélectionnée.",
    origine: "dbf",
    module: "stock",
    scopeSociete: true,
    // `sources` : champs DBF dont dépend un champ CALCULÉ. Si l'un d'eux est
    // masqué pour l'utilisateur (droits champ par champ), le champ calculé
    // disparaît aussi — sinon masquer PVTE laisserait déduire le prix via le CA.
    // Absent = champ DBF direct, sa propre source est son nom.
    champs: [
      { name: "stockTotal", label: "Stock total (S1..S5)", type: "nombre", sources: ["S1", "S2", "S3", "S4", "S5"] },
      { name: "valeurStock", label: "Valeur du stock (stock × PREV)", type: "nombre", sources: ["S1", "S2", "S3", "S4", "S5", "PREV"] },
      { name: "PREV", label: "Prix de revient", type: "nombre" },
      { name: "PVTE", label: "Prix de vente HT", type: "nombre" },
      { name: "PVTETTC", label: "Prix de vente TTC", type: "nombre" },
      { name: "PACHAT", label: "Prix d'achat", type: "nombre" },
      { name: "ventesMois", label: "Ventes mois courant (V1)", type: "nombre", sources: ["V1"] },
      { name: "ventes3", label: "Ventes 3 mois", type: "nombre", sources: ["V1", "V2", "V3"] },
      { name: "ventes12", label: "Ventes 12 mois", type: "nombre", sources: ["V1", "V2", "V3", "V4", "V5", "V6", "V7", "V8", "V9", "V10", "V11", "V12"] },
      { name: "caHt12", label: "CA HT 12 mois", type: "nombre", sources: ["V1", "V2", "V3", "V4", "V5", "V6", "V7", "V8", "V9", "V10", "V11", "V12", "PVTE"] },
      { name: "DEPREC", label: "DEPREC", type: "nombre" },
      { name: "deprecie", label: "Déprécié", type: "booleen", sources: ["DEPREC", "S1", "S2", "S3", "S4", "S5"] },
      { name: "GROUPE", label: "Groupe", type: "texte" },
      { name: "FOURN", label: "Code fournisseur", type: "nombre" },
      { name: "NART", label: "Code article", type: "texte" },
      { name: "GENCOD", label: "Code-barres", type: "texte" },
      { name: "WEB", label: "Visible web (O/N)", type: "texte" },
    ],
  },
  fournisseurs: {
    label: "Fournisseurs",
    description: "Base fourniss.dbf de la société sélectionnée.",
    origine: "dbf",
    module: "stock",
    scopeSociete: true,
    champs: [
      { name: "FOURN", label: "Code fournisseur", type: "nombre" },
      { name: "NOM", label: "Nom", type: "texte" },
      { name: "DELAPRO", label: "Délai appro. (jours)", type: "nombre" },
      { name: "FRANCO", label: "Franco", type: "nombre" },
      { name: "LOCAL", label: "Local (O/N)", type: "texte" },
      { name: "TEL", label: "Téléphone", type: "texte" },
    ],
  },
  taches: {
    label: "Mes tâches",
    description: "Tâches qui me sont assignées.",
    origine: "mongo",
    module: null,
    scopeSociete: false,
    champs: [
      { name: "statut", label: "Statut", type: "texte" },
      { name: "priorite", label: "Priorité", type: "texte" },
      { name: "enRetard", label: "En retard", type: "booleen" },
      { name: "type", label: "Type (equipe/perso)", type: "texte" },
      { name: "titre", label: "Titre", type: "texte" },
    ],
  },
  inventaires: {
    label: "Sessions d'inventaire",
    description: "Mes sessions d'inventaire.",
    origine: "mongo",
    module: "inventaire",
    scopeSociete: false,
    champs: [
      { name: "statut", label: "Statut", type: "texte" },
      { name: "nom", label: "Nom de session", type: "texte" },
      { name: "nomDossierDBF", label: "Société", type: "texte" },
      { name: "nbLignes", label: "Nombre de lignes", type: "nombre" },
    ],
  },
  releves: {
    label: "Sessions de relevé",
    description: "Mes sessions de relevé de prix.",
    origine: "mongo",
    module: "releve",
    scopeSociete: false,
    champs: [
      { name: "statut", label: "Statut", type: "texte" },
      { name: "nom", label: "Nom de session", type: "texte" },
      { name: "nomDossierDBF", label: "Société", type: "texte" },
      { name: "nbLignes", label: "Nombre de lignes", type: "nombre" },
    ],
  },
  reappros: {
    label: "Sessions de réappro",
    description: "Mes sessions de réapprovisionnement.",
    origine: "mongo",
    module: "reapro",
    scopeSociete: false,
    champs: [
      { name: "statut", label: "Statut", type: "texte" },
      { name: "nom", label: "Nom de session", type: "texte" },
      { name: "nomDossierDBF", label: "Société", type: "texte" },
      { name: "nbLignes", label: "Nombre de lignes", type: "nombre" },
    ],
  },
};

export const DATASET_KEYS = Object.keys(KPI_DATASETS);

export const MESURES = [
  { key: "count", label: "Nombre de lignes", besoinChamp: false },
  { key: "somme", label: "Somme d'un champ", besoinChamp: true },
  { key: "moyenne", label: "Moyenne d'un champ", besoinChamp: true },
  { key: "min", label: "Minimum d'un champ", besoinChamp: true },
  { key: "max", label: "Maximum d'un champ", besoinChamp: true },
];

export const MESURE_KEYS = MESURES.map((m) => m.key);

// ─── Graphiques configurables ────────────────────────────────────────────────
export const TYPES_GRAPHIQUE = [
  { key: "barres", label: "Barres" },
  { key: "lignes", label: "Courbe" },
  { key: "aires", label: "Aires" },
  { key: "camembert", label: "Camembert" },
];

export const TYPE_GRAPHIQUE_KEYS = TYPES_GRAPHIQUE.map((t) => t.key);

export const TRIS = [
  { key: "valeurDesc", label: "Valeur décroissante" },
  { key: "valeurAsc", label: "Valeur croissante" },
  { key: "libelle", label: "Libellé (A→Z)" },
];

export const TRI_KEYS = TRIS.map((t) => t.key);

export const LIMITE_MIN = 3;
export const LIMITE_MAX = 30;

export default {
  DASHBOARD_WIDGETS,
  WIDGET_BY_KEY,
  KPI_DATASETS,
  DATASET_KEYS,
  MESURES,
  MESURE_KEYS,
  OPERATEURS,
  OPERATEUR_KEYS,
  TYPES_GRAPHIQUE,
  TYPE_GRAPHIQUE_KEYS,
  TRIS,
  TRI_KEYS,
  LIMITE_MIN,
  LIMITE_MAX,
};
