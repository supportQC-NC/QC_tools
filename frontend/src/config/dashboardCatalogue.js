// src/config/dashboardCatalogue.js
//
// MIROIR de backend/config/dashboardCatalogue.js (mêmes clés), enrichi de ce qui
// n'a de sens que côté client : icône et couleur d'affichage.
// Toute évolution doit toucher LES DEUX fichiers.
//
// Le catalogue effectif (widgets et datasets réellement autorisés) est renvoyé
// par GET /api/dashboard-layout/catalogue : c'est le serveur qui fait foi.
// Ce fichier ne sert qu'au rendu et aux libellés.

import {
  HiClipboardCheck,
  HiChartBar,
  HiTrendingUp,
  HiViewGrid,
  HiUsers,
  HiInboxIn,
  HiTruck,
  HiExclamationCircle,
  HiCurrencyDollar,
  HiOfficeBuilding,
  HiCube,
  HiClipboardList,
  HiDocumentReport,
  HiRefresh,
  HiTag,
} from "react-icons/hi";

// Rendu de chaque widget du catalogue (clé -> icône + couleur).
export const WIDGET_UI = {
  mes_taches: { icon: HiClipboardCheck, couleur: "#6366f1" },
  kpi_perso: { icon: HiChartBar, couleur: "#8b5cf6" },
  mon_activite: { icon: HiTrendingUp, couleur: "#06b6d4" },
  acces_rapides: { icon: HiViewGrid, couleur: "#22c55e" },
  global_effectifs: { icon: HiUsers, couleur: "#3b82f6" },
  global_receptions: { icon: HiInboxIn, couleur: "#4da6ff" },
  commandes_etat: { icon: HiTruck, couleur: "#f59e0b" },
  prochains_bateaux: { icon: HiInboxIn, couleur: "#0ea5e9" },
  top_fournisseurs: { icon: HiTruck, couleur: "#a855f7" },
  meilleures_ventes: { icon: HiTrendingUp, couleur: "#eab308" },
  ruptures: { icon: HiExclamationCircle, couleur: "#ef4444" },
  ca_societe: { icon: HiCurrencyDollar, couleur: "#10b981" },
  ca_comparaison: { icon: HiOfficeBuilding, couleur: "#14b8a6" },
};

// Icônes proposées à l'utilisateur pour ses tuiles KPI.
export const ICONES_KPI = {
  HiChartBar,
  HiCube,
  HiCurrencyDollar,
  HiTrendingUp,
  HiExclamationCircle,
  HiClipboardList,
  HiDocumentReport,
  HiTruck,
  HiRefresh,
  HiTag,
  HiUsers,
  HiOfficeBuilding,
};

export const ICONE_KPI_KEYS = Object.keys(ICONES_KPI);

export const COULEURS_KPI = [
  "#6366f1",
  "#8b5cf6",
  "#06b6d4",
  "#22c55e",
  "#eab308",
  "#f59e0b",
  "#ef4444",
  "#ec4899",
  "#10b981",
  "#0ea5e9",
];

export const TAILLES = [
  { key: "tiers", label: "Un tiers" },
  { key: "moitie", label: "Moitié" },
  { key: "pleine", label: "Pleine largeur" },
];

export const FORMATS = [
  { key: "nombre", label: "Nombre" },
  { key: "xpf", label: "Montant (XPF)" },
  { key: "pourcent", label: "Pourcentage" },
];

// Formatage d'une valeur de tuile KPI.
export const formaterValeur = (valeur, format) => {
  if (valeur === null || valeur === undefined) return "—";
  const n = Number(valeur);
  if (!Number.isFinite(n)) return "—";
  if (format === "xpf") {
    return `${Math.round(n).toLocaleString("fr-FR")} XPF`;
  }
  if (format === "pourcent") {
    return `${n.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %`;
  }
  return n.toLocaleString("fr-FR", { maximumFractionDigits: 2 });
};

// Classe CSS de largeur d'un bloc.
export const classeTaille = (taille) =>
  taille === "pleine" ? "db-w-full" : taille === "moitie" ? "db-w-half" : "db-w-third";

// Palette des parts de camembert (dérivée des couleurs de tuiles).
export const PALETTE_GRAPHIQUE = [
  "#6366f1",
  "#22c55e",
  "#f59e0b",
  "#ef4444",
  "#06b6d4",
  "#ec4899",
  "#eab308",
  "#8b5cf6",
  "#10b981",
  "#0ea5e9",
  "#f97316",
  "#14b8a6",
];
