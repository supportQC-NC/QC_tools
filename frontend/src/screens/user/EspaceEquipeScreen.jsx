// src/screens/user/EspaceEquipeScreen.jsx
//
// Espace d'équipe — « réseau social interne ». Liste unifiée des discussions
// (API /api/conversations) séparées par CODE COULEUR :
//   • Général          -> bleu
//   • Équipes           -> vert
//   • Discussions users -> violet (1:1 / groupe)
// Rail de conversations à gauche, conversation active (en-tête + chat) à droite.
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  HiChatAlt2,
  HiUserGroup,
  HiSearch,
  HiPlus,
  HiTrash,
  HiLogout,
  HiCamera,
} from "react-icons/hi";
import { getSocket } from "../../socketClient";
import {
  useGetConversationsQuery,
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

const Avatar = ({ conv, size = "md" }) => {
  const Icon = conv.type === "global" ? HiChatAlt2 : chatIcon(conv.icone);
  return (
    <span className={`ee-avatar ee-av--${couleurType(conv.type)} ee-av--${size}`}>
      {conv.photo ? (
        <img src={convPhotoUrl(conv.id, conv.photoUpdatedAt)} alt="" />
      ) : (
        <Icon />
      )}
    </span>
  );
};

const EspaceEquipeScreen = () => {
  const { data: conversations = [], refetch } = useGetConversationsQuery();
  const [activeRoom, setActiveRoom] = useState("global");
  const [q, setQ] = useState("");
  const [showCreate, setShowCreate] = useState(false);

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

  const renderRoom = (c) => (
    <button
      key={c.room}
      className={`ee-room ${activeRoom === c.room ? "active" : ""} ee-room--${couleurType(c.type)}`}
      onClick={() => setActiveRoom(c.room)}
    >
      <Avatar conv={c} />
      <span className="ee-room-texts">
        <span className="ee-room-name">{c.nom}</span>
        <span className="ee-room-sub">{c.sub}</span>
      </span>
    </button>
  );

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

      <div className="ee-layout">
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
                <Avatar conv={current} size="lg" />
                <div className="ee-conv-headtexts">
                  <h2>{current.nom}</h2>
                  <span className="ee-conv-sub">
                    <HiUserGroup /> {current.sub}
                  </span>
                </div>

                {isUserConv && (
                  <div className="ee-conv-actions">
                    {current.type === "group" && (
                      <>
                        <input
                          ref={groupPhotoRef}
                          type="file"
                          accept="image/*"
                          hidden
                          onChange={handleGroupPhoto}
                        />
                        <button
                          onClick={() => groupPhotoRef.current?.click()}
                          title="Changer la photo du groupe"
                        >
                          <HiCamera />
                        </button>
                      </>
                    )}
                    {current.isOwner ? (
                      <button
                        onClick={() => handleDelete(current)}
                        title="Supprimer la discussion"
                      >
                        <HiTrash />
                      </button>
                    ) : (
                      <button
                        onClick={() => handleLeave(current)}
                        title="Quitter la discussion"
                      >
                        <HiLogout />
                      </button>
                    )}
                  </div>
                )}
              </header>

              <ChatPanel
                key={current.room}
                room={current.room}
                embedded
                canModerate={!!current.isModerator}
              />
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
