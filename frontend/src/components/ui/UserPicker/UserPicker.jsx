// src/components/ui/UserPicker/UserPicker.jsx
//
// Sélecteur d'utilisateur RÉUTILISABLE, avec recherche dans le menu déroulant.
//
// Pourquoi pas un <select> : la liste porte TOUS les comptes de l'application
// (pas seulement ceux d'une société), elle est donc trop longue pour être
// parcourue à la souris. Le filtre se fait sur le nom ET sur l'e-mail, sans
// accent ni casse — on tape « lea » et on trouve « Léa ».
//
// Composant contrôlé : `value` = id sélectionné (ou ""), `onChange(id)`.
// Aucune dépendance externe : ni lib de combobox, ni portail (le menu est
// positionné en absolu dans le conteneur).
import React, { useEffect, useMemo, useRef, useState } from "react";
import { HiChevronDown, HiSearch, HiX } from "react-icons/hi";
import "./UserPicker.css";

// Comparaison tolérante : minuscules, accents retirés.
const normaliser = (v) =>
  String(v || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

const UserPicker = ({
  users = [],
  value = "",
  onChange,
  placeholder = "Choisir une personne…",
  emptyLabel = "Aucune (moi)",
  allowEmpty = true,
  disabled = false,
  id,
}) => {
  const [ouvert, setOuvert] = useState(false);
  const [recherche, setRecherche] = useState("");
  const conteneurRef = useRef(null);
  const rechercheRef = useRef(null);

  const selection = useMemo(
    () => users.find((u) => String(u._id) === String(value)) || null,
    [users, value],
  );

  const filtres = useMemo(() => {
    const q = normaliser(recherche).trim();
    if (!q) return users;
    return users.filter(
      (u) => normaliser(u.nom).includes(q) || normaliser(u.email).includes(q),
    );
  }, [users, recherche]);

  // Fermeture au clic extérieur et à Échap : un menu resté ouvert masquerait
  // le champ de scan juste en dessous.
  useEffect(() => {
    if (!ouvert) return undefined;
    const onClick = (e) => {
      if (conteneurRef.current && !conteneurRef.current.contains(e.target)) {
        setOuvert(false);
      }
    };
    const onKey = (e) => {
      if (e.key === "Escape") setOuvert(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [ouvert]);

  useEffect(() => {
    if (ouvert && rechercheRef.current) rechercheRef.current.focus();
    if (!ouvert) setRecherche("");
  }, [ouvert]);

  const choisir = (uid) => {
    onChange?.(uid);
    setOuvert(false);
  };

  return (
    <div className="user-picker" ref={conteneurRef}>
      <button
        type="button"
        id={id}
        className={`user-picker-trigger ${selection ? "has-value" : ""}`}
        onClick={() => !disabled && setOuvert((o) => !o)}
        disabled={disabled}
        title={selection ? selection.nom : placeholder}
      >
        <span className="user-picker-value">
          {selection ? selection.nom : placeholder}
        </span>
        {selection && allowEmpty && (
          <span
            className="user-picker-clear"
            role="button"
            tabIndex={-1}
            title="Effacer"
            onClick={(e) => {
              e.stopPropagation();
              choisir("");
            }}
          >
            <HiX />
          </span>
        )}
        <HiChevronDown className="user-picker-caret" />
      </button>

      {ouvert && (
        <div className="user-picker-menu">
          <div className="user-picker-search">
            <HiSearch />
            <input
              ref={rechercheRef}
              type="text"
              value={recherche}
              placeholder="Rechercher un nom, un e-mail…"
              onChange={(e) => setRecherche(e.target.value)}
              onKeyDown={(e) => {
                // Entrée sur un filtre qui ne laisse qu'un candidat : on le
                // prend. Le geste courant est « je tape 3 lettres, j'enchaîne ».
                if (e.key === "Enter" && filtres.length === 1) {
                  e.preventDefault();
                  choisir(filtres[0]._id);
                }
              }}
            />
          </div>
          <ul className="user-picker-list">
            {allowEmpty && (
              <li>
                <button
                  type="button"
                  className={`user-picker-item ${!value ? "selected" : ""}`}
                  onClick={() => choisir("")}
                >
                  {emptyLabel}
                </button>
              </li>
            )}
            {filtres.length === 0 ? (
              <li className="user-picker-vide">Aucun résultat</li>
            ) : (
              filtres.map((u) => (
                <li key={u._id}>
                  <button
                    type="button"
                    className={`user-picker-item ${
                      String(u._id) === String(value) ? "selected" : ""
                    }`}
                    onClick={() => choisir(u._id)}
                  >
                    <span className="user-picker-nom">{u.nom}</span>
                    {u.email && (
                      <span className="user-picker-mail">{u.email}</span>
                    )}
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
};

export default UserPicker;
