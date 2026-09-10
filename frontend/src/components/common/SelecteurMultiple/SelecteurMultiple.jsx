// src/components/common/SelecteurMultiple/SelecteurMultiple.jsx
//
// Menu déroulant RECHERCHABLE à sélection multiple, sur des entrées
// { code, count } — la forme renvoyée par les endpoints « gisements » (GISM1)
// et « groupes » (GROUPE) de l'API articles.
//
// Extrait du générateur d'étiquettes (où il a été mis au point) pour être
// partagé : il est utilisé à l'identique par les DEMANDES DE BIPAGE. Chez QC il
// y a des centaines de codes — une grille de puces à cocher est inutilisable,
// il faut pouvoir taper trois lettres.
//
// Gestes attendus d'un champ à puces, tous implémentés ici :
//   - clic sur une option : coche / décoche, le menu reste ouvert ;
//   - Retour arrière sur une recherche vide : retire la dernière puce ;
//   - « Tout effacer » : à 30 codes cochés, les retirer un par un n'en est pas
//     une (le bouton reste collé à droite, visible même avec 3 lignes de puces) ;
//   - clic à l'extérieur : referme le menu.
import React, { useState, useEffect, useRef } from "react";
import { HiX } from "react-icons/hi";
import "./SelecteurMultiple.css";

// Code réservé renvoyé par l'API pour « les articles SANS groupe / SANS
// gisement » (backend : articleService.CODE_VIDE). Il est affiché « VIDE »
// partout : l'utilisateur ne doit jamais voir la valeur technique.
export const CODE_VIDE = "__VIDE__";
export const libelleCode = (code) => (code === CODE_VIDE ? "VIDE" : code);

/**
 * @param {Array}    items         [{ code, count }] — liste complète.
 * @param {string[]} selected      codes sélectionnés.
 * @param {Function} onToggle      (code) => void
 * @param {Function} [onClear]     () => void — bouton « Tout effacer ».
 * @param {boolean}  [loading]
 * @param {string}   [placeholder]
 * @param {string}   [uniteLabel]  nom de l'élément compté (défaut « article »).
 */
const SelecteurMultiple = ({
  items,
  selected = [],
  onToggle,
  onClear,
  loading = false,
  placeholder = "Rechercher et sélectionner…",
  uniteLabel = "article",
}) => {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const q = search.trim().toLowerCase();
  // La recherche porte sur le libellé AFFICHÉ : taper « vide » doit trouver
  // l'entrée des articles sans groupe / sans gisement.
  const filtered = (items || []).filter((g) =>
    libelleCode(g.code).toLowerCase().includes(q),
  );

  return (
    <div className="sms" ref={boxRef}>
      <div className="sms-control" onClick={() => setOpen(true)}>
        {selected.length === 0 && !search && (
          <span className="sms-placeholder">{placeholder}</span>
        )}
        {selected.map((code) => (
          <span
            key={code}
            className={`sms-chip ${code === CODE_VIDE ? "sms-chip-vide" : ""}`}
          >
            {libelleCode(code)}
            <button
              type="button"
              className="sms-chip-x"
              onClick={(e) => {
                e.stopPropagation();
                onToggle(code);
              }}
              aria-label={`Retirer ${libelleCode(code)}`}
            >
              <HiX />
            </button>
          </span>
        ))}
        <input
          className="sms-search"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder={selected.length ? "Ajouter…" : ""}
          onKeyDown={(e) => {
            if (e.key === "Backspace" && !search && selected.length) {
              onToggle(selected[selected.length - 1]);
            }
          }}
        />

        {selected.length > 0 && (
          <button
            type="button"
            className="sms-clear"
            onClick={(e) => {
              e.stopPropagation();
              setSearch("");
              onClear?.();
            }}
            title={`Tout effacer (${selected.length})`}
            aria-label="Tout effacer"
          >
            <HiX /> Tout effacer
          </button>
        )}
      </div>

      {open && (
        <div className="sms-menu">
          {loading ? (
            <div className="sms-empty">Chargement</div>
          ) : filtered.length === 0 ? (
            <div className="sms-empty">
              {search
                ? "Aucun résultat correspondant"
                : "Aucune valeur disponible"}
            </div>
          ) : (
            filtered.map((g) => {
              const checked = selected.includes(g.code);
              return (
                <button
                  type="button"
                  key={g.code}
                  className={`sms-option ${checked ? "checked" : ""} ${
                    g.code === CODE_VIDE ? "sms-option-vide" : ""
                  }`}
                  onClick={() => onToggle(g.code)}
                  title={
                    g.code === CODE_VIDE
                      ? "Articles auxquels aucun code n'est attribué dans l'ERP"
                      : undefined
                  }
                >
                  <span className="sms-check">{checked ? "✓" : ""}</span>
                  <span className="sms-code">{libelleCode(g.code)}</span>
                  <span className="sms-count">
                    {g.count} {uniteLabel}
                    {g.count > 1 ? "s" : ""}
                  </span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
};

export default SelecteurMultiple;
