// src/screens/user/AssistantIAScreen.jsx
//
// Assistant IA « métier » : chat branché sur les données de la société
// sélectionnée (via des outils backend en lecture seule). Réponses streamées
// (SSE). Historique des conversations persisté (rail à gauche). Module gaté
// « assistant_ia ».
import React, { useEffect, useRef, useState } from "react";
import { useSelector } from "react-redux";
import {
  HiSparkles,
  HiPaperAirplane,
  HiPlus,
  HiTrash,
  HiOfficeBuilding,
  HiUser,
} from "react-icons/hi";
import { selectGlobalDossier } from "../../slices/entrepriseGlobalSlice";
import {
  useGetAiConversationsQuery,
  useDeleteAiConversationMutation,
} from "../../slices/aiApiSlice";
import { BASE_URL } from "../../constants";
import "./AssistantIAScreen.css";

const SUGGESTIONS = [
  "Top 10 des meilleures ventes cette année",
  "Quel est notre chiffre d'affaires sur 12 mois ?",
  "Cherche les articles « perceuse » en stock",
  "Propose des nouveautés à commander vu nos meilleures ventes",
];

const AssistantIAScreen = () => {
  const nomDossierDBF = useSelector(selectGlobalDossier);

  const { data: conversations = [], refetch } = useGetAiConversationsQuery(
    nomDossierDBF,
    { skip: !nomDossierDBF },
  );
  const [deleteConversation] = useDeleteAiConversationMutation();

  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState([]); // [{role, content}]
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState("");
  const [error, setError] = useState("");
  const bottomRef = useRef(null);
  const streamRef = useRef("");

  // Reset quand on change de société.
  useEffect(() => {
    setActiveId(null);
    setMessages([]);
    setStreamText("");
    setError("");
  }, [nomDossierDBF]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamText]);

  const newConversation = () => {
    setActiveId(null);
    setMessages([]);
    setStreamText("");
    setError("");
  };

  // Charge une conversation existante (messages complets).
  const openConversation = async (id) => {
    setError("");
    setStreamText("");
    setActiveId(id);
    try {
      const r = await fetch(
        `${BASE_URL}/api/ai/${nomDossierDBF}/conversations/${id}`,
        { credentials: "include" },
      );
      if (!r.ok) throw new Error();
      const data = await r.json();
      setMessages(data.messages || []);
    } catch {
      setError("Impossible de charger la conversation.");
    }
  };

  const removeConversation = async (e, conv) => {
    e.stopPropagation();
    if (!window.confirm(`Supprimer « ${conv.titre} » ?`)) return;
    try {
      await deleteConversation({ nomDossierDBF, id: conv._id }).unwrap();
      if (activeId === conv._id) newConversation();
    } catch {
      alert("Suppression impossible.");
    }
  };

  const send = async (e) => {
    e?.preventDefault?.();
    const message = input.trim();
    if (!message || streaming || !nomDossierDBF) return;

    setError("");
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: message }]);
    setStreaming(true);
    setStreamText("");
    streamRef.current = "";

    let convId = activeId;
    try {
      const res = await fetch(`${BASE_URL}/api/ai/${nomDossierDBF}/chat`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: activeId, message }),
      });
      if (!res.ok || !res.body) {
        let msg = `Erreur ${res.status}`;
        try {
          const j = await res.json();
          if (j?.message) msg = j.message;
        } catch {
          /* réponse non-JSON */
        }
        throw new Error(msg);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      // Boucle de lecture du flux SSE (« data: {json}\n\n »).
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() || "";
        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith("data:")) continue;
          let evt;
          try {
            evt = JSON.parse(line.slice(5).trim());
          } catch {
            continue;
          }
          if (evt.conversationId) convId = evt.conversationId;
          if (evt.token) {
            streamRef.current += evt.token;
            setStreamText(streamRef.current);
          }
          if (evt.error) throw new Error(evt.error);
        }
      }

      // Finalise : bascule le texte streamé en message assistant.
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: streamRef.current },
      ]);
      setStreamText("");
      if (convId && convId !== activeId) setActiveId(convId);
      refetch();
    } catch (err) {
      setError(err.message || "L'assistant n'a pas pu répondre.");
      setStreamText("");
    } finally {
      setStreaming(false);
    }
  };

  if (!nomDossierDBF) {
    return (
      <div className="ai-screen">
        <div className="ai-empty-company">
          <HiOfficeBuilding />
          Sélectionnez une société dans l'en-tête pour utiliser l'assistant.
        </div>
      </div>
    );
  }

  const showWelcome = messages.length === 0 && !streaming && !streamText;

  return (
    <div className="ai-screen">
      {/* Rail des conversations */}
      <aside className="ai-rail">
        <button className="ai-new" onClick={newConversation}>
          <HiPlus /> Nouvelle conversation
        </button>
        <div className="ai-conv-list">
          {conversations.length === 0 ? (
            <div className="ai-rail-hint">Aucune conversation.</div>
          ) : (
            conversations.map((c) => (
              <button
                key={c._id}
                className={`ai-conv ${activeId === c._id ? "active" : ""}`}
                onClick={() => openConversation(c._id)}
              >
                <span className="ai-conv-title">{c.titre}</span>
                <span
                  className="ai-conv-del"
                  onClick={(e) => removeConversation(e, c)}
                  title="Supprimer"
                >
                  <HiTrash />
                </span>
              </button>
            ))
          )}
        </div>
      </aside>

      {/* Conversation */}
      <section className="ai-main">
        <header className="ai-head">
          <div className="ai-head-icon">
            <HiSparkles />
          </div>
          <div>
            <h1>Assistant IA</h1>
            <p>
              Posez vos questions sur les articles, le stock, les clients, les
              commandes… — réponses basées uniquement sur vos données.
            </p>
          </div>
        </header>

        <div className="ai-messages">
          {showWelcome ? (
            <div className="ai-welcome">
              <HiSparkles className="ai-welcome-icon" />
              <h2>Comment puis-je vous aider ?</h2>
              <p>
                Je consulte vos données (articles, stock, prix, clients,
                fournisseurs, commandes, proformas, factures) en lecture seule.
              </p>
              <div className="ai-suggestions">
                {SUGGESTIONS.map((s) => (
                  <button key={s} onClick={() => setInput(s)}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
              {messages.map((m, i) => (
                <div key={i} className={`ai-msg ai-msg--${m.role}`}>
                  <div className="ai-msg-avatar">
                    {m.role === "assistant" ? <HiSparkles /> : <HiUser />}
                  </div>
                  <div className="ai-msg-bubble">{m.content}</div>
                </div>
              ))}
              {(streaming || streamText) && (
                <div className="ai-msg ai-msg--assistant">
                  <div className="ai-msg-avatar">
                    <HiSparkles />
                  </div>
                  <div className="ai-msg-bubble">
                    {streamText || <span className="ai-typing">…</span>}
                    {streaming && streamText && <span className="ai-caret" />}
                  </div>
                </div>
              )}
            </>
          )}
          {error && <div className="ai-error">{error}</div>}
          <div ref={bottomRef} />
        </div>

        <form className="ai-input" onSubmit={send}>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(e);
              }
            }}
            placeholder="Écrivez votre question…  (Entrée pour envoyer)"
            rows={1}
            disabled={streaming}
          />
          <button type="submit" disabled={!input.trim() || streaming} title="Envoyer">
            <HiPaperAirplane />
          </button>
        </form>
      </section>
    </div>
  );
};

export default AssistantIAScreen;
