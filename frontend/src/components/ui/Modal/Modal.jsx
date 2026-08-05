// src/components/ui/Modal/Modal.jsx
//
// Fenêtre modale RÉUTILISABLE — wrapper COMPORTEMENTAL.
//
// Objectif : centraliser une bonne fois les comportements répétés (et souvent
// oubliés) des ~29 modales maison du projet, SANS toucher à leur apparence.
//
// Ce composant N'EMBARQUE AUCUN style : il rend la structure habituelle avec les
// mêmes noms de classes (`modal-overlay` / `modal-content` / `modal-header` /
// `modal-close`). L'habillage continue donc de venir de la CSS existante de
// chaque écran (`overlayClassName` / `contentClassName` sont paramétrables). Le
// rendu reste strictement identique.
//
// Ce qu'il apporte (bonnes pratiques, additif) :
//   - rendu via un PORTAIL sur <body> (évite les pièges d'empilement/overflow) ;
//   - fermeture au clic sur l'arrière-plan et à la touche Échap ;
//   - verrou du scroll de la page tant que la modale est ouverte ;
//   - accessibilité : role="dialog" + aria-modal, bouton de fermeture labellisé.
// Chaque comportement est désactivable par prop pour rester 100 % fidèle si besoin.
import React, { useEffect } from "react";
import { createPortal } from "react-dom";
import { HiX } from "react-icons/hi";

/**
 * @param {object}    props
 * @param {Function}  props.onClose            Appelé pour fermer (Échap, clic fond, croix).
 * @param {ReactNode} props.children           Contenu de la modale.
 * @param {ReactNode} [props.title]            Si fourni, rend un en-tête standard (h2 + croix).
 * @param {ReactNode} [props.icon]             Icône affichée avant le titre dans l'en-tête.
 * @param {boolean}   [props.showClose=true]   Affiche la croix de fermeture dans l'en-tête.
 * @param {boolean}   [props.closeOnOverlay=true] Fermer au clic sur l'arrière-plan.
 * @param {boolean}   [props.closeOnEscape=true]  Fermer à la touche Échap.
 * @param {boolean}   [props.lockScroll=true]  Verrouiller le scroll de la page.
 * @param {string}    [props.overlayClassName="modal-overlay"] Classe de l'arrière-plan.
 * @param {string}    [props.contentClassName="modal-content"] Classe(s) de la boîte.
 * @param {string}    [props.ariaLabel]        Libellé accessible si pas de titre visible.
 * @param {string}    [props.labelledBy]       id d'un élément titrant la modale.
 */
const Modal = ({
  onClose,
  children,
  title,
  icon,
  showClose = true,
  closeOnOverlay = true,
  closeOnEscape = true,
  lockScroll = true,
  overlayClassName = "modal-overlay",
  contentClassName = "modal-content",
  ariaLabel,
  labelledBy,
}) => {
  // Fermeture au clavier (Échap).
  useEffect(() => {
    if (!closeOnEscape) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [closeOnEscape, onClose]);

  // Verrou du scroll de la page pendant l'ouverture (restauré à la fermeture).
  useEffect(() => {
    if (!lockScroll) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [lockScroll]);

  const handleOverlayClick = () => {
    if (closeOnOverlay) onClose?.();
  };

  return createPortal(
    <div className={overlayClassName} onClick={handleOverlayClick} role="presentation">
      <div
        className={contentClassName}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        aria-labelledby={labelledBy}
      >
        {title !== undefined && (
          <div className="modal-header">
            <h2>
              {icon}
              {title}
            </h2>
            {showClose && (
              <button className="modal-close" onClick={onClose} aria-label="Fermer">
                <HiX />
              </button>
            )}
          </div>
        )}
        {children}
      </div>
    </div>,
    document.body,
  );
};

export default Modal;
