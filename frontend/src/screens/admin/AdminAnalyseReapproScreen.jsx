// src/screens/admin/AdminAnalyseReapproScreen.jsx
import React, { useMemo, useState } from "react";
import { useSelector } from "react-redux";
import {
  HiTruck, HiRefresh, HiExclamationCircle, HiTrendingDown, HiCube, HiShoppingCart,
  HiPaperAirplane, HiTrash, HiPlus, HiX,
} from "react-icons/hi";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import { useGetAnalyseReapproQuery } from "../../slices/analyseReapproApiSlice";
import { selectGlobalDossier } from "../../slices/entrepriseGlobalSlice";
import {
  useGetDemandesQuery,
  useCreateDemandePanierMutation,
  useLazyGetArticleReapproQuery,
  useDeleteDemandeMutation,
} from "../../slices/demandeReapproApiSlice";
import Loader from "../../components/Shared/Loader/Loader";
import "./AdminAnalyseReapproScreen.css";

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
  // Société active : lue depuis la sélection GLOBALE (Header).
  const selectedEntreprise = useSelector(selectGlobalDossier) || "";
  const [tab, setTab] = useState("fourn"); // fourn | magasin
  const [gisFilter, setGisFilter] = useState("");
  const [priorite, setPriorite] = useState("a_faire");
  const [msg, setMsg] = useState(null);
  const [cart, setCart] = useState([]);
  const [manualNart, setManualNart] = useState("");
  const [manualMsg, setManualMsg] = useState(null);

  const { data, isLoading, isFetching, refetch } = useGetAnalyseReapproQuery(
    selectedEntreprise,
    { skip: !selectedEntreprise },
  );

  const kpis = data?.kpis;
  const rows = data?.rows || [];
  const rowsMagasin = data?.rowsMagasin || [];
  const gisementsMagasin = data?.gisementsMagasin || [];
  const mappingEntrepots = data?.mappingEntrepots || {
    S1: "Magasin", S2: "S2", S3: "S3", S4: "S4", S5: "S5",
  };

  const { data: demandes = [], refetch: refetchDemandes } = useGetDemandesQuery(
    { nomDossierDBF: selectedEntreprise },
    { skip: !selectedEntreprise },
  );
  const [deleteDemande] = useDeleteDemandeMutation();
  const [createPanier, { isLoading: sendingPanier }] = useCreateDemandePanierMutation();
  const [resolveArticle] = useLazyGetArticleReapproQuery();

  const ruptureData = useMemo(
    () => (data?.ruptureParLieu || []).map((r) => ({ ...r })),
    [data],
  );

  const busy = Boolean(selectedEntreprise) && (isLoading || isFetching);

  const magasinFiltres = gisFilter
    ? rowsMagasin.filter((r) => r.gisement === gisFilter)
    : rowsMagasin;

  const supprimerDemande = async (id) => {
    if (!window.confirm("Supprimer cette demande ?")) return;
    try {
      await deleteDemande(id).unwrap();
      refetchDemandes();
    } catch (e) {
      /* ignore */
    }
  };

  // --- Panier de demande (quantités bornées au stock) ---
  const lieuxTxt = (c) =>
    ["s1", "s2", "s3", "s4", "s5"]
      .filter((k) => (c[k] || 0) > 0)
      .map((k) => `${mappingEntrepots[k.toUpperCase()] || k.toUpperCase()}: ${fmtNb(c[k])}`)
      .join(" · ") || "—";

  const inCart = (nart) => cart.some((c) => c.nart === nart);

  const addToCart = (art, qty) => {
    if (inCart(art.nart)) return;
    let q = Math.round(qty || art.stock);
    if (q < 1) q = 1;
    if (q > art.stock) q = art.stock;
    setCart((c) => [
      ...c,
      {
        nart: art.nart,
        design: art.design,
        fournNom: art.fournNom || art.fourn,
        stock: art.stock,
        s1: art.s1, s2: art.s2, s3: art.s3, s4: art.s4, s5: art.s5,
        quantite: q,
      },
    ]);
  };

  const setCartQty = (nart, val) => {
    setCart((c) =>
      c.map((x) => {
        if (x.nart !== nart) return x;
        let q = Math.round(Number(val) || 0);
        if (q < 1) q = 1;
        if (q > x.stock) q = x.stock;
        return { ...x, quantite: q };
      }),
    );
  };

  const removeCart = (nart) => setCart((c) => c.filter((x) => x.nart !== nart));

  const addManual = async () => {
    setManualMsg(null);
    const nart = manualNart.trim().toUpperCase();
    if (!nart) return;
    if (inCart(nart)) {
      setManualMsg({ type: "error", text: "Déjà dans la demande." });
      return;
    }
    try {
      const art = await resolveArticle({
        nomDossierDBF: selectedEntreprise,
        nart,
      }).unwrap();
      if (!art || art.stock <= 0) {
        setManualMsg({ type: "error", text: "Stock nul — non ajoutable." });
        return;
      }
      addToCart(art, art.stock);
      setManualNart("");
      setManualMsg({ type: "success", text: `${art.nart} ajouté.` });
    } catch (e) {
      setManualMsg({ type: "error", text: e?.data?.message || "NART introuvable." });
    }
  };

  const validerPanier = async () => {
    setMsg(null);
    if (cart.length === 0) return;
    try {
      const r = await createPanier({
        nomDossierDBF: selectedEntreprise,
        articles: cart.map((c) => ({ nart: c.nart, quantite: c.quantite })),
        priorite,
      }).unwrap();
      setCart([]);
      refetchDemandes();
      setMsg({
        type: "success",
        text: `Demande créée (${r.demande?.nbArticles ?? cart.length} article(s)).`,
      });
    } catch (e) {
      setMsg({ type: "error", text: e?.data?.message || "Échec de la validation." });
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
                  {/* Nouvelle demande : panier + saisie NART manuelle */}
                  <div className="ar-gis-panel">
                    <div className="ar-gis-head">
                      <span>Nouvelle demande de réappro magasin</span>
                      <div className="ar-gis-actions">
                        <select value={priorite} onChange={(e) => setPriorite(e.target.value)}>
                          <option value="urgent">Urgent</option>
                          <option value="a_faire">À faire</option>
                          <option value="normal">Normal</option>
                        </select>
                        <button
                          className="ar-send"
                          disabled={sendingPanier || cart.length === 0}
                          onClick={validerPanier}
                        >
                          <HiPaperAirplane /> Valider la demande ({cart.length})
                        </button>
                      </div>
                    </div>
                    {msg && <div className={`ar-msg ${msg.type}`}>{msg.text}</div>}

                    {/* Ajout manuel par NART */}
                    <div className="ar-manual">
                      <input
                        className="ar-manual-input"
                        value={manualNart}
                        onChange={(e) => setManualNart(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && addManual()}
                        placeholder="Ajouter un article par NART…"
                      />
                      <button className="ar-manual-btn" onClick={addManual}>
                        <HiPlus /> Ajouter
                      </button>
                      {manualMsg && (
                        <span className={`ar-manual-msg ${manualMsg.type}`}>{manualMsg.text}</span>
                      )}
                    </div>

                    {/* Récap du panier (avant validation) */}
                    {cart.length > 0 && (
                      <div className="ar-cart">
                        <div className="ar-cart-title">
                          Articles de la demande ({cart.length})
                        </div>
                        {cart.map((c) => (
                          <div key={c.nart} className="ar-cart-row">
                            <div className="ar-cart-info">
                              <span className="ar-cart-nart">{c.nart}</span>
                              <span className="ar-cart-design" title={c.design}>{c.design}</span>
                              <span className="ar-cart-stock">
                                Stock {fmtNb(c.stock)} · {lieuxTxt(c)}
                              </span>
                            </div>
                            <input
                              className="ar-cart-qty"
                              type="number"
                              min="1"
                              max={c.stock}
                              value={c.quantite}
                              onChange={(e) => setCartQty(c.nart, e.target.value)}
                              title={`Max ${c.stock}`}
                            />
                            <button className="ar-cart-del" onClick={() => removeCart(c.nart)}>
                              <HiX />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
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
                          <th className="num">Stock</th>
                          <th>Répartition</th>
                          <th className="num">Vte/mois</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {magasinFiltres.length === 0 ? (
                          <tr>
                            <td colSpan={8} className="ar-none">
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
                              <td className="ar-lieux">{lieuxTxt(r)}</td>
                              <td className="num">{fmtNb(r.vteMoyMois)}</td>
                              <td>
                                {inCart(r.nart) ? (
                                  <span className="ar-badge-done">Ajouté</span>
                                ) : (
                                  <button className="ar-add" onClick={() => addToCart(r, r.stock)}>
                                    <HiPlus /> Ajouter
                                  </button>
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