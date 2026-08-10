// backend/config/dbfTables.js
//
// Catalogue des bases DBF de l'ERP sur lesquelles on peut restreindre les
// champs visibles par utilisateur (Permission.champsDbf).
//
// Le nom des champs n'est PAS figé ici : il est lu dans le fichier DBF réel de
// la société (dbfChampsService.listerChamps), car la structure peut varier d'un
// dossier à l'autre. Ce fichier ne déclare que les tables et leur libellé.
//
// Miroir léger côté client : frontend/src/config/dbfTables.js (libellés seuls).

// `label` = le NOM RÉEL du fichier DBF, tel qu'il existe dans le dossier de la
// société. C'est ce nom qui est affiché à l'administrateur : il doit pouvoir
// faire le lien direct avec la base de l'ERP, sans traduction.
// `description` n'est qu'une aide de lecture.
export const DBF_TABLES = [
  { key: "article", fichier: "article.dbf", label: "article.dbf", description: "Articles" },
  { key: "artplus", fichier: "artplus.dbf", label: "artplus.dbf", description: "Compléments article" },
  { key: "fourniss", fichier: "fourniss.dbf", label: "fourniss.dbf", description: "Fournisseurs" },
  { key: "clients", fichier: "clients.dbf", label: "clients.dbf", description: "Clients" },
  { key: "tiers", fichier: "tiers.dbf", label: "tiers.dbf", description: "Tiers comptables" },
  { key: "cmdref", fichier: "cmdref.dbf", label: "cmdref.dbf", description: "Entêtes de commande" },
  { key: "cmdetail", fichier: "cmdetail.dbf", label: "cmdetail.dbf", description: "Lignes de commande" },
  { key: "facture", fichier: "facture.dbf", label: "facture.dbf", description: "Entêtes de facture" },
  { key: "detail", fichier: "detail.dbf", label: "detail.dbf", description: "Lignes de facture" },
  { key: "proforma", fichier: "proforma.dbf", label: "proforma.dbf", description: "Entêtes de proforma" },
  { key: "prodet", fichier: "prodet.dbf", label: "prodet.dbf", description: "Lignes de proforma" },
  { key: "entrees", fichier: "entrees.dbf", label: "entrees.dbf", description: "Entrées marchandises" },
  { key: "balances", fichier: "balances.dbf", label: "balances.dbf", description: "Balances clients" },
  { key: "verif", fichier: "verif.dbf", label: "verif.dbf", description: "Changements de prix" },
  { key: "filiales", fichier: "filiales.dbf", label: "filiales.dbf", description: "Filiales" },
];

export const DBF_TABLE_KEYS = DBF_TABLES.map((t) => t.key);

export const DBF_TABLE_BY_KEY = DBF_TABLES.reduce((acc, t) => {
  acc[t.key] = t;
  return acc;
}, {});

// Modes de restriction d'une table.
//   "tous"  : aucun filtrage (défaut, rétro-compatible)
//   "liste" : seuls les champs listés sont visibles
export const MODES_CHAMPS = ["tous", "liste"];

export default { DBF_TABLES, DBF_TABLE_KEYS, DBF_TABLE_BY_KEY, MODES_CHAMPS };
