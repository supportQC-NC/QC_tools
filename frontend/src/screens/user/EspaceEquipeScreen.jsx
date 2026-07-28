// src/screens/user/EspaceEquipeScreen.jsx
//
// Espace d'équipe — « réseau social interne ». Liste unifiée des discussions
// (API /api/conversations) séparées par CODE COULEUR :
//   • Général          -> bleu
//   • Équipes           -> vert
//   • Discussions users -> violet (1:1 / groupe)
// Rail de conversations à gauche, conversation active (en-tête + chat) à droite,
// panneau « Participants » (présence en ligne / hors ligne) optionnel à droite.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useSelector } from "react-redux";
import {
  HiChatAlt2,
  HiUserGroup,
  HiUsers,
  HiSearch,
  HiPlus,
  HiTrash,
  HiLogout,
  HiCamera,
  HiX,
  HiPhotograph,
  HiDocumentText,
  HiTable,
  HiDocument,
  HiDownload,
} from "react-icons/hi";
import { getSocket } from "../../socketClient";
import { usePresence, setMyManualStatus } from "../../presenceClient";
import {
  useGetRoomMediaQuery,
  messageFileUrl,
} from "../../slices/messageApiSlice";
import {
  triggerDownload,
  openInNewTab,
  formatSize,
} from "../../utils/executableHelpers";
import {
  useGetConversationsQuery,
  useGetRoomMembersQuery,
  useDeleteConversationMutation,
  useLeaveConversationMutation,
  useUploadConversationPhotoMutation,
  convPhotoUrl,
} from "../../slices/conversationApiSlice";
import { useMarkChatSeenMutation } from "../../slices/notificationApiSlice";
import { chatIcon } from "../../config/chatIcons";
import ChatPanel from "../../components/chat/ChatPanel";
import NouvelleDiscussionModal from "../../components/chat/NouvelleDiscussionModal";
import "./EspaceEquipeScreen.css";

// Famille de couleur selon le type de discussion.
const couleurType = (type) => {
  if (type === "team") return "team"; // vert
  if (type === "direct" || type === "group") return "user"; // violet
  return "global"; // bleu
};

// Heure relative compacte pour le rail (« à l'instant », « 5 min », « hier »…).
const timeAgo = (d) => {
  if (!d) return "";
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 45) return "à l'instant";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h`;
  const j = Math.floor(h / 24);
  if (j === 1) return "hier";
  if (j < 7) return `${j} j`;
  return new Date(d).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });
};

// Tri par activité récente (dernier message) : le plus récent d'abord.
const byRecency = (a, b) => {
  const ta = a.lastMessage?.at ? new Date(a.lastMessage.at).getTime() : 0;
  const tb = b.lastMessage?.at ? new Date(b.lastMessage.at).getTime() : 0;
  return tb - ta;
};

// Libellés de statut de présence.
const STATUS_LABEL = {
  actif: "En ligne",
  absent: "Absent",
  occupe: "Ne pas déranger",
  offline: "Hors ligne",
};

// « Vu il y a X » à partir de lastSeenAt (utilisateur hors ligne).
const seenText = (d) => {
  if (!d) return "Hors ligne";
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return "Vu à l'instant";
  const m = Math.floor(s / 60);
  if (m < 60) return `Vu il y a ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `Vu il y a ${h} h`;
  const j = Math.floor(h / 24);
  if (j === 1) return "Vu hier";
  if (j < 7) return `Vu il y a ${j} j`;
  return `Vu le ${new Date(d).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })}`;
};

const initiales = (u) =>
  `${(u?.prenom || "").charAt(0)}${(u?.nom || "").charAt(0)}`.toUpperCase() || "?";

const avatarColor = (u) => {
  const key = String(u?._id || u?.email || `${u?.prenom}${u?.nom}` || "?");
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) % 360;
  return `hsl(${h}, 55%, 45%)`;
};

// Avatar d'une conversation (icône/photo colorée). `status` = statut de présence
// ("actif"|"absent"|"occupe"|"offline") ou undefined pour ne pas afficher de pastille.
const Avatar = ({ conv, size = "md", status }) => {
  const Icon = conv.type === "global" ? HiChatAlt2 : chatIcon(conv.icone);
  return (
    <span className={`ee-avatar ee-av--${couleurType(conv.type)} ee-av--${size}`}>
      {conv.photo ? (
        <img src={convPhotoUrl(conv.id, conv.photoUpdatedAt)} alt="" />
      ) : (
        <Icon />
      )}
      {status !== undefined && <i className={`ee-presence s-${status}`} />}
    </span>
  );
};

// Avatar d'un utilisateur (photo si dispo, sinon initiales colorées) + pastille statut.
const UserAvatar = ({ user, status }) => (
  <span className="ee-uavatar" style={{ background: avatarColor(user) }}>
    {user?.photo ? (
      <img
        src={`/api/users/${user._id}/photo?v=${user.photoUpdatedAt || ""}`}
        alt=""
      />
    ) : (
      <span>{initiales(user)}</span>
    )}
    <i className={`ee-presence s-${status}`} />
  </span>
);

const fileKindIcon = (kind) => {
  if (kind === "pdf") return HiDocumentText;
  if (kind === "tableur") return HiTable;
  return HiDocument;
};

// Galerie des fichiers & images partagés d'un salon (onglet du tiroir latéral).
const MediaGallery = ({ room }) => {
  const { data: items = [], isFetching } = useGetRoomMediaQuery(room, {
    skip: !room,
  });
  const images = items.filter((i) => i.kind === "image");
  const files = items.filter((i) => i.kind !== "image");

  if (isFetching && items.length === 0)
    return <div className="ee-members-hint">Chargement…</div>;
  if (items.length === 0)
    return <div className="ee-members-hint">Aucun fichier partagé.</div>;

  return (
    <div className="ee-media">
      {images.length > 0 && (
        <>
          <div className="ee-media-label">Images · {images.length}</div>
          <div className="ee-media-grid">
            {images.map((im) => {
              const url = messageFileUrl(im.messageId, im.fileId);
              return (
                <button
                  key={im.fileId}
                  className="ee-media-thumb"
                  onClick={() => openInNewTab(url)}
                  title={im.fileName}
                >
                  <img src={url} alt={im.fileName} />
                </button>
              );
            })}
          </div>
        </>
      )}
      {files.length > 0 && (
        <>
          <div className="ee-media-label">Fichiers · {files.length}</div>
          <div className="ee-media-files">
            {files.map((f) => {
              const url = messageFileUrl(f.messageId, f.fileId);
              const Icon = fileKindIcon(f.kind);
              return (
                <button
                  key={f.fileId}
                  className="ee-media-file"
                  onClick={() => triggerDownload(url, f.fileName)}
                  title={`Télécharger ${f.fileName}`}
                >
                  <span className="ee-media-fileicon">
                    <Icon />
                  </span>
                  <span className="ee-media-filemeta">
                    <span className="ee-media-filename">{f.fileName}</span>
                    <span className="ee-media-filesub">
                      {formatSize(f.size)}
                      {f.auteurPrenom ? ` · ${f.auteurPrenom}` : ""}
                    </span>
                  </span>
                  <HiDownload className="ee-media-dl" />
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
};

const EspaceEquipeScreen = () => {
  const { data: conversations = [], refetch } = useGetConversationsQuery(
    undefined,
    { pollingInterval: 20000 },
  );
  const { userInfo } = useSelector((s) => s.auth);
  const myId = userInfo?._id;
  const { isOnline, statusOf } = usePresence();

  // Mon statut de présence (dérivé du store ; « offline » avant connexion socket).
  const myStatus = (() => {
    const s = statusOf(myId);
    return s === "offline" ? "actif" : s;
  })();
  const changeMyStatus = (s) => {
    setMyManualStatus(s === "actif" ? null : s); // « actif » = retour à l'auto
    getSocket().emit("presence:status", s);
  };

  const [activeRoom, setActiveRoom] = useState("global");
  const [q, setQ] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const [drawerTab, setDrawerTab] = useState("membres"); // membres | medias

  const [deleteConversation] = useDeleteConversationMutation();
  const [leaveConversation] = useLeaveConversationMutation();
  const [uploadConvPhoto] = useUploadConversationPhotoMutation();
  const groupPhotoRef = useRef(null);

  // Ouvrir l'espace = marquer les messages comme lus (efface le badge).
  const [markChatSeen] = useMarkChatSeenMutation();
  useEffect(() => {
    markChatSeen();
  }, [markChatSeen]);

  // Rafraîchir la liste quand une conversation change OU qu'un message arrive
  // (rail temps réel : dernier message + non-lus). Débounce léger anti-rafale.
  useEffect(() => {
    const socket = getSocket();
    let t = null;
    const bump = () => {
      clearTimeout(t);
      t = setTimeout(() => refetch(), 400);
    };
    socket.on("conv:refresh", bump);
    socket.on("message:new", bump);
    socket.on("notif:message", bump);
    return () => {
      clearTimeout(t);
      socket.off("conv:refresh", bump);
      socket.off("message:new", bump);
      socket.off("notif:message", bump);
    };
  }, [refetch]);

  const groupes = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const match = (c) => !needle || (c.nom || "").toLowerCase().includes(needle);
    return {
      global: conversations.filter((c) => c.type === "global" && match(c)),
      teams: conversations
        .filter((c) => c.type === "team" && match(c))
        .sort(byRecency),
      users: conversations
        .filter((c) => (c.type === "direct" || c.type === "group") && match(c))
        .sort(byRecency),
    };
  }, [conversations, q]);

  const current =
    conversations.find((c) => c.room === activeRoom) ||
    conversations.find((c) => c.type === "global");

  const isUserConv = current && (current.type === "direct" || current.type === "group");
  const isDirect = current?.type === "direct";

  // Pour une discussion 1:1, l'AUTRE participant (présence affichée en en-tête).
  const otherUser = useMemo(() => {
    if (!isDirect) return null;
    return (current.participants || []).find((p) => String(p._id) !== String(myId)) || null;
  }, [isDirect, current, myId]);

  // Membres du salon actif (panneau participants) — chargés à la demande.
  const { data: members = [], isFetching: loadingMembers } = useGetRoomMembersQuery(
    current?.room,
    { skip: !current?.room || !showMembers },
  );

  const sortedMembers = useMemo(() => {
    const arr = [...members];
    arr.sort((a, b) => {
      const oa = isOnline(a._id) ? 0 : 1;
      const ob = isOnline(b._id) ? 0 : 1;
      if (oa !== ob) return oa - ob; // en ligne d'abord
      return `${a.prenom} ${a.nom}`.localeCompare(`${b.prenom} ${b.nom}`);
    });
    return arr;
  }, [members, isOnline]);

  const membersOnlineCount = useMemo(
    () => members.reduce((n, u) => n + (isOnline(u._id) ? 1 : 0), 0),
    [members, isOnline],
  );

  // Fermer le panneau participants au changement de salon.
  useEffect(() => {
    setShowMembers(false);
  }, [activeRoom]);

  const handleDelete = async (conv) => {
    if (
      !window.confirm(
        `Supprimer la discussion « ${conv.nom} » ? Les messages seront perdus.`,
      )
    )
      return;
    try {
      await deleteConversation(conv.id).unwrap();
      if (activeRoom === conv.room) setActiveRoom("global");
    } catch (e) {
      alert(e?.data?.message || "Suppression impossible");
    }
  };

  const handleLeave = async (conv) => {
    if (!window.confirm(`Quitter la discussion « ${conv.nom} » ?`)) return;
    try {
      await leaveConversation(conv.id).unwrap();
      if (activeRoom === conv.room) setActiveRoom("global");
    } catch (e) {
      alert(e?.data?.message || "Action impossible");
    }
  };

  const handleGroupPhoto = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !current?.id) return;
    if (!file.type.startsWith("image/")) {
      alert("Veuillez choisir une image.");
      return;
    }
    try {
      await uploadConvPhoto({ id: current.id, file }).unwrap();
    } catch (err) {
      alert(err?.data?.message || "Envoi de la photo impossible (max 5 Mo).");
    }
  };

  const renderRoom = (c) => {
    // Pastille de présence sur le rail : uniquement pour les discussions 1:1.
    let status;
    if (c.type === "direct") {
      const other = (c.participants || []).find(
        (p) => String(p._id) !== String(myId),
      );
      status = other ? statusOf(other._id) : "offline";
    }
    // Le salon actif est réputé lu (on est en train de le regarder).
    const unread = c.room === activeRoom ? 0 : c.unread || 0;
    const lm = c.lastMessage;
    // Aperçu « Prénom : texte » (ou « Vous : … » ; rien pour un 1:1).
    let preview = c.sub;
    if (lm) {
      const prefix = lm.mine
        ? "Vous : "
        : c.type === "direct" || !lm.auteurPrenom
          ? ""
          : `${lm.auteurPrenom} : `;
      preview = `${prefix}${lm.texte || ""}`;
    }
    return (
      <button
        key={c.room}
        className={`ee-room ${activeRoom === c.room ? "active" : ""} ee-room--${couleurType(c.type)} ${unread > 0 ? "unread" : ""}`}
        onClick={() => setActiveRoom(c.room)}
      >
        <Avatar conv={c} status={status} />
        <span className="ee-room-texts">
          <span className="ee-room-top">
            <span className="ee-room-name">{c.nom}</span>
            {lm && <span className="ee-room-time">{timeAgo(lm.at)}</span>}
          </span>
          <span className="ee-room-bottom">
            <span className="ee-room-sub">{preview}</span>
            {unread > 0 && (
              <span className="ee-unread">{unread > 99 ? "99+" : unread}</span>
            )}
          </span>
        </span>
      </button>
    );
  };

  return (
    <div className="espace-equipe">
      <header className="ee-header">
        <div className="ee-header-icon">
          <HiChatAlt2 />
        </div>
        <div>
          <h1>Espace d'équipe</h1>
          <p className="ee-header-sub">
            Le réseau interne du groupe — échangez entre collègues et équipes
          </p>
        </div>

        {/* Mon statut de présence */}
        <div className={`ee-mystatus s-${myStatus}`}>
          <i className={`ee-presence s-${myStatus}`} />
          <select
            value={myStatus}
            onChange={(e) => changeMyStatus(e.target.value)}
            title="Mon statut de présence"
          >
            <option value="actif">Disponible</option>
            <option value="absent">Absent</option>
            <option value="occupe">Ne pas déranger</option>
          </select>
        </div>
      </header>

      <div className={`ee-layout ${showMembers ? "with-members" : ""}`}>
        {/* Rail des conversations */}
        <aside className="ee-rooms">
          <div className="ee-search">
            <HiSearch />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Rechercher une conversation…"
            />
          </div>

          <div className="ee-rooms-list">
            {groupes.global.map(renderRoom)}

            {groupes.teams.length > 0 && (
              <div className="ee-group-label ee-group--team">Équipes</div>
            )}
            {groupes.teams.map(renderRoom)}

            <div className="ee-group-row">
              <span className="ee-group-label ee-group--user">Discussions</span>
              <button
                className="ee-new-btn"
                onClick={() => setShowCreate(true)}
                title="Nouvelle discussion"
              >
                <HiPlus />
              </button>
            </div>
            {groupes.users.map(renderRoom)}
            {groupes.users.length === 0 && (
              <div className="ee-rooms-hint">
                Aucune discussion privée pour l'instant.
              </div>
            )}
          </div>
        </aside>

        {/* Conversation active */}
        <section className="ee-conversation">
          {current && (
            <>
              <header className="ee-conv-head">
                <Avatar
                  conv={current}
                  size="lg"
                  status={isDirect ? (otherUser ? statusOf(otherUser._id) : "offline") : undefined}
                />
                <div className="ee-conv-headtexts">
                  <h2>{current.nom}</h2>
                  <span className="ee-conv-sub">
                    {isDirect ? (
                      <>
                        <i
                          className={`ee-presence-inline s-${otherUser ? statusOf(otherUser._id) : "offline"}`}
                        />
                        {STATUS_LABEL[otherUser ? statusOf(otherUser._id) : "offline"]}
                      </>
                    ) : (
                      <>
                        <HiUserGroup /> {current.sub}
                      </>
                    )}
                  </span>
                </div>

                <div className="ee-conv-actions">
                  {/* Participants + présence (hors 1:1, dont la présence est en en-tête). */}
                  {!isDirect && (
                    <button
                      className={`ee-act ${showMembers ? "on" : ""}`}
                      onClick={() => setShowMembers((v) => !v)}
                      title="Voir les participants"
                    >
                      <HiUsers />
                    </button>
                  )}

                  {isUserConv && current.type === "group" && (
                    <>
                      <input
                        ref={groupPhotoRef}
                        type="file"
                        accept="image/*"
                        hidden
                        onChange={handleGroupPhoto}
                      />
                      <button
                        className="ee-act"
                        onClick={() => groupPhotoRef.current?.click()}
                        title="Changer la photo du groupe"
                      >
                        <HiCamera />
                      </button>
                    </>
                  )}
                  {isUserConv &&
                    (current.isOwner ? (
                      <button
                        className="ee-act ee-act--danger"
                        onClick={() => handleDelete(current)}
                        title="Supprimer la discussion"
                      >
                        <HiTrash />
                      </button>
                    ) : (
                      <button
                        className="ee-act ee-act--danger"
                        onClick={() => handleLeave(current)}
                        title="Quitter la discussion"
                      >
                        <HiLogout />
                      </button>
                    ))}
                </div>
              </header>

              <div className="ee-conv-body">
                <ChatPanel
                  key={current.room}
                  room={current.room}
                  embedded
                  canModerate={!!current.isModerator}
                />

                {showMembers && (
                  <aside className="ee-members">
                    <div className="ee-drawer-tabs">
                      <button
                        className={`ee-drawer-tab ${drawerTab === "membres" ? "on" : ""}`}
                        onClick={() => setDrawerTab("membres")}
                      >
                        <HiUsers /> Participants
                      </button>
                      <button
                        className={`ee-drawer-tab ${drawerTab === "medias" ? "on" : ""}`}
                        onClick={() => setDrawerTab("medias")}
                      >
                        <HiPhotograph /> Fichiers
                      </button>
                      <button
                        className="ee-members-close"
                        onClick={() => setShowMembers(false)}
                        title="Fermer"
                      >
                        <HiX />
                      </button>
                    </div>

                    {drawerTab === "medias" ? (
                      <MediaGallery room={current.room} />
                    ) : (
                      <>
                    <div className="ee-members-online">
                      <i className="ee-presence s-actif" />
                      {membersOnlineCount} en ligne
                    </div>
                    <div className="ee-members-list">
                      {loadingMembers && members.length === 0 ? (
                        <div className="ee-members-hint">Chargement…</div>
                      ) : members.length === 0 ? (
                        <div className="ee-members-hint">Aucun participant.</div>
                      ) : (
                        sortedMembers.map((u) => {
                          const online = isOnline(u._id);
                          const st = statusOf(u._id);
                          const me = String(u._id) === String(myId);
                          return (
                            <div key={u._id} className="ee-member">
                              <UserAvatar user={u} status={st} />
                              <span className="ee-member-texts">
                                <span className="ee-member-name">
                                  {u.prenom} {u.nom}
                                  {me && <span className="ee-member-you"> (vous)</span>}
                                </span>
                                <span className={`ee-member-status s-${st}`}>
                                  {online ? STATUS_LABEL[st] : seenText(u.lastSeenAt)}
                                </span>
                              </span>
                            </div>
                          );
                        })
                      )}
                    </div>
                      </>
                    )}
                  </aside>
                )}
              </div>
            </>
          )}
        </section>
      </div>

      {showCreate && (
        <NouvelleDiscussionModal
          onClose={() => setShowCreate(false)}
          onCreated={(room) => setActiveRoom(room)}
        />
      )}
    </div>
  );
};

export default EspaceEquipeScreen;
