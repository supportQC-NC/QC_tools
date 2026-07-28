// backend/services/mailTracking.js
//
// Suivi des emails (ouvertures / clics) et lien de désinscription — SANS auth
// (les clients mail chargent ces URLs). Chaque URL porte un TOKEN signé (HMAC)
// pour éviter la falsification / l'énumération.
//
//  - token destinataire : { t:"r", c:<campaignId>, r:<rid> }  (ouverture + clic)
//  - token désinscription: { t:"u", e:<entrepriseId>, m:<email> }
//
// Le sender injecte, PAR destinataire : un pixel d'ouverture, la réécriture des
// liens http(s) vers une redirection traçée, et l'URL de désinscription.
import crypto from "crypto";

const SECRET =
  process.env.MAIL_TRACK_SECRET ||
  process.env.JWT_SECRET ||
  "mail-track-dev-secret";

const b64url = (buf) => Buffer.from(buf).toString("base64url");
const hmac = (data) =>
  crypto.createHmac("sha256", SECRET).update(data).digest("base64url").slice(0, 24);

export const sign = (obj) => {
  const p = b64url(JSON.stringify(obj));
  return `${p}.${hmac(p)}`;
};

export const verify = (token) => {
  if (!token || typeof token !== "string") return null;
  const dot = token.lastIndexOf(".");
  if (dot < 0) return null;
  const p = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!p || !sig || hmac(p) !== sig) return null;
  try {
    return JSON.parse(Buffer.from(p, "base64url").toString("utf8"));
  } catch {
    return null;
  }
};

export const recipientToken = (campaignId, rid) =>
  sign({ t: "r", c: String(campaignId), r: rid });
export const unsubToken = (entrepriseId, email) =>
  sign({ t: "u", e: String(entrepriseId), m: String(email).toLowerCase() });

export const openPixelUrl = (base, token) => `${base}/api/mailing/o/${token}`;
export const clickUrl = (base, token, url) =>
  `${base}/api/mailing/c/${token}?u=${encodeURIComponent(url)}`;
export const unsubUrl = (base, token) => `${base}/api/mailing/u/${token}`;

// Réécrit les liens http(s) en redirections traçées + insère le pixel d'ouverture.
// NB : appelé APRÈS applyMerge et AVANT le remplacement de {{unsubscribe_url}}
// (qui n'est pas un lien http, donc non réécrit).
export const injectTracking = (html, base, token) => {
  let out = String(html || "").replace(
    /href="(https?:\/\/[^"]+)"/gi,
    (_m, url) => `href="${clickUrl(base, token, url)}"`,
  );
  const pixel = `<img src="${openPixelUrl(
    base,
    token,
  )}" width="1" height="1" alt="" style="display:none;max-height:0;overflow:hidden;border:0;" />`;
  out = out.includes("</body>")
    ? out.replace("</body>", `${pixel}</body>`)
    : out + pixel;
  return out;
};

// GIF transparent 1×1 pour le pixel d'ouverture.
export const PIXEL_GIF = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64",
);

export default {
  sign,
  verify,
  recipientToken,
  unsubToken,
  openPixelUrl,
  clickUrl,
  unsubUrl,
  injectTracking,
  PIXEL_GIF,
};
