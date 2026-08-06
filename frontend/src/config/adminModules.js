// src/config/adminModules.js
//
// Miroir frontend du registre backend. Fournit :
//  - PERMISSION_MODULES (clés + libellés + groupes) pour l'UI (UserModal) ;
//  - PATH_MODULE_MAP (chemin d'écran admin -> clé) pour le menu et <ModuleRoute> ;
//  - helpers hasModuleAccess / moduleForPath.

export const MODULE_GROUPS = {
  gestion: "Gestion",
  donnees: "Données",
  commerciaux: "Commerciaux",
  analyse: "Analyse",
  administration: "Administration",
};

export const PERMISSION_MODULES = [
  { key: "stock", label: "Recherche Article", group: "gestion" },
  { key: "inventaire", label: "Inventaire", group: "gestion" },
  { key: "reapro", label: "Reapro", group: "gestion" },
  { key: "proforma", label: "Proformas", group: "gestion" },
  { key: "ctr_commande", label: "Contrôle Commandes", group: "gestion" },
  { key: "reception", label: "Réception marchandises", group: "gestion" },
  { key: "prep_commande", label: "Préparation Commandes", group: "gestion" },
  { key: "envoi_cde_fournisseur", label: "Envoi Cde Fournisseur", group: "gestion" },
  { key: "ctrl_info_produit", label: "Contrôle Infos Produit", group: "gestion" },
  { key: "releve", label: "Relevé de prix", group: "gestion" },
  { key: "etiquettes", label: "Générateur d'étiquettes", group: "gestion" },
  { key: "changement_prix", label: "Changement de prix de vente", group: "gestion" },
  { key: "edition_promo", label: "Édition Promo", group: "gestion" },
  { key: "mailing", label: "Mailing clients", group: "gestion" },
  { key: "communication_client", label: "Communication client", group: "gestion" },
  { key: "assistant_ia", label: "Assistant IA", group: "gestion" },
  { key: "client", label: "Clients", group: "donnees" },
  { key: "commandes", label: "Commandes", group: "donnees" },
  { key: "facture", label: "Factures", group: "donnees" },
  { key: "bipage", label: "Bipages", group: "donnees" },
  { key: "concurrents", label: "Concurrents", group: "donnees" },
  { key: "inventaire_proforma_admin", label: "Inventaire Proforma", group: "donnees" },
  { key: "fiches_controle_admin", label: "Fiches de contrôle", group: "donnees" },
  { key: "reception_suivi_admin", label: "Suivi Réceptions", group: "donnees" },
  { key: "suivi_entrees", label: "Suivi des entrées", group: "donnees" },
  { key: "resa_entrees", label: "Entrées sur réservation", group: "donnees" },
  { key: "export_gisements_admin", label: "Export Gisements", group: "donnees" },
  { key: "executables_admin", label: "Exécutables", group: "donnees" },
  { key: "commerciaux_outils", label: "Outils Commerciaux", group: "commerciaux" },
  { key: "commerciaux_admin", label: "Analyse Commerciaux", group: "analyse" },
  { key: "filiales_admin", label: "Analyse Filiales", group: "analyse" },
  { key: "reappro_local_admin", label: "Reappro Local", group: "analyse" },
  { key: "debit_comptant_admin", label: "Débit / Comptant", group: "analyse" },
  { key: "gencod_doublons_admin", label: "Doublons GENCODE", group: "analyse" },
  { key: "analyse_ca_admin", label: "Analyse CA", group: "analyse" },
  { key: "performance_dock_admin", label: "Performance Dock", group: "analyse" },
  { key: "collecteurs_admin", label: "Collecteurs", group: "analyse" },
  { key: "rapport_tgc", label: "Rapports TGC", group: "analyse" },
  { key: "balances_clients", label: "Balances / clients à bloquer", group: "analyse" },
  { key: "facture_analyse_admin", label: "Analyse Facturation", group: "analyse" },
  { key: "journal_caisse_admin", label: "Journal de Caisse", group: "analyse" },
  { key: "top_articles_admin", label: "Top Articles", group: "analyse" },
  { key: "analyse_reappro_admin", label: "Analyse Réappro", group: "analyse" },
  { key: "dashboard_admin", label: "Tableau de bord", group: "administration" },
  { key: "users_admin", label: "Utilisateurs", group: "administration" },
  { key: "entreprises_admin", label: "Entreprises", group: "administration" },
  { key: "infobulles_admin", label: "Organisation du menu", group: "administration" },
  { key: "smtp_admin", label: "Paramètres Email (SMTP)", group: "administration" },
];

export const PERMISSION_MODULE_BY_KEY = PERMISSION_MODULES.reduce((acc, m) => {
  acc[m.key] = m;
  return acc;
}, {});

// Chemin d'écran admin -> clé de permission qui le protège (préfixe).
export const PATH_MODULE_MAP = [
  // Administration
  { path: "/admin/users", key: "users_admin" },
  { path: "/admin/entreprises", key: "entreprises_admin" },
  { path: "/admin/infobulles", key: "infobulles_admin" },
  { path: "/admin/smtp", key: "smtp_admin" },
  { path: "/admin/meilleures-ventes", key: "stock" },
  { path: "/admin", key: "dashboard_admin" }, // exact "/admin" (les /admin/xxx sont plus spécifiques)
  // Données
  { path: "/admin/articles", key: "stock" },
  { path: "/admin/fournisseurs", key: "stock" },
  { path: "/admin/clients", key: "client" },
  { path: "/admin/reservations", key: "proforma" },
  { path: "/admin/commandes", key: "commandes" },
  { path: "/admin/proformas", key: "proforma" },
  { path: "/admin/factures", key: "facture" },
  { path: "/admin/concurrents", key: "concurrents" },
  { path: "/admin/releves", key: "releve" },
  { path: "/changement-prix", key: "changement_prix" },
  { path: "/mailing", key: "mailing" },
  { path: "/communication-client", key: "communication_client" },
  { path: "/assistant-ia", key: "assistant_ia" },
  { path: "/admin/inventaire-proforma", key: "inventaire_proforma_admin" },
  { path: "/admin/fiches-controle", key: "fiches_controle_admin" },
  { path: "/admin/suivi-receptions", key: "reception_suivi_admin" },
  { path: "/admin/suivi-entrees", key: "suivi_entrees" },
  { path: "/admin/resa-entrees", key: "resa_entrees" },
  { path: "/admin/export-gisements", key: "export_gisements_admin" },
  { path: "/admin/dictionnaire-rayons", key: "export_gisements_admin" },
  { path: "/admin/executables", key: "executables_admin" },
  { path: "/admin/inventaires", key: "inventaire" },
  { path: "/admin/zones", key: "inventaire" },
  { path: "/admin/inventaire-progression", key: "inventaire" },
  { path: "/admin/recap-zones", key: "inventaire" },
  { path: "/admin/bipages", key: "bipage" },
  { path: "/admin/demandes-bipage", key: "bipage" },
  { path: "/admin/reappros", key: "reapro" },
  { path: "/admin/envoi-cde-fournisseur", key: "envoi_cde_fournisseur" },
  // Commerciaux (accès global unique)
  { path: "/admin/top-ventes", key: "commerciaux_outils" },
  // Analyse
  { path: "/admin/commerciaux", key: "commerciaux_admin" },
  { path: "/admin/filiales", key: "filiales_admin" },
  { path: "/admin/reappro-local", key: "reappro_local_admin" },
  { path: "/admin/debit-comptant", key: "debit_comptant_admin" },
  { path: "/admin/gencod-doublons", key: "gencod_doublons_admin" },
  { path: "/admin/analyse-ca", key: "analyse_ca_admin" },
  { path: "/admin/performance-dock", key: "performance_dock_admin" },
  { path: "/admin/collecteurs", key: "collecteurs_admin" },
  { path: "/admin/rapport-tgc", key: "rapport_tgc" },
  { path: "/admin/balances-clients", key: "balances_clients" },
  { path: "/admin/collecteurs-carte", key: "collecteurs_admin" },
  { path: "/admin/facture-analyse", key: "facture_analyse_admin" },
  { path: "/admin/journal-caisse", key: "journal_caisse_admin" },
  { path: "/admin/top-articles", key: "top_articles_admin" },
  { path: "/admin/analyse-reappro", key: "analyse_reappro_admin" },
];

// L'utilisateur a-t-il l'action demandée sur ce module ?
// role admin et allModules -> accès total.
export function hasModuleAccess(userInfo, moduleKey, action = "read") {
  if (!userInfo) return false;
  if (userInfo.role === "admin") return true;
  const perm = userInfo.permissions;
  if (!perm) return false;
  if (perm.allModules) return true;
  const m = perm.modules?.[moduleKey];
  return !!(m && m[action]);
}

// Clé de permission protégeant un chemin (préfixe le plus spécifique), ou null.
export function moduleForPath(pathname) {
  let best = null;
  for (const entry of PATH_MODULE_MAP) {
    if (pathname === entry.path || pathname.startsWith(entry.path + "/")) {
      if (!best || entry.path.length > best.path.length) best = entry;
    }
  }
  return best ? best.key : null;
}

// ===========================================================================
// HIÉRARCHIE — miroir CLIENT de l'atténuation serveur (assertGrantWithinScope).
// Sert à l'UI (UserModal) : un acteur ne peut proposer/accorder que ce qu'il a.
// La sécurité RÉELLE reste côté serveur ; ceci évite juste des tentatives vaines.
// ===========================================================================

// Super-admin côté client : admin + (aucune permission héritée OU allEntreprises).
export function isSuperAdminClient(userInfo) {
  if (!userInfo || userInfo.role !== "admin") return false;
  const p = userInfo.permissions;
  return !p || p.allEntreprises === true;
}

// Rôles que l'acteur peut attribuer (miroir de canAssignRole).
export function assignableRoles(userInfo) {
  if (isSuperAdminClient(userInfo)) return ["user", "responsable", "admin"];
  if (userInfo?.role === "admin") return ["user", "responsable"];
  if (userInfo?.role === "responsable") return ["user"];
  return [];
}

// L'acteur peut-il accorder « tous les modules » ? (un admin a tous les modules)
export function actorCanGrantAllModules(userInfo) {
  if (isSuperAdminClient(userInfo)) return true;
  if (userInfo?.role === "admin") return true;
  return userInfo?.permissions?.allModules === true;
}

// L'acteur peut-il accorder « toutes les entreprises » ?
export function actorCanGrantAllEntreprises(userInfo) {
  if (isSuperAdminClient(userInfo)) return true;
  return userInfo?.permissions?.allEntreprises === true;
}

// Ids des entreprises que l'acteur peut accorder (null = toutes).
export function actorGrantableEntrepriseIds(userInfo) {
  if (actorCanGrantAllEntreprises(userInfo)) return null;
  return (userInfo?.permissions?.entreprises || []).map((e) => e._id || e);
}

// L'acteur peut-il accorder l'action `action` sur le module `key` ?
export function actorCanGrantModuleAction(userInfo, key, action) {
  if (actorCanGrantAllModules(userInfo)) return true;
  return !!userInfo?.permissions?.modules?.[key]?.[action];
}

// L'utilisateur a-t-il accès à AU MOINS UNE action d'un des modules d'un groupe ?
// (utile pour l'affichage des sections de menu)
export function hasAnyModuleInGroup(userInfo, group) {
  if (!userInfo) return false;
  if (userInfo.role === "admin") return true;
  if (userInfo.permissions?.allModules) return true;
  return PERMISSION_MODULES.filter((m) => m.group === group).some((m) =>
    hasModuleAccess(userInfo, m.key, "read"),
  );
}

export default PERMISSION_MODULES;