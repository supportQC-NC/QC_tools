// src/components/chat/ChatPanel.jsx
//
// Panneau de chat temps réel pour un salon (room). Charge l'historique via REST
// puis écoute les nouveaux messages via Socket.IO et permet d'en envoyer.
import React, { useEffect, useRef, useState, useCallback } from "react";
import { useSelector } from "react-redux";
import { HiPaperAirplane } from "react-icons/hi";
import { getSocket } from "../../socketClient";
import "./ChatPanel.css";

const heure = (d) =>
  new Date(d).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

const ChatPanel = ({ room, title, compact = false }) => {
  const { userInfo } = useSelector((state) => state.auth);
  const myId = userInfo?._id;

  const [messages, setMessages] = useState([]);
  const [texte, setTexte] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const bottomRef = useRef(null);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, []);

  // Historique (REST) au montage / changement de salon.
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    fetch(`/api/messages?room=${encodeURIComponent(room)}`, {
      credentials: "include",
    })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        if (active) setMessages(data);
      })
      .catch(() => active && setError("Impossible de charger la discussion."))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [room]);

  // Socket : rejoindre le salon + écouter les nouveaux messages.
  useEffect(() => {
    const socket = getSocket();
    socket.emit("room:join", room);
    const onNew = (msg) => {
      if (msg.room === room) setMessages((prev) => [...prev, msg]);
    };
    socket.on("message:new", onNew);
    return () => {
      socket.emit("room:leave", room);
      socket.off("message:new", onNew);
    };
  }, [room]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const send = (e) => {
    e.preventDefault();
    const t = texte.trim();
    if (!t) return;
    getSocket().emit("message:send", { room, texte: t });
    setTexte("");
  };

  return (
    <div className={`chat-panel ${compact ? "compact" : ""}`}>
      {title && <div className="chat-panel-title">{title}</div>}

      <div className="chat-messages">
        {loading ? (
          <div className="chat-empty">Chargement…</div>
        ) : error ? (
          <div className="chat-empty error">{error}</div>
        ) : messages.length === 0 ? (
          <div className="chat-empty">Aucun message. Lancez la discussion !</div>
        ) : (
          messages.map((m) => {
            const mine = (m.auteur?._id || m.auteur) === myId;
            return (
              <div key={m._id} className={`chat-msg ${mine ? "mine" : ""}`}>
                {!mine && (
                  <span className="chat-msg-author">
                    {m.auteur?.prenom} {m.auteur?.nom}
                  </span>
                )}
                <div className="chat-bubble">
                  <span className="chat-text">{m.texte}</span>
                  <span className="chat-time">{heure(m.createdAt)}</span>
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      <form className="chat-input" onSubmit={send}>
        <input
          value={texte}
          onChange={(e) => setTexte(e.target.value)}
          placeholder="Écrire un message…"
          maxLength={4000}
        />
        <button type="submit" disabled={!texte.trim()} title="Envoyer">
          <HiPaperAirplane />
        </button>
      </form>
    </div>
  );
};

export default ChatPanel;
