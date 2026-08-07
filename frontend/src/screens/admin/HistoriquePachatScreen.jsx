import React, { useMemo, useState } from "react";
import { useSelector } from "react-redux";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import {
  HiTrendingUp,
  HiTrendingDown,
  HiOfficeBuilding,
  HiExclamationCircle,
  HiSearch,
  HiExternalLink,
  HiArrowNarrowRight,
  HiX,
} from "react-icons/hi";
import {
  selectGlobalDossier,
  selectGlobalEntreprise,
} from "../../slices/entrepriseGlobalSlice";
import {
  useGetPachatHistoriqueQuery,
  useGetPachatFournisseursQuery,
  useGetPachatEvolutionsQuery,
} from "../../slices/pachatHistoriqueApiSlice";
import "./HistoriquePachatScreen.css";

// Prix avec séparateur d'espace + devise.
const fmtPrix = (v, devise = "XPF") => {
  if (v === null || v === undefined || v === "" || Number.isNaN(Number(v)))
    return "—";
  const n = Math.round(Number(v) * 100) / 100;
  const ent = Number.isInteger(n)
    ? n.toLocaleString("fr-FR")
    : n.toLocaleString("fr-FR", { minimumFractionDigits: 2 });
  return `${ent} ${devise}`.trim();
};

const fmtPct = (v) => {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return null;
  const n = Number(v);
  return `${n > 0 ? "+" : ""}${n}%`;
};

// Tooltip personnalisé de la courbe détaillée.
const ChartTooltip = ({ active, payload }) => {
  if (!active || !payload || !payload.length) return null;
  const p = payload[0].payload;
  return (
    <div className="hp-tooltip">
      <div className="hp-tooltip-date">{p.date || "—"}</div>
      <div className="hp-tooltip-price">{fmtPrix(p.prix, p.devise)}</div>
      <div className="hp-tooltip-meta">
        {p.fournisseur || `Frs ${p.fournCode ?? "?"}`}
        {p.numcde ? ` · ${p.numcde}` : ""}
      </div>
    </div>
  );
};

const HistoriquePachatScreen = () => {
  const nomDossierDBF = useSelector(selectGlobalDossier);
  const entreprise = useSelector(selectGlobalEntreprise);

  // Classement
  const [fourn, setFourn] = useState("");
  const [sens, setSens] = useState("hausse");
  // Détail
  const [nartInput, setNartInput] = useState("");
  const [submittedNart, setSubmittedNart] = useState("");

  const { data: fournData } = useGetPachatFournisseursQuery(
    { nomDossierDBF },
    { skip: !nomDossierDBF },
  );
  const fournisseursListe = useMemo(() => fournData || [], [fournData]);

  const {
    data: evoData,
    isFetching: evoLoading,
    isError: evoErr,
  } = useGetPachatEvolutionsQuery(
    { nomDossierDBF, fourn, sens },
    { skip: !nomDossierDBF },
  );
  const evolutions = useMemo(() => evoData?.items || [], [evoData]);

  const {
    data: detail,
    isFetching: detailLoading,
    isError: detailErr,
    error: detailErrObj,
  } = useGetPachatHistoriqueQuery(
    { nomDossierDBF, nart: submittedNart },
    { skip: !nomDossierDBF || !submittedNart },
  );

  const points = useMemo(() => detail?.points || [], [detail]);
  const fournisseurs = useMemo(() => detail?.fournisseurs || [], [detail]);
  const devises = useMemo(
    () => [...new Set(points.map((p) => p.devise).filter(Boolean))],
    [points],
  );
  const multiDevise = devises.length > 1;

  const openDetail = (nart) => {
    setNartInput(nart);
    setSubmittedNart(nart);
  };
  const submitSearch = (e) => {
    e.preventDefault();
    const v = nartInput.trim();
    if (v) setSubmittedNart(v);
  };
  const closeDetail = () => {
    setSubmittedNart("");
    setNartInput("");
  };

  return (
    <div className="hp-page">
      {/* ── Header ── */}
      <header className="hp-header">
        <div className="hp-header-left">
          <div className="hp-header-icon">
            <HiTrendingUp />
          </div>
          <div>
            <h1>Historique prix d'achat</h1>
            <p className="hp-header-subtitle">
              Évolution du PACHAT par article et par fournisseur (source&nbsp;:
              commandes). Classement des plus fortes variations.
            </p>
          </div>
        </div>
        {entreprise && (
          <div className="hp-entreprise-badge">
            <HiOfficeBuilding />
            <span>{entreprise.nomComplet || entreprise.nom || nomDossierDBF}</span>
          </div>
        )}
      </header>

      {!nomDossierDBF ? (
        <div className="hp-empty">
          <HiExclamationCircle className="hp-empty-icon" />
          <h2>Aucune société sélectionnée</h2>
          <p>Choisissez une société dans l'en-tête pour consulter l'historique.</p>
        </div>
      ) : (
        <>
          {/* ── Barre d'outils : fournisseur + sens + recherche NART ── */}
          <div className="hp-toolbar">
            <div className="hp-field">
              <label htmlFor="hp-fourn">Fournisseur</label>
              <select
                id="hp-fourn"
                value={fourn}
                onChange={(e) => setFourn(e.target.value)}
              >
                <option value="">Tous les fournisseurs</option>
                {fournisseursListe.map((f) => (
                  <option key={f.code} value={f.code}>
                    {f.nom || `Fournisseur ${f.code}`} ({f.nbCommandes})
                  </option>
                ))}
              </select>
            </div>

            <div className="hp-field">
              <label>Sens</label>
              <div className="hp-toggle">
                <button
                  type="button"
                  className={sens === "hausse" ? "active" : ""}
                  onClick={() => setSens("hausse")}
                >
                  <HiTrendingUp /> Hausses
                </button>
                <button
                  type="button"
                  className={sens === "baisse" ? "active" : ""}
                  onClick={() => setSens("baisse")}
                >
                  <HiTrendingDown /> Baisses
                </button>
              </div>
            </div>

            <form className="hp-field hp-search-field" onSubmit={submitSearch}>
              <label htmlFor="hp-nart">Voir un article précis (NART)</label>
              <div className="hp-search-row">
                <div className="hp-input-wrap">
                  <HiSearch className="hp-input-icon" />
                  <input
                    id="hp-nart"
                    type="text"
                    value={nartInput}
                    placeholder="Ex : 250217"
                    onChange={(e) => setNartInput(e.target.value)}
                    autoComplete="off"
                  />
                </div>
                <button
                  type="submit"
                  className="hp-btn hp-btn-primary"
                  disabled={!nartInput.trim()}
                >
                  Voir
                </button>
              </div>
            </form>
          </div>

          {/* ── DÉTAIL ARTICLE (si sélectionné) ── */}
          {submittedNart && (
            <div className="hp-detail">
              <div className="hp-detail-head">
                <h2 className="hp-section-title">
                  Détail article {submittedNart}
                </h2>
                <button
                  type="button"
                  className="hp-btn hp-btn-ghost"
                  onClick={closeDetail}
                >
                  <HiX /> Fermer
                </button>
              </div>

              {detailErr && (
                <div className="hp-alert hp-alert-err">
                  {detailErrObj?.data?.message ||
                    "Erreur lors du chargement de l'article."}
                </div>
              )}
              {detailLoading ? (
                <div className="hp-hint">
                  <span className="hp-spinner" /> Chargement…
                </div>
              ) : detail && detail.total === 0 ? (
                <div className="hp-empty hp-empty-sm">
                  <HiExclamationCircle className="hp-empty-icon" />
                  <p>
                    Aucune commande avec prix d'achat pour{" "}
                    <strong>{submittedNart}</strong>.
                  </p>
                </div>
              ) : detail ? (
                <>
                  <div className="hp-article-card">
                    <div className="hp-article-main">
                      <a
                        className="hp-nart-link"
                        href={`/admin/articles/${nomDossierDBF}/${encodeURIComponent(
                          detail.article?.nart || submittedNart,
                        )}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {detail.article?.nart || submittedNart}
                        <HiExternalLink className="hp-nart-ext" />
                      </a>
                      <div className="hp-article-design">
                        {detail.article?.design || (
                          <em className="hp-muted">Désignation inconnue</em>
                        )}
                      </div>
                      <div className="hp-article-meta">
                        {detail.article?.refer && (
                          <span>Réf : {detail.article.refer}</span>
                        )}
                        {detail.article?.gencod && (
                          <span>Gencod : {detail.article.gencod}</span>
                        )}
                      </div>
                    </div>
                    <div className="hp-article-stats">
                      <div className="hp-stat hp-stat-primary">
                        <span className="hp-stat-value">
                          {fmtPrix(detail.pachatCourant)}
                        </span>
                        <span className="hp-stat-label">PACHAT courant</span>
                      </div>
                      <div className="hp-stat">
                        <span className="hp-stat-value">{detail.total}</span>
                        <span className="hp-stat-label">Commandes</span>
                      </div>
                    </div>
                  </div>

                  {multiDevise && (
                    <div className="hp-alert hp-alert-warn">
                      ⚠️ Plusieurs devises ({devises.join(", ")}) — prix non
                      convertis.
                    </div>
                  )}

                  <div className="hp-chart-card">
                    <ResponsiveContainer width="100%" height={280}>
                      <LineChart
                        data={points}
                        margin={{ top: 10, right: 20, bottom: 10, left: 0 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                        <XAxis dataKey="date" tick={{ fontSize: 11 }} minTickGap={20} />
                        <YAxis
                          tick={{ fontSize: 11 }}
                          width={70}
                          tickFormatter={(v) => v.toLocaleString("fr-FR")}
                        />
                        <Tooltip content={<ChartTooltip />} />
                        <Line
                          type="monotone"
                          dataKey="prix"
                          stroke="#2563eb"
                          strokeWidth={2}
                          dot={{ r: 3 }}
                          activeDot={{ r: 5 }}
                          isAnimationActive={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>

                  {fournisseurs.length > 0 && (
                    <div className="hp-fourn-grid">
                      {fournisseurs.map((f) => {
                        const pct = fmtPct(f.variationPct);
                        const up = f.variationPct > 0;
                        const down = f.variationPct < 0;
                        return (
                          <div className="hp-fourn-card" key={`${f.fournCode}`}>
                            <div className="hp-fourn-name">
                              {f.fournisseur ||
                                `Fournisseur ${f.fournCode ?? "?"}`}
                            </div>
                            <div className="hp-fourn-price">
                              {fmtPrix(f.dernier, f.devise)}
                              {pct && (
                                <span
                                  className={`hp-fourn-pct ${
                                    up ? "up" : down ? "down" : ""
                                  }`}
                                >
                                  {pct}
                                </span>
                              )}
                            </div>
                            <div className="hp-fourn-meta">
                              <span>{f.nbCommandes} cde(s)</span>
                              <span>
                                min {fmtPrix(f.min, f.devise)} · max{" "}
                                {fmtPrix(f.max, f.devise)}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  <div className="hp-table-wrap">
                    <table className="hp-table">
                      <thead>
                        <tr>
                          <th>Date cde</th>
                          <th>N° commande</th>
                          <th>Fournisseur</th>
                          <th className="hp-num">Qté</th>
                          <th className="hp-num">Prix d'achat</th>
                          <th>Devise</th>
                          <th>Arrivée</th>
                        </tr>
                      </thead>
                      <tbody>
                        {points.map((p, i) => {
                          const prev = points[i - 1];
                          const hausse = prev && p.prix > prev.prix;
                          const baisse = prev && p.prix < prev.prix;
                          return (
                            <tr key={`${p.numcde}-${i}`}>
                              <td className="hp-mono">{p.date || "—"}</td>
                              <td className="hp-mono">{p.numcde || "—"}</td>
                              <td>
                                {p.fournisseur || (
                                  <span className="hp-muted">
                                    Frs {p.fournCode ?? "?"}
                                  </span>
                                )}
                              </td>
                              <td className="hp-num hp-mono">{p.qte ?? "—"}</td>
                              <td
                                className={`hp-num hp-mono ${
                                  hausse ? "hp-up" : baisse ? "hp-down" : ""
                                }`}
                                title={
                                  p.source === "rendu"
                                    ? "Coût rendu (réception valorisée)"
                                    : "Prix commandé (MONTANT, devise)"
                                }
                              >
                                {(hausse || baisse) && (
                                  <HiArrowNarrowRight
                                    className={`hp-arrow ${hausse ? "up" : "down"}`}
                                  />
                                )}
                                {fmtPrix(p.prix, "")}
                              </td>
                              <td>{p.devise}</td>
                              <td className="hp-mono hp-muted">
                                {p.arrivee || "—"}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : null}
            </div>
          )}

          {/* ── CLASSEMENT DES ÉVOLUTIONS (par défaut) ── */}
          <div className="hp-ranking">
            <h2 className="hp-section-title">
              {sens === "hausse" ? "Plus fortes hausses" : "Plus fortes baisses"}{" "}
              du prix d'achat
              {fourn && fournisseursListe.length > 0 && (
                <span className="hp-scope">
                  {" · "}
                  {fournisseursListe.find((f) => String(f.code) === String(fourn))
                    ?.nom || `Frs ${fourn}`}
                </span>
              )}
            </h2>

            {evoErr && (
              <div className="hp-alert hp-alert-err">
                Erreur lors du chargement du classement.
              </div>
            )}

            <div className="hp-table-wrap">
              <table className="hp-table hp-table-rank">
                <thead>
                  <tr>
                    <th className="hp-num">#</th>
                    <th>NART</th>
                    <th>Désignation</th>
                    <th>Fournisseur</th>
                    <th className="hp-num">1er prix</th>
                    <th className="hp-num">Dernier</th>
                    <th className="hp-num">Variation</th>
                    <th className="hp-num">Cdes</th>
                  </tr>
                </thead>
                <tbody>
                  {evoLoading ? (
                    <tr>
                      <td colSpan={8} className="hp-td-info">
                        <span className="hp-spinner" /> Calcul du classement…
                      </td>
                    </tr>
                  ) : evolutions.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="hp-td-info">
                        Aucune évolution à afficher.
                      </td>
                    </tr>
                  ) : (
                    evolutions.map((it, i) => {
                      const up = it.variationPct > 0;
                      const down = it.variationPct < 0;
                      return (
                        <tr
                          key={`${it.nart}-${i}`}
                          className="hp-row-click"
                          onClick={() => openDetail(it.nart)}
                          title="Voir l'évolution détaillée"
                        >
                          <td className="hp-num hp-muted">{i + 1}</td>
                          <td className="hp-mono">{it.nart}</td>
                          <td className="hp-design">
                            {it.design || <span className="hp-muted">—</span>}
                          </td>
                          <td>
                            {it.fournisseur || (
                              <span className="hp-muted">
                                Frs {it.fournCode ?? "?"}
                              </span>
                            )}
                          </td>
                          <td className="hp-num hp-mono hp-muted">
                            {fmtPrix(it.premier, "")}
                          </td>
                          <td className="hp-num hp-mono">
                            {fmtPrix(it.dernier, it.devise)}
                          </td>
                          <td
                            className={`hp-num hp-mono hp-var ${
                              up ? "hp-up" : down ? "hp-down" : ""
                            }`}
                          >
                            {fmtPct(it.variationPct) ?? "—"}
                          </td>
                          <td className="hp-num hp-mono">{it.nbCommandes}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
            {evoData?.total > evolutions.length && (
              <p className="hp-rank-note">
                {evolutions.length} premiers sur {evoData.total} articles avec
                évolution.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default HistoriquePachatScreen;
