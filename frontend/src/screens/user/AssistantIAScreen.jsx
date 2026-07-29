// src/screens/user/AssistantIAScreen.jsx
//
// Assistant IA « métier » : chat branché sur les données (DBF + Mongo) via des
// outils backend en lecture seule. Sélecteur de PÉRIMÈTRE : société courante
// (suit l'en-tête) ou « Toutes mes sociétés » — toujours borné aux sociétés
// autorisées. Réponses streamées (SSE) + rendu markdown (liens cliquables).
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useSelector } from "react-redux";
import {
  HiSparkles,
  HiPaperAirplane,
  HiPlus,
  HiTrash,
  HiUser,
  HiOfficeBuilding,
} from "react-icons/hi";
import { selectGlobalEntrepriseId } from "../../slices/entrepriseGlobalSlice";
import {
  useGetAiCompaniesQuery,
  useGetAiConversationsQuery,
  useDeleteAiConversationMutation,
} from "../../slices/aiApiSlice";
import { BASE_URL } from "../../constants";
import Markdown from "../../components/Admin/Markdown";
import "./AssistantIAScreen.css";

const ALL = "__all__";

const SUGGESTIONS = [
  "Top 10 des meilleures ventes sur les 12 derniers mois",
  "Propose des nouveautés qui font le buzz à vendre en quincaillerie",
  "Cherche les articles « perceuse » en stock",
  "Compare le CA de mes sociétés cette année",
];

const AssistantIAScreen = () => {
  const globalEntrepriseId = useSelector(selectGlobalEntrepriseId);

  const { data: companies = [] } = useGetAiCompaniesQuery();
  const { data: conversations = [], refetch } = useGetAiConversationsQuery();
  const [deleteConversation] = useDeleteAiConversationMutation();

  const [scope, setScope] = useState(""); // entrepriseId | ALL
  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState("");
  const [error, setError] = useState("");
  const bottomRef = useRef(null);
  const streamRef = useRef("");

  // Périmètre par défaut = société de l'en-tête (si accessible), sinon 1re société.
  useEffect(() => {
    if (companies.length === 0) return;
    setScope((cur) => {
      if (cur && (cur === ALL || companies.some((c) => c._id === cur))) return cur;
      if (globalEntrepriseId && companies.some((c) => c._id === globalEntrepriseId))
        return globalEntrepriseId;
      return companies[0]._id;
    });
  }, [companies, globalEntrepriseId]);

  // Changer la société de l'en-tête bascule le périmètre sur cette société.
  useEffect(() => {
    if (globalEntrepriseId && companies.some((c) => c._id === globalEntrepriseId)) {
      setScope(globalEntrepriseId);
    }
  }, [globalEntrepriseId, companies]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamText]);

  const scopeBody = useMemo(
    () => (scope === ALL ? { type: "all" } : { type: "societe", entrepriseId: scope }),
    [scope],
  );

  const newConversation = () => {
    setActiveId(null);
    setMessages([]);
    setStreamText("");
    setError("");
  };

  const openConversation = async (id) => {
    setError("");
    setStreamText("");
    setActiveId(id);
    try {
      const r = await fetch(`${BASE_URL}/api/ai/conversations/${id}`, {
        credentials: "include",
      });
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
      await deleteConversation(conv._id).unwrap();
      if (activeId === conv._id) newConversation();
    } catch {
      alert("Suppression impossible.");
    }
  };

  const send = async (e) => {
    e?.preventDefault?.();
    const message = input.trim();
    if (!message || streaming) return;

    setError("");
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: message }]);
    setStreaming(true);
    setStreamText("");
    streamRef.current = "";

    let convId = activeId;
    try {
      const res = await fetch(`${BASE_URL}/api/ai/chat`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: activeId, message, scope: scopeBody }),
      });
      if (!res.ok || !res.body) {
        let msg = `Erreur ${res.status}`;
        try {
          const j = await res.json();
          if (j?.message) msg = j.message;
        } catch {
          /* non-JSON */
        }
        throw new Error(msg);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() || "";
        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith("data:")) continue; // ignore les heartbeats « : »
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

  if (companies.length === 0) {
    return (
      <div className="ai-screen">
        <div className="ai-empty-company">
          <HiOfficeBuilding />
          Vous n'avez accès à aucune société pour l'assistant.
        </div>
      </div>
    );
  }

  const showWelcome = messages.length === 0 && !streaming && !streamText;
  const multi = companies.length > 1;

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
          <div className="ai-head-texts">
            <h1>Assistant IA</h1>
            <p>
              Vos données (articles, stock, ventes, clients…) + veille produits web
              — en lecture seule.
            </p>
          </div>
          {/* Sélecteur de périmètre */}
          <div className="ai-scope">
            <HiOfficeBuilding />
            <select value={scope} onChange={(e) => setScope(e.target.value)}>
              {companies.map((c) => (
                <option key={c._id} value={c._id}>
                  {c.trigramme || c.nom}
                </option>
              ))}
              {multi && <option value={ALL}>Toutes mes sociétés</option>}
            </select>
          </div>
        </header>

        <div className="ai-messages">
          {showWelcome ? (
            <div className="ai-welcome">
              <HiSparkles className="ai-welcome-icon" />
              <h2>Comment puis-je vous aider ?</h2>
              <p>
                Je réponds sur{" "}
                {scope === ALL ? (
                  <b>toutes vos sociétés</b>
                ) : (
                  <b>{companies.find((c) => c._id === scope)?.trigramme || "la société"}</b>
                )}{" "}
                et je peux chercher des nouveautés produits sur le web.
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
                  <div className="ai-msg-bubble">
                    {m.role === "assistant" ? (
                      <Markdown text={m.content} />
                    ) : (
                      m.content
                    )}
                  </div>
                </div>
              ))}
              {(streaming || streamText) && (
                <div className="ai-msg ai-msg--assistant">
                  <div className="ai-msg-avatar">
                    <HiSparkles />
                  </div>
                  <div className="ai-msg-bubble">
                    {streamText ? (
                      <Markdown text={streamText} />
                    ) : (
                      <span className="ai-dots" aria-label="L'assistant réfléchit…">
                        <i />
                        <i />
                        <i />
                      </span>
                    )}
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
