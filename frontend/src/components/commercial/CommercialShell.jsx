// src/components/commercial/CommercialShell.jsx
//
// Ossature commune des écrans de l'ESPACE COMMERCIAL (/commercial/*) :
// en-tête, sélecteur de société limité aux sociétés du commercial, navigation
// interne. Toutes les données affichées sont déjà filtrées par le serveur sur
// le couple société + code vendeur de l'utilisateur connecté.

import React, { useEffect, useMemo, useState } from "react";
import { NavLink } from "react-router-dom";
import { useSelector } from "react-redux";
import {
  HiViewGrid,
  HiUserGroup,
  HiDocumentReport,
  HiBookmark,
  HiStar,
  HiCurrencyDollar,
  HiBell,
  HiOfficeBuilding,
} from "react-icons/hi";
import { selectGlobalDossier } from "../../slices/entrepriseGlobalSlice";
import { useGetMonProfilCommercialQuery } from "../../slices/commercialApiSlice";

// ── Formatage (partagé par tous les écrans de l'espace) ─────────────────────
export const fmtMontant = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return Math.round(n).toLocaleString("fr-FR").replace(/[\s,]/g, " ");
};

export const fmtNombre = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("fr-FR").replace(/[\s,]/g, " ");
};

export const fmtDate = (iso) => {
  if (!iso) return "—";
  const [y, m, d] = String(iso).slice(0, 10).split("-");
  return y && m && d ? `${d}/${m}/${y}` : "—";
};

export const fmtPct = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return `${n > 0 ? "+" : ""}${n.toFixed(1)} %`;
};

// Puce de catégorie de document (proforma.ETAT).
export const ChipCategorie = ({ categorie, label }) => (
  <span className={`co-chip co-chip-${categorie || "muted"}`}>
    {label || categorie}
  </span>
);

// Évolution colorée.
export const Evolution = ({ valeur }) => {
  const n = Number(valeur) || 0;
  return (
    <span className={n >= 0 ? "co-evol-up" : "co-evol-down"}>{fmtPct(n)}</span>
  );
};

/**
 * Sociétés du commercial + société active.
 * La sélection initiale suit le sélecteur GLOBAL du header quand la société y
 * figure, sinon la première société rattachée.
 */
export const useSocietesCommerciales = () => {
  const dossierGlobal = useSelector(selectGlobalDossier);
  const { data, isLoading, error } = useGetMonProfilCommercialQuery();
  const societes = useMemo(() => data?.entreprises || [], [data]);
  const [dossier, setDossier] = useState(null);

  useEffect(() => {
    if (!societes.length) return;
    setDossier((courant) => {
      if (courant && societes.some((s) => s.nomDossierDBF === courant)) {
        return courant;
      }
      if (
        dossierGlobal &&
        societes.some((s) => s.nomDossierDBF === dossierGlobal)
      ) {
        return dossierGlobal;
      }
      return societes[0].nomDossierDBF;
    });
  }, [societes, dossierGlobal]);

  const societe = societes.find((s) => s.nomDossierDBF === dossier) || null;
  return { societes, societe, dossier, setDossier, isLoading, error };
};

// Onglets de l'espace commercial.
const NAV = [
  { to: "/commercial", label: "Tableau de bord", icon: HiViewGrid, end: true },
  { to: "/commercial/clients", label: "Portefeuille", icon: HiUserGroup },
  { to: "/commercial/proformas", label: "Proformas", icon: HiDocumentReport },
  { to: "/commercial/reservations", label: "Réservations", icon: HiBookmark },
  { to: "/commercial/commandes-speciales", label: "Cdes spéciales", icon: HiStar },
  { to: "/commercial/factures", label: "Factures", icon: HiCurrencyDollar },
  { to: "/commercial/alertes", label: "Alertes", icon: HiBell },
];

/**
 * En-tête + navigation. `societes`/`dossier`/`onDossier` viennent de
 * useSocietesCommerciales ; passer `sansSociete` pour les écrans agrégés.
 */
const CommercialShell = ({
  titre,
  sousTitre,
  icone: Icone = HiViewGrid,
  societes = [],
  dossier,
  onDossier,
  sansSociete = false,
  // Ajoute un bouton « Toutes » (valeur null) — utilisé par le dashboard, qui
  // sait agréger plusieurs sociétés.
  avecToutes = false,
  actions = null,
  children,
}) => (
  <div className="co-page">
    <header className="co-header">
      <div className="co-header-left">
        <div className="co-header-icon">
          <Icone />
        </div>
        <div>
          <h1>{titre}</h1>
          {sousTitre && <p className="co-header-subtitle">{sousTitre}</p>}
        </div>
      </div>
      <div className="co-header-right">
        {actions}
        {!sansSociete && societes.length > 0 && (
          <div className="co-societes" role="group" aria-label="Mes sociétés">
            {avecToutes && societes.length > 1 && (
              <button
                type="button"
                className={`co-societe-btn ${!dossier ? "active" : ""}`}
                onClick={() => onDossier && onDossier(null)}
                title="Toutes mes sociétés"
              >
                <HiOfficeBuilding />
                Toutes
              </button>
            )}
            {societes.map((s) => (
              <button
                key={s.nomDossierDBF}
                type="button"
                className={`co-societe-btn ${s.nomDossierDBF === dossier ? "active" : ""}`}
                onClick={() => onDossier && onDossier(s.nomDossierDBF)}
                title={`${s.nomComplet} — code vendeur ${s.codes.join(", ")}`}
              >
                <HiOfficeBuilding />
                {s.trigramme}
                <span className="co-societe-code">({s.codes.join("/")})</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </header>

    <nav className="co-nav">
      {NAV.map(({ to, label, icon: I, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) => (isActive ? "active" : "")}
        >
          <I />
          {label}
        </NavLink>
      ))}
    </nav>

    {children}
  </div>
);

export default CommercialShell;
