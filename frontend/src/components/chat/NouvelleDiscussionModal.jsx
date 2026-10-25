// src/components/chat/NouvelleDiscussionModal.jsx
//
// Création d'une discussion entre users (1:1 si 1 participant, groupe si 2+).
// Le créateur choisit les participants, un nom (groupes) et une icône dans la
// liste prédéfinie. Un GESTIONNAIRE d'équipe (admin / responsable) peut en plus
// rattacher la discussion à une de ses équipes : elle devient alors visible par
// le responsable ET tous les membres (y compris ceux ajoutés plus tard), les
// participants cochés restant des invités en plus.
import React, { useMemo, useState } from "react";
import { useSelector } from "react-redux";
import { HiX, HiSearch, HiUserGroup } from "react-icons/hi";
import { useGetDirectoryUsersQuery } from "../../slices/userApiSlice";
import { useCreateConversationMutation } from "../../slices/conversationApiSlice";
import { useGetTeamsQuery } from "../../slices/teamApiSlice";
import { CHAT_ICON_KEYS, chatIcon } from "../../config/chatIcons";
import Modal from "../ui/Modal/Modal";
import "./NouvelleDiscussionModal.css";

const NouvelleDiscussionModal = ({ onClose, onCreated }) => {
  // Annuaire société : tout utilisateur peut discuter avec ses collègues.
  const { data: users = [] } = useGetDirectoryUsersQuery();
  const [createConversation, { isLoading }] = useCreateConversationMutation();

  // Équipes gérables (GET /api/teams est réservé admin/responsable).
  const { userInfo } = useSelector((state) => state.auth);
  const canTeam =
    userInfo?.role === "admin" || userInfo?.role === "responsable";
  const { data: teams = [] } = useGetTeamsQuery(undefined, { skip: !canTeam });

  const [selected, setSelected] = useState([]); // ids
  const [equipe, setEquipe] = useState(""); // id d'équipe ("" = discussion libre)
  const [nom, setNom] = useState("");
  const [icone, setIcone] = useState("chat");
  const [q, setQ] = useState("");
  const [error, setError] = useState("");

  const isGroup = selected.length > 1 || !!equipe;

  const dispo = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return users.filter((u) => {
      const label = `${u.prenom} ${u.nom} ${u.email}`.toLowerCase();
      return !needle || label.includes(needle);
    });
  }, [users, q]);

  const toggle = (id) =>
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    // Une discussion d'équipe a déjà son audience (responsable + membres) :
    // les participants cochés sont optionnels (invités en plus).
    if (selected.length === 0 && !equipe) {
      setError("Sélectionnez au moins un participant");
      return;
    }
    if (isGroup && !equipe && !nom.trim()) {
      setError("Donnez un nom au groupe");
      return;
    }
    try {
      const res = await createConversation({
        participants: selected,
        nom: nom.trim(),
        icone,
        equipe: equipe || undefined,
      }).unwrap();
      onCreated?.(res.room);
      onClose();
    } catch (err) {
      setError(err?.data?.message || "Création impossible");
    }
  };

  return (
    <Modal onClose={onClose} contentClassName="ndm">
      <div className="ndm-head">
        <h2>Nouvelle discussion</h2>
        <button className="ndm-close" onClick={onClose}>
          <HiX />
        </button>
      </div>

      <form onSubmit={submit} className="ndm-body">
        {error && <div className="ndm-error">{error}</div>}

        {/* Discussion d'ÉQUIPE (gestionnaires uniquement) : visible par le
            responsable + tous les membres, actuels et futurs. */}
        {canTeam && teams.length > 0 && (
          <>
            <label className="ndm-label">
              <HiUserGroup style={{ verticalAlign: "-2px" }} /> Rattacher à une
              équipe <span className="ndm-count">(optionnel)</span>
            </label>
            <select
              className="ndm-input"
              value={equipe}
              onChange={(e) => setEquipe(e.target.value)}
            >
              <option value="">Discussion libre (participants cochés)</option>
              {teams.map((t) => (
                <option key={t._id} value={t._id}>
                  Équipe {t.nom}
                  {t.entreprise?.trigramme
                    ? ` · ${t.entreprise.trigramme}`
                    : ""}
                </option>
              ))}
            </select>
            {equipe && (
              <div className="ndm-empty" style={{ padding: "6px 2px" }}>
                Visible par le responsable et TOUS les membres de l'équipe (y
                compris ajoutés plus tard). Les participants cochés ci-dessous
                sont des invités en plus.
              </div>
            )}
          </>
        )}

        {/* Icône */}
        <label className="ndm-label">Icône</label>
        <div className="ndm-icons">
          {CHAT_ICON_KEYS.map((key) => {
            const Icon = chatIcon(key);
            return (
              <button
                type="button"
                key={key}
                className={`ndm-icon ${icone === key ? "on" : ""}`}
                onClick={() => setIcone(key)}
                title={key}
              >
                <Icon />
              </button>
            );
          })}
        </div>

        {/* Nom (groupes) — pour une discussion d'équipe, défaut = nom de l'équipe. */}
        {isGroup && (
          <>
            <label className="ndm-label">Nom du groupe</label>
            <input
              className="ndm-input"
              value={nom}
              onChange={(e) => setNom(e.target.value)}
              placeholder={
                equipe
                  ? `Ex : ${teams.find((t) => t._id === equipe)?.nom || "Équipe"} — vide = nom de l'équipe`
                  : "Ex : Projet inventaire"
              }
            />
          </>
        )}

        {/* Participants */}
        <label className="ndm-label">
          Participants{" "}
          {selected.length > 0 && (
            <span className="ndm-count">{selected.length} sélectionné(s)</span>
          )}
        </label>
        <div className="ndm-search">
          <HiSearch />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Rechercher un collègue…"
          />
        </div>
        <div className="ndm-users">
          {dispo.length === 0 && (
            <div className="ndm-empty">Aucun utilisateur.</div>
          )}
          {dispo.map((u) => (
            <label key={u._id} className="ndm-user">
              <input
                type="checkbox"
                checked={selected.includes(u._id)}
                onChange={() => toggle(u._id)}
              />
              <span className="ndm-user-name">
                {u.prenom} {u.nom}
                <span className="ndm-user-mail">{u.email}</span>
              </span>
              {u.entreprises?.length ? (
                <span className="ndm-user-ent">{u.entreprises.join(", ")}</span>
              ) : null}
            </label>
          ))}
        </div>

        <div className="ndm-foot">
          <button type="button" className="ndm-btn-cancel" onClick={onClose}>
            Annuler
          </button>
          <button
            type="submit"
            className="ndm-btn-submit"
            disabled={isLoading || (selected.length === 0 && !equipe)}
          >
            {isLoading ? "Création…" : isGroup ? "Créer le groupe" : "Démarrer"}
          </button>
        </div>
      </form>
    </Modal>
  );
};

export default NouvelleDiscussionModal;
