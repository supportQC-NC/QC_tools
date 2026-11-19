// src/screens/user/userDashboardScreen.jsx
//
// LE tableau de bord — un seul écran pour tout le monde (user, responsable,
// admin). Volontairement MINIMAL depuis le 26/08/2026 : le composeur de widgets
// / tuiles KPI (« Organiser mon tableau de bord ») a été retiré. Il ne reste que
//   1. la société active (parmi celles auxquelles l'utilisateur a accès) ;
//   2. des accès rapides vers ses onglets, qu'il choisit lui-même.
//
// Les raccourcis ne sont qu'une liste de CHEMINS (stockée par
// /api/raccourcis/me) : libellé, icône et surtout DROITS sont recalculés ici
// depuis le catalogue de menu, donc un raccourci vers un module retiré à
// l'utilisateur disparaît de lui-même.

import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useSelector, useDispatch } from "react-redux";
import {
  HiLockClosed,
  HiOfficeBuilding,
  HiAdjustments,
  HiViewGrid,
  HiCheck,
  HiX,
  HiRefresh,
  HiArrowSmRight,
} from "react-icons/hi";
import { getMenuCatalog, catalogItemVisible } from "../../config/menuConfig";
import {
  useGetMesRaccourcisQuery,
  useSetMesRaccourcisMutation,
  useResetMesRaccourcisMutation,
} from "../../slices/raccourcisApiSlice";
import { useGetMyEntreprisesQuery } from "../../slices/entrepriseApiSlice";
import {
  selectGlobalEntreprise,
  setGlobalEntreprise,
} from "../../slices/entrepriseGlobalSlice";
import Modal from "../../components/ui/Modal/Modal";
import "./UserdashboardScreen.css";

const nomSociete = (e) =>
  e ? e.nomComplet || e.nom || e.nomDossierDBF || "" : "";

// Salutation selon l'heure — purement cosmétique.
const salutation = (d) => {
  const h = d.getHours();
  if (h < 5) return "Bonsoir";
  if (h < 12) return "Bonjour";
  if (h < 18) return "Bon après-midi";
  return "Bonsoir";
};

// Teinte des tuiles d'accès rapide : une couleur STABLE par chemin (hachage
// simple), purement décorative — aucune signification métier.
const TUILE_COULEURS = [
  { c: "#4da6ff", bg: "rgba(77, 166, 255, 0.14)" },
  { c: "#8b5cf6", bg: "rgba(139, 92, 246, 0.14)" },
  { c: "#10b981", bg: "rgba(16, 185, 129, 0.14)" },
  { c: "#f59e0b", bg: "rgba(245, 158, 11, 0.14)" },
  { c: "#ec4899", bg: "rgba(236, 72, 153, 0.14)" },
  { c: "#06b6d4", bg: "rgba(6, 182, 212, 0.14)" },
  { c: "#f97316", bg: "rgba(249, 115, 22, 0.14)" },
  { c: "#14b8a6", bg: "rgba(20, 184, 166, 0.14)" },
];
const couleurTuile = (path = "") => {
  let h = 0;
  for (let i = 0; i < path.length; i += 1)
    h = (h * 31 + path.charCodeAt(i)) % 997;
  return TUILE_COULEURS[h % TUILE_COULEURS.length];
};

// ── Choix des raccourcis (modale) ───────────────────────────────────────────
// Liste tous les onglets AUTORISÉS ; cocher = épingler sur l'accueil.
const ChoixRaccourcis = ({ catalogue, selection, onClose, onValider, onReset }) => {
  const [coches, setCoches] = useState(() => new Set(selection));

  const basculer = (path) =>
    setCoches((s) => {
      const next = new Set(s);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  return (
    <Modal onClose={onClose} contentClassName="ud-modal">
      <h3>
        <HiAdjustments /> Choisir mes accès rapides
      </h3>
      <p className="ud-modal-hint">
        Cochez les onglets à épingler sur votre accueil. Sans sélection, tous vos
        onglets sont affichés.
      </p>

      <div className="ud-choix-liste">
        {catalogue.map((c) => (
          <label key={c.path} className="ud-choix">
            <input
              type="checkbox"
              checked={coches.has(c.path)}
              onChange={() => basculer(c.path)}
            />
            <span>{c.label}</span>
          </label>
        ))}
      </div>

      <div className="ud-modal-actions">
        <button type="button" className="ud-btn" onClick={onReset}>
          <HiRefresh /> Tout afficher
        </button>
        <div className="ud-spacer" />
        <button type="button" className="ud-btn" onClick={onClose}>
          <HiX /> Annuler
        </button>
        <button
          type="button"
          className="ud-btn primaire"
          onClick={() => onValider([...coches])}
        >
          <HiCheck /> Enregistrer ({coches.size})
        </button>
      </div>
    </Modal>
  );
};

const UserDashboard = () => {
  const dispatch = useDispatch();
  const { userInfo } = useSelector((s) => s.auth);
  const societe = useSelector(selectGlobalEntreprise);
  const [now, setNow] = useState(new Date());
  const [choixOuvert, setChoixOuvert] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const { data: entreprises } = useGetMyEntreprisesQuery();
  const { data: prefs } = useGetMesRaccourcisQuery();
  const [enregistrer] = useSetMesRaccourcisMutation();
  const [reinitialiser] = useResetMesRaccourcisMutation();

  // Onglets auxquels l'utilisateur a droit (mêmes règles que la sidebar).
  const catalogue = useMemo(
    () => getMenuCatalog().filter((c) => catalogItemVisible(userInfo, c)),
    [userInfo],
  );

  // Raccourcis affichés : la sélection de l'utilisateur, ré-filtrée par ses
  // droits ; sinon (jamais choisi) tous ses onglets.
  const raccourcis = useMemo(() => {
    if (!prefs?.personnalise) return catalogue;
    const voulus = prefs.raccourcis || [];
    const parPath = new Map(catalogue.map((c) => [c.path, c]));
    return voulus.map((p) => parPath.get(p)).filter(Boolean);
  }, [prefs, catalogue]);

  const changerSociete = (ev) => {
    const e = (entreprises || []).find((x) => x._id === ev.target.value);
    if (e) dispatch(setGlobalEntreprise(e));
  };

  const dateStr = now.toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const timeStr = now.toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  return (
    <div className="user-dashboard">
      <header className="ud-hero">
        <div className="ud-hero-main">
          <span className="ud-avatar" aria-hidden="true">
            {(userInfo?.prenom?.charAt(0) || "") + (userInfo?.nom?.charAt(0) || "") || "·"}
          </span>
          <div className="ud-hero-textes">
            <h1 className="ud-title">
              {salutation(now)},{" "}
              <span className="ud-prenom">{userInfo?.prenom || "Utilisateur"}</span>
            </h1>
            <p className="ud-date">{dateStr}</p>
          </div>
        </div>
        <div className="ud-time" title="Heure locale">
          {timeStr}
        </div>
      </header>

      {/* ── Société active ───────────────────────────────────────────────── */}
      <section className="ud-societe">
        <div className="ud-societe-icone">
          <HiOfficeBuilding />
        </div>
        <div className="ud-societe-corps">
          <span className="ud-societe-label">Société active</span>
          {societe ? (
            <span className="ud-societe-nom">
              {societe.trigramme ? (
                <span className="ud-trigramme">{societe.trigramme}</span>
              ) : null}
              {nomSociete(societe)}
            </span>
          ) : (
            <span className="ud-societe-nom vide">Aucune société sélectionnée</span>
          )}
        </div>
        {(entreprises?.length || 0) > 1 ? (
          <select
            className="ud-societe-select"
            value={societe?._id || ""}
            onChange={changerSociete}
            aria-label="Changer de société"
          >
            <option value="">— Choisir —</option>
            {entreprises.map((e) => (
              <option key={e._id} value={e._id}>
                {e.trigramme ? `${e.trigramme} · ` : ""}
                {nomSociete(e)}
              </option>
            ))}
          </select>
        ) : (
          <span className="ud-societe-note">
            {entreprises?.length === 1
              ? "Votre seule société"
              : "Aucune société ne vous est attribuée"}
          </span>
        )}
      </section>

      {/* ── Accès rapides ────────────────────────────────────────────────── */}
      <section className="ud-raccourcis">
        <div className="ud-section-tete">
          <h2>
            Accès rapides
            {raccourcis.length > 0 && (
              <span className="ud-count">{raccourcis.length}</span>
            )}
          </h2>
          <button
            type="button"
            className="ud-btn"
            onClick={() => setChoixOuvert(true)}
          >
            <HiAdjustments /> Choisir
          </button>
        </div>

        {raccourcis.length === 0 ? (
          <div className="ud-empty">
            <HiViewGrid />
            <p>
              Aucun accès rapide. Utilisez « Choisir » pour épingler les onglets
              que vous utilisez le plus.
            </p>
          </div>
        ) : (
          <div className="ud-grid">
            {raccourcis.map((c) => {
              const Icone = c.icon || HiViewGrid;
              const teinte = couleurTuile(c.path);
              return (
                <Link
                  key={c.path}
                  to={c.path}
                  className="ud-card"
                  style={{ "--tc": teinte.c, "--tc-bg": teinte.bg }}
                >
                  <span className="ud-card-icon">
                    <Icone />
                  </span>
                  <span className="ud-card-label">{c.label}</span>
                  <HiArrowSmRight className="ud-card-arrow" />
                </Link>
              );
            })}
          </div>
        )}
      </section>

      <div className="ud-notice">
        <HiLockClosed className="ud-notice-icon" />
        <p>
          <strong>Pensez à vous déconnecter après chaque utilisation.</strong>{" "}
          Chaque compte est personnel et toutes les actions sont tracées. Si un
          autre utilisateur utilise votre session, ses actions seront
          enregistrées à votre nom.
        </p>
      </div>

      {choixOuvert && (
        <ChoixRaccourcis
          catalogue={catalogue}
          selection={prefs?.personnalise ? prefs.raccourcis || [] : []}
          onClose={() => setChoixOuvert(false)}
          onValider={async (liste) => {
            await enregistrer(liste).unwrap();
            setChoixOuvert(false);
          }}
          onReset={async () => {
            await reinitialiser().unwrap();
            setChoixOuvert(false);
          }}
        />
      )}
    </div>
  );
};

export default UserDashboard;
