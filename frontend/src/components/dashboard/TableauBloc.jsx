// src/components/dashboard/TableauBloc.jsx
//
// Visuel « tableau » : le détail des lignes, pas un agrégat. Les colonnes et le
// tri viennent du serveur (déjà filtrés par les droits champ par champ).
// Export CSV du contenu affiché, sans repasser par le serveur.

import React from "react";
import { HiTable, HiDownload } from "react-icons/hi";

const formater = (valeur, type) => {
  if (valeur === null || valeur === undefined || valeur === "") return "—";
  if (type === "booleen") return valeur ? "Oui" : "Non";
  if (type === "nombre") {
    const n = Number(valeur);
    return Number.isFinite(n) ? n.toLocaleString("fr-FR", { maximumFractionDigits: 2 }) : "—";
  }
  return String(valeur);
};

const TableauBloc = ({ bloc, resultat }) => {
  const colonnes = resultat?.colonnes || [];
  const lignes = resultat?.lignes || [];
  const erreur = resultat?.erreur;

  const exporterCsv = () => {
    const entetes = colonnes.map((c) => `"${c.label.replace(/"/g, '""')}"`).join(";");
    const corps = lignes
      .map((l) =>
        colonnes
          .map((c) => {
            const v = l[c.name];
            if (c.type === "nombre") return Number(v) || 0;
            return `"${String(v ?? "").replace(/"/g, '""')}"`;
          })
          .join(";"),
      )
      .join("\n");
    // BOM UTF-8 pour qu'Excel ouvre correctement les accents.
    const blob = new Blob([`﻿${entetes}\n${corps}`], {
      type: "text/csv;charset=utf-8;",
    });
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = `${(bloc.titre || "tableau").replace(/[^\w-]+/g, "_")}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 60000);
  };

  return (
    <section className="db-carte">
      <header className="db-carte-head">
        <h3>
          <HiTable /> {bloc.titre || "Tableau"}
        </h3>
        {!erreur && resultat && (
          <span className="db-carte-sous">
            {lignes.length.toLocaleString("fr-FR")} /{" "}
            {Number(resultat.total || 0).toLocaleString("fr-FR")} ligne(s)
            {lignes.length > 0 && (
              <button
                type="button"
                className="db-mini-export"
                onClick={exporterCsv}
                title="Exporter les lignes affichées en CSV"
              >
                <HiDownload />
              </button>
            )}
          </span>
        )}
      </header>
      <div className="db-carte-body">
        {erreur ? (
          <p className="db-vide">{erreur}</p>
        ) : !resultat ? (
          <p className="db-vide">Calcul en cours…</p>
        ) : lignes.length === 0 ? (
          <p className="db-vide">Aucune ligne.</p>
        ) : (
          <div className="db-tableau-scroll">
            <table className="db-tableau">
              <thead>
                <tr>
                  {colonnes.map((c) => (
                    <th
                      key={c.name}
                      className={c.type === "nombre" ? "num" : ""}
                      title={c.name}
                    >
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lignes.map((l, i) => (
                  <tr key={i}>
                    {colonnes.map((c) => (
                      <td key={c.name} className={c.type === "nombre" ? "num" : ""}>
                        {formater(l[c.name], c.type)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {resultat && resultat.total > lignes.length && (
          <p className="db-tableau-note">
            Seules les {lignes.length} premières lignes sont affichées
            {bloc.champ ? " (tri appliqué sur l'ensemble)" : ""}.
          </p>
        )}
      </div>
    </section>
  );
};

export default TableauBloc;
