import {
  HiUsers,
  HiOfficeBuilding,
  HiLockClosed,
  HiCog,
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
  HiDeviceMobile
} from "react-icons/hi";

// =============================================
// CONFIGURATION DES MENUS AVEC SOUS-GROUPES
// =============================================

// Structure des menus ADMIN avec sous-groupes
export const adminMenuStructure = [
  {
    type: "item",
    label: "Dashboard",
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
      {
        label: "Utilisateurs",
        path: "/admin/users",
        icon: HiUsers,
      },
      {
        label: "Entreprises",
        path: "/admin/entreprises",
        icon: HiOfficeBuilding,
      },
      // {
      //   label: "Permissions",
      //   path: "/admin/permissions",
      //   icon: HiLockClosed,
      // },
      {
        label: "Concurrents",
        path: "/admin/concurrents",
        icon: HiUserGroup,
      },
           { label: "Collecteurs", path: "/admin/collecteurs", icon: HiDeviceMobile },
     { label: "Installation app", path: "/install", icon: HiQrcode },
    ],
  },
  {
    type: "subgroup",
    label: "Données",
    icon: HiDatabase,
    collapsible: true,
    items: [
      {
        label: "Articles",
        path: "/admin/articles",
        icon: HiCube,
      },
      {
        label: "Fournisseurs",
        path: "/admin/fournisseurs",
        icon: HiCube,
      },
      {
        label: "Clients",
        path: "/admin/clients",
        icon: HiCube,
      },
      {
        label: "Commandes",
        path: "/admin/commandes",
        icon: HiTruck,
      },
      {
        label: "proformas",
        path: "/admin/proformas",
        icon: HiTruck,
      },
      {
        label: "factures",
        path: "/admin/factures",
        icon: HiTruck,
      },
    ],
  },
  {
    type: "subgroup",
    label: "Analyse",
    icon: HiCog,
    collapsible: true,
    items: [
      {
        label: "Analyse Commerciaux",
        path: "/admin/commerciaux",
        icon: HiUserGroup,
      },
      {
        label: "Analyse Filiales",
        path: "/admin/filiales",
        icon: HiOfficeBuilding,
      },
      { label: "Reappro Local", path: "/admin/reappro-local", icon: HiTruck },
       { label: "Débit / Comptant", path: "/admin/debit-comptant", icon: HiCurrencyDollar },
         { label: "Doublons GENCODE", path: "/admin/gencod-doublons", icon: HiDatabase },
            { label: "Collecteurs", path: "/admin/collecteurs", icon: HiDeviceMobile },
         
 
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

  // 1. Section Administration (admin uniquement)
  if (isAdmin(userInfo)) {
    menus.push({
      type: "section",
      label: "Administration",
      collapsible: true,
      items: adminMenuStructure,
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

/**
 * Récupère les items de modules accessibles avec sous-groupes
 */
const getModuleMenuItems = (userInfo) => {
  if (!userInfo) return [];

  const result = [];
  const hasFullAccess = isAdmin(userInfo) || hasAllModulesAccess(userInfo);

  moduleMenuStructure.forEach((item) => {
    if (item.type === "subgroup") {
      // Filtrer les items du sous-groupe selon les permissions
      const accessibleItems = item.items.filter((subItem) => {
        if (hasFullAccess) return true;
        return hasModulePermission(userInfo, subItem.moduleKey, "read");
      });

      // N'ajouter le sous-groupe que s'il a des items accessibles
      if (accessibleItems.length > 0) {
        result.push({
          ...item,
          items: accessibleItems,
        });
      }
    } else if (item.type === "item") {
      // Item simple - vérifier la permission
      if (
        hasFullAccess ||
        hasModulePermission(userInfo, item.moduleKey, "read")
      ) {
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
