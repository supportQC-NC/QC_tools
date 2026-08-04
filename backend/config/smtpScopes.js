// backend/config/smtpScopes.js
//
// Modules qui envoient des emails et peuvent avoir leur propre surcharge SMTP
// (notamment un « From » différent). Miroir front : frontend/src/config/smtpScopes.js.
export const SMTP_MODULE_SCOPES = [
  { key: "envoi_cde_fournisseur", label: "Envoi Cde Fournisseur" },
  { key: "mailing", label: "Mailing clients" },
  { key: "rapports", label: "Rapports (réception, préparation, abonnements)" },
  { key: "comptes", label: "Comptes utilisateurs (mot de passe, bienvenue)" },
];

export const SMTP_MODULE_KEYS = SMTP_MODULE_SCOPES.map((s) => s.key);

export default SMTP_MODULE_SCOPES;
