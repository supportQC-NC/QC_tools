// src/screens/user/EspaceEquipeScreen.jsx
//
// Espace d'équipe : chat GLOBAL (tous les utilisateurs) + un chat par équipe
// accessible à l'utilisateur. Sélection du salon par onglets.
import React, { useEffect, useMemo, useState } from "react";
import { HiChatAlt2, HiGlobeAlt, HiUserGroup } from "react-icons/hi";
import { useGetTeamsQuery } from "../../slices/teamApiSlice";
import { useMarkChatSeenMutation } from "../../slices/notificationApiSlice";
import ChatPanel from "../../components/chat/ChatPanel";
import "./EspaceEquipeScreen.css";

const EspaceEquipeScreen = () => {
  const { data: teams } = useGetTeamsQuery();
  const [active, setActive] = useState("global");

  // Ouvrir l'espace équipe = marquer les messages comme lus (efface le badge).
  const [markChatSeen] = useMarkChatSeenMutation();
  useEffect(() => {
    markChatSeen();
  }, [markChatSeen]);

  const salons = useMemo(() => {
    const list = [{ key: "global", room: "global", label: "Général", icon: "globe" }];
    (teams || []).forEach((t) => {
      list.push({
        key: t._id,
        room: `team:${t._id}`,
        label: t.nom,
        icon: "team",
      });
    });
    return list;
  }, [teams]);

  const current = salons.find((s) => s.key === active) || salons[0];

  return (
    <div className="espace-equipe">
      <header className="ee-header">
        <div className="ee-header-icon">
          <HiChatAlt2 />
        </div>
        <div>
          <h1>Espace d'équipe</h1>
          <p className="ee-header-sub">
            Échangez en direct avec vos collègues et vos équipes
          </p>
        </div>
      </header>

      <div className="ee-layout">
        <aside className="ee-rooms">
          {salons.map((s) => (
            <button
              key={s.key}
              className={`ee-room ${active === s.key ? "active" : ""}`}
              onClick={() => setActive(s.key)}
            >
              {s.icon === "globe" ? <HiGlobeAlt /> : <HiUserGroup />}
              <span>{s.label}</span>
            </button>
          ))}
        </aside>

        <div className="ee-chat">
          {current && (
            <ChatPanel
              key={current.room}
              room={current.room}
              title={
                current.key === "global"
                  ? "Chat général"
                  : `Équipe · ${current.label}`
              }
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default EspaceEquipeScreen;
