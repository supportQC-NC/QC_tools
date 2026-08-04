// src/config/smtpScopes.js — miroir de backend/config/smtpScopes.js
export const SMTP_MODULE_SCOPES = [
  { key: "envoi_cde_fournisseur", label: "Envoi Cde Fournisseur" },
  { key: "mailing", label: "Mailing clients" },
  { key: "rapports", label: "Rapports (réception, préparation, abonnements)" },
  { key: "comptes", label: "Comptes utilisateurs (mot de passe, bienvenue)" },
];

export default SMTP_MODULE_SCOPES;
