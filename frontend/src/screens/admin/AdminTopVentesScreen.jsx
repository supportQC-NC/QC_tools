import React, { useState, useMemo } from "react";
import { useSelector } from "react-redux";
import {
  HiTrendingUp,
  HiOfficeBuilding,
  HiViewGrid,
  HiSearch,
  HiRefresh,
  HiX,
  HiChevronUp,
  HiChevronDown,
} from "react-icons/hi";
import { selectGlobalDossier, selectGlobalEntreprise } from "../../slices/entrepriseGlobalSlice";
import {
  useGetTopVenteSyntheseQuery,
  useGetTopVenteDetailQuery,
} from "../../slices/topVentesApiSlice";
import "./AdminTopVentesScreen.css";

const nf = new Intl.NumberFormat("fr-FR");
const fmtInt = (n) => nf.format(Math.round(Number(n) || 0));
const fmtMoney = (n) => `${nf.format(Math.round(Number(n) || 0))} F`;
const fmtMarge = (n) => (n === null || n === undefined ? "—" : `×${Number(n).toFixed(2)}`);

// En-tête de colonne triable.
const Th = ({ label, field, sort, dir, onSort, num }) => (
  <th className={num ? "num" : ""} onClick={() => onSort(field)}>
    {label}
    {sort === field && (
      <span className="arrow">{dir === "asc" ? <HiChevronUp /> : <HiChevronDown />}</span>
    )}
  </th>
);

// ════════════════════════════════════════════════════════════════════════════
const AdminTopVentesScreen = () => {
  const dossier = useSelector(selectGlobalDossier) || "";
  const entreprise = useSelector(selectGlobalEntreprise);

  const [groupBy, setGroupBy] = useState("fournisseur");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("caAnnee");
  const [dir, setDir] = useState("desc");
  const [drill, setDrill] = useState(null); // { type, code, label }

  const { data, isLoading, isFetching, error, refetch } =
    useGetTopVenteSyntheseQuery({ nomDossierDBF: dossier, groupBy }, { skip: !dossier });

  const onSort = (field) => {
    if (sort === field) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSort(field);
      setDir("desc");
    }
  };

  const lignes = useMemo(() => {
    let rows = data?.lignes || [];
    if (search) {
      const s = search.toLowerCase();
      rows = rows.filter(
        (l) =>
          String(l.code).toLowerCase().includes(s) ||
          (l.label || "").toLowerCase().includes(s),
      );
    }
    const sorted = [...rows].sort((a, b) => {
      const av = a[sort] ?? 0;
      const bv = b[sort] ?? 0;
      if (typeof av === "string" || typeof bv === "string") {
        return String(av).localeCompare(String(bv)) * (dir === "asc" ? 1 : -1);
      }
      return (av - bv) * (dir === "asc" ? 1 : -1);
    });
    return sorted;
  }, [data, search, sort, dir]);

  if (!dossier) {
    return (
      <div className="tv-wrap">
        <div className="tv-head">
          <h1>
            <HiTrendingUp /> Top Ventes
          </h1>
        </div>
        <div className="tv-empty">
          Sélectionnez une société dans l'en-tête pour afficher le classement des ventes.
        </div>
      </div>
    );
  }

  return (
    <div className="tv-wrap">
      <div className="tv-head">
        <h1>
          <HiTrendingUp /> Top Ventes
        </h1>
        <div className="tv-soc">
          Société : <b>{entreprise?.nomComplet || dossier}</b>
        </div>
      </div>

      <div className="tv-toolbar">
        <div className="tv-seg">
          <button
            className={groupBy === "fournisseur" ? "active" : ""}
            onClick={() => setGroupBy("fournisseur")}
          >
            <HiOfficeBuilding style={{ verticalAlign: "-2px" }} /> Par fournisseur
          </button>
          <button
            className={groupBy === "rayon" ? "active" : ""}
            onClick={() => setGroupBy("rayon")}
          >
            <HiViewGrid style={{ verticalAlign: "-2px" }} /> Par rayon
          </button>
        </div>
        <div style={{ position: "relative" }}>
          <HiSearch
            style={{ position: "absolute", left: 10, top: 10, color: "#94a3b8" }}
          />
          <input
            className="tv-input"
            style={{ paddingLeft: 32 }}
            placeholder={`Rechercher un ${groupBy}…`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <button className="tv-btn" onClick={() => refetch()} disabled={isFetching}>
          <HiRefresh /> Rafraîchir
        </button>
        <div className="tv-spacer" />
        <span className="tv-soc">
          Classement basé sur les ventes des 12 derniers mois (fiche article)
        </span>
      </div>

      {/* KPIs */}
      <div className="tv-kpis">
        <div className="tv-kpi">
          <div className="lbl">CA annuel total (estimé)</div>
          <div className="val">{fmtMoney(data?.totaux?.caAnnee)}</div>
        </div>
        <div className="tv-kpi">
          <div className="lbl">Ventes totales (qté)</div>
          <div className="val">{fmtInt(data?.totaux?.venteAnnee)}</div>
        </div>
        <div className="tv-kpi">
          <div className="lbl">{groupBy === "rayon" ? "Rayons" : "Fournisseurs"}</div>
          <div className="val">{fmtInt(data?.nbGroupes)}</div>
        </div>
      </div>

      {error && <div className="tv-empty">Erreur de chargement.</div>}

      <div className="tv-tablewrap">
        <table className="tv-table">
          <thead>
            <tr>
              <th style={{ cursor: "default" }}>#</th>
              <Th label="Code" field="code" sort={sort} dir={dir} onSort={onSort} />
              <Th
                label={groupBy === "rayon" ? "Rayon" : "Fournisseur"}
                field="label"
                sort={sort}
                dir={dir}
                onSort={onSort}
              />
              <Th label="Nb articles" field="nbArticles" sort={sort} dir={dir} onSort={onSort} num />
              <Th label="Ventes (qté/an)" field="venteAnnee" sort={sort} dir={dir} onSort={onSort} num />
              <Th label="CA annuel" field="caAnnee" sort={sort} dir={dir} onSort={onSort} num />
              <Th label="Marge moy." field="margeMoy" sort={sort} dir={dir} onSort={onSort} num />
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={7} className="tv-empty">
                  Chargement du classement…
                </td>
              </tr>
            ) : lignes.length === 0 ? (
              <tr>
                <td colSpan={7} className="tv-empty">
                  Aucune donnée.
                </td>
              </tr>
            ) : (
              lignes.map((l, i) => (
                <tr
                  key={`${l.code}-${i}`}
                  onClick={() => setDrill({ type: groupBy, code: l.code, label: l.label })}
                  title="Voir le détail des articles"
                >
                  <td className="tv-rank">{i + 1}</td>
                  <td>
                    <b>{l.code}</b>
                  </td>
                  <td className="wrap">{l.label || "—"}</td>
                  <td className="num">{fmtInt(l.nbArticles)}</td>
                  <td className="num">{fmtInt(l.venteAnnee)}</td>
                  <td className="num">
                    <b>{fmtMoney(l.caAnnee)}</b>
                  </td>
                  <td className="num">{fmtMarge(l.margeMoy)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {drill && (
        <DetailModal dossier={dossier} drill={drill} onClose={() => setDrill(null)} />
      )}
    </div>
  );
};

// ── Modale détail (articles d'un fournisseur / rayon) ────────────────────────
const DetailModal = ({ dossier, drill, onClose }) => {
  const [sort, setSort] = useState("caAnnee");
  const [dir, setDir] = useState("desc");
  const [search, setSearch] = useState("");

  const { data, isLoading, isFetching } = useGetTopVenteDetailQuery({
    nomDossierDBF: dossier,
    type: drill.type,
    code: drill.code,
    sort,
    dir,
  });

  const onSort = (field) => {
    if (sort === field) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSort(field);
      setDir("desc");
    }
  };

  const articles = useMemo(() => {
    let rows = data?.articles || [];
    if (search) {
      const s = search.toLowerCase();
      rows = rows.filter((a) =>
        `${a.nart} ${a.design} ${a.refer} ${a.gencod}`.toLowerCase().includes(s),
      );
    }
    return rows;
  }, [data, search]);

  return (
    <div className="tv-overlay" onClick={onClose}>
      <div className="tv-modal" onClick={(e) => e.stopPropagation()}>
        <h3>
          <HiTrendingUp /> {drill.type === "rayon" ? "Rayon" : "Fournisseur"}{" "}
          <span className="tv-badge">{drill.code}</span> {drill.label}
          <button className="tv-btn" style={{ marginLeft: "auto" }} onClick={onClose}>
            <HiX />
          </button>
        </h3>

        <div className="tv-toolbar">
          <div style={{ position: "relative" }}>
            <HiSearch style={{ position: "absolute", left: 10, top: 10, color: "#94a3b8" }} />
            <input
              className="tv-input"
              style={{ paddingLeft: 32 }}
              placeholder="Rechercher un article…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="tv-spacer" />
          <span className="tv-soc">
            {data?.total ?? 0} article(s){isFetching ? " · …" : ""}
          </span>
        </div>

        <div className="tv-tablewrap" style={{ maxHeight: "62vh" }}>
          <table className="tv-table">
            <thead>
              <tr>
                <th style={{ cursor: "default" }}>Code</th>
                <th style={{ cursor: "default" }}>Désignation</th>
                {drill.type === "fournisseur" && (
                  <th style={{ cursor: "default" }}>Rayon</th>
                )}
                <Th label="Ventes/an" field="venteAnnee" sort={sort} dir={dir} onSort={onSort} num />
                <Th label="CA annuel" field="caAnnee" sort={sort} dir={dir} onSort={onSort} num />
                <Th label="Marge" field="margeHt" sort={sort} dir={dir} onSort={onSort} num />
                <Th label="Rupture (j)" field="jourRupture" sort={sort} dir={dir} onSort={onSort} num />
                <Th label="Stock" field="stockTotal" sort={sort} dir={dir} onSort={onSort} num />
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={8} className="tv-empty">
                    Chargement…
                  </td>
                </tr>
              ) : articles.length === 0 ? (
                <tr>
                  <td colSpan={8} className="tv-empty">
                    Aucun article.
                  </td>
                </tr>
              ) : (
                articles.map((a) => (
                  <tr key={a.nart} style={{ cursor: "default" }}>
                    <td>
                      <b>{a.nart}</b>
                    </td>
                    <td className="wrap">{a.design}</td>
                    {drill.type === "fournisseur" && (
                      <td className="wrap">{a.rayon || a.gism1 || "—"}</td>
                    )}
                    <td className="num">{fmtInt(a.venteAnnee)}</td>
                    <td className="num">{fmtMoney(a.caAnnee)}</td>
                    <td className="num">{fmtMarge(a.margeHt)}</td>
                    <td className="num">{a.jourRupture}</td>
                    <td className="num">{fmtInt(a.stockTotal)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default AdminTopVentesScreen;
