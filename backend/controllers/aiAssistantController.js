// backend/controllers/aiAssistantController.js
//
// Assistant IA : CRUD des conversations (persistées par user + société) et
// endpoint de CHAT en streaming (SSE). Toutes les routes passent protect +
// checkEntrepriseAccess (=> req.entreprise) + checkModuleAccess("assistant_ia").
import asyncHandler from "../middleware/asyncHandler.js";
import AiConversation from "../models/AiConversationModel.js";
import { runAssistant, isConfigured } from "../services/aiAssistantService.js";

// Charge une conversation appartenant à l'utilisateur ET à la société du chemin.
const loadOwned = async (req, res) => {
  const conv = await AiConversation.findById(req.params.id);
  if (
    !conv ||
    String(conv.user) !== String(req.user._id) ||
    String(conv.entreprise) !== String(req.entreprise._id)
  ) {
    res.status(404);
    throw new Error("Conversation introuvable");
  }
  return conv;
};

// @route GET /api/ai/:nomDossierDBF/conversations
const getConversations = asyncHandler(async (req, res) => {
  const list = await AiConversation.find({
    user: req.user._id,
    entreprise: req.entreprise._id,
  })
    .select("titre updatedAt createdAt")
    .sort({ updatedAt: -1 })
    .limit(100)
    .lean();
  res.json(list);
});

// @route GET /api/ai/:nomDossierDBF/conversations/:id
const getConversation = asyncHandler(async (req, res) => {
  const conv = await loadOwned(req, res);
  res.json(conv);
});

// @route POST /api/ai/:nomDossierDBF/conversations
const createConversation = asyncHandler(async (req, res) => {
  const conv = await AiConversation.create({
    user: req.user._id,
    entreprise: req.entreprise._id,
    titre: "Nouvelle conversation",
    messages: [],
  });
  res.status(201).json(conv);
});

// @route DELETE /api/ai/:nomDossierDBF/conversations/:id
const deleteConversation = asyncHandler(async (req, res) => {
  const conv = await loadOwned(req, res);
  await AiConversation.deleteOne({ _id: conv._id });
  res.json({ message: "Conversation supprimée" });
});

// @route POST /api/ai/:nomDossierDBF/chat   { conversationId?, message }
// @desc  Répond en STREAMING (SSE). Persiste le tour user + assistant à la fin.
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

  // Conversation cible : existante (à moi + cette société) ou nouvelle.
  let conv;
  if (req.body.conversationId) {
    conv = await AiConversation.findById(req.body.conversationId);
    if (
      !conv ||
      String(conv.user) !== String(req.user._id) ||
      String(conv.entreprise) !== String(req.entreprise._id)
    ) {
      res.status(404);
      throw new Error("Conversation introuvable");
    }
  } else {
    conv = await AiConversation.create({
      user: req.user._id,
      entreprise: req.entreprise._id,
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

  // Indique tout de suite l'id (utile quand la conversation vient d'être créée).
  send({ conversationId: String(conv._id), titre: conv.titre });

  // Heartbeat : garde la connexion SSE vivante pendant les traitements longs
  // (certaines analyses agrègent de gros volumes de factures). Ligne « : … »
  // = commentaire SSE, ignoré par le client.
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
      entreprise: req.entreprise,
      onDelta: (t) => send({ token: t }),
    });
  } catch (e) {
    clearInterval(heartbeat);
    send({ error: e.message || "Erreur de l'assistant" });
    return res.end();
  }
  clearInterval(heartbeat);

  // Persistance du tour (dialogue lisible uniquement).
  conv.messages.push({ role: "user", content: message });
  conv.messages.push({ role: "assistant", content: answer });
  if (conv.messages.length === 2) conv.titre = message.slice(0, 60);
  await conv.save();

  send({ done: true, conversationId: String(conv._id), titre: conv.titre });
  res.end();
});

export {
  getConversations,
  getConversation,
  createConversation,
  deleteConversation,
  chat,
};
