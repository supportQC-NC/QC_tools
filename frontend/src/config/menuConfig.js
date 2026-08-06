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
  HiDownload,
  HiChatAlt2,
  HiMail,
  HiSparkles,
  HiTrendingUp,
  HiUser,
  HiCog
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
      { label: "Organisation du menu", path: "/admin/infobulles", icon: HiInformationCircle },
      { label: "Paramètres Email (SMTP)", path: "/admin/smtp", icon: HiMail },
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
      { label: "Envoi Cde Fournisseur", path: "/admin/envoi-cde-fournisseur", icon: HiMail },
      { label: "Proformas", path: "/admin/proformas", icon: HiDocumentReport },
      { label: "Factures", path: "/admin/factures", icon: HiCurrencyDollar },
      { label: "Bipages", path: "/admin/demandes-bipage", icon: HiClipboardList },
      { label: "Suivi Réceptions", path: "/admin/suivi-receptions", icon: HiClipboardCheck },
      { label: "Suivi des entrées", path: "/admin/suivi-entrees", icon: HiTruck },
      { label: "Entrées sur réservation", path: "/admin/resa-entrees", icon: HiClipboardCheck },
      { label: "Gisements & Groupes", path: "/admin/export-gisements", icon: HiDownload },
      { label: "Dictionnaire des rayons", path: "/admin/dictionnaire-rayons", icon: HiTag },
      { label: "Exécutables", path: "/admin/executables", icon: HiDownload },
    ],
  },
  {
    type: "subgroup",
    label: "Commerciaux",
    icon: HiTrendingUp,
    collapsible: true,
    items: [
      { label: "Top Ventes", path: "/admin/top-ventes", icon: HiTrendingUp },
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
      { label: "Rapports TGC", path: "/admin/rapport-tgc", icon: HiCurrencyDollar },
      { label: "Balances clients", path: "/admin/balances-clients", icon: HiCurrencyDollar },
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
        moduleKey: "changement_prix",
        label: "Changement de prix",
        path: "/changement-prix",
        icon: HiCurrencyDollar,
      },
      {
        moduleKey: "edition_promo",
        label: "Édition Promo",
        path: "/edition-promo",
        icon: HiCurrencyDollar,
      },
    ],
  },
  {
    type: "subgroup",
    label: "Communication",
    icon: HiMail,
    collapsible: true,
    items: [
      {
        moduleKey: "mailing",
        label: "Mailing clients",
        path: "/mailing",
        icon: HiMail,
      },
      {
        moduleKey: "communication_client",
        label: "Nouveautés clients",
        path: "/communication-client",
        icon: HiMail,
      },
      {
        moduleKey: "assistant_ia",
        label: "Assistant IA",
        path: "/assistant-ia",
        icon: HiSparkles,
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
      { label: "Espace équipe", path: "/espace-equipe", icon: HiChatAlt2 },
      { label: "Mon profil", path: "/profile", icon: HiUser },
      { label: "Organiser mon menu", path: "/mon-menu", icon: HiViewGrid },
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

// =============================================
// INFOBULLES DES ONGLETS (survol) — textes par défaut
// =============================================
// Texte court affiché au survol de chaque onglet. Peut être surchargé par
// l'administrateur (stocké en base, clé = path). Voir Sidebar + AdminInfobulles.
export const DEFAULT_MENU_HINTS = {
  "/admin": "Vue d'ensemble et indicateurs clés.",
  "/mes-taches": "Vos tâches personnelles à traiter.",
  "/espace-equipe": "Messagerie et espace de travail de vos équipes.",
  // Gestion
  "/admin/users": "Gérer les comptes utilisateurs et leurs accès.",
  "/admin/equipes": "Créer et gérer les équipes.",
  "/admin/taches": "Suivre et assigner les tâches.",
  "/admin/entreprises": "Configurer les sociétés et leurs chemins de données.",
  "/admin/infobulles": "Réorganiser, masquer et décrire les onglets du menu.",
  "/admin/smtp": "Paramètres d'envoi d'emails (SMTP) global et par module.",
  "/admin/concurrents": "Relevés et suivi des prix concurrents.",
  "/install": "Installer l'application mobile (QR code).",
  // Données
  "/articles": "Rechercher un article (stock, prix, gencode).",
  "/admin/articles": "Rechercher et consulter les articles.",
  "/admin/fournisseurs": "Consulter les fournisseurs.",
  "/admin/clients": "Consulter les clients.",
  "/admin/reservations": "Réservations clients (proformas en cours).",
  "/admin/commandes": "Commandes fournisseurs et leur suivi.",
  "/admin/envoi-cde-fournisseur":
    "Envoyer les commandes préparées aux fournisseurs par email.",
  "/admin/proformas": "Proformas / devis clients.",
  "/admin/factures": "Factures clients.",
  "/admin/demandes-bipage": "Demandes d'articles à biper (collecteur).",
  "/admin/bipages": "Détail des bipages remontés.",
  "/admin/suivi-receptions": "Suivi des réceptions de marchandises.",
  "/admin/suivi-entrees":
    "Marchandises entrées du jour (entrees.dbf) enrichies + contrôle TGC.",
  "/admin/resa-entrees":
    "Articles réservés / commande spéciale qui entrent en stock (client + vendeur).",
  "/admin/export-gisements": "Export Excel des gisements et groupes.",
  "/admin/dictionnaire-rayons": "Dictionnaire des rayons (libellés, métrage).",
  "/admin/executables": "Téléchargements et exécutables.",
  // Inventaire
  "/admin/zones": "Fiches d'inventaire par zone.",
  "/admin/inventaire-progression": "Progression de l'inventaire en cours.",
  "/admin/recap-zones": "Récapitulatif de l'inventaire par zone.",
  "/admin/fiches-controle": "Fiches de contrôle d'inventaire.",
  "/admin/inventaire-proforma": "Inventaire à partir d'une proforma.",
  // Commerciaux
  "/admin/top-ventes": "Classement des ventes par fournisseur ou rayon.",
  // Analyse
  "/admin/commerciaux": "Chiffre d'affaires par commercial (REPRES).",
  "/admin/filiales": "Analyse des filiales.",
  "/admin/analyse-ca": "Analyse du chiffre d'affaires.",
  "/admin/facture-analyse": "Analyse de la facturation.",
  "/admin/journal-caisse": "Journal de caisse.",
  "/admin/rapport-tgc":
    "Déclaration TGC mensuelle (base HT & TGC par taux) + alertes.",
  "/admin/balances-clients":
    "Encours clients par ancienneté + clients à bloquer (dette ≥ 2 mois).",
  "/admin/top-articles": "Meilleures ventes par article (facture).",
  "/admin/reappro-local": "Réapprovisionnement local.",
  "/admin/analyse-reappro": "Analyse des réapprovisionnements.",
  "/admin/debit-comptant": "Répartition débit / comptant.",
  "/admin/gencod-doublons": "Détection des doublons de gencode.",
  "/admin/performance-dock": "Performance du dock (réceptions).",
  "/admin/collecteurs": "Collecteurs (terminaux de scan).",
  "/admin/collecteurs-carte": "Carte de localisation des collecteurs.",
  // Modules (gestion utilisateur)
  "/releve": "Relevé de prix terrain.",
  "/etiquettes": "Générateur d'étiquettes.",
  "/changement-prix":
    "Changements de prix de vente (rapport Excel + étiquettes).",
  "/edition-promo": "Édition des promotions.",
  "/mailing": "Emailing clients (campagnes).",
  "/assistant-ia": "Assistant IA branché sur les données société.",
  "/communication-client":
    "Catalogue des nouveautés en stock, envoyé aux clients abonnés.",
};

// Onglets de l'espace personnel (section fixe, non gérée par le constructeur).
const PERSONAL_ITEMS = [
  { label: "Mes tâches", path: "/mes-taches", icon: HiClipboardCheck },
  { label: "Espace équipe", path: "/espace-equipe", icon: HiChatAlt2 },
  { label: "Mon profil", path: "/profile", icon: HiUser },
  { label: "Organiser mon menu", path: "/mon-menu", icon: HiViewGrid },
];

// Aplatit toutes les structures de menu -> liste { path, label, group } unique.
// Sert à l'écran d'administration des infobulles.
export const getAllMenuItems = () => {
  const out = [];
  const seen = new Set();
  const push = (item, group) => {
    if (!item?.path || seen.has(item.path)) return;
    seen.add(item.path);
    out.push({ path: item.path, label: item.label, group });
  };
  PERSONAL_ITEMS.forEach((it) => push(it, "Mon espace"));
  const walk = (nodes, group) => {
    (nodes || []).forEach((node) => {
      if (node.type === "subgroup") walk(node.items, node.label);
      else push(node, group);
    });
  };
  walk(adminMenuStructure, "Administration");
  walk(moduleMenuStructure, "Modules");
  return out;
};

// Texte d'infobulle effectif : override admin > défaut > vide.
// `config` = map { path: { hint, ordre, masque } } renvoyée par l'API.
export const getMenuHint = (path, config = {}) =>
  (config && config[path] && config[path].hint) ||
  DEFAULT_MENU_HINTS[path] ||
  "";

// =============================================
// CONSTRUCTEUR DE MENU — catalogue + structure base + assemblage
// =============================================

// Icônes proposées pour les chapitres (map nom -> composant). Repli : HiFolder.
export const CHAPTER_ICONS = {
  folder: HiFolder,
  database: HiDatabase,
  cube: HiCube,
  chart: HiChartBar,
  trending: HiTrendingUp,
  cart: HiShoppingCart,
  truck: HiTruck,
  tag: HiTag,
  users: HiUserGroup,
  building: HiOfficeBuilding,
  mail: HiMail,
  document: HiDocumentReport,
  money: HiCurrencyDollar,
  grid: HiViewGrid,
  device: HiDeviceMobile,
  sparkles: HiSparkles,
};
export const chapterIcon = (name) => CHAPTER_ICONS[name] || HiFolder;

const slug = (s) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "chap";

// Catalogue = TOUS les onglets connus du code (hors espace perso), avec leur
// permission (moduleKey explicite sinon déduite du path).
export const getMenuCatalog = () => {
  const out = [];
  const seen = new Set();
  const add = (item) => {
    if (!item?.path || seen.has(item.path)) return;
    seen.add(item.path);
    out.push({
      path: item.path,
      label: item.label,
      icon: item.icon || null,
      permKey: item.moduleKey || moduleForPath(item.path) || null,
    });
  };
  const walk = (nodes) =>
    (nodes || []).forEach((n) =>
      n.type === "subgroup" ? walk(n.items) : add(n),
    );
  walk(adminMenuStructure);
  walk(moduleMenuStructure);
  return out;
};

// Structure par défaut (repli si la base est vide) = calque de la structure code.
export const getDefaultLayout = () => {
  const chapitres = [];
  const topItems = [];
  const walkTop = (nodes) =>
    (nodes || []).forEach((n) => {
      if (n.type === "subgroup") {
        chapitres.push({
          key: slug(n.label),
          label: n.label,
          icon: "",
          items: (n.items || []).map((i) => i.path).filter(Boolean),
        });
      } else if (n.path) {
        topItems.push(n.path);
      }
    });
  walkTop(adminMenuStructure);
  walkTop(moduleMenuStructure);
  if (topItems.length) {
    chapitres.unshift({ key: "general", label: "Général", icon: "", items: topItems });
  }
  return { chapitres, masques: [] };
};

// Onglets admin visibles par un responsable (gestion d'équipe).
const RESP_PATHS = ["/admin/users", "/admin/equipes", "/admin/taches"];

// Un utilisateur voit-il un onglet du catalogue ? (mêmes règles que canSeeAdminItem)
export const catalogItemVisible = (userInfo, cat) => {
  if (!userInfo) return false;
  if (userInfo.role === "responsable" && RESP_PATHS.includes(cat.path)) return true;
  if (cat.permKey) return hasModulePermission(userInfo, cat.permKey, "read");
  return isAdmin(userInfo); // onglet sans permission -> admin uniquement
};

// Assemble les sections à rendre dans la sidebar à partir de la structure base.
// Retourne UNE section sans titre contenant des sous-groupes (Mon espace + chapitres
// + Non classé), chacun filtré par les permissions de l'utilisateur.
export const buildSidebar = (userInfo, layout, hints) => {
  if (!userInfo) return [];
  const catalog = getMenuCatalog();
  const byPath = new Map(catalog.map((c) => [c.path, c]));
  const lay =
    layout && Array.isArray(layout.chapitres) && layout.chapitres.length
      ? layout
      : getDefaultLayout();
  const masques = new Set(lay.masques || []);
  const placed = new Set();

  const subgroups = [];

  // 1. Mon espace (fixe).
  subgroups.push({
    type: "subgroup",
    label: "Mon espace",
    icon: HiChatAlt2,
    items: PERSONAL_ITEMS.map((it) => ({ ...it })),
  });

  // 2. Chapitres définis par l'admin.
  for (const ch of lay.chapitres || []) {
    const items = [];
    for (const path of ch.items || []) {
      placed.add(path);
      if (masques.has(path)) continue;
      const cat = byPath.get(path);
      if (!cat || !catalogItemVisible(userInfo, cat)) continue;
      items.push({ label: cat.label, path: cat.path, icon: cat.icon });
    }
    if (items.length) {
      subgroups.push({
        type: "subgroup",
        label: ch.label || "Sans nom",
        icon: chapterIcon(ch.icon),
        items,
      });
    }
  }

  // 3. Non classé : onglets du catalogue non rangés, non masqués, visibles.
  const nonClasses = catalog
    .filter(
      (c) => !placed.has(c.path) && !masques.has(c.path) && catalogItemVisible(userInfo, c),
    )
    .map((c) => ({ label: c.label, path: c.path, icon: c.icon }));
  if (nonClasses.length) {
    subgroups.push({
      type: "subgroup",
      label: "Non classé",
      icon: HiFolder,
      items: nonClasses,
    });
  }

  return [{ type: "section", label: "", collapsible: false, items: subgroups }];
};

// Applique l'ordre + le masquage définis par l'admin aux menus (getUserMenus).
// - trie les items de chaque sous-groupe par `ordre` (null => ordre du code) ;
// - retire les items masqués ; supprime les sous-groupes/sections devenus vides.
const isMasque = (config, path) => !!(config && config[path] && config[path].masque);
const ordreOf = (config, path) => {
  const o = config && config[path] ? config[path].ordre : null;
  return o === null || o === undefined ? null : o;
};
const trierEtFiltrer = (items, config) =>
  (items || [])
    .filter((it) => !(it.path && isMasque(config, it.path)))
    .map((it, i) => ({ it, i }))
    .sort((a, b) => {
      const oa = a.it.path ? ordreOf(config, a.it.path) : null;
      const ob = b.it.path ? ordreOf(config, b.it.path) : null;
      if (oa === null && ob === null) return a.i - b.i;
      if (oa === null) return 1;
      if (ob === null) return -1;
      return oa - ob || a.i - b.i;
    })
    .map((x) => x.it);

export const applyMenuConfig = (menus, config = {}) => {
  const out = [];
  for (const section of menus || []) {
    const nodes = [];
    for (const node of section.items || []) {
      if (node.type === "subgroup") {
        const its = trierEtFiltrer(node.items, config);
        if (its.length) nodes.push({ ...node, items: its });
      } else if (!(node.path && isMasque(config, node.path))) {
        nodes.push(node);
      }
    }
    if (nodes.length) out.push({ ...section, items: nodes });
  }
  return out;
};