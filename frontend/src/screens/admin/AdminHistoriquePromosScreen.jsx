// src/screens/admin/AdminHistoriquePromosScreen.jsx
//
// HISTORIQUE PROMOS : restitution des fichiers `<trig>.json` du FTPS
// robot-documents (dossier historique_promos/), un bloc par mois et par
// société, historisés par le robot : CA promo, marge promo, nombre
// d'articles vendus en promo et top 3 des articles du mois.
//
// La société suit la sélection GLOBALE du header. Trois étages :
//   1. sélecteur de mois (pastilles, du plus récent au plus ancien)
//   2. KPI du mois choisi + podium top 3 (NART cliquable vers la page
//      données article, comme l'analyse stock)
//   3. historique : évolution CA/marge par mois (graphique dès 2 mois)
//      + table récapitulative de tous les mois
//
// Montants : fmtMontant (entiers, espaces larges — préférence client).

import React, { useEffect, useMemo, useState } from "react";
import { useSelector } from "react-redux";
import { selectGlobalDossier } from "../../slices/entrepriseGlobalSlice";
import { useGetHistoriquePromosQuery } from "../../slices/historiquePromosApiSlice";
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import { fmtMontant, fmtNombreLarge } from "../../utils/format";
import { BASE_URL } from "../../constants";
import "./AdminHistoriquePromosScreen.css";

// ── Formats ──
const fmtXPF = (n) => (typeof n === "number" ? `${fmtMontant(n)} XPF` : "—");
const fmtPct = (n) => (typeof n === "number" ? `${n.toFixed(1)} %` : "—");
// Les quantités peuvent être décimales (vente au mètre).
const fmtQte = (n) =>
  typeof n !== "number" ? "—" : fmtNombreLarge(n, Number.isInteger(n) ? 0 : 1);
const fmtCompact = (n) => {
  if (typeof n !== "number") return "";
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${(n / 1e9).toFixed(1)} Md`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(1)} M`;
  if (abs >= 1e3) return `${Math.round(n / 1e3)} k`;
  return String(n);
};
// « Octobre 2026 » → « oct. 26 » (axe du graphique).
const labelMoisCourt = (l) => {
  const m = /^(\S+)\s+(\d{4})$/.exec(String(l).trim());
  if (!m) return l;
  return `${m[1].slice(0, 4).toLowerCase()}. ${m[2].slice(2)}`;
};

const MEDAILLES = ["🥇", "🥈", "🥉"];

// Ouvre la PAGE « données article » dans une autre fenêtre.
const ouvrirFiche = (dossier, nart) =>
  window.open(
    `${BASE_URL}/admin/articles/${dossier}/${encodeURIComponent(nart)}`,
    "_blank",
  );

// Couleurs du graphique (thème sombre admin, mêmes repères qu'ailleurs).
const CH = {
  grille: "#2a2a3a",
  axe: "#a7a7b8",
  ca: "#4da6ff",
  marge: "#34d399",
};

const AdminHistoriquePromosScreen = () => {
  const dossier = useSelector(selectGlobalDossier) || "";
  const [periode, setPeriode] = useState("");

  const { data, isFetching, error } = useGetHistoriquePromosQuery(
    { nomDossierDBF: dossier },
    { skip: !dossier },
  );

  // Mois affiché : celui choisi s'il existe encore, sinon le plus récent.
  useEffect(() => {
    setPeriode("");
  }, [dossier]);
  const mois = data?.mois || [];
  const moisActif = useMemo(
    () => mois.find((m) => m.periode === periode) || mois[0] || null,
    [mois, periode],
  );

  // Données du graphique, du plus ancien au plus récent.
  const serie = useMemo(
    () =>
      [...mois].reverse().map((m) => ({
        mois: labelMoisCourt(m.libelle),
        caPromo: m.caPromo,
        margePromo: m.margePromo,
      })),
    [mois],
  );

  if (!dossier) {
    return (
      <div className="hpr-screen">
        <h1 className="hpr-titre">🏷️ Historique promos</h1>
        <p className="hpr-info">Sélectionnez une société dans l'en-tête.</p>
      </div>
    );
  }

  return (
    <div className="hpr-screen">
      <div className="hpr-entete">
        <div>
          <h1 className="hpr-titre">
            🏷️ Historique promos — {data?.source?.label || dossier}
          </h1>
          <p className="hpr-sous-titre">
            Bilan mensuel des promotions historisé par le robot : chiffre
            d'affaires et marge réalisés sur les articles en promotion, et top
            3 des articles du mois.
          </p>
        </div>
        {isFetching && <span className="hpr-chargement">chargement…</span>}
      </div>

      {error && (
        <p className="hpr-erreur">
          {error?.data?.message || "Historique des promotions inaccessible."}
        </p>
      )}

      {!error && data && mois.length === 0 && (
        <p className="hpr-info">
          Aucun mois historisé pour cette société — le robot ajoute un bilan à
          chaque début de mois.
        </p>
      )}

      {!error && moisActif && (
        <>
          {/* Sélecteur de mois */}
          <div className="hpr-periodes">
            {mois.map((m) => (
              <button
                key={m.periode}
                type="button"
                className={`hpr-periode${m.periode === moisActif.periode ? " actif" : ""}`}
                onClick={() => setPeriode(m.periode)}
              >
                {m.libelle}
              </button>
            ))}
          </div>

          {/* KPI du mois */}
          <div className="hpr-kpis">
            <div className="hpr-kpi">
              <span className="hpr-kpi-label">CA promo</span>
              <span className="hpr-kpi-valeur">{fmtXPF(moisActif.caPromo)}</span>
            </div>
            <div className="hpr-kpi">
              <span className="hpr-kpi-label">Marge promo</span>
              <span className="hpr-kpi-valeur hpr-vert">
                {fmtXPF(moisActif.margePromo)}
              </span>
              <span className="hpr-kpi-detail">
                taux {fmtPct(moisActif.tauxMarge)}
              </span>
            </div>
            <div className="hpr-kpi">
              <span className="hpr-kpi-label">Articles vendus en promo</span>
              <span className="hpr-kpi-valeur">
                {fmtMontant(moisActif.nbArticlesVendus)}
              </span>
            </div>
            <div className="hpr-kpi">
              <span className="hpr-kpi-label">Historisé le</span>
              <span className="hpr-kpi-valeur hpr-kpi-date">
                {moisActif.enregistreLe || "—"}
              </span>
            </div>
          </div>

          {/* Top 3 du mois */}
          <div className="hpr-card">
            <h3 className="hpr-card-titre">
              Top 3 des articles en promotion — {moisActif.libelle}
            </h3>
            {moisActif.top3.length === 0 ? (
              <p className="hpr-info">Aucune vente en promotion ce mois-ci.</p>
            ) : (
              <div className="hpr-table-wrap">
                <table className="hpr-table">
                  <thead>
                    <tr>
                      <th className="gauche"> </th>
                      <th className="gauche">Article</th>
                      <th className="gauche">Période promo</th>
                      <th>Qté</th>
                      <th>Factures</th>
                      <th>CA</th>
                      <th>Marge</th>
                      <th>Taux</th>
                    </tr>
                  </thead>
                  <tbody>
                    {moisActif.top3.map((t, i) => (
                      <tr key={t.nart || i}>
                        <td className="gauche hpr-medaille">
                          {MEDAILLES[t.rang - 1] || t.rang}
                        </td>
                        <td className="gauche">
                          <button
                            type="button"
                            className="hpr-nart"
                            onClick={() => ouvrirFiche(dossier, t.nart)}
                            title="Ouvrir la page données article"
                          >
                            {t.nart}
                          </button>
                          <span className="hpr-designation">
                            {t.designation}
                          </span>
                        </td>
                        <td className="gauche hpr-periode-promo">
                          {t.debutPromo} → {t.finPromo}
                        </td>
                        <td>{fmtQte(t.qte)}</td>
                        <td>{fmtMontant(t.nbFactures)}</td>
                        <td>{fmtMontant(t.ca)}</td>
                        <td className="hpr-vert">{fmtMontant(t.marge)}</td>
                        <td>{fmtPct(t.tauxMarge)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Évolution mensuelle — le graphique n'a de sens qu'à partir de
              deux mois ; la table récapitule toujours tout l'historique. */}
          <div className="hpr-card">
            <h3 className="hpr-card-titre">Évolution mensuelle</h3>
            {serie.length >= 2 && (
              <ResponsiveContainer width="100%" height={260}>
                <ComposedChart data={serie} margin={{ top: 8, right: 16 }}>
                  <CartesianGrid stroke={CH.grille} vertical={false} />
                  <XAxis
                    dataKey="mois"
                    stroke={CH.axe}
                    tick={{ fontSize: 12 }}
                  />
                  <YAxis
                    stroke={CH.axe}
                    tick={{ fontSize: 12 }}
                    tickFormatter={fmtCompact}
                  />
                  <Tooltip
                    formatter={(v, n) => [
                      fmtXPF(v),
                      n === "caPromo" ? "CA promo" : "Marge promo",
                    ]}
                    contentStyle={{
                      background: "#1b1b2a",
                      border: "1px solid #2a2a3a",
                      borderRadius: 8,
                    }}
                  />
                  <Legend
                    formatter={(n) =>
                      n === "caPromo" ? "CA promo" : "Marge promo"
                    }
                  />
                  <Bar dataKey="caPromo" fill={CH.ca} radius={[3, 3, 0, 0]} />
                  <Line
                    dataKey="margePromo"
                    stroke={CH.marge}
                    strokeWidth={2}
                    dot={{ r: 3 }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            )}
            <div className="hpr-table-wrap">
              <table className="hpr-table">
                <thead>
                  <tr>
                    <th className="gauche">Mois</th>
                    <th>CA promo</th>
                    <th>Marge promo</th>
                    <th>Taux</th>
                    <th>Articles vendus</th>
                    <th className="gauche">Meilleur article</th>
                  </tr>
                </thead>
                <tbody>
                  {mois.map((m) => (
                    <tr
                      key={m.periode}
                      className={
                        m.periode === moisActif.periode ? "hpr-ligne-active" : ""
                      }
                      onClick={() => setPeriode(m.periode)}
                    >
                      <td className="gauche">{m.libelle}</td>
                      <td>{fmtMontant(m.caPromo)}</td>
                      <td className="hpr-vert">{fmtMontant(m.margePromo)}</td>
                      <td>{fmtPct(m.tauxMarge)}</td>
                      <td>{fmtMontant(m.nbArticlesVendus)}</td>
                      <td className="gauche hpr-designation">
                        {m.top3[0]?.designation || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default AdminHistoriquePromosScreen;
