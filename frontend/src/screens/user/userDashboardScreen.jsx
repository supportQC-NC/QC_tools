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
      <div className="ud-header">
        <div className="ud-header-left">
          <h1 className="ud-title">Tableau de bord</h1>
          <p className="ud-welcome">
            Bonjour, <strong>{userInfo?.prenom || "Utilisateur"}</strong>
          </p>
        </div>
        <div className="ud-header-right">
          <span className="ud-date">{dateStr}</span>
          <span className="ud-time">{timeStr}</span>
        </div>
      </div>

      {/* ── Société active ───────────────────────────────────────────────── */}
      <section className="ud-societe">
        <div className="ud-societe-icone">
          <HiOfficeBuilding />
        </div>
        <div className="ud-societe-corps">
          <span className="ud-societe-label">Société active</span>
          {societe ? (
            <span className="ud-societe-nom">
              {societe.trigramme ? `${societe.trigramme} · ` : ""}
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
          <h2>Accès rapides</h2>
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
              return (
                <Link key={c.path} to={c.path} className="ud-card">
                  <span className="ud-card-icon">
                    <Icone />
                  </span>
                  <span className="ud-card-label">{c.label}</span>
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
