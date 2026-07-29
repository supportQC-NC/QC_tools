// backend/controllers/aiAssistantController.js
//
// Assistant IA : CRUD des conversations (par utilisateur) et CHAT en streaming
// (SSE). Le PÉRIMÈTRE est choisi à chaque requête (société précise OU « toutes
// mes sociétés »), TOUJOURS borné aux sociétés auxquelles l'utilisateur a accès
// (getAccessibleEntreprises). Routes gatées protect + module « assistant_ia ».
import asyncHandler from "../middleware/asyncHandler.js";
import AiConversation from "../models/AiConversationModel.js";
import Entreprise from "../models/EntrepriseModel.js";
import { getAccessibleEntreprises } from "../middleware/accessControl.js";
import { runAssistant, isConfigured } from "../services/aiAssistantService.js";

// Sociétés accessibles à l'utilisateur (docs Mongoose COMPLETS — getters de
// chemins DBF nécessaires aux services de cache : pas de .lean()).
const accessibleCompanies = async (user) => {
  const acc = await getAccessibleEntreprises(user);
  const filter = acc.all ? {} : { _id: { $in: acc.ids } };
  return Entreprise.find(filter);
};

// Résout le périmètre demandé en liste d'entreprises AUTORISÉES.
const resolveScope = async (user, scope) => {
  const all = await accessibleCompanies(user);
  if (scope && scope.type === "societe" && scope.entrepriseId) {
    const ent = all.find((e) => String(e._id) === String(scope.entrepriseId));
    if (!ent) {
      const err = new Error("Société hors de votre périmètre.");
      err.status = 403;
      throw err;
    }
    return { mode: "societe", entreprises: [ent] };
  }
  // Par défaut / « toutes » : toutes les sociétés accessibles.
  return { mode: "all", entreprises: all };
};

const loadOwned = async (req, res) => {
  const conv = await AiConversation.findById(req.params.id);
  if (!conv || String(conv.user) !== String(req.user._id)) {
    res.status(404);
    throw new Error("Conversation introuvable");
  }
  return conv;
};

// @route GET /api/ai/companies  → sociétés accessibles (pour le sélecteur)
const getMyCompanies = asyncHandler(async (req, res) => {
  const list = await accessibleCompanies(req.user);
  res.json(
    list
      .map((e) => ({
        _id: String(e._id),
        nom: e.nom || e.trigramme || e.nomDossierDBF,
        trigramme: e.trigramme || "",
        nomDossierDBF: e.nomDossierDBF || "",
      }))
      .sort((a, b) => (a.trigramme || a.nom).localeCompare(b.trigramme || b.nom)),
  );
});

// @route GET /api/ai/conversations
const getConversations = asyncHandler(async (req, res) => {
  const list = await AiConversation.find({ user: req.user._id })
    .select("titre updatedAt createdAt")
    .sort({ updatedAt: -1 })
    .limit(100)
    .lean();
  res.json(list);
});

// @route GET /api/ai/conversations/:id
const getConversation = asyncHandler(async (req, res) => {
  const conv = await loadOwned(req, res);
  res.json(conv);
});

// @route POST /api/ai/conversations
const createConversation = asyncHandler(async (req, res) => {
  const conv = await AiConversation.create({
    user: req.user._id,
    titre: "Nouvelle conversation",
    messages: [],
  });
  res.status(201).json(conv);
});

// @route DELETE /api/ai/conversations/:id
const deleteConversation = asyncHandler(async (req, res) => {
  const conv = await loadOwned(req, res);
  await AiConversation.deleteOne({ _id: conv._id });
  res.json({ message: "Conversation supprimée" });
});

// @route POST /api/ai/chat   { conversationId?, message, scope }
// scope = { type:"societe", entrepriseId } | { type:"all" } (défaut all)
const chat = asyncHandler(async (req, res) => {
  if (!isConfigured()) {
    res.status(503);
    throw new Error(
      "Assistant IA non configuré (OPENAI_API_KEY manquant dans le .env).",
    );
  }
  const message = String(req.body.message || "").trim();
  if (!message) {
    res.status(400);
    throw new Error("Message vide");
  }

  // Périmètre (borné aux sociétés autorisées).
  let scope;
  try {
    scope = await resolveScope(req.user, req.body.scope);
  } catch (e) {
    res.status(e.status || 400);
    throw e;
  }
  if (scope.entreprises.length === 0) {
    res.status(403);
    throw new Error("Vous n'avez accès à aucune société.");
  }

  // Conversation cible (à moi) ou nouvelle.
  let conv;
  if (req.body.conversationId) {
    conv = await AiConversation.findById(req.body.conversationId);
    if (!conv || String(conv.user) !== String(req.user._id)) {
      res.status(404);
      throw new Error("Conversation introuvable");
    }
  } else {
    conv = await AiConversation.create({
      user: req.user._id,
      titre: message.slice(0, 60),
      messages: [],
    });
  }

  // En-têtes SSE.
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

  send({ conversationId: String(conv._id), titre: conv.titre });

  // Heartbeat : garde la connexion SSE vivante pendant les traitements longs.
  const heartbeat = setInterval(() => {
    try {
      res.write(": keep-alive\n\n");
    } catch {
      /* connexion fermée */
    }
  }, 15000);

  let answer = "";
  try {
    answer = await runAssistant({
      history: conv.messages,
      message,
      entreprises: scope.entreprises,
      mode: scope.mode,
      user: req.user,
      onDelta: (t) => send({ token: t }),
    });
  } catch (e) {
    clearInterval(heartbeat);
    send({ error: e.message || "Erreur de l'assistant" });
    return res.end();
  }
  clearInterval(heartbeat);

  conv.messages.push({ role: "user", content: message });
  conv.messages.push({ role: "assistant", content: answer });
  if (conv.messages.length === 2) conv.titre = message.slice(0, 60);
  await conv.save();

  send({ done: true, conversationId: String(conv._id), titre: conv.titre });
  res.end();
});

export {
  getMyCompanies,
  getConversations,
  getConversation,
  createConversation,
  deleteConversation,
  chat,
};
