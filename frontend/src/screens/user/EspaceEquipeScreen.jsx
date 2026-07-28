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
} from "react-icons/hi";
import { getSocket } from "../../socketClient";
import { usePresence } from "../../presenceClient";
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

const initiales = (u) =>
  `${(u?.prenom || "").charAt(0)}${(u?.nom || "").charAt(0)}`.toUpperCase() || "?";

const avatarColor = (u) => {
  const key = String(u?._id || u?.email || `${u?.prenom}${u?.nom}` || "?");
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) % 360;
  return `hsl(${h}, 55%, 45%)`;
};

// Avatar d'une conversation (icône/photo colorée). `dot` = présence (true/false)
// ou undefined pour ne pas afficher de pastille.
const Avatar = ({ conv, size = "md", dot }) => {
  const Icon = conv.type === "global" ? HiChatAlt2 : chatIcon(conv.icone);
  return (
    <span className={`ee-avatar ee-av--${couleurType(conv.type)} ee-av--${size}`}>
      {conv.photo ? (
        <img src={convPhotoUrl(conv.id, conv.photoUpdatedAt)} alt="" />
      ) : (
        <Icon />
      )}
      {dot !== undefined && (
        <i className={`ee-presence ${dot ? "on" : "off"}`} />
      )}
    </span>
  );
};

// Avatar d'un utilisateur (photo si dispo, sinon initiales colorées) + pastille.
const UserAvatar = ({ user, online }) => (
  <span className="ee-uavatar" style={{ background: avatarColor(user) }}>
    {user?.photo ? (
      <img
        src={`/api/users/${user._id}/photo?v=${user.photoUpdatedAt || ""}`}
        alt=""
      />
    ) : (
      <span>{initiales(user)}</span>
    )}
    <i className={`ee-presence ${online ? "on" : "off"}`} />
  </span>
);

const EspaceEquipeScreen = () => {
  const { data: conversations = [], refetch } = useGetConversationsQuery();
  const { userInfo } = useSelector((s) => s.auth);
  const myId = userInfo?._id;
  const { isOnline } = usePresence();

  const [activeRoom, setActiveRoom] = useState("global");
  const [q, setQ] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [showMembers, setShowMembers] = useState(false);

  const [deleteConversation] = useDeleteConversationMutation();
  const [leaveConversation] = useLeaveConversationMutation();
  const [uploadConvPhoto] = useUploadConversationPhotoMutation();
  const groupPhotoRef = useRef(null);

  // Ouvrir l'espace = marquer les messages comme lus (efface le badge).
  const [markChatSeen] = useMarkChatSeenMutation();
  useEffect(() => {
    markChatSeen();
  }, [markChatSeen]);

  // Rafraîchir la liste quand une conversation change (socket).
  useEffect(() => {
    const socket = getSocket();
    const onRefresh = () => refetch();
    socket.on("conv:refresh", onRefresh);
    return () => socket.off("conv:refresh", onRefresh);
  }, [refetch]);

  const groupes = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const match = (c) => !needle || (c.nom || "").toLowerCase().includes(needle);
    return {
      global: conversations.filter((c) => c.type === "global" && match(c)),
      teams: conversations.filter((c) => c.type === "team" && match(c)),
      users: conversations.filter(
        (c) => (c.type === "direct" || c.type === "group") && match(c),
      ),
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
    let dot;
    if (c.type === "direct") {
      const other = (c.participants || []).find(
        (p) => String(p._id) !== String(myId),
      );
      dot = other ? isOnline(other._id) : false;
    }
    return (
      <button
        key={c.room}
        className={`ee-room ${activeRoom === c.room ? "active" : ""} ee-room--${couleurType(c.type)}`}
        onClick={() => setActiveRoom(c.room)}
      >
        <Avatar conv={c} dot={dot} />
        <span className="ee-room-texts">
          <span className="ee-room-name">{c.nom}</span>
          <span className="ee-room-sub">{c.sub}</span>
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
                  dot={isDirect ? (otherUser ? isOnline(otherUser._id) : false) : undefined}
                />
                <div className="ee-conv-headtexts">
                  <h2>{current.nom}</h2>
                  <span className="ee-conv-sub">
                    {isDirect ? (
                      <>
                        <i
                          className={`ee-presence-inline ${otherUser && isOnline(otherUser._id) ? "on" : "off"}`}
                        />
                        {otherUser && isOnline(otherUser._id)
                          ? "En ligne"
                          : "Hors ligne"}
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
                    <div className="ee-members-head">
                      <span className="ee-members-title">
                        Participants
                        <span className="ee-members-count">{members.length}</span>
                      </span>
                      <button
                        className="ee-members-close"
                        onClick={() => setShowMembers(false)}
                        title="Fermer"
                      >
                        <HiX />
                      </button>
                    </div>
                    <div className="ee-members-online">
                      <i className="ee-presence on" />
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
                          const me = String(u._id) === String(myId);
                          return (
                            <div key={u._id} className="ee-member">
                              <UserAvatar user={u} online={online} />
                              <span className="ee-member-texts">
                                <span className="ee-member-name">
                                  {u.prenom} {u.nom}
                                  {me && <span className="ee-member-you"> (vous)</span>}
                                </span>
                                <span className={`ee-member-status ${online ? "on" : "off"}`}>
                                  {online ? "En ligne" : "Hors ligne"}
                                </span>
                              </span>
                            </div>
                          );
                        })
                      )}
                    </div>
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
