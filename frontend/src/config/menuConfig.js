import {
  HiUsers,
  HiOfficeBuilding,
  HiChartBar,
  HiCube,
  HiViewGrid,
  HiSearch,
  HiClipboardList,
  HiRefresh,
  HiInformationCircle,
  HiCurrencyDollar,
  HiTruck,
  HiClipboardCheck,
  HiAdjustments,
  HiUserGroup,
  HiDocumentReport,
  HiShoppingCart,
  HiDatabase,
  HiFolder,
  HiTemplate,
  HiTag,
  HiQrcode,
  HiDeviceMobile,
  HiDownload
} from "react-icons/hi";
import { moduleForPath } from "./adminModules";

// =============================================
// CONFIGURATION DES MENUS AVEC SOUS-GROUPES
// =============================================

// Structure des menus ADMIN avec sous-groupes
export const adminMenuStructure = [
  {
    type: "item",
    label: "Tableau de bord",
    path: "/admin",
    icon: HiViewGrid,
    exact: true,
  },
  {
    type: "subgroup",
    label: "Gestion",
    icon: HiFolder,
    collapsible: true,
    items: [
      { label: "Utilisateurs", path: "/admin/users", icon: HiUsers },
      { label: "Équipes", path: "/admin/equipes", icon: HiUserGroup },
      { label: "Tâches", path: "/admin/taches", icon: HiClipboardCheck },
      { label: "Entreprises", path: "/admin/entreprises", icon: HiOfficeBuilding },
      { label: "Concurrents", path: "/admin/concurrents", icon: HiUserGroup },
      { label: "Installation app", path: "/install", icon: HiQrcode },
    ],
  },
  {
    type: "subgroup",
    label: "Données",
    icon: HiDatabase,
    collapsible: true,
    items: [
      { label: "Articles", path: "/admin/articles", icon: HiCube },
      { label: "Fournisseurs", path: "/admin/fournisseurs", icon: HiFolder },
      { label: "Clients", path: "/admin/clients", icon: HiUserGroup },
      { label: "Réservations", path: "/admin/reservations", icon: HiClipboardList },
      { label: "Commandes", path: "/admin/commandes", icon: HiTruck },
      { label: "Proformas", path: "/admin/proformas", icon: HiDocumentReport },
      { label: "Factures", path: "/admin/factures", icon: HiCurrencyDollar },
      { label: "Bipages", path: "/admin/bipages", icon: HiClipboardList },
      { label: "Suivi Réceptions", path: "/admin/suivi-receptions", icon: HiClipboardCheck },
      { label: "Gisements & Groupes", path: "/admin/export-gisements", icon: HiDownload },
    ],
  },
  {
    type: "subgroup",
    label: "Analyse",
    icon: HiChartBar,
    collapsible: true,
    items: [
      { label: "Analyse Commerciaux", path: "/admin/commerciaux", icon: HiUserGroup },
      { label: "Analyse Filiales", path: "/admin/filiales", icon: HiOfficeBuilding },
      { label: "Analyse CA", path: "/admin/analyse-ca", icon: HiChartBar },
      { label: "Analyse Facturation", path: "/admin/facture-analyse", icon: HiDocumentReport },
      { label: "Journal de Caisse", path: "/admin/journal-caisse", icon: HiCurrencyDollar },
      { label: "Top Articles", path: "/admin/top-articles", icon: HiChartBar },
      { label: "Reappro Local", path: "/admin/reappro-local", icon: HiTruck },
      { label: "Analyse Réappro", path: "/admin/analyse-reappro", icon: HiRefresh },
      { label: "Débit / Comptant", path: "/admin/debit-comptant", icon: HiCurrencyDollar },
      { label: "Doublons GENCODE", path: "/admin/gencod-doublons", icon: HiDatabase },
      { label: "Performance Dock", path: "/admin/performance-dock", icon: HiClipboardCheck },
      { label: "Collecteurs", path: "/admin/collecteurs", icon: HiDeviceMobile },
      { label: "Carte des collecteurs", path: "/admin/collecteurs-carte", icon: HiDeviceMobile },
    ],
  },
];

// Structure des menus MODULES avec sous-groupes
export const moduleMenuStructure = [
  {
    type: "subgroup",
    label: "Stock",
    icon: HiCube,
    collapsible: true,
    items: [
      {
        moduleKey: "stock",
        label: "Recherche Article",
        path: "/articles",
        icon: HiSearch,
      },
      // {
      //   moduleKey: "proforma",
      //   label: "Recherche Proforma",
      //   path: "/proformas",
      //   icon: HiSearch,
      // },
      // {
      //   moduleKey: "reapro",
      //   label: "Réappro",
      //   path: "/reappro",
      //   icon: HiRefresh,
      // },
    ],
  },
  {
    type: "subgroup",
    label: "Inventaire Zones",
    icon: HiClipboardList,
    collapsible: true,
    items: [
      {
        label: "Fiches inventaires",
        path: "/admin/zones",
        icon: HiTemplate,
      },
      {
        label: "Progression inventaire",
        path: "/admin/inventaire-progression",
        icon: HiChartBar,
      },
      {
        label: "Détail des bipages",
        path: "/admin/bipages",
        icon: HiClipboardList,
      },
      {
        label: "Fiches de contrôle",
        path: "/admin/fiches-controle",
        icon: HiDocumentReport,
      },
      {
        label: "Récap par zone",
        path: "/admin/recap-zones",
        icon: HiViewGrid,
      },
    ],
  },
  {
    type: "subgroup",
    label: "Inventaire proforma",
    icon: HiDocumentReport,
    collapsible: true,
    items: [
      {
        label: "Inventaire Proforma",
        path: "/admin/inventaire-proforma",
        icon: HiDocumentReport,
      },
    ],
  },
  // {
  //   type: "subgroup",
  //   label: "Commandes",
  //   icon: HiShoppingCart,
  //   collapsible: true,
  //   items: [
  //     {
  //       moduleKey: "ctr_commande",
  //       label: "CTRL Commandes",
  //       path: "/controle-commandes",
  //       icon: HiClipboardCheck,
  //     },
  //     {
  //       moduleKey: "prep_commande",
  //       label: "PREPA Commandes",
  //       path: "/preparation-commandes",
  //       icon: HiShoppingCart,
  //     },
  //   ],
  // },
  {
    type: "subgroup",
    label: "Relevé",
    icon: HiChartBar,
    collapsible: true,
    items: [
      // {
      //   moduleKey: "ctrl_info_produit",
      //   label: "CTRL Infos Produit",
      //   path: "/controle-infos-produit",
      //   icon: HiInformationCircle,
      // },
      {
        moduleKey: "releve",
        label: "Relevé Prix",
        path: "/releve",
        icon: HiCurrencyDollar,
      },
    ],
  },
  {
    type: "subgroup",
    label: "Étiquettes",
    icon: HiTag,
    collapsible: true,
    items: [
      {
        moduleKey: "etiquettes",
        label: "Générateur d'étiquettes",
        path: "/etiquettes",
        icon: HiTag,
      },
      {
        moduleKey: "edition_promo",
        label: "Édition Promo",
        path: "/edition-promo",
        icon: HiCurrencyDollar,
      },
    ],
  },
];

// Ancienne structure plate pour compatibilité (moduleMenus)
export const moduleMenus = {
  stock: {
    label: "Recherche Article",
    path: "/articles",
    icon: HiSearch,
  },
  proformas: {
    label: "Proformas",
    path: "/proformas",
    icon: HiAdjustments,
  },
  reapro: {
    label: "Reapro",
    path: "/reappro",
    icon: HiRefresh,
  },
  ctr_commande: {
    label: "CTRL Commandes",
    path: "/controle-commandes",
    icon: HiClipboardCheck,
  },
  prep_commande: {
    label: "PREPA Commandes",
    path: "/preparation-commandes",
    icon: HiShoppingCart,
  },
  ctrl_info_produit: {
    label: "CTRL Infos Produit",
    path: "/controle-infos-produit",
    icon: HiInformationCircle,
  },
  releve: {
    label: "Releve Prix",
    path: "/releve",
    icon: HiCurrencyDollar,
  },
  etiquettes: {
    label: "Générateur d'étiquettes",
    path: "/etiquettes",
    icon: HiTag,
  },
};

// =============================================
// HELPERS
// =============================================

export const isAdmin = (userInfo) => {
  return userInfo?.role === "admin";
};

export const hasAllModulesAccess = (userInfo) => {
  if (!userInfo?.permissions) return false;
  return userInfo.permissions.allModules === true;
};

export const hasAllEntreprisesAccess = (userInfo) => {
  if (!userInfo?.permissions) return false;
  return userInfo.permissions.allEntreprises === true;
};

export const hasModulePermission = (userInfo, module, action = "read") => {
  if (!userInfo) return false;
  if (isAdmin(userInfo)) return true;
  if (hasAllModulesAccess(userInfo)) return true;

  const permissions = userInfo.permissions;
  if (!permissions?.modules?.[module]) return false;

  return permissions.modules[module][action] === true;
};

export const hasEntrepriseAccess = (userInfo, entreprise) => {
  if (!userInfo) return false;
  if (isAdmin(userInfo)) return true;
  if (hasAllEntreprisesAccess(userInfo)) return true;

  const permissions = userInfo.permissions;
  return permissions?.entreprises?.includes(entreprise) || false;
};

export const hasRouteAccess = (userInfo, path, action = "read") => {
  if (!userInfo) return false;
  if (isAdmin(userInfo)) return true;
  if (path.startsWith("/admin")) return false;

  const module = Object.keys(moduleMenus).find((key) => {
    const menu = moduleMenus[key];
    return path === menu.path || path.startsWith(`${menu.path}/`);
  });

  if (!module) return true;

  return hasModulePermission(userInfo, module, action);
};

// =============================================
// GÉNÉRATION DES MENUS AVEC SOUS-GROUPES
// =============================================

/**
 * Génère les menus pour un utilisateur avec la nouvelle structure
 * supportant les sous-groupes
 */
export const getUserMenus = (userInfo) => {
  if (!userInfo) return [];

  const menus = [];

  // 0. Espace personnel — « Mes tâches », visible par TOUT utilisateur connecté.
  menus.push({
    type: "section",
    label: "Mon espace",
    collapsible: true,
    items: [
      { label: "Mes tâches", path: "/mes-taches", icon: HiClipboardCheck },
    ],
  });

  // 1. Section Administration — filtrée par permission de module.
  //    Visible pour un admin OU tout utilisateur ayant au moins une entrée
  //    autorisée (chaque entrée -> clé via moduleForPath -> hasModulePermission).
  const adminItems = filterAdminStructure(userInfo, adminMenuStructure);
  if (adminItems.length > 0) {
    menus.push({
      type: "section",
      label: "Administration",
      collapsible: true,
      items: adminItems,
    });
  }

  // 2. Section Modules selon permissions
  const moduleItems = getModuleMenuItems(userInfo);
  if (moduleItems.length > 0) {
    menus.push({
      type: "section",
      label: "Modules",
      collapsible: true,
      items: moduleItems,
    });
  }

  return menus;
};

// Écrans d'administration accessibles à un RESPONSABLE (gestion de son équipe).
// Les données sont scopées côté API (users de son équipe / ses équipes).
const RESPONSABLE_ADMIN_PATHS = [
  "/admin/users",
  "/admin/equipes",
  "/admin/taches",
];

// Un utilisateur peut-il voir une entrée du menu admin ?
// - responsable -> gestion d'équipe (utilisateurs scopés + équipes) ;
// - entrée mappée à un module (via son path) -> permission requise ;
// - entrée sans module (ex. /install) -> réservée aux admins.
const canSeeAdminItem = (userInfo, item) => {
  if (!item?.path) return isAdmin(userInfo);
  if (
    userInfo?.role === "responsable" &&
    RESPONSABLE_ADMIN_PATHS.includes(item.path)
  ) {
    return true;
  }
  const key = moduleForPath(item.path);
  if (key) return hasModulePermission(userInfo, key, "read");
  return isAdmin(userInfo);
};

// Filtre la structure admin (items + sous-groupes) selon les permissions.
const filterAdminStructure = (userInfo, structure) => {
  const out = [];
  structure.forEach((node) => {
    if (node.type === "subgroup") {
      const items = (node.items || []).filter((it) =>
        canSeeAdminItem(userInfo, it),
      );
      if (items.length > 0) out.push({ ...node, items });
    } else {
      // type "item" (Dashboard, etc.)
      if (canSeeAdminItem(userInfo, node)) out.push(node);
    }
  });
  return out;
};

/**
 * Récupère les items de modules accessibles avec sous-groupes
 */
const getModuleMenuItems = (userInfo) => {
  if (!userInfo) return [];

  const result = [];
  const hasFullAccess = isAdmin(userInfo) || hasAllModulesAccess(userInfo);

  // Clé de permission d'une entrée : moduleKey explicite, sinon déduite du path.
  const keyOf = (entry) =>
    entry.moduleKey || (entry.path ? moduleForPath(entry.path) : null);

  const canSee = (entry) => {
    if (hasFullAccess) return true;
    const key = keyOf(entry);
    return key ? hasModulePermission(userInfo, key, "read") : false;
  };

  moduleMenuStructure.forEach((item) => {
    if (item.type === "subgroup") {
      // Filtrer les items du sous-groupe selon les permissions
      const accessibleItems = item.items.filter((subItem) => canSee(subItem));

      // N'ajouter le sous-groupe que s'il a des items accessibles
      if (accessibleItems.length > 0) {
        result.push({
          ...item,
          items: accessibleItems,
        });
      }
    } else if (item.type === "item") {
      // Item simple - vérifier la permission
      if (canSee(item)) {
        result.push(item);
      }
    }
  });

  return result;
};

/**
 * Ancienne fonction pour compatibilité - retourne une liste plate
 */
export const getModuleMenus = (userInfo) => {
  if (!userInfo) return [];

  const menus = [];

  if (isAdmin(userInfo) || hasAllModulesAccess(userInfo)) {
    Object.values(moduleMenus).forEach((menu) => {
      menus.push({ ...menu });
    });
    return menus;
  }

  const permissions = userInfo.permissions;
  if (!permissions?.modules) return menus;

  Object.entries(moduleMenus).forEach(([moduleKey, menu]) => {
    const modulePerms = permissions.modules[moduleKey];
    if (modulePerms?.read) {
      menus.push({ ...menu });
    }
  });

  return menus;
};

export const getAccessibleEntreprises = (userInfo, allEntreprises = []) => {
  if (!userInfo) return [];

  if (isAdmin(userInfo) || hasAllEntreprisesAccess(userInfo)) {
    return allEntreprises;
  }

  const permissions = userInfo.permissions;
  if (!permissions?.entreprises) return [];

  return allEntreprises.filter((entreprise) =>
    permissions.entreprises.includes(entreprise.nom || entreprise),
  );
};