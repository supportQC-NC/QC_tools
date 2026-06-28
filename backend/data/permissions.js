// backend/data/permissions.js
const permissions = [
  // Permissions Admin (index 0)
  {
    entreprises: [],
    allEntreprises: true,
    allModules: true,
    modules: {
      clients: { read: true, write: true, delete: true },
      factures: { read: true, write: true, delete: true },
      rapports: { read: true, write: true, delete: true },
      stock: { read: true, write: true, delete: true },
      parametres: { read: true, write: true, delete: true },
      inventaire: { read: true, write: true, delete: false },
    },
  },
  // Permissions User (index 1)
  {
    entreprises: [],
    allEntreprises: false,
    allModules: false,
    modules: {
      clients: { read: true, write: true, delete: false },
      factures: { read: true, write: false, delete: false },
      rapports: { read: true, write: false, delete: false },
      stock: { read: true, write: false, delete: false }, // ← CHANGÉ: true
      parametres: { read: false, write: false, delete: false },
      inventaire: { read: true, write: true, delete: false },
    },
  },
];

export default permissions;
