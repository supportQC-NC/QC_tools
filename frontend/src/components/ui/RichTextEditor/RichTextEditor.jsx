// src/components/ui/RichTextEditor/RichTextEditor.jsx
//
// Éditeur de texte VISUEL réutilisable (WYSIWYG), pensé pour rédiger un corps
// de mail SANS écrire une ligne de HTML : on tape sur une page blanche, on
// sélectionne, on clique sur un bouton — comme dans Word.
//
// Choix techniques :
//  - `contentEditable` + document.execCommand : aucune dépendance à installer,
//    et surtout un HTML de sortie « à l'ancienne » (<b>, <u>, <font color>)
//    que TOUS les clients mail savent afficher — là où un éditeur moderne
//    produirait des <span style="..."> souvent mal rendus dans Outlook.
//    execCommand est déprécié mais reste implémenté par tous les navigateurs ;
//    aucune alternative standard n'existe à ce jour.
//  - `styleWithCSS = false` pour forcer ce HTML-là.
//  - le collage est nettoyé (Word/Web arrivent avec des tonnes de balises).
//  - un mode « Code HTML » reste disponible pour les utilisateurs avancés.
//
// Props :
//   value        (string)  HTML courant
//   onChange     (fn)      appelé avec le nouveau HTML
//   variables    (array)   [{ cle, label, exemple }] -> menu « Insérer un champ »
//   minHeight    (number)  hauteur de la zone de saisie (px, défaut 320)
//   placeholder  (string)  texte d'invite quand c'est vide
//   disabled     (bool)
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  HiViewList,
  HiMenuAlt2,
  HiMenuAlt3,
  HiMenuAlt4,
  HiLink,
  HiPhotograph,
  HiCode,
  HiMinusSm,
  HiTrash,
  HiVariable,
  HiArrowLeft,
  HiArrowRight,
  HiChevronDown,
} from "react-icons/hi";
import { sanitizeHtml, htmlEstVide } from "./sanitizeHtml";
import "./RichTextEditor.css";

// Tailles execCommand (1..7) traduites en libellés compréhensibles.
const TAILLES = [
  { v: "2", label: "Petit" },
  { v: "3", label: "Normal" },
  { v: "4", label: "Grand" },
  { v: "5", label: "Très grand" },
];

const BLOCS = [
  { v: "P", label: "Paragraphe" },
  { v: "H1", label: "Titre 1" },
  { v: "H2", label: "Titre 2" },
  { v: "H3", label: "Titre 3" },
];

// Couleurs proposées (palette courte : un nuancier complet est illisible).
const COULEURS = [
  "#000000", "#374151", "#6b7280", "#b91c1c", "#ea580c",
  "#ca8a04", "#15803d", "#0e7490", "#1d4ed8", "#6d28d9",
];

// Bouton de barre d'outils. Défini HORS du composant : recréer le type à chaque
// frappe ferait remonter toute la barre à chaque caractère saisi.
// `onMouseDown` + preventDefault conserve la sélection de texte pendant le clic.
const Btn = ({ titre, onClick, children, actif = false, disabled = false }) => (
  <button
    type="button"
    className={`rte-btn ${actif ? "actif" : ""}`}
    title={titre}
    aria-label={titre}
    disabled={disabled}
    onMouseDown={(e) => e.preventDefault()}
    onClick={onClick}
  >
    {children}
  </button>
);

const RichTextEditor = ({
  value = "",
  onChange,
  variables = [],
  minHeight = 320,
  placeholder = "Rédigez votre message…",
  disabled = false,
}) => {
  const editorRef = useRef(null);
  // Dernier HTML émis par l'éditeur : évite de réécrire innerHTML (et donc de
  // faire sauter le curseur) à chaque frappe.
  const dernierHtml = useRef(value);
  const selection = useRef(null);

  const [mode, setMode] = useState("visuel"); // "visuel" | "html"
  const [barreLien, setBarreLien] = useState(null); // { type: "lien"|"image", url }
  const [menuVariables, setMenuVariables] = useState(false);
  const [vide, setVide] = useState(htmlEstVide(value));

  // ── Synchronisation value -> éditeur ──────────────────────────────────────
  useEffect(() => {
    if (mode !== "visuel" || !editorRef.current) return;
    if (value !== dernierHtml.current) {
      editorRef.current.innerHTML = value || "";
      dernierHtml.current = value || "";
    }
    setVide(htmlEstVide(value));
  }, [value, mode]);

  // Au (re)montage de la zone visuelle : on repose le contenu et on demande à
  // l'exécution de produire des balises plutôt que du CSS en ligne.
  useEffect(() => {
    if (mode !== "visuel" || !editorRef.current) return;
    editorRef.current.innerHTML = value || "";
    dernierHtml.current = value || "";
    try {
      document.execCommand("styleWithCSS", false, false);
    } catch {
      /* certains navigateurs refusent : sans effet, on continue */
    }
    // Volontairement limité au changement de mode.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const emettre = useCallback(() => {
    if (!editorRef.current) return;
    const html = editorRef.current.innerHTML;
    dernierHtml.current = html;
    setVide(htmlEstVide(html));
    onChange?.(html);
  }, [onChange]);

  // ── Sélection : mémorisée avant d'ouvrir un champ (lien, image, couleur) ──
  const memoriserSelection = useCallback(() => {
    const sel = window.getSelection();
    if (
      sel &&
      sel.rangeCount &&
      editorRef.current &&
      editorRef.current.contains(sel.anchorNode)
    ) {
      selection.current = sel.getRangeAt(0).cloneRange();
    }
  }, []);

  const restaurerSelection = useCallback(() => {
    editorRef.current?.focus();
    const r = selection.current;
    if (!r) return;
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
  }, []);

  // ── Commandes ─────────────────────────────────────────────────────────────
  const exec = useCallback(
    (cmd, arg = null) => {
      if (disabled) return;
      editorRef.current?.focus();
      try {
        document.execCommand(cmd, false, arg);
      } catch {
        /* commande non supportée : on ignore plutôt que de casser l'écran */
      }
      emettre();
    },
    [disabled, emettre],
  );

  // Applique une commande APRÈS avoir remis la sélection mémorisée en place
  // (cas des champs qui ont volé le focus à l'éditeur).
  const execSurSelection = useCallback(
    (cmd, arg) => {
      restaurerSelection();
      exec(cmd, arg);
    },
    [restaurerSelection, exec],
  );

  const insererHtml = useCallback(
    (html) => {
      restaurerSelection();
      exec("insertHTML", html);
    },
    [restaurerSelection, exec],
  );

  // ── Collage nettoyé ───────────────────────────────────────────────────────
  const onPaste = useCallback(
    (e) => {
      e.preventDefault();
      const dt = e.clipboardData;
      const html = dt?.getData("text/html");
      if (html) {
        document.execCommand("insertHTML", false, sanitizeHtml(html));
      } else {
        const texte = dt?.getData("text/plain") || "";
        document.execCommand(
          "insertHTML",
          false,
          texte
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/\r?\n/g, "<br>"),
        );
      }
      emettre();
    },
    [emettre],
  );

  // ── Barre lien / image ────────────────────────────────────────────────────
  const ouvrirBarre = (type) => {
    memoriserSelection();
    setBarreLien({ type, url: type === "lien" ? "https://" : "https://" });
  };

  const validerBarre = () => {
    if (!barreLien) return;
    const url = String(barreLien.url || "").trim();
    if (!url || url === "https://") {
      setBarreLien(null);
      return;
    }
    if (barreLien.type === "lien") execSurSelection("createLink", url);
    else execSurSelection("insertImage", url);
    setBarreLien(null);
  };

  return (
    <div className={`rte ${disabled ? "rte-off" : ""}`}>
      <div className="rte-toolbar">
        {/* Blocs + taille */}
        <select
          className="rte-select"
          defaultValue=""
          disabled={disabled || mode === "html"}
          title="Style de paragraphe"
          onMouseDown={memoriserSelection}
          onChange={(e) => {
            if (e.target.value) execSurSelection("formatBlock", `<${e.target.value}>`);
            e.target.value = "";
          }}
        >
          <option value="">Style…</option>
          {BLOCS.map((b) => (
            <option key={b.v} value={b.v}>
              {b.label}
            </option>
          ))}
        </select>

        <select
          className="rte-select"
          defaultValue=""
          disabled={disabled || mode === "html"}
          title="Taille du texte"
          onMouseDown={memoriserSelection}
          onChange={(e) => {
            if (e.target.value) execSurSelection("fontSize", e.target.value);
            e.target.value = "";
          }}
        >
          <option value="">Taille…</option>
          {TAILLES.map((t) => (
            <option key={t.v} value={t.v}>
              {t.label}
            </option>
          ))}
        </select>

        <span className="rte-sep" />

        {/* Gras / italique / souligné / barré */}
        <Btn disabled={disabled} titre="Gras (Ctrl+B)" onClick={() => exec("bold")}>
          <b>G</b>
        </Btn>
        <Btn disabled={disabled} titre="Italique (Ctrl+I)" onClick={() => exec("italic")}>
          <i>I</i>
        </Btn>
        <Btn disabled={disabled} titre="Souligné (Ctrl+U)" onClick={() => exec("underline")}>
          <u>S</u>
        </Btn>
        <Btn disabled={disabled} titre="Barré" onClick={() => exec("strikeThrough")}>
          <s>B</s>
        </Btn>

        <span className="rte-sep" />

        {/* Couleurs */}
        <div className="rte-pop">
          <Btn disabled={disabled} titre="Couleur du texte" onClick={() => {}}>
            <span className="rte-swatch">A</span>
            <HiChevronDown className="rte-mini" />
          </Btn>
          <div className="rte-pop-menu">
            <div className="rte-pop-title">Couleur du texte</div>
            <div className="rte-colors">
              {COULEURS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className="rte-color"
                  style={{ background: c }}
                  title={c}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => exec("foreColor", c)}
                />
              ))}
            </div>
            <div className="rte-pop-title">Surlignage</div>
            <div className="rte-colors">
              {["#fef08a", "#bbf7d0", "#bfdbfe", "#fecaca", "#e9d5ff"].map((c) => (
                <button
                  key={c}
                  type="button"
                  className="rte-color"
                  style={{ background: c }}
                  title={c}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => exec("hiliteColor", c)}
                />
              ))}
              <button
                type="button"
                className="rte-color rte-color-none"
                title="Aucun surlignage"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => exec("hiliteColor", "transparent")}
              />
            </div>
          </div>
        </div>

        <span className="rte-sep" />

        {/* Listes + alignements */}
        <Btn disabled={disabled} titre="Liste à puces" onClick={() => exec("insertUnorderedList")}>
          <HiViewList />
        </Btn>
        <Btn disabled={disabled} titre="Liste numérotée" onClick={() => exec("insertOrderedList")}>
          <span className="rte-txt">1.</span>
        </Btn>
        <Btn disabled={disabled} titre="Aligner à gauche" onClick={() => exec("justifyLeft")}>
          <HiMenuAlt2 />
        </Btn>
        <Btn disabled={disabled} titre="Centrer" onClick={() => exec("justifyCenter")}>
          <HiMenuAlt4 />
        </Btn>
        <Btn disabled={disabled} titre="Aligner à droite" onClick={() => exec("justifyRight")}>
          <HiMenuAlt3 />
        </Btn>

        <span className="rte-sep" />

        {/* Lien / image / trait */}
        <Btn disabled={disabled} titre="Insérer un lien" onClick={() => ouvrirBarre("lien")}>
          <HiLink />
        </Btn>
        <Btn disabled={disabled} titre="Retirer le lien" onClick={() => exec("unlink")}>
          <span className="rte-txt">⊘</span>
        </Btn>
        <Btn disabled={disabled} titre="Insérer une image (adresse web)" onClick={() => ouvrirBarre("image")}>
          <HiPhotograph />
        </Btn>
        <Btn disabled={disabled} titre="Ligne de séparation" onClick={() => exec("insertHorizontalRule")}>
          <HiMinusSm />
        </Btn>

        <span className="rte-sep" />

        {/* Variables */}
        {variables.length > 0 && (
          <div className={`rte-pop ${menuVariables ? "ouvert" : ""}`}>
            <Btn
              disabled={disabled}
              titre="Insérer un champ automatique"
              onClick={() => {
                memoriserSelection();
                setMenuVariables((v) => !v);
              }}
            >
              <HiVariable />
              <span className="rte-txt">Champ</span>
              <HiChevronDown className="rte-mini" />
            </Btn>
            <div className="rte-pop-menu large">
              <div className="rte-pop-title">
                Remplacé automatiquement à l'envoi
              </div>
              {variables.map((v) => (
                <button
                  key={v.cle}
                  type="button"
                  className="rte-varitem"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    insererHtml(`{{${v.cle}}}`);
                    setMenuVariables(false);
                  }}
                >
                  <span className="rte-varlbl">{v.label}</span>
                  <span className="rte-varex">{v.exemple}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <span className="rte-sep" />

        <Btn disabled={disabled} titre="Annuler (Ctrl+Z)" onClick={() => exec("undo")}>
          <HiArrowLeft />
        </Btn>
        <Btn disabled={disabled} titre="Rétablir (Ctrl+Y)" onClick={() => exec("redo")}>
          <HiArrowRight />
        </Btn>
        <Btn
          disabled={disabled}
          titre="Effacer la mise en forme de la sélection"
          onClick={() => {
            exec("removeFormat");
            exec("unlink");
          }}
        >
          <HiTrash />
        </Btn>

        <span className="rte-spacer" />

        <Btn
          disabled={disabled}
          titre="Voir / modifier le code HTML (utilisateurs avancés)"
          actif={mode === "html"}
          onClick={() => setMode((m) => (m === "html" ? "visuel" : "html"))}
        >
          <HiCode />
        </Btn>
      </div>

      {/* Barre de saisie d'URL (lien ou image) */}
      {barreLien && (
        <div className="rte-urlbar">
          <span>
            {barreLien.type === "lien"
              ? "Adresse du lien :"
              : "Adresse de l'image :"}
          </span>
          <input
            autoFocus
            value={barreLien.url}
            onChange={(e) => setBarreLien((b) => ({ ...b, url: e.target.value }))}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                validerBarre();
              }
              if (e.key === "Escape") setBarreLien(null);
            }}
            placeholder="https://…"
          />
          <button type="button" className="rte-urlok" onClick={validerBarre}>
            Appliquer
          </button>
          <button type="button" className="rte-urlno" onClick={() => setBarreLien(null)}>
            Annuler
          </button>
        </div>
      )}

      {mode === "visuel" ? (
        <div className="rte-sheet-wrap" style={{ minHeight }}>
          <div
            ref={editorRef}
            className="rte-sheet"
            style={{ minHeight }}
            contentEditable={!disabled}
            suppressContentEditableWarning
            spellCheck
            role="textbox"
            aria-multiline="true"
            aria-label="Corps du message"
            onInput={emettre}
            onBlur={() => {
              memoriserSelection();
              emettre();
            }}
            onKeyUp={memoriserSelection}
            onMouseUp={memoriserSelection}
            onPaste={onPaste}
          />
          {vide && <div className="rte-placeholder">{placeholder}</div>}
        </div>
      ) : (
        <textarea
          className="rte-code"
          style={{ minHeight }}
          value={value}
          disabled={disabled}
          spellCheck={false}
          onChange={(e) => {
            dernierHtml.current = e.target.value;
            onChange?.(e.target.value);
          }}
        />
      )}
    </div>
  );
};

export default RichTextEditor;
