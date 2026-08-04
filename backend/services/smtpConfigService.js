// backend/services/smtpConfigService.js
//
// Résolution de la configuration SMTP effective : .env (défaut immuable) < surcharge
// « global » (base) < surcharge « module » (base). Un champ vide hérite du niveau
// inférieur. Sert à `utils/sendEmail.js` et `services/mailingSender.js`.
import SmtpConfig from "../models/SmtpConfigModel.js";

// Défauts issus du .env (jamais modifiés).
const envBase = () => ({
  host: process.env.SMTP_HOST || "",
  port: process.env.SMTP_PORT || "",
  secureBool: String(process.env.SMTP_SECURE || "true").toLowerCase() !== "false",
  user: process.env.SMTP_USER || "",
  password: process.env.SMTP_PASSWORD || "",
  fromName: process.env.SMTP_FROM_NAME || "",
  fromEmail: process.env.SMTP_USER || "",
});

// Cache court (les envois en masse ne martèlent pas la base).
const cache = new Map(); // scope -> { resolved, ts }
const TTL = 30 * 1000;
export const invalidateSmtpCache = () => cache.clear();

const loadConfigs = async (scope) => {
  const scopes = ["global"];
  if (scope && scope !== "global") scopes.push(scope);
  const docs = await SmtpConfig.find({ scope: { $in: scopes } }).lean();
  const byScope = {};
  for (const d of docs) byScope[d.scope] = d;
  return { global: byScope.global || null, module: scope ? byScope[scope] || null : null };
};

// Config SMTP effective pour un scope module (ou global si non fourni).
export const resolveSmtp = async (scope = null) => {
  const key = scope || "global";
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < TTL) return hit.resolved;

  const env = envBase();
  const { global, module } = await loadConfigs(scope);
  const layers = [global, module].filter((c) => c && c.actif !== false);

  let host = env.host;
  let portStr = env.port;
  let secureSel = ""; // "", "ssl", "tls"
  let user = env.user;
  let pass = env.password;
  let fromName = env.fromName;
  let fromEmail = env.fromEmail;

  for (const c of layers) {
    if (c.host) host = c.host;
    if (c.port) portStr = c.port;
    if (c.secure) secureSel = c.secure;
    if (c.user) user = c.user;
    if (c.password) pass = c.password;
    if (c.fromName) fromName = c.fromName;
    if (c.fromEmail) fromEmail = c.fromEmail;
  }

  let secure;
  if (secureSel === "ssl") secure = true;
  else if (secureSel === "tls") secure = false;
  else secure = env.secureBool;

  const port = parseInt(portStr, 10) || (secure ? 465 : 587);
  const resolved = {
    host,
    port,
    secure,
    user,
    pass,
    fromName,
    fromEmail: fromEmail || user,
  };
  cache.set(key, { resolved, ts: Date.now() });
  return resolved;
};

// En-tête From prêt à l'emploi ("Nom" <email>).
export const buildFrom = (resolved, fallbackName = "") =>
  `"${resolved.fromName || fallbackName || "Krysto"}" <${resolved.fromEmail}>`;

// ── Administration ───────────────────────────────────────────────────────────
const publicView = (doc) => ({
  scope: doc.scope,
  host: doc.host || "",
  port: doc.port || "",
  secure: doc.secure || "",
  user: doc.user || "",
  fromName: doc.fromName || "",
  fromEmail: doc.fromEmail || "",
  hasPassword: !!doc.password,
  actif: doc.actif !== false,
});

// Vue pour l'écran admin : défauts .env (masqués) + surcharges enregistrées.
export const getAdminView = async () => {
  const env = envBase();
  const docs = await SmtpConfig.find({}).lean();
  const configs = {};
  for (const d of docs) configs[d.scope] = publicView(d);
  return {
    env: {
      host: env.host,
      port: env.port,
      secure: env.secureBool ? "ssl" : "tls",
      user: env.user,
      fromName: env.fromName,
      fromEmail: env.fromEmail,
      hasPassword: !!env.password,
    },
    configs,
  };
};

// Upsert d'une surcharge. `password` n'est modifié que s'il est fourni (non vide),
// ou effacé si clearPassword = true.
export const saveConfig = async (scope, fields = {}, userId = null) => {
  const set = { updatedBy: userId };
  ["host", "port", "user", "fromName", "fromEmail"].forEach((f) => {
    if (fields[f] !== undefined) set[f] = String(fields[f] || "").trim();
  });
  if (fields.secure !== undefined)
    set.secure = ["ssl", "tls"].includes(fields.secure) ? fields.secure : "";
  if (fields.actif !== undefined) set.actif = !!fields.actif;
  if (fields.clearPassword) set.password = "";
  else if (fields.password) set.password = String(fields.password);

  await SmtpConfig.findOneAndUpdate(
    { scope },
    { $set: set },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
  invalidateSmtpCache();
  const doc = await SmtpConfig.findOne({ scope }).lean();
  return publicView(doc);
};

// Supprime une surcharge -> retour au défaut (niveau inférieur / .env).
export const resetConfig = async (scope) => {
  await SmtpConfig.deleteOne({ scope });
  invalidateSmtpCache();
  return { scope, reset: true };
};

export default { resolveSmtp, buildFrom, getAdminView, saveConfig, resetConfig, invalidateSmtpCache };
