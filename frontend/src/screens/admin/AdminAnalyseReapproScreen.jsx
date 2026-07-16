// src/screens/admin/AdminAnalyseReapproScreen.jsx
import React, { useEffect, useMemo, useState } from "react";
import {
  HiTruck, HiRefresh, HiExclamationCircle, HiTrendingDown, HiCube, HiShoppingCart,
  HiPaperAirplane, HiTrash,
} from "react-icons/hi";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import { useGetEntreprisesQuery } from "../../slices/entrepriseApiSlice";
import { useGetAnalyseReapproQuery } from "../../slices/analyseReapproApiSlice";
import {
  useGetDemandesQuery,
  useCreateDemandesMutation,
  useDeleteDemandeMutation,
} from "../../slices/demandeReapproApiSlice";
import Loader from "../../components/Shared/Loader/Loader";
import "./AdminAnalyseReapproScreen.css";

const STORAGE_KEY = "analyseReappro.entreprise";

const STATUT_LABEL = {
  en_attente: "En attente",
  en_cours: "En cours",
  realisee: "Réalisée",
};
const PRIORITE_LABEL = { urgent: "Urgent", a_faire: "À faire", normal: "Normal" };
const fmtDate = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "—" : d.toLocaleDateString("fr-FR");
};

const fmtNb = (n) => (n ?? 0).toLocaleString("fr-FR");
const fmtXpf = (n) => `${Math.round(n ?? 0).toLocaleString("fr-FR")} F`;
const fmtPct = (n) => `${(n ?? 0).toLocaleString("fr-FR")} %`;

const AdminAnalyseReapproScreen = () => {
  const [selectedEntreprise, setSelectedEntreprise] = useState(
    localStorage.getItem(STORAGE_KEY) || "",
  );
  const [tab, setTab] = useState("fourn"); // fourn | magasin
  const [gisFilter, setGisFilter] = useState("");
  const [selectedGis, setSelectedGis] = useState([]);
  const [priorite, setPriorite] = useState("a_faire");
  const [msg, setMsg] = useState(null);

  const { data: entreprises, isLoading: loadingEntreprises } =
    useGetEntreprisesQuery();

  const { data, isLoading, isFetching, refetch } = useGetAnalyseReapproQuery(
    selectedEntreprise,
    { skip: !selectedEntreprise },
  );

  // Sélection par défaut : 1re entreprise active.
  useEffect(() => {
    if (!selectedEntreprise && entreprises && entreprises.length > 0) {
      const active = entreprises.find((e) => e.isActive) || entreprises[0];
      if (active) setSelectedEntreprise(active.nomDossierDBF);
    }
  }, [entreprises, selectedEntreprise]);

  useEffect(() => {
    if (selectedEntreprise) localStorage.setItem(STORAGE_KEY, selectedEntreprise);
  }, [selectedEntreprise]);

  const kpis = data?.kpis;
  const rows = data?.rows || [];
  const rowsMagasin = data?.rowsMagasin || [];
  const gisementsMagasin = data?.gisementsMagasin || [];

  const { data: demandes = [], refetch: refetchDemandes } = useGetDemandesQuery(
    { nomDossierDBF: selectedEntreprise },
    { skip: !selectedEntreprise },
  );
  const [createDemandes, { isLoading: creating }] = useCreateDemandesMutation();
  const [deleteDemande] = useDeleteDemandeMutation();

  const activeGis = useMemo(() => {
    const set = new Set();
    demandes.forEach((d) => {
      if (d.statut === "en_attente" || d.statut === "en_cours") set.add(d.gisement);
    });
    return set;
  }, [demandes]);
  const ruptureData = useMemo(
    () => (data?.ruptureParLieu || []).map((r) => ({ ...r })),
    [data],
  );

  const busy = Boolean(selectedEntreprise) && (isLoading || isFetching);

  const magasinFiltres = gisFilter
    ? rowsMagasin.filter((r) => r.gisement === gisFilter)
    : rowsMagasin;

  const toggleGis = (g) =>
    setSelectedGis((prev) =>
      prev.includes(g) ? prev.filter((x) => x !== g) : [...prev, g],
    );

  const envoyerDemande = async () => {
    setMsg(null);
    const gis = selectedGis.filter((g) => !activeGis.has(g));
    if (gis.length === 0) {
      setMsg({ type: "error", text: "Sélectionnez au moins un gisement non déjà demandé." });
      return;
    }
    try {
      const r = await createDemandes({
        nomDossierDBF: selectedEntreprise,
        gisements: gis,
        priorite,
      }).unwrap();
      setSelectedGis([]);
      refetchDemandes();
      const ign = r.ignores?.length
        ? ` — ${r.ignores.length} ignoré(s) (déjà demandé)`
        : "";
      setMsg({ type: "success", text: `${r.crees} demande(s) créée(s)${ign}.` });
    } catch (e) {
      setMsg({ type: "error", text: e?.data?.message || "Échec de l'envoi." });
    }
  };

  const supprimerDemande = async (id) => {
    if (!window.confirm("Supprimer cette demande ?")) return;
    try {
      await deleteDemande(id).unwrap();
      refetchDemandes();
    } catch (e) {
      /* ignore */
    }
  };

  return (
    <div className="analyse-reappro">
      {/* En-tête */}
      <div className="ar-header">
        <div className="ar-head-title">
          <span className="ar-head-icon"><HiTruck /></span>
          <div>
            <h1>Analyse Réappro / Ruptures</h1>
            <p>Articles à réapprovisionner et ruptures, priorisés par CA perdu.</p>
          </div>
        </div>
        <div className="ar-head-actions">
          <select
            className="ar-select"
            value={selectedEntreprise}
            onChange={(e) => setSelectedEntreprise(e.target.value)}
            disabled={loadingEntreprises}
          >
            <option value="">— Entreprise —</option>
            {(entreprises || []).map((e) => (
              <option key={e._id || e.nomDossierDBF} value={e.nomDossierDBF}>
                {e.nom || e.nomComplet || e.nomDossierDBF}
              </option>
            ))}
          </select>
          <button className="ar-refresh" onClick={() => refetch()} disabled={busy}>
            <HiRefresh className={busy ? "spin" : ""} /> Rafraîchir
          </button>
        </div>
      </div>

      {!selectedEntreprise ? (
        <div className="ar-empty">Choisissez une entreprise pour lancer l'analyse.</div>
      ) : busy ? (
        <Loader />
      ) : !data ? (
        <div className="ar-empty">Aucune donnée.</div>
      ) : (
        <>
          {/* KPIs */}
          <div className="ar-kpis">
            <div className="ar-kpi ar-kpi-blue">
              <span className="ar-kpi-icon"><HiCube /></span>
              <div>
                <div className="ar-kpi-value">{fmtNb(kpis.nbARepro)}</div>
                <div className="ar-kpi-label">À réappro fournisseur</div>
              </div>
            </div>
            <div className="ar-kpi ar-kpi-purple">
              <span className="ar-kpi-icon"><HiShoppingCart /></span>
              <div>
                <div className="ar-kpi-value">{fmtNb(kpis.nbReapproMagasin)}</div>
                <div className="ar-kpi-label">À réappro magasin</div>
              </div>
            </div>
            <div className="ar-kpi ar-kpi-red">
              <span className="ar-kpi-icon"><HiExclamationCircle /></span>
              <div>
                <div className="ar-kpi-value">{fmtNb(kpis.nbEnRupture)}</div>
                <div className="ar-kpi-label">En rupture (stock ≤ 0)</div>
              </div>
            </div>
            <div className="ar-kpi ar-kpi-amber">
              <span className="ar-kpi-icon"><HiTrendingDown /></span>
              <div>
                <div className="ar-kpi-value">{fmtPct(kpis.tauxRuptureQte)}</div>
                <div className="ar-kpi-label">Taux de rupture (qté)</div>
              </div>
            </div>
            <div className="ar-kpi ar-kpi-green">
              <span className="ar-kpi-icon"><HiTruck /></span>
              <div>
                <div className="ar-kpi-value">{fmtXpf(kpis.caMoisTotal)}</div>
                <div className="ar-kpi-label">CA mensuel (actifs)</div>
              </div>
            </div>
            <div className="ar-kpi ar-kpi-red">
              <span className="ar-kpi-icon"><HiTrendingDown /></span>
              <div>
                <div className="ar-kpi-value">{fmtXpf(kpis.caPerduMois)}</div>
                <div className="ar-kpi-label">CA perdu / mois</div>
              </div>
            </div>
            <div className="ar-kpi ar-kpi-amber">
              <span className="ar-kpi-icon"><HiTrendingDown /></span>
              <div>
                <div className="ar-kpi-value">{fmtPct(kpis.tauxRuptureValeur)}</div>
                <div className="ar-kpi-label">Taux de rupture (valeur)</div>
              </div>
            </div>
          </div>

          <div className="ar-main">
            {/* Graphe ruptures par lieu */}
            <div className="ar-card">
              <h3>Ruptures par lieu de stockage</h3>
              <div className="ar-chart">
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={ruptureData}>
                    <XAxis dataKey="lieu" stroke="#888" />
                    <YAxis stroke="#888" allowDecimals={false} />
                    <Tooltip
                      contentStyle={{
                        background: "#252540",
                        border: "1px solid #333",
                        borderRadius: 8,
                        color: "#eee",
                      }}
                      formatter={(v) => [fmtNb(v), "En rupture"]}
                    />
                    <Bar dataKey="nbRupture" radius={[6, 6, 0, 0]}>
                      {ruptureData.map((_, i) => (
                        <Cell key={i} fill="#ef4444" />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Tableau des articles à réappro — filtre Fournisseur / Magasin */}
            <div className="ar-card">
              <div className="ar-tabs">
                <button
                  className={`ar-tab ${tab === "fourn" ? "active" : ""}`}
                  onClick={() => setTab("fourn")}
                >
                  <HiTruck /> Réappro fournisseur
                  <span className="ar-tab-count">{fmtNb(data.totalRows)}</span>
                </button>
                <button
                  className={`ar-tab ${tab === "magasin" ? "active" : ""}`}
                  onClick={() => setTab("magasin")}
                >
                  <HiShoppingCart /> Réappro magasin
                  <span className="ar-tab-count">{fmtNb(data.totalMagasin)}</span>
                </button>
              </div>

              {tab === "fourn" ? (
                <>
                  <p className="ar-tab-help">
                    Articles à commander au fournisseur (vente moy/mois &gt; stock).
                    Top {fmtNb(rows.length)} sur {fmtNb(data.totalRows)}.
                  </p>
                  <div className="ar-table-wrap">
                    <table className="ar-table">
                      <thead>
                        <tr>
                          <th>NART</th>
                          <th>Désignation</th>
                          <th>Fournisseur</th>
                          <th className="num">Stock</th>
                          <th className="num">Vte/mois</th>
                          <th className="num">À cmd</th>
                          <th className="num">CA perdu</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r) => (
                          <tr key={r.nart} className={r.enRupture ? "rupture" : ""}>
                            <td className="mono">{r.nart}</td>
                            <td className="design" title={r.design}>{r.design}</td>
                            <td>{r.fournNom || r.fourn}</td>
                            <td className="num">{fmtNb(r.stock)}</td>
                            <td className="num">{fmtNb(r.vteMoyMois)}</td>
                            <td className="num strong">{fmtNb(r.reappro)}</td>
                            <td className="num danger">{fmtXpf(r.caPerdu)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <>
                  {/* Sélection de gisements à envoyer en demande */}
                  <div className="ar-gis-panel">
                    <div className="ar-gis-head">
                      <span>Demander un réappro magasin par gisement (GISM1)</span>
                      <div className="ar-gis-actions">
                        <select value={priorite} onChange={(e) => setPriorite(e.target.value)}>
                          <option value="urgent">Urgent</option>
                          <option value="a_faire">À faire</option>
                          <option value="normal">Normal</option>
                        </select>
                        <button
                          className="ar-send"
                          disabled={creating || selectedGis.length === 0}
                          onClick={envoyerDemande}
                        >
                          <HiPaperAirplane /> Envoyer ({selectedGis.length})
                        </button>
                      </div>
                    </div>
                    {msg && <div className={`ar-msg ${msg.type}`}>{msg.text}</div>}
                    <div className="ar-gis-chips">
                      {gisementsMagasin.map((g) => {
                        const actif = activeGis.has(g.gisement);
                        const sel = selectedGis.includes(g.gisement);
                        return (
                          <button
                            key={g.gisement}
                            className={`ar-gis-chip ${sel ? "sel" : ""} ${actif ? "done" : ""}`}
                            onClick={() => !actif && toggleGis(g.gisement)}
                            disabled={actif}
                            title={actif ? "Déjà demandé" : "Sélectionner ce gisement"}
                          >
                            <span className="ar-gis-name">{g.gisement}</span>
                            <span className="ar-gis-nb">{fmtNb(g.nb)}</span>
                            {actif && <span className="ar-gis-tag">Demandé</span>}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Filtre + tableau */}
                  <div className="ar-tab-filter">
                    <label>Filtrer :</label>
                    <select value={gisFilter} onChange={(e) => setGisFilter(e.target.value)}>
                      <option value="">Tous les gisements</option>
                      {gisementsMagasin.map((g) => (
                        <option key={g.gisement} value={g.gisement}>
                          {g.gisement} ({g.nb})
                        </option>
                      ))}
                    </select>
                    <span className="ar-tab-help" style={{ margin: 0 }}>
                      Rayon vide (S1 = 0), stock en réserve — {fmtNb(magasinFiltres.length)} affiché(s).
                    </span>
                  </div>
                  <div className="ar-table-wrap">
                    <table className="ar-table">
                      <thead>
                        <tr>
                          <th>NART</th>
                          <th>Désignation</th>
                          <th>Fournisseur</th>
                          <th>Gisement</th>
                          <th className="num">Stock réserve</th>
                          <th className="num">Vte/mois</th>
                          <th>Demande</th>
                        </tr>
                      </thead>
                      <tbody>
                        {magasinFiltres.length === 0 ? (
                          <tr>
                            <td colSpan={7} className="ar-none">
                              Aucun article à réapprovisionner au magasin.
                            </td>
                          </tr>
                        ) : (
                          magasinFiltres.map((r) => (
                            <tr key={r.nart}>
                              <td className="mono">{r.nart}</td>
                              <td className="design" title={r.design}>{r.design}</td>
                              <td>{r.fournNom || r.fourn}</td>
                              <td>{r.gisement}</td>
                              <td className="num strong">{fmtNb(r.stock)}</td>
                              <td className="num">{fmtNb(r.vteMoyMois)}</td>
                              <td>
                                {activeGis.has(r.gisement) ? (
                                  <span className="ar-badge-done">Déjà demandé</span>
                                ) : (
                                  <span className="ar-badge-todo">—</span>
                                )}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>

            {/* Liste des demandes de réappro + statuts */}
            <div className="ar-card">
              <h3>
                Demandes de réappro{" "}
                <span className="ar-count">{fmtNb(demandes.length)}</span>
              </h3>
              {demandes.length === 0 ? (
                <p className="ar-tab-help">Aucune demande envoyée pour l'instant.</p>
              ) : (
                <div className="ar-table-wrap">
                  <table className="ar-table">
                    <thead>
                      <tr>
                        <th>Gisement</th>
                        <th className="num">Articles</th>
                        <th>Priorité</th>
                        <th>Statut</th>
                        <th>Créé par</th>
                        <th>Réalisé par</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {demandes.map((d) => (
                        <tr key={d._id}>
                          <td className="strong">{d.gisement}</td>
                          <td className="num">{fmtNb(d.nbArticles)}</td>
                          <td>
                            <span className={`ar-prio ar-prio-${d.priorite}`}>
                              {PRIORITE_LABEL[d.priorite] || d.priorite}
                            </span>
                          </td>
                          <td>
                            <span className={`ar-statut ar-statut-${d.statut}`}>
                              {STATUT_LABEL[d.statut] || d.statut}
                            </span>
                          </td>
                          <td>
                            {d.createdByNom || "—"}{" "}
                            <span className="ar-date">{fmtDate(d.createdAt)}</span>
                          </td>
                          <td>
                            {d.realisedByNom ? (
                              <>
                                {d.realisedByNom}{" "}
                                <span className="ar-date">{fmtDate(d.realisedAt)}</span>
                              </>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td>
                            {d.statut !== "realisee" && (
                              <button
                                className="ar-del"
                                title="Supprimer la demande"
                                onClick={() => supprimerDemande(d._id)}
                              >
                                <HiTrash />
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default AdminAnalyseReapproScreen;