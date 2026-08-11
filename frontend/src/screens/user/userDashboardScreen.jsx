// src/screens/user/userDashboardScreen.jsx
//
// LE tableau de bord — un seul écran pour tout le monde (user, responsable,
// admin). Son contenu est la disposition personnelle de l'utilisateur
// (GET /api/dashboard-layout/me), déjà filtrée par ses droits côté serveur.
// La composition se fait dans « Organiser mon tableau de bord » (/mon-dashboard).

import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useSelector } from "react-redux";
import { HiLockClosed, HiAdjustments, HiViewGrid } from "react-icons/hi";
import {
  useGetMonDashboardQuery,
  useEvaluerKpisQuery,
} from "../../slices/dashboardLayoutApiSlice";
import { selectGlobalDossier } from "../../slices/entrepriseGlobalSlice";
import RENDUS from "../../components/dashboard/DashboardWidgets";
import GraphiqueBloc from "../../components/dashboard/GraphiqueBloc";
import TableauBloc from "../../components/dashboard/TableauBloc";
import { ICONES_KPI, formaterValeur } from "../../config/dashboardCatalogue";
import "./UserdashboardScreen.css";

// Tuile KPI composée par l'utilisateur.
const TuileKpi = ({ bloc, resultat }) => {
  const Icone = ICONES_KPI[bloc.icone] || ICONES_KPI.HiChartBar;
  const erreur = resultat?.erreur;
  return (
    <div className="db-tuile" style={{ borderTopColor: bloc.couleur }}>
      <div
        className="db-tuile-icone"
        style={{ background: `${bloc.couleur}22`, color: bloc.couleur }}
      >
        <Icone />
      </div>
      <div className="db-tuile-corps">
        <span className="db-tuile-valeur">
          {erreur ? "—" : formaterValeur(resultat?.valeur, bloc.format)}
        </span>
        <span className="db-tuile-titre">{bloc.titre || "Sans titre"}</span>
        <span className="db-tuile-sous">
          {erreur || (
            resultat ? `${Number(resultat.lignes || 0).toLocaleString("fr-FR")} ligne(s)` : "…"
          )}
        </span>
      </div>
    </div>
  );
};

const UserDashboard = () => {
  const { userInfo } = useSelector((s) => s.auth);
  const dossier = useSelector(selectGlobalDossier) || "";
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const { data, isLoading } = useGetMonDashboardQuery();
  const pages = useMemo(() => data?.pages || [], [data]);
  const [pageActive, setPageActive] = useState(0);

  // La page courante peut disparaître (droits retirés, page supprimée
  // ailleurs) : on retombe sur la première.
  const indexPage = pageActive < pages.length ? pageActive : 0;
  const blocs = useMemo(
    () => pages[indexPage]?.blocs || [],
    [pages, indexPage],
  );

  // Tuiles ET graphiques sont évalués en un seul appel groupé.
  const blocsCalcules = useMemo(
    () =>
      blocs.filter((b) =>
        ["kpi", "graphique", "tableau"].includes(b.type),
      ),
    [blocs],
  );
  const { data: evaluation } = useEvaluerKpisQuery(
    { blocs: blocsCalcules, nomDossierDBF: dossier },
    { skip: blocsCalcules.length === 0 },
  );
  const resultatParId = useMemo(() => {
    const m = new Map();
    for (const r of evaluation?.resultats || []) m.set(r.id, r);
    return m;
  }, [evaluation]);

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
          <Link to="/mon-dashboard" className="ud-config-link">
            <HiAdjustments /> Organiser
          </Link>
          <span className="ud-date">{dateStr}</span>
          <span className="ud-time">{timeStr}</span>
        </div>
      </div>

      {isLoading ? (
        <div className="db-chargement">Chargement du tableau de bord…</div>
      ) : blocs.length === 0 ? (
        <div className="db-vide-total">
          <HiViewGrid />
          <h2>Votre tableau de bord est vide</h2>
          <p>
            Composez-le depuis « Organiser mon tableau de bord » : widgets prêts
            à l'emploi et tuiles chiffrées sur mesure.
          </p>
          <Link to="/mon-dashboard" className="db-bouton">
            <HiAdjustments /> Organiser mon tableau de bord
          </Link>
        </div>
      ) : (
        <>
        {pages.length > 1 && (
          <nav className="db-onglets">
            {pages.map((p, i) => (
              <button
                key={p.id}
                type="button"
                className={`db-onglet ${i === indexPage ? "actif" : ""}`}
                onClick={() => setPageActive(i)}
              >
                {p.nom}
                <span className="db-onglet-nb">{p.blocs.length}</span>
              </button>
            ))}
          </nav>
        )}
        <div className="db-grille">
          {blocs.map((b) => {
            // Grille 12 colonnes : largeur et hauteur portées par le bloc.
            const style = {
              gridColumn: `span ${Math.min(12, Math.max(1, b.w || 4))}`,
              gridRow: `span ${Math.min(12, Math.max(1, b.h || 3))}`,
            };
            const resultat = resultatParId.get(b.id);

            let contenu = null;
            if (b.type === "kpi") contenu = <TuileKpi bloc={b} resultat={resultat} />;
            else if (b.type === "graphique")
              contenu = <GraphiqueBloc bloc={b} resultat={resultat} />;
            else if (b.type === "tableau")
              contenu = <TableauBloc bloc={b} resultat={resultat} />;
            else {
              const Rendu = RENDUS[b.source];
              if (Rendu) contenu = <Rendu />;
            }
            if (!contenu) return null;

            return (
              <div key={b.id} className="db-bloc" style={style}>
                {contenu}
              </div>
            );
          })}
        </div>
        </>
      )}

      <div className="ud-notice">
        <HiLockClosed className="ud-notice-icon" />
        <p>
          <strong>Pensez à vous déconnecter après chaque utilisation.</strong>{" "}
          Chaque compte est personnel et toutes les actions sont tracées. Si un
          autre utilisateur utilise votre session, ses actions seront
          enregistrées à votre nom.
        </p>
      </div>
    </div>
  );
};

export default UserDashboard;
