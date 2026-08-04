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
  HiReply,
  HiX,
  HiPencil,
  HiSearch,
  HiBookmark,
} from "react-icons/hi";
import { getSocket } from "../../socketClient";
import { usePresence } from "../../presenceClient";
import {
  useSendMessageWithFilesMutation,
  useDeleteMessageMutation,
  useReactToMessageMutation,
  useEditMessageMutation,
  usePinMessageMutation,
  messageFileUrl,
} from "../../slices/messageApiSlice";
import { useGetRoomMembersQuery } from "../../slices/conversationApiSlice";
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
  const { statusOf } = usePresence();

  const [messages, setMessages] = useState([]);
  const [texte, setTexte] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [reads, setReads] = useState([]); // [{user, lastReadAt}] (hors global)
  const [typingUsers, setTypingUsers] = useState({}); // {uid: user}
  const [replyingTo, setReplyingTo] = useState(null); // message cité en cours
  const [reactFor, setReactFor] = useState(null); // id du message dont le sélecteur d'emoji est ouvert
  const [mentions, setMentions] = useState([]); // [{user, display}] ajoutées
  const [mentionState, setMentionState] = useState({
    open: false,
    query: "",
    start: -1,
    index: 0,
  });
  const bottomRef = useRef(null);
  const messagesRef = useRef(null);
  const fileRef = useRef(null);
  const inputRef = useRef(null);

  // Membres du salon pour l'autocomplétion des mentions @ (self exclu).
  const { data: roomMembers = [] } = useGetRoomMembersQuery(room, { skip: !room });
  const typingTimers = useRef({});
  const typingStopTimer = useRef(null);
  const lastTypingEmit = useRef(0);

  const [sendFiles] = useSendMessageWithFilesMutation();
  const [deleteMessage] = useDeleteMessageMutation();
  const [reactMsg] = useReactToMessageMutation();
  const [editMessageMut] = useEditMessageMutation();
  const [pinMessageMut] = usePinMessageMutation();

  // Édition en place, épingles (bandeau) et recherche.
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState("");
  const [pinned, setPinned] = useState([]); // messages épinglés du salon
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);

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

  // Messages épinglés du salon (bandeau).
  const loadPinned = useCallback(() => {
    fetch(`/api/messages/pinned?room=${encodeURIComponent(room)}`, {
      credentials: "include",
    })
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setPinned(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, [room]);
  useEffect(() => {
    loadPinned();
  }, [loadPinned]);

  // Socket : join + écoute (nouveaux, suppressions, réactions, lecture, saisie,
  // édition, épingle).
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

    const onEdited = ({ id, room: r, texte, editedAt }) => {
      if (r !== room) return;
      setMessages((prev) =>
        prev.map((m) => (m._id === id ? { ...m, texte, editedAt } : m)),
      );
    };
    const onPinned = ({ id, room: r, pinned: isPinned }) => {
      if (r !== room) return;
      setMessages((prev) =>
        prev.map((m) => (m._id === id ? { ...m, pinned: isPinned } : m)),
      );
      loadPinned();
    };

    socket.on("message:new", onNew);
    socket.on("message:deleted", onDeleted);
    socket.on("message:reaction", onReaction);
    socket.on("room:read", onRead);
    socket.on("typing", onTyping);
    socket.on("message:edited", onEdited);
    socket.on("message:pinned", onPinned);
    return () => {
      socket.emit("room:leave", room);
      socket.off("message:new", onNew);
      socket.off("message:deleted", onDeleted);
      socket.off("message:reaction", onReaction);
      socket.off("room:read", onRead);
      socket.off("typing", onTyping);
      socket.off("message:edited", onEdited);
      socket.off("message:pinned", onPinned);
    };
  }, [room, myId, loadPinned]);

  // Marquer le salon lu au montage et à chaque nouveau message vu (y compris
  // « global » : la position sert au compteur de non-lus du rail — le serveur
  // ne diffuse pas d'accusé « vu par » sur global).
  useEffect(() => {
    getSocket().emit("room:read", room);
  }, [room, messages.length]);

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

  // ── Mentions @ ────────────────────────────────────────────────────────
  const mentionSuggestions = useMemo(() => {
    if (!mentionState.open) return [];
    const q = mentionState.query.toLowerCase();
    return roomMembers
      .filter((u) => String(u._id) !== String(myId))
      .filter((u) => !q || `${u.prenom} ${u.nom}`.toLowerCase().includes(q))
      .slice(0, 6);
  }, [mentionState, roomMembers, myId]);

  const handleInputChange = (e) => {
    const val = e.target.value;
    setTexte(val);
    emitTyping();
    // Détecte un token @ juste avant le curseur (mot sans espace).
    const caret = e.target.selectionStart ?? val.length;
    const m = /(?:^|\s)@(\S*)$/.exec(val.slice(0, caret));
    if (m) {
      setMentionState({ open: true, query: m[1], start: caret - m[1].length - 1, index: 0 });
    } else if (mentionState.open) {
      setMentionState({ open: false, query: "", start: -1, index: 0 });
    }
  };

  const pickMention = (u) => {
    if (!u) return;
    const display = u.prenom || u.nom || "?";
    const val = texte;
    const start = mentionState.start >= 0 ? mentionState.start : val.length;
    const caret = inputRef.current?.selectionStart ?? val.length;
    const before = val.slice(0, start);
    const insert = `@${display} `;
    const next = before + insert + val.slice(caret);
    setTexte(next);
    setMentions((prev) =>
      prev.some((x) => String(x.user) === String(u._id))
        ? prev
        : [...prev, { user: u._id, display }],
    );
    setMentionState({ open: false, query: "", start: -1, index: 0 });
    const pos = (before + insert).length;
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(pos, pos);
      }
    });
  };

  const onInputKeyDown = (e) => {
    if (!mentionState.open || mentionSuggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setMentionState((s) => ({ ...s, index: (s.index + 1) % mentionSuggestions.length }));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setMentionState((s) => ({
        ...s,
        index: (s.index - 1 + mentionSuggestions.length) % mentionSuggestions.length,
      }));
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      pickMention(mentionSuggestions[mentionState.index] || mentionSuggestions[0]);
    } else if (e.key === "Escape") {
      setMentionState({ open: false, query: "", start: -1, index: 0 });
    }
  };

  // Mentions réellement présentes dans le texte au moment de l'envoi.
  const activeMentions = () =>
    mentions.filter((mm) => texte.includes(`@${mm.display}`));

  const iAmMentioned = (m) =>
    (m.mentions || []).some((x) => String(x.user) === String(myId));

  // Rendu du texte avec surlignage des mentions @.
  const renderMessageText = (m) => {
    const t = m.texte || "";
    const ms = m.mentions || [];
    if (!ms.length) return t;
    const displays = [...new Set(ms.map((x) => x.display).filter(Boolean))]
      .sort((a, b) => b.length - a.length)
      .map((d) => d.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    if (!displays.length) return t;
    const re = new RegExp(`@(${displays.join("|")})`, "g");
    const nodes = [];
    let last = 0;
    let mm;
    let i = 0;
    while ((mm = re.exec(t)) !== null) {
      if (mm.index > last) nodes.push(t.slice(last, mm.index));
      const disp = mm[1];
      const ment = ms.find((x) => x.display === disp);
      const isMe = ment && String(ment.user) === String(myId);
      nodes.push(
        <span key={`mn-${i++}`} className={`chat-mention ${isMe ? "me" : ""}`}>
          @{disp}
        </span>,
      );
      last = mm.index + mm[0].length;
    }
    if (last < t.length) nodes.push(t.slice(last));
    return nodes;
  };

  const send = (e) => {
    e.preventDefault();
    const t = texte.trim();
    if (!t) return;
    getSocket().emit("message:send", {
      room,
      texte: t,
      replyTo: replyingTo?._id || undefined,
      mentions: activeMentions(),
    });
    setTexte("");
    setMentions([]);
    setReplyingTo(null);
    setMentionState({ open: false, query: "", start: -1, index: 0 });
    stopTyping();
  };

  const handleFiles = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (!files.length) return;
    setUploading(true);
    try {
      await sendFiles({
        room,
        texte: texte.trim(),
        files,
        replyTo: replyingTo?._id,
        mentions: activeMentions(),
      }).unwrap();
      setTexte("");
      setMentions([]);
      setReplyingTo(null);
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
    setReactFor(null); // referme le sélecteur après le choix
    try {
      await reactMsg({ id: m._id, type }).unwrap();
    } catch {
      /* silencieux */
    }
  };

  // Ferme le sélecteur d'emoji au clic extérieur ou sur Échap.
  useEffect(() => {
    if (!reactFor) return undefined;
    const onDocClick = (e) => {
      if (!e.target.closest || !e.target.closest(".chat-react")) setReactFor(null);
    };
    const onEsc = (e) => {
      if (e.key === "Escape") setReactFor(null);
    };
    document.addEventListener("click", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("click", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [reactFor]);

  // ── Édition ──
  const startEdit = (m) => {
    setEditingId(m._id);
    setEditText(m.texte || "");
  };
  const cancelEdit = () => {
    setEditingId(null);
    setEditText("");
  };
  const saveEdit = async (m) => {
    const t = editText.trim();
    if (!t || t === m.texte) {
      cancelEdit();
      return;
    }
    try {
      await editMessageMut({ id: m._id, texte: t }).unwrap();
    } catch {
      alert("Modification impossible");
    }
    cancelEdit();
  };

  // ── Épingle ──
  const togglePin = async (m) => {
    try {
      await pinMessageMut(m._id).unwrap();
    } catch (e) {
      alert(e?.data?.message || "Épingle impossible");
    }
  };

  // ── Recherche ──
  const doSearch = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    const q = searchQuery.trim();
    if (q.length < 2) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    try {
      const r = await fetch(
        `/api/messages/search?room=${encodeURIComponent(room)}&q=${encodeURIComponent(q)}`,
        { credentials: "include" },
      );
      const data = r.ok ? await r.json() : [];
      setSearchResults(Array.isArray(data) ? data : []);
    } catch {
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  };
  const closeSearch = () => {
    setSearchOpen(false);
    setSearchQuery("");
    setSearchResults([]);
  };
  const searchActive = searchOpen && searchQuery.trim().length >= 2;

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

      {/* Barre d'outils : recherche dans la conversation */}
      <div className="chat-toolbar">
        {searchOpen ? (
          <form className="chat-search" onSubmit={doSearch}>
            <HiSearch />
            <input
              autoFocus
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Rechercher dans la conversation…"
            />
            <button type="button" onClick={closeSearch} title="Fermer la recherche">
              <HiX />
            </button>
          </form>
        ) : (
          <button
            type="button"
            className="chat-toolbtn"
            onClick={() => setSearchOpen(true)}
            title="Rechercher"
          >
            <HiSearch />
          </button>
        )}
      </div>

      {/* Bandeau des messages épinglés */}
      {pinned.length > 0 && (
        <div className="chat-pinned">
          <HiBookmark className="chat-pinned-icon" />
          <div className="chat-pinned-body">
            <span className="chat-pinned-label">
              Épinglé{pinned.length > 1 ? ` · ${pinned.length}` : ""}
            </span>
            <span className="chat-pinned-text">
              {pinned[0].texte ||
                (pinned[0].attachments?.length ? "📎 Pièce jointe" : "")}
            </span>
          </div>
          <button
            type="button"
            className="chat-pinned-x"
            onClick={() => togglePin(pinned[0])}
            title="Désépingler"
          >
            <HiX />
          </button>
        </div>
      )}

      <div className="chat-messages" ref={messagesRef}>
        {searchActive ? (
          <div className="chat-search-results">
            {searching ? (
              <div className="chat-empty">Recherche…</div>
            ) : searchResults.length === 0 ? (
              <div className="chat-empty">Aucun résultat.</div>
            ) : (
              searchResults.map((m) => (
                <div key={m._id} className="chat-sr">
                  <MiniAvatar user={m.auteur} size={24} />
                  <div className="chat-sr-body">
                    <div className="chat-sr-top">
                      <b>
                        {m.auteur?.prenom} {m.auteur?.nom}
                      </b>
                      <span>
                        {new Date(m.createdAt).toLocaleDateString("fr-FR", {
                          day: "2-digit",
                          month: "2-digit",
                        })}{" "}
                        {heure(m.createdAt)}
                      </span>
                    </div>
                    <div className="chat-sr-text">{m.texte}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        ) : loading ? (
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
                    <i className={`chat-av-dot s-${statusOf(auteur?._id)}`} />
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
                            className={`chat-bubble ${iAmMentioned(m) ? "mentioned" : ""}`}
                            data-pos={bubblePos(items.length, i)}
                            title={heure(m.createdAt)}
                          >
                            {m.replyTo?.texte && (
                              <div className="chat-quote">
                                <span className="chat-quote-author">
                                  {[m.replyTo.auteurPrenom, m.replyTo.auteurNom]
                                    .filter(Boolean)
                                    .join(" ") || "Message"}
                                </span>
                                <span className="chat-quote-text">
                                  {m.replyTo.texte}
                                </span>
                              </div>
                            )}
                            {editingId === m._id ? (
                              <div className="chat-edit">
                                <input
                                  autoFocus
                                  value={editText}
                                  onChange={(e) => setEditText(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                      e.preventDefault();
                                      saveEdit(m);
                                    } else if (e.key === "Escape") {
                                      cancelEdit();
                                    }
                                  }}
                                />
                                <div className="chat-edit-actions">
                                  <button type="button" onClick={() => saveEdit(m)}>
                                    Enregistrer
                                  </button>
                                  <button type="button" onClick={cancelEdit}>
                                    Annuler
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <>
                                {m.texte && (
                                  <span className="chat-text">
                                    {renderMessageText(m)}
                                    {m.editedAt && (
                                      <span className="chat-edited"> · modifié</span>
                                    )}
                                  </span>
                                )}
                                {(m.attachments || []).length > 0 && (
                                  <div className="chat-atts">
                                    {renderAttachments(m)}
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                          {renderReactionChips(m)}
                        </div>
                        {/* Répondre (survol) */}
                        <button
                          type="button"
                          className="chat-reply-btn"
                          title="Répondre"
                          onClick={() => {
                            setReplyingTo(m);
                            inputRef.current?.focus();
                          }}
                        >
                          <HiReply />
                        </button>
                        {mine && (
                          <button
                            type="button"
                            className="chat-reply-btn"
                            title="Modifier"
                            onClick={() => startEdit(m)}
                          >
                            <HiPencil />
                          </button>
                        )}
                        {(mine || canModerate) && (
                          <button
                            type="button"
                            className={`chat-reply-btn ${m.pinned ? "on" : ""}`}
                            title={m.pinned ? "Désépingler" : "Épingler"}
                            onClick={() => togglePin(m)}
                          >
                            <HiBookmark />
                          </button>
                        )}
                        {/* Déclencheur de réaction (clic pour ouvrir/fermer) */}
                        <div className={`chat-react ${reactFor === m._id ? "open" : ""}`}>
                          <button
                            type="button"
                            className={`chat-react-btn ${reactFor === m._id ? "on" : ""}`}
                            title="Réagir"
                            aria-expanded={reactFor === m._id}
                            onClick={(e) => {
                              e.stopPropagation();
                              setReactFor((cur) => (cur === m._id ? null : m._id));
                            }}
                          >
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

      <div className="chat-composer">
        {/* Barre de citation (réponse en cours) */}
        {replyingTo && (
          <div className="chat-replybar">
            <HiReply className="chat-replybar-icon" />
            <div className="chat-replybar-body">
              <span className="chat-replybar-author">
                Réponse à {replyingTo.auteur?.prenom} {replyingTo.auteur?.nom}
              </span>
              <span className="chat-replybar-text">
                {replyingTo.texte ||
                  (replyingTo.attachments?.length ? "📎 Pièce jointe" : "")}
              </span>
            </div>
            <button
              type="button"
              className="chat-replybar-x"
              onClick={() => setReplyingTo(null)}
              title="Annuler la réponse"
            >
              <HiX />
            </button>
          </div>
        )}

        {/* Autocomplétion des mentions @ */}
        {mentionState.open && mentionSuggestions.length > 0 && (
          <div className="chat-mention-menu">
            {mentionSuggestions.map((u, idx) => (
              <button
                type="button"
                key={u._id}
                className={`chat-mention-item ${idx === mentionState.index ? "on" : ""}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pickMention(u);
                }}
              >
                <span
                  className="chat-mention-av"
                  style={{ background: avatarColor(u) }}
                >
                  {u.photo ? (
                    <img
                      src={`/api/users/${u._id}/photo?v=${u.photoUpdatedAt || ""}`}
                      alt=""
                    />
                  ) : (
                    initiales(u)
                  )}
                </span>
                <span className="chat-mention-name">
                  {u.prenom} {u.nom}
                </span>
              </button>
            ))}
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
            ref={inputRef}
            value={texte}
            onChange={handleInputChange}
            onKeyDown={onInputKeyDown}
            placeholder={uploading ? "Envoi du fichier…" : "Écrire un message…  (@ pour mentionner)"}
            maxLength={4000}
            disabled={uploading}
          />
          <button type="submit" disabled={!texte.trim() || uploading} title="Envoyer">
            <HiPaperAirplane />
          </button>
        </form>
      </div>
    </div>
  );
};

export default ChatPanel;
