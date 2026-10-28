// src/screens/admin/AdminAnalyseCaMensuelleScreen.jsx
//
// ANALYSE CA MENSUELLE : restitue INTÉGRALEMENT les classeurs Excel déposés
// chaque mois sur le Rcommun (STOCK/doc_temp/CA_MENSUELLE), un par société —
// un onglet d'écran par feuille du classeur (Types de client, Clients,
// Fournisseurs, Classes, Sous-classes, Locates, Groupes, Familles,
// Sous-familles, Rayons, Clients internes). Les feuilles sont volumineuses
// (4 000+ lignes côté Clients chez QC) : recherche, tri par colonne et
// pagination, lignes TOTAL épinglées en bas.
//
// La société suit la sélection GLOBALE du header ; les pourcentages arrivent
// déjà normalisés en 0–100 par le backend.

import React, { useMemo, useState } from "react";
import { useSelector } from "react-redux";
import { selectGlobalDossier } from "../../slices/entrepriseGlobalSlice";
import {
  useGetAnalyseCaMensuelleSourcesQuery,
  useGetAnalyseCaMensuelleClasseurQuery,
} from "../../slices/analyseCaMensuelleApiSlice";
import "./AdminAnalyseCaMensuelleScreen.css";

const PAGE_SIZE = 100;

// Libellés d'onglet plus lisibles que les noms de feuille Excel.
const LABELS_FEUILLES = {
  TYPES_CLIENT: "Types de client",
  Client: "Clients",
  Fournisseurs: "Fournisseurs",
  Classes: "Classes",
  Sous_Classes: "Sous-classes",
  Locates: "Locates",
  Groupes: "Groupes",
  Familles: "Familles",
  Sous_Familles: "Sous-familles",
  Rayons: "Rayons",
  Client_Interne: "Clients internes",
};

// ── Formats ──
const fmtNb = (n, dec = 0) =>
  new Intl.NumberFormat("fr-FR", { maximumFractionDigits: dec }).format(n);
const fmtPct = (n) => `${fmtNb(n, 1)} %`;

const sansAccents = (s) =>
  String(s)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

// "2026-09" -> "Septembre 2026"
const MOIS_FR = [
  "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
  "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre",
];
const labelPeriode = (p) => {
  const [a, m] = String(p).split("-");
  return `${MOIS_FR[Number(m) - 1] || m} ${a}`;
};

// Une ligne TOTAL ? Se reconnaît à sa PREMIÈRE colonne : les lignes de données
// y portent un numéro (#/Rang) — un client « TOTAL ENERGIES… » (colonne 2)
// n'est PAS un total.
const estLigneTotal = (l) =>
  typeof l[0] === "string" && /^TOTAL/i.test(l[0].trim());

// Formatage d'une cellule selon la colonne (et la ligne pour TYPES_CLIENT).
// Un pourcentage d'ÉVOLUTION (Évol., R/H) se colore vert/rouge ; un taux ou
// une part reste neutre.
function Cellule({ valeur, colonne, pct, colore }) {
  if (valeur === null || valeur === undefined || valeur === "") {
    return <>—</>;
  }
  if (typeof valeur !== "number") return <>{String(valeur)}</>;

  if (colonne.format === "pct" || pct) {
    const colorer = colore || /evol|r\/h/.test(sansAccents(colonne.label));
    return colorer ? (
      <span className={valeur < 0 ? "neg" : "pos"}>{fmtPct(valeur)}</span>
    ) : (
      <>{fmtPct(valeur)}</>
    );
  }
  if (/\(XPF\)/i.test(colonne.label)) {
    return <span className={valeur < 0 ? "neg" : ""}>{fmtNb(valeur)}</span>;
  }
  // Nombre générique : 2 décimales maxi (NUC, prix moyens…).
  return <>{fmtNb(valeur, 2)}</>;
}

const AdminAnalyseCaMensuelleScreen = () => {
  const globalDossier = useSelector(selectGlobalDossier) || "";

  const [periode, setPeriode] = useState(null); // null = plus récente
  const [ongletActif, setOngletActif] = useState(null);
  const [filtre, setFiltre] = useState("");
  const [tri, setTri] = useState(null); // { index, dir: 1|-1 }
  const [page, setPage] = useState(0);

  const { data: sources } = useGetAnalyseCaMensuelleSourcesQuery();
  const sourceGlobale = (sources?.societes || []).find(
    (s) => s.nomDossierDBF === globalDossier,
  );

  const {
    data,
    isFetching: busy,
    error,
  } = useGetAnalyseCaMensuelleClasseurQuery(
    { nomDossierDBF: globalDossier, periode },
    { skip: !globalDossier },
  );

  const feuilles = useMemo(
    () => (data?.feuilles || []).filter((f) => f.lignes.length > 0),
    [data],
  );
  const feuille =
    feuilles.find((f) => f.nom === ongletActif) || feuilles[0] || null;

  const changerOnglet = (nom) => {
    setOngletActif(nom);
    setFiltre("");
    setTri(null);
    setPage(0);
  };

  // TYPES_CLIENT : les lignes « % » se repèrent à la MÉTRIQUE (2e colonne).
  const estTypesClient = feuille?.nom === "TYPES_CLIENT";
  const indexMetrique = 1;

  // Filtre + tri + pagination, lignes TOTAL épinglées hors pagination.
  const { lignesPage, totaux, nbFiltre, nbPages } = useMemo(() => {
    if (!feuille) return { lignesPage: [], totaux: [], nbFiltre: 0, nbPages: 0 };

    const totaux = feuille.lignes.filter(estLigneTotal);
    let donnees = feuille.lignes.filter((l) => !estLigneTotal(l));

    if (filtre.trim()) {
      const mots = sansAccents(filtre).split(/\s+/).filter(Boolean);
      donnees = donnees.filter((l) => {
        const texte = sansAccents(
          l.filter((v) => typeof v === "string").join(" "),
        );
        return mots.every((m) => texte.includes(m));
      });
    }

    if (tri) {
      const { index, dir } = tri;
      donnees = [...donnees].sort((a, b) => {
        const va = a[index];
        const vb = b[index];
        if (va === null || va === undefined || va === "") return 1;
        if (vb === null || vb === undefined || vb === "") return -1;
        if (typeof va === "number" && typeof vb === "number") {
          return (va - vb) * dir;
        }
        return String(va).localeCompare(String(vb), "fr") * dir;
      });
    }

    const nbPages = Math.max(1, Math.ceil(donnees.length / PAGE_SIZE));
    const p = Math.min(page, nbPages - 1);
    return {
      lignesPage: donnees.slice(p * PAGE_SIZE, (p + 1) * PAGE_SIZE),
      totaux,
      nbFiltre: donnees.length,
      nbPages,
    };
  }, [feuille, filtre, tri, page]);

  const pageCourante = Math.min(page, Math.max(0, nbPages - 1));

  const trierPar = (index) => {
    setPage(0);
    setTri((t) =>
      t && t.index === index
        ? t.dir === 1
          ? { index, dir: -1 }
          : null
        : { index, dir: 1 },
    );
  };

  const periodes = data?.source?.periodes || sourceGlobale?.periodes || [];

  return (
    <div className="acm-screen">
      <header className="acm-header">
        <h1 className="acm-title">Analyse CA mensuelle</h1>
        <p className="acm-subtitle">
          Restitution complète du classeur d'analyse mensuel de la société :
          types de client, clients, fournisseurs, classes et sous-classes,
          locates, groupes, familles et sous-familles, rayons, clients internes.
        </p>
      </header>

      <section className="acm-toolbar">
        {periodes.length > 0 && (
          <label className="acm-field">
            Période
            <select
              value={periode ?? data?.source?.periode ?? ""}
              onChange={(e) => {
                setPeriode(e.target.value);
                setPage(0);
              }}
            >
              {periodes.map((p) => (
                <option key={p} value={p}>
                  {labelPeriode(p)}
                </option>
              ))}
            </select>
          </label>
        )}
        {data && (
          <span className="acm-meta">
            Source : <code>{data.fichier}</code> —{" "}
            {data.source?.label} ({data.source?.trigramme})
          </span>
        )}
      </section>

      {sources && !sources.accessible && (
        <div className="acm-alert acm-alert-error">
          Le dossier des analyses mensuelles est inaccessible (
          <code>{sources.dossier}</code>). Vérifier le partage réseau
          (Rcommun\STOCK\doc_temp\CA_MENSUELLE).
        </div>
      )}

      {!globalDossier && (
        <div className="acm-empty">
          Sélectionnez une société (en haut de page) pour commencer.
        </div>
      )}

      {error && (
        <div className="acm-alert acm-alert-error">
          {error?.data?.message || "Impossible de charger l'analyse mensuelle."}
        </div>
      )}

      {busy && <div className="acm-loading">Chargement du classeur…</div>}

      {!busy && data && feuilles.length > 0 && (
        <>
          <nav className="acm-tabs">
            {feuilles.map((f) => (
              <button
                key={f.nom}
                type="button"
                className={`acm-tab ${feuille?.nom === f.nom ? "actif" : ""}`}
                onClick={() => changerOnglet(f.nom)}
              >
                {LABELS_FEUILLES[f.nom] || f.nom}
                <span className="acm-tab-count">
                  {fmtNb(f.lignes.filter((l) => !estLigneTotal(l)).length)}
                </span>
              </button>
            ))}
          </nav>

          {feuille && (
            <>
              <div className="acm-sheetbar">
                <h2 className="acm-sheet-title">{feuille.titre || feuille.nom}</h2>
                <input
                  type="search"
                  className="acm-search"
                  placeholder="Rechercher…"
                  value={filtre}
                  onChange={(e) => {
                    setFiltre(e.target.value);
                    setPage(0);
                  }}
                />
                <div className="acm-pager">
                  <span>
                    {fmtNb(nbFiltre)} ligne{nbFiltre > 1 ? "s" : ""}
                  </span>
                  {nbPages > 1 && (
                    <>
                      <button
                        type="button"
                        onClick={() => setPage((p) => Math.max(0, p - 1))}
                        disabled={pageCourante === 0}
                      >
                        ←
                      </button>
                      <span>
                        {pageCourante + 1} / {nbPages}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setPage((p) => Math.min(nbPages - 1, p + 1))
                        }
                        disabled={pageCourante >= nbPages - 1}
                      >
                        →
                      </button>
                    </>
                  )}
                </div>
              </div>

              <div className="acm-table-wrap">
                <table className="acm-table">
                  <thead>
                    <tr>
                      {feuille.colonnes.map((c, i) => (
                        <th
                          key={`${c.label}-${i}`}
                          onClick={() => trierPar(i)}
                          title="Trier"
                        >
                          {c.label}
                          {tri?.index === i && (
                            <span className="acm-sort">
                              {tri.dir === 1 ? "▲" : "▼"}
                            </span>
                          )}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {lignesPage.map((l, li) => {
                      // Séparation visuelle des blocs TYPES_CLIENT.
                      const nouveauGroupe =
                        estTypesClient &&
                        li > 0 &&
                        l[0] !== lignesPage[li - 1][0];
                      const metrique = estTypesClient
                        ? String(l[indexMetrique] ?? "")
                        : "";
                      const pctLigne = /%/.test(metrique);
                      const coloreLigne = /r\/h/i.test(metrique);
                      return (
                        <tr
                          key={li}
                          className={nouveauGroupe ? "acm-row-groupe" : ""}
                        >
                          {l.map((v, ci) => (
                            <td
                              key={ci}
                              className={
                                typeof v === "string" ? "gauche" : undefined
                              }
                            >
                              <Cellule
                                valeur={v}
                                colonne={feuille.colonnes[ci]}
                                pct={pctLigne && ci > indexMetrique}
                                colore={coloreLigne && ci > indexMetrique}
                              />
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                    {totaux.map((l, li) => {
                      const metrique = estTypesClient
                        ? String(l[indexMetrique] ?? "")
                        : "";
                      return (
                        <tr
                          key={`total-${li}`}
                          className={`acm-row-total${li === 0 ? " acm-row-total-debut" : ""}`}
                        >
                          {l.map((v, ci) => (
                            <td
                              key={ci}
                              className={
                                typeof v === "string" ? "gauche" : undefined
                              }
                            >
                              <Cellule
                                valeur={v}
                                colonne={feuille.colonnes[ci]}
                                pct={/%/.test(metrique) && ci > indexMetrique}
                                colore={
                                  /r\/h/i.test(metrique) && ci > indexMetrique
                                }
                              />
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}

      {!busy && data && feuilles.length === 0 && (
        <div className="acm-empty">Le classeur ne contient aucune donnée.</div>
      )}
    </div>
  );
};

export default AdminAnalyseCaMensuelleScreen;
