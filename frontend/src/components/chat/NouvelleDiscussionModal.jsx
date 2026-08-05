// src/components/chat/NouvelleDiscussionModal.jsx
//
// Création d'une discussion entre users (1:1 si 1 participant, groupe si 2+).
// Le créateur choisit les participants, un nom (groupes) et une icône dans la
// liste prédéfinie.
import React, { useMemo, useState } from "react";
import { HiX, HiSearch } from "react-icons/hi";
import { useGetDirectoryUsersQuery } from "../../slices/userApiSlice";
import { useCreateConversationMutation } from "../../slices/conversationApiSlice";
import { CHAT_ICON_KEYS, chatIcon } from "../../config/chatIcons";
import Modal from "../ui/Modal/Modal";
import "./NouvelleDiscussionModal.css";

const NouvelleDiscussionModal = ({ onClose, onCreated }) => {
  // Annuaire société : tout utilisateur peut discuter avec ses collègues.
  const { data: users = [] } = useGetDirectoryUsersQuery();
  const [createConversation, { isLoading }] = useCreateConversationMutation();

  const [selected, setSelected] = useState([]); // ids
  const [nom, setNom] = useState("");
  const [icone, setIcone] = useState("chat");
  const [q, setQ] = useState("");
  const [error, setError] = useState("");

  const isGroup = selected.length > 1;

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
    if (selected.length === 0) {
      setError("Sélectionnez au moins un participant");
      return;
    }
    if (isGroup && !nom.trim()) {
      setError("Donnez un nom au groupe");
      return;
    }
    try {
      const res = await createConversation({
        participants: selected,
        nom: nom.trim(),
        icone,
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

        {/* Nom (groupes) */}
        {isGroup && (
          <>
            <label className="ndm-label">Nom du groupe</label>
            <input
              className="ndm-input"
              value={nom}
              onChange={(e) => setNom(e.target.value)}
              placeholder="Ex : Projet inventaire"
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
            disabled={isLoading || selected.length === 0}
          >
            {isLoading ? "Création…" : isGroup ? "Créer le groupe" : "Démarrer"}
          </button>
        </div>
      </form>
    </Modal>
  );
};

export default NouvelleDiscussionModal;
