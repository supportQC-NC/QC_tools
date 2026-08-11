// src/components/dashboard/GraphiqueBloc.jsx
//
// Rendu d'un graphique configuré par l'utilisateur. Les données viennent
// déjà agrégées du serveur : [{ libelle, valeur }], triées et limitées, avec
// un groupe « Autres » quand il y a plus de groupes que la limite.

import React from "react";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { formaterValeur, PALETTE_GRAPHIQUE } from "../../config/dashboardCatalogue";

const HAUTEUR = 260;

const GraphiqueBloc = ({ bloc, resultat }) => {
  const series = resultat?.series || [];
  const erreur = resultat?.erreur;

  // Le serveur renvoie toujours une liste de séries : ["valeur"] sans
  // ventilation, les valeurs distinctes du champ de ventilation sinon. Le rendu
  // est donc identique dans les deux cas.
  const cles = resultat?.clesSeries?.length ? resultat.clesSeries : ["valeur"];
  const ventile = !!resultat?.ventile && cles.length > 1;
  const pileId = ventile && bloc.empile ? "pile" : undefined;

  const formatteur = (v) => formaterValeur(v, bloc.format);
  const nomSerie = (cle) => (cle === "valeur" ? bloc.titre || "Valeur" : cle);

  const corps = () => {
    if (erreur) return <p className="db-vide">{erreur}</p>;
    if (!resultat) return <p className="db-vide">Calcul en cours…</p>;
    if (series.length === 0) return <p className="db-vide">Aucune donnée.</p>;

    if (bloc.typeGraphique === "camembert") {
      return (
        <ResponsiveContainer width="100%" height={HAUTEUR}>
          <PieChart>
            <Pie
              data={series}
              dataKey="valeur"
              nameKey="libelle"
              outerRadius="78%"
              label={false}
            >
              {series.map((s, i) => (
                <Cell key={s.libelle} fill={PALETTE_GRAPHIQUE[i % PALETTE_GRAPHIQUE.length]} />
              ))}
            </Pie>
            <Tooltip formatter={formatteur} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
          </PieChart>
        </ResponsiveContainer>
      );
    }

    const axes = (
      <>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
        <XAxis
          dataKey="libelle"
          stroke="var(--text-muted)"
          fontSize={10}
          interval={0}
          angle={-25}
          textAnchor="end"
          height={70}
        />
        <YAxis stroke="var(--text-muted)" fontSize={10} />
        <Tooltip formatter={formatteur} />
      </>
    );

    // Couleur d'une série : la couleur du bloc quand il n'y en a qu'une,
    // la palette sinon.
    const couleurDe = (cle, i) =>
      ventile ? PALETTE_GRAPHIQUE[i % PALETTE_GRAPHIQUE.length] : bloc.couleur;

    const legende = ventile ? <Legend wrapperStyle={{ fontSize: 11 }} /> : null;

    if (bloc.typeGraphique === "lignes") {
      return (
        <ResponsiveContainer width="100%" height={HAUTEUR}>
          <LineChart data={series}>
            {axes}
            {legende}
            {cles.map((cle, i) => (
              <Line
                key={cle}
                type="monotone"
                dataKey={cle}
                name={nomSerie(cle)}
                stroke={couleurDe(cle, i)}
                strokeWidth={2}
                dot={{ r: 2 }}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      );
    }

    if (bloc.typeGraphique === "aires") {
      return (
        <ResponsiveContainer width="100%" height={HAUTEUR}>
          <AreaChart data={series}>
            <defs>
              {cles.map((cle, i) => (
                <linearGradient key={cle} id={`deg-${bloc.id}-${i}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={couleurDe(cle, i)} stopOpacity={0.4} />
                  <stop offset="95%" stopColor={couleurDe(cle, i)} stopOpacity={0} />
                </linearGradient>
              ))}
            </defs>
            {axes}
            {legende}
            {cles.map((cle, i) => (
              <Area
                key={cle}
                type="monotone"
                dataKey={cle}
                name={nomSerie(cle)}
                stackId={pileId}
                stroke={couleurDe(cle, i)}
                fill={`url(#deg-${bloc.id}-${i})`}
                strokeWidth={2}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      );
    }

    return (
      <ResponsiveContainer width="100%" height={HAUTEUR}>
        <BarChart data={series}>
          {axes}
          {legende}
          {cles.map((cle, i) => (
            <Bar
              key={cle}
              dataKey={cle}
              name={nomSerie(cle)}
              stackId={pileId}
              fill={couleurDe(cle, i)}
              radius={pileId ? undefined : [4, 4, 0, 0]}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    );
  };

  return (
    <section className="db-carte">
      <header className="db-carte-head">
        <h3>{bloc.titre || "Graphique"}</h3>
        {!erreur && resultat && (
          <span className="db-carte-sous">
            {Number(resultat.lignes || 0).toLocaleString("fr-FR")} ligne(s)
            {resultat.groupes > series.length
              ? ` · ${resultat.groupes} groupes`
              : ""}
            {resultat.seriesCumulees > 0
              ? ` · ${resultat.seriesCumulees} séries cumulées`
              : ""}
          </span>
        )}
      </header>
      <div className="db-carte-body">{corps()}</div>
    </section>
  );
};

export default GraphiqueBloc;
