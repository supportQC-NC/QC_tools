// src/components/chat/ChatPanel.jsx
//
// Chat temps réel « Messenger » : bulles groupées, avatars, séparateurs de date,
// partage de fichiers, suppression, RÉACTIONS, ACCUSÉS DE LECTURE (« vu par ») et
// indicateur « en train d'écrire ». Texte pur via socket ; fichiers via REST.
import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useSelector } from "react-redux";
import {
  HiPaperAirplane,
  HiPaperClip,
  HiTrash,
  HiDownload,
  HiDocumentText,
  HiPhotograph,
  HiTable,
  HiDocument,
  HiEmojiHappy,
} from "react-icons/hi";
import { getSocket } from "../../socketClient";
import { usePresence } from "../../presenceClient";
import {
  useSendMessageWithFilesMutation,
  useDeleteMessageMutation,
  useReactToMessageMutation,
  messageFileUrl,
} from "../../slices/messageApiSlice";
import { REACTION_KEYS, reactionEmoji, reactionLabel } from "../../config/chatReactions";
import {
  triggerDownload,
  openInNewTab,
  formatSize,
} from "../../utils/executableHelpers";
import "./ChatPanel.css";

const heure = (d) =>
  new Date(d).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

const initiales = (a) =>
  `${(a?.prenom || "").charAt(0)}${(a?.nom || "").charAt(0)}`.toUpperCase() || "?";

const avatarColor = (a) => {
  const key = String(a?._id || a?.email || `${a?.prenom}${a?.nom}` || "?");
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) % 360;
  return `hsl(${h}, 55%, 45%)`;
};

// Petit avatar (photo si dispo, sinon initiales colorées).
const MiniAvatar = ({ user, size = 18, title }) => (
  <span
    className="chat-mini-avatar"
    style={{ width: size, height: size, background: avatarColor(user) }}
    title={title || `${user?.prenom || ""} ${user?.nom || ""}`.trim()}
  >
    {user?.photo ? (
      <img src={`/api/users/${user._id}/photo?v=${user.photoUpdatedAt || ""}`} alt="" />
    ) : (
      <span style={{ fontSize: size * 0.42 }}>{initiales(user)}</span>
    )}
  </span>
);

const labelDate = (d) => {
  const date = new Date(d);
  const today = new Date();
  const hier = new Date();
  hier.setDate(today.getDate() - 1);
  const sameDay = (x, y) =>
    x.getFullYear() === y.getFullYear() &&
    x.getMonth() === y.getMonth() &&
    x.getDate() === y.getDate();
  if (sameDay(date, today)) return "Aujourd'hui";
  if (sameDay(date, hier)) return "Hier";
  return date.toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
};

const authorId = (m) => (m.auteur?._id || m.auteur || "").toString();
const GROUP_GAP_MS = 5 * 60 * 1000;

const buildTimeline = (messages, myId) => {
  const out = [];
  let lastDay = null;
  let group = null;
  const flush = () => {
    if (group) out.push(group);
    group = null;
  };
  for (const m of messages) {
    const day = new Date(m.createdAt).toDateString();
    if (day !== lastDay) {
      flush();
      out.push({ type: "date", key: `date-${day}`, label: labelDate(m.createdAt) });
      lastDay = day;
    }
    const mine = authorId(m) === String(myId);
    const t = new Date(m.createdAt).getTime();
    const contigu =
      group &&
      group.mine === mine &&
      authorId(group.items[0]) === authorId(m) &&
      t - new Date(group.items[group.items.length - 1].createdAt).getTime() <
        GROUP_GAP_MS;
    if (contigu) {
      group.items.push(m);
    } else {
      flush();
      group = { type: "group", key: `grp-${m._id}`, mine, auteur: m.auteur, items: [m] };
    }
  }
  flush();
  return out;
};

const fileIcon = (kind) => {
  if (kind === "image") return HiPhotograph;
  if (kind === "pdf") return HiDocumentText;
  if (kind === "tableur") return HiTable;
  return HiDocument;
};

const ChatPanel = ({
  room,
  title,
  compact = false,
  embedded = false,
  canModerate = false,
}) => {
  const { userInfo } = useSelector((state) => state.auth);
  const myId = userInfo?._id;
  const isGlobal = room === "global";
  const { isOnline } = usePresence();

  const [messages, setMessages] = useState([]);
  const [texte, setTexte] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [reads, setReads] = useState([]); // [{user, lastReadAt}] (hors global)
  const [typingUsers, setTypingUsers] = useState({}); // {uid: user}
  const bottomRef = useRef(null);
  const messagesRef = useRef(null);
  const fileRef = useRef(null);
  const typingTimers = useRef({});
  const typingStopTimer = useRef(null);
  const lastTypingEmit = useRef(0);

  const [sendFiles] = useSendMessageWithFilesMutation();
  const [deleteMessage] = useDeleteMessageMutation();
  const [reactMsg] = useReactToMessageMutation();

  // Colle la vue en bas (instantané). On le fait aussi en différé pour rattraper
  // la hauteur qui grandit quand les images se chargent (sinon on reste en haut).
  const scrollToBottom = useCallback(() => {
    const el = messagesRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  // Historique (REST) au montage / changement de salon.
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    setTypingUsers({});
    fetch(`/api/messages?room=${encodeURIComponent(room)}`, { credentials: "include" })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => active && setMessages(data))
      .catch(() => active && setError("Impossible de charger la discussion."))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [room]);

  // Accusés de lecture : snapshot initial (hors global).
  useEffect(() => {
    if (isGlobal) {
      setReads([]);
      return undefined;
    }
    let active = true;
    fetch(`/api/messages/reads?room=${encodeURIComponent(room)}`, {
      credentials: "include",
    })
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => active && setReads(data))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [room, isGlobal]);

  // Socket : join + écoute (nouveaux, suppressions, réactions, lecture, saisie).
  useEffect(() => {
    const socket = getSocket();
    socket.emit("room:join", room);

    const onNew = (msg) => {
      if (msg.room === room) setMessages((prev) => [...prev, msg]);
    };
    const onDeleted = ({ id, room: r }) => {
      if (r === room) setMessages((prev) => prev.filter((m) => m._id !== id));
    };
    const onReaction = ({ id, room: r, reactions }) => {
      if (r === room)
        setMessages((prev) =>
          prev.map((m) => (m._id === id ? { ...m, reactions } : m)),
        );
    };
    const onRead = ({ room: r, user, lastReadAt }) => {
      if (r !== room || !user) return;
      setReads((prev) => [
        ...prev.filter((x) => String(x.user._id) !== String(user._id)),
        { user, lastReadAt },
      ]);
    };
    const onTyping = ({ room: r, actif, user }) => {
      if (r !== room || !user || String(user._id) === String(myId)) return;
      const uid = String(user._id);
      if (actif) {
        setTypingUsers((prev) => ({ ...prev, [uid]: user }));
        clearTimeout(typingTimers.current[uid]);
        typingTimers.current[uid] = setTimeout(() => {
          setTypingUsers((prev) => {
            const n = { ...prev };
            delete n[uid];
            return n;
          });
        }, 3500);
      } else {
        clearTimeout(typingTimers.current[uid]);
        setTypingUsers((prev) => {
          const n = { ...prev };
          delete n[uid];
          return n;
        });
      }
    };

    socket.on("message:new", onNew);
    socket.on("message:deleted", onDeleted);
    socket.on("message:reaction", onReaction);
    socket.on("room:read", onRead);
    socket.on("typing", onTyping);
    return () => {
      socket.emit("room:leave", room);
      socket.off("message:new", onNew);
      socket.off("message:deleted", onDeleted);
      socket.off("message:reaction", onReaction);
      socket.off("room:read", onRead);
      socket.off("typing", onTyping);
    };
  }, [room, myId]);

  // Marquer le salon lu (hors global) au montage et à chaque nouveau message vu.
  useEffect(() => {
    if (isGlobal) return;
    getSocket().emit("room:read", room);
  }, [room, isGlobal, messages.length]);

  useEffect(() => {
    scrollToBottom();
    const t = setTimeout(scrollToBottom, 250);
    return () => clearTimeout(t);
  }, [messages, typingUsers, scrollToBottom]);

  const timeline = useMemo(() => buildTimeline(messages, myId), [messages, myId]);

  // Accusés de lecture par message : chaque lecteur pointe le DERNIER message lu.
  const readersByMsg = useMemo(() => {
    const map = {};
    if (isGlobal) return map;
    for (const rd of reads) {
      if (!rd.user || String(rd.user._id) === String(myId)) continue;
      const lr = new Date(rd.lastReadAt).getTime();
      let last = null;
      for (const m of messages) {
        if (new Date(m.createdAt).getTime() <= lr) last = m;
        else break;
      }
      if (last) (map[last._id] = map[last._id] || []).push(rd.user);
    }
    return map;
  }, [reads, messages, myId, isGlobal]);

  const emitTyping = () => {
    const now = Date.now();
    if (now - lastTypingEmit.current > 1500) {
      getSocket().emit("typing", { room, actif: true });
      lastTypingEmit.current = now;
    }
    clearTimeout(typingStopTimer.current);
    typingStopTimer.current = setTimeout(() => {
      getSocket().emit("typing", { room, actif: false });
      lastTypingEmit.current = 0;
    }, 2000);
  };

  const stopTyping = () => {
    clearTimeout(typingStopTimer.current);
    lastTypingEmit.current = 0;
    getSocket().emit("typing", { room, actif: false });
  };

  const send = (e) => {
    e.preventDefault();
    const t = texte.trim();
    if (!t) return;
    getSocket().emit("message:send", { room, texte: t });
    setTexte("");
    stopTyping();
  };

  const handleFiles = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (!files.length) return;
    setUploading(true);
    try {
      await sendFiles({ room, texte: texte.trim(), files }).unwrap();
      setTexte("");
    } catch {
      alert("Envoi du fichier impossible (taille max 25 Mo).");
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (m) => {
    if (!window.confirm("Supprimer ce message ?")) return;
    try {
      await deleteMessage(m._id).unwrap();
    } catch (err) {
      alert(err?.data?.message || "Suppression impossible");
    }
  };

  const react = async (m, type) => {
    try {
      await reactMsg({ id: m._id, type }).unwrap();
    } catch {
      /* silencieux */
    }
  };

  const bubblePos = (len, i) => {
    if (len === 1) return "single";
    if (i === 0) return "first";
    if (i === len - 1) return "last";
    return "middle";
  };

  const renderAttachments = (m) =>
    (m.attachments || []).map((a) => {
      const url = messageFileUrl(m._id, a._id);
      if (a.kind === "image") {
        return (
          <div key={a._id} className="chat-att-imgwrap">
            <img
              className="chat-att-img"
              src={url}
              alt={a.fileName}
              title={a.fileName}
              onClick={() => openInNewTab(url)}
              onLoad={scrollToBottom}
            />
            <button
              type="button"
              className="chat-att-imgdl"
              title={`Télécharger ${a.fileName}`}
              onClick={(e) => {
                e.stopPropagation();
                triggerDownload(url, a.fileName);
              }}
            >
              <HiDownload />
            </button>
          </div>
        );
      }
      const Icon = fileIcon(a.kind);
      return (
        <button
          key={a._id}
          type="button"
          className="chat-att-file"
          onClick={() => triggerDownload(url, a.fileName)}
          title={`Télécharger ${a.fileName}`}
        >
          <span className="chat-att-icon">
            <Icon />
          </span>
          <span className="chat-att-meta">
            <span className="chat-att-name">{a.fileName}</span>
            <span className="chat-att-size">{formatSize(a.size)}</span>
          </span>
          <HiDownload className="chat-att-dl" />
        </button>
      );
    });

  // Puces de réactions groupées par type (avec ma réaction mise en avant).
  const renderReactionChips = (m) => {
    const rs = m.reactions || [];
    if (!rs.length) return null;
    const byType = {};
    for (const r of rs) {
      (byType[r.type] = byType[r.type] || []).push(r.user);
    }
    const mine = rs.find((r) => String(r.user?._id) === String(myId))?.type;
    return (
      <div className="chat-chips">
        {Object.entries(byType).map(([type, users]) => (
          <button
            key={type}
            type="button"
            className={`chat-chip ${mine === type ? "on" : ""}`}
            onClick={() => react(m, type)}
            title={users.map((u) => `${u?.prenom || ""} ${u?.nom || ""}`.trim()).join(", ")}
          >
            <span>{reactionEmoji(type)}</span>
            <span className="chat-chip-n">{users.length}</span>
          </button>
        ))}
      </div>
    );
  };

  const typingNames = Object.values(typingUsers).map((u) => u.prenom || u.nom);

  return (
    <div
      className={`chat-panel ${compact ? "compact" : ""} ${embedded ? "embedded" : ""}`}
    >
      {title && <div className="chat-panel-title">{title}</div>}

      <div className="chat-messages" ref={messagesRef}>
        {loading ? (
          <div className="chat-empty">Chargement…</div>
        ) : error ? (
          <div className="chat-empty error">{error}</div>
        ) : messages.length === 0 ? (
          <div className="chat-empty">Aucun message. Lancez la discussion !</div>
        ) : (
          timeline.map((node) => {
            if (node.type === "date") {
              return (
                <div key={node.key} className="chat-date-sep">
                  <span>{node.label}</span>
                </div>
              );
            }
            const { mine, auteur, items, key } = node;
            const last = items[items.length - 1];
            return (
              <div key={key} className={`chat-group ${mine ? "mine" : ""}`}>
                {!mine && (
                  <div
                    className="chat-avatar"
                    style={{ background: avatarColor(auteur) }}
                    title={`${auteur?.prenom || ""} ${auteur?.nom || ""}`.trim()}
                  >
                    {auteur?.photo ? (
                      <img
                        src={`/api/users/${auteur._id}/photo?v=${auteur.photoUpdatedAt || ""}`}
                        alt=""
                      />
                    ) : (
                      initiales(auteur)
                    )}
                    <i
                      className={`chat-av-dot ${isOnline(auteur?._id) ? "on" : "off"}`}
                    />
                  </div>
                )}
                <div className="chat-group-bubbles">
                  {!mine && (
                    <span className="chat-group-author">
                      {auteur?.prenom} {auteur?.nom}
                    </span>
                  )}
                  {items.map((m, i) => (
                    <React.Fragment key={m._id}>
                      <div className="chat-msg-row">
                        {(mine || canModerate) && (
                          <button
                            type="button"
                            className="chat-del"
                            onClick={() => handleDelete(m)}
                            title="Supprimer"
                          >
                            <HiTrash />
                          </button>
                        )}
                        <div className="chat-bubble-wrap">
                          <div
                            className="chat-bubble"
                            data-pos={bubblePos(items.length, i)}
                            title={heure(m.createdAt)}
                          >
                            {m.texte && <span className="chat-text">{m.texte}</span>}
                            {(m.attachments || []).length > 0 && (
                              <div className="chat-atts">{renderAttachments(m)}</div>
                            )}
                          </div>
                          {renderReactionChips(m)}
                        </div>
                        {/* Déclencheur de réaction (survol) */}
                        <div className="chat-react">
                          <button type="button" className="chat-react-btn" title="Réagir">
                            <HiEmojiHappy />
                          </button>
                          <div className="chat-react-picker">
                            {REACTION_KEYS.map((k) => (
                              <button
                                key={k}
                                type="button"
                                onClick={() => react(m, k)}
                                title={reactionLabel(k)}
                              >
                                {reactionEmoji(k)}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                      {readersByMsg[m._id] && (
                        <div className="chat-readers">
                          {readersByMsg[m._id].map((u) => (
                            <MiniAvatar key={u._id} user={u} size={16} />
                          ))}
                        </div>
                      )}
                    </React.Fragment>
                  ))}
                  <span className="chat-group-time">{heure(last.createdAt)}</span>
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {typingNames.length > 0 && (
        <div className="chat-typing">
          <span className="chat-typing-dots">
            <i />
            <i />
            <i />
          </span>
          {typingNames.length === 1
            ? `${typingNames[0]} est en train d'écrire…`
            : `${typingNames.join(", ")} sont en train d'écrire…`}
        </div>
      )}

      <form className="chat-input" onSubmit={send}>
        <input
          ref={fileRef}
          type="file"
          multiple
          accept=".pdf,.xls,.xlsx,.csv,image/*"
          style={{ display: "none" }}
          onChange={handleFiles}
        />
        <button
          type="button"
          className="chat-attach"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          title="Joindre un fichier"
        >
          <HiPaperClip />
        </button>
        <input
          value={texte}
          onChange={(e) => {
            setTexte(e.target.value);
            emitTyping();
          }}
          placeholder={uploading ? "Envoi du fichier…" : "Écrire un message…"}
          maxLength={4000}
          disabled={uploading}
        />
        <button type="submit" disabled={!texte.trim() || uploading} title="Envoyer">
          <HiPaperAirplane />
        </button>
      </form>
    </div>
  );
};

export default ChatPanel;
