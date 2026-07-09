// // backend/config/adminModules.js
// //
// // SOURCE DE VÉRITÉ des modules soumis au contrôle de permission par utilisateur.
// // 4 groupes : gestion (côté user), donnees (écrans admin données), analyse
// // (écrans admin analyse), administration (dashboard/users/entreprises).
// // Contrôle = checkModuleAccess(cle, action) [+ checkEntrepriseAccess quand la
// // route porte :nomDossierDBF/:entrepriseId] -> module scopé aux sociétés.

// export const MODULE_GROUPS = {
//   gestion: "Gestion",
//   donnees: "Données",
//   analyse: "Analyse",
//   administration: "Administration",
// };

// export const PERMISSION_MODULES = [
//   // ── Gestion (utilisateur + écrans données partagés) ───────────────────────
//   { key: "stock", label: "Recherche Article", group: "gestion" },
//   { key: "inventaire", label: "Inventaire", group: "gestion" },
//   { key: "reapro", label: "Reapro", group: "gestion" },
//   { key: "proforma", label: "Proformas", group: "gestion" },
//   { key: "ctr_commande", label: "Contrôle Commandes", group: "gestion" },
//   { key: "reception", label: "Réception marchandises", group: "gestion" },
//   { key: "prep_commande", label: "Préparation Commandes", group: "gestion" },
//   { key: "ctrl_info_produit", label: "Contrôle Infos Produit", group: "gestion" },
//   { key: "releve", label: "Relevé de prix", group: "gestion" },
//   { key: "etiquettes", label: "Générateur d'étiquettes", group: "gestion" },
//   // ── Données (écrans admin) ────────────────────────────────────────────────
//   { key: "client", label: "Clients", group: "donnees" },
//   { key: "commandes", label: "Commandes", group: "donnees" },
//   { key: "facture", label: "Factures", group: "donnees" },
//   { key: "bipage", label: "Bipages", group: "donnees" },
//   { key: "concurrents", label: "Concurrents", group: "donnees" },
//   { key: "inventaire_proforma_admin", label: "Inventaire Proforma", group: "donnees" },
//   { key: "fiches_controle_admin", label: "Fiches de contrôle", group: "donnees" },
//   // ── Analyse (écrans admin) ────────────────────────────────────────────────
//   { key: "commerciaux_admin", label: "Analyse Commerciaux", group: "analyse" },
//   { key: "filiales_admin", label: "Analyse Filiales", group: "analyse" },
//   { key: "reappro_local_admin", label: "Reappro Local", group: "analyse" },
//   { key: "debit_comptant_admin", label: "Débit / Comptant", group: "analyse" },
//   { key: "gencod_doublons_admin", label: "Doublons GENCODE", group: "analyse" },
//   { key: "analyse_ca_admin", label: "Analyse CA", group: "analyse" },
//   { key: "performance_dock_admin", label: "Performance Dock", group: "analyse" },
//   { key: "collecteurs_admin", label: "Collecteurs", group: "analyse" },
//   // ── Administration ────────────────────────────────────────────────────────
//   { key: "dashboard_admin", label: "Tableau de bord", group: "administration" },
//   { key: "users_admin", label: "Utilisateurs", group: "administration" },
//   { key: "entreprises_admin", label: "Entreprises", group: "administration" },
// ];

// export const PERMISSION_MODULE_KEYS = PERMISSION_MODULES.map((m) => m.key);

// export const PERMISSION_MODULE_BY_KEY = PERMISSION_MODULES.reduce((acc, m) => {
//   acc[m.key] = m;
//   return acc;
// }, {});

// export default PERMISSION_MODULES;

// backend/config/adminModules.js
//
// SOURCE DE VÉRITÉ des modules soumis au contrôle de permission par utilisateur.
// 4 groupes : gestion (côté user), donnees (écrans admin données), analyse
// (écrans admin analyse), administration (dashboard/users/entreprises).
// Contrôle = checkModuleAccess(cle, action) [+ checkEntrepriseAccess quand la
// route porte :nomDossierDBF/:entrepriseId] -> module scopé aux sociétés.

export const MODULE_GROUPS = {
  gestion: "Gestion",
  donnees: "Données",
  analyse: "Analyse",
  administration: "Administration",
};

export const PERMISSION_MODULES = [
  // ── Gestion (utilisateur + écrans données partagés) ───────────────────────
  { key: "stock", label: "Recherche Article", group: "gestion" },
  { key: "inventaire", label: "Inventaire", group: "gestion" },
  { key: "reapro", label: "Reapro", group: "gestion" },
  { key: "proforma", label: "Proformas", group: "gestion" },
  { key: "ctr_commande", label: "Contrôle Commandes", group: "gestion" },
  { key: "reception", label: "Réception marchandises", group: "gestion" },
  { key: "prep_commande", label: "Préparation Commandes", group: "gestion" },
  { key: "ctrl_info_produit", label: "Contrôle Infos Produit", group: "gestion" },
  { key: "releve", label: "Relevé de prix", group: "gestion" },
  { key: "etiquettes", label: "Générateur d'étiquettes", group: "gestion" },
  // ── Données (écrans admin) ────────────────────────────────────────────────
  { key: "client", label: "Clients", group: "donnees" },
  { key: "commandes", label: "Commandes", group: "donnees" },
  { key: "facture", label: "Factures", group: "donnees" },
  { key: "bipage", label: "Bipages", group: "donnees" },
  { key: "concurrents", label: "Concurrents", group: "donnees" },
  { key: "inventaire_proforma_admin", label: "Inventaire Proforma", group: "donnees" },
  { key: "fiches_controle_admin", label: "Fiches de contrôle", group: "donnees" },
  // ── Analyse (écrans admin) ────────────────────────────────────────────────
  { key: "commerciaux_admin", label: "Analyse Commerciaux", group: "analyse" },
  { key: "filiales_admin", label: "Analyse Filiales", group: "analyse" },
  { key: "reappro_local_admin", label: "Reappro Local", group: "analyse" },
  { key: "debit_comptant_admin", label: "Débit / Comptant", group: "analyse" },
  { key: "gencod_doublons_admin", label: "Doublons GENCODE", group: "analyse" },
  { key: "analyse_ca_admin", label: "Analyse CA", group: "analyse" },
  { key: "performance_dock_admin", label: "Performance Dock", group: "analyse" },
  { key: "collecteurs_admin", label: "Collecteurs", group: "analyse" },
  { key: "facture_analyse_admin", label: "Analyse Facturation", group: "analyse" },
  { key: "journal_caisse_admin", label: "Journal de Caisse", group: "analyse" },
  { key: "top_articles_admin", label: "Top Articles", group: "analyse" },
  // ── Administration ────────────────────────────────────────────────────────
  { key: "dashboard_admin", label: "Tableau de bord", group: "administration" },
  { key: "users_admin", label: "Utilisateurs", group: "administration" },
  { key: "entreprises_admin", label: "Entreprises", group: "administration" },
];

export const PERMISSION_MODULE_KEYS = PERMISSION_MODULES.map((m) => m.key);

export const PERMISSION_MODULE_BY_KEY = PERMISSION_MODULES.reduce((acc, m) => {
  acc[m.key] = m;
  return acc;
}, {});

export default PERMISSION_MODULES;