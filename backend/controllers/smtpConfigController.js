// backend/controllers/smtpConfigController.js
//
// Administration des paramètres SMTP (global + par module). Admin uniquement.
// Le .env reste le défaut ; ces surcharges (base) prennent le dessus.
import asyncHandler from "../middleware/asyncHandler.js";
import sendEmail from "../utils/sendEmail.js";
import { getAdminView, saveConfig, resetConfig } from "../services/smtpConfigService.js";
import { SMTP_MODULE_KEYS } from "../config/smtpScopes.js";

const ALLOWED = new Set(["global", ...SMTP_MODULE_KEYS]);

// GET /api/smtp-config -> { env(masqué), configs{scope:...} }
export const getConfigs = asyncHandler(async (req, res) => {
  res.json(await getAdminView());
});

// PUT /api/smtp-config/:scope
export const saveConfigCtrl = asyncHandler(async (req, res) => {
  const { scope } = req.params;
  if (!ALLOWED.has(scope)) {
    res.status(400);
    throw new Error("Scope SMTP invalide.");
  }
  const view = await saveConfig(scope, req.body || {}, req.user?._id || null);
  res.json(view);
});

// DELETE /api/smtp-config/:scope  (retour au défaut)
export const resetConfigCtrl = asyncHandler(async (req, res) => {
  const { scope } = req.params;
  if (!ALLOWED.has(scope)) {
    res.status(400);
    throw new Error("Scope SMTP invalide.");
  }
  res.json(await resetConfig(scope));
});

// POST /api/smtp-config/:scope/test  body: { email }
export const testConfigCtrl = asyncHandler(async (req, res) => {
  const { scope } = req.params;
  const email = String(req.body?.email || "").trim();
  if (!ALLOWED.has(scope)) {
    res.status(400);
    throw new Error("Scope SMTP invalide.");
  }
  if (!email) {
    res.status(400);
    throw new Error("Adresse email de test requise.");
  }
  try {
    await sendEmail({
      module: scope === "global" ? null : scope,
      email,
      subject: `Test SMTP (${scope})`,
      html: `<p>Ceci est un email de test de la configuration SMTP « <b>${scope}</b> ».</p><p>Si vous le recevez, la configuration fonctionne.</p>`,
    });
    res.json({ ok: true, message: `Email de test envoyé à ${email}.` });
  } catch (e) {
    res.status(502);
    throw new Error(`Échec de l'envoi de test : ${e.message}`);
  }
});
