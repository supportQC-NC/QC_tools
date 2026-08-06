// backend/controllers/communicationClientController.js
//
// Module « Communication client — catalogue nouveautés ».
// Société injectée par checkEntrepriseAccess (:nomDossierDBF -> req.entreprise).
//
// ⚠️ GARDE-FOU EMAIL : en mode TEST, l'envoi ne part QUE vers support@quincaillerie.nc
// (jamais un vrai client). Les envois « abonnés » ciblent les clients NEWSLETTER.
import asyncHandler from "../middleware/asyncHandler.js";
import { getNouveautes } from "../services/nouveautesService.js";
import { buildCatalogHtml } from "../services/nouveautesCatalogService.js";
import AbonnementRapportClient from "../models/masterConfig/AbonnementRapportClientModel.js";
import sendEmail from "../utils/sendEmail.js";

// Adresses AUTORISÉES pour un envoi de test (jamais la base clients).
const TEST_RECIPIENTS = [
  "support@quincaillerie.nc",
  "communication@quincaillerie.nc",
  "krysto.contact@gmail.com",
];
// Destinataire unique d'un envoi de test.
const TEST_TO = "support@quincaillerie.nc";

const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// Période par défaut = mois courant.
const currentMonthRange = () => {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return { start: ymd(start), end: ymd(end) };
};

const isValidDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));

const resolvePeriode = (q) => {
  const def = currentMonthRange();
  const start = isValidDay(q.start) ? q.start : def.start;
  const end = isValidDay(q.end) ? q.end : def.end;
  return { start, end };
};

const frDay = (s) => (isValidDay(s) ? s.split("-").reverse().join("/") : s);
const periodeLabel = ({ start, end }) => `du ${frDay(start)} au ${frDay(end)}`;

// Emails des abonnés NEWSLETTER de la société (dédupliqués, non vides).
const getAbonnesNewsletter = async (entrepriseId) => {
  const docs = await AbonnementRapportClient.find({
    entreprise: entrepriseId,
    newsletter: true,
  })
    .select("email")
    .lean();
  const set = new Set();
  for (const d of docs) {
    const e = String(d.email || "").trim().toLowerCase();
    if (e) set.add(e);
  }
  return [...set];
};

/**
 * @route  GET /api/communication-client/:nomDossierDBF?start&end
 * @access Private (module communication_client, read)
 */
const getNouveautesReport = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const periode = resolvePeriode(req.query);
  const data = await getNouveautes(entreprise, periode);
  const nbAbonnes = (await getAbonnesNewsletter(entreprise._id)).length;
  res.json({ ...data, nbAbonnes });
});

/**
 * @route  GET /api/communication-client/:nomDossierDBF/preview?start&end
 * @access Private (module communication_client, read)
 */
const previewCatalog = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const periode = resolvePeriode(req.query);
  const { groupes } = await getNouveautes(entreprise, periode);
  const html = buildCatalogHtml({
    entreprise,
    groupes,
    periodeLabel: periodeLabel(periode),
  });
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(html);
});

/**
 * @route  POST /api/communication-client/:nomDossierDBF/send  { start, end, mode }
 * @access Private (module communication_client, write)
 *   mode = "test"    -> envoie UNIQUEMENT à support@quincaillerie.nc
 *   mode = "abonnes" -> envoie aux clients NEWSLETTER (en bcc)
 */
const sendCatalog = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const periode = resolvePeriode(req.body || {});
  const mode = req.body?.mode === "abonnes" ? "abonnes" : "test";

  const { groupes, total } = await getNouveautes(entreprise, periode);
  const html = buildCatalogHtml({
    entreprise,
    groupes,
    periodeLabel: periodeLabel(periode),
  });
  const subject = `Nouveautés ${entreprise.nomComplet || entreprise.nomDossierDBF} — ${periodeLabel(periode)}`;

  if (mode === "test") {
    // GARDE-FOU : uniquement l'adresse de test autorisée.
    await sendEmail({
      email: TEST_TO,
      subject: `[TEST] ${subject}`,
      html,
      module: "communication_client",
    });
    return res.json({
      sent: true,
      mode: "test",
      nbDestinataires: 1,
      destinataires: [TEST_TO],
      total,
      periode,
    });
  }

  // mode === "abonnes" : envoi RÉEL aux clients newsletter (bcc).
  const abonnes = await getAbonnesNewsletter(entreprise._id);
  if (abonnes.length === 0) {
    res.status(400);
    throw new Error("Aucun client abonné à la newsletter pour cette société.");
  }
  await sendEmail({
    email: TEST_TO, // adresse « à » technique ; les clients sont en bcc
    bcc: abonnes,
    subject,
    html,
    module: "communication_client",
  });
  res.json({
    sent: true,
    mode: "abonnes",
    nbDestinataires: abonnes.length,
    total,
    periode,
  });
});

export { getNouveautesReport, previewCatalog, sendCatalog, TEST_RECIPIENTS };
