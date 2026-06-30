// src/screens/admin/AdminRecapZonesScreen.jsx
import React, { useState, useMemo, useCallback } from "react";
import {
  HiViewGrid,
  HiRefresh,
  HiSearch,
  HiX,
  HiDownload,
  HiDocumentDownload,
  HiExclamation,
  HiCheckCircle,
  HiChevronDown,
  HiChevronRight,
} from "react-icons/hi";
import { useGetRecapZonesQuery } from "../../slices/inventaireCollecteApiSlice";
import { useGetMyEntreprisesQuery } from "../../slices/entrepriseApiSlice";
import * as XLSX from "xlsx";
import "./AdminRecapZonesScreen.css";

// Base API (proxy en dev, même origine en prod)
const API_BASE = process.env.REACT_APP_API_URL || "";

const AdminRecapZonesScreen = () => {
  const [selectedEntreprise, setSelectedEntreprise] = useState("");
  const [search, setSearch] = useState("");
  const [filterEcart, setFilterEcart] = useState("TOUT"); // TOUT | ECARTS
  const [groupBy, setGroupBy] = useState("ZONE"); // ZONE | FOURN
  const [seuilXpf, setSeuilXpf] = useState(""); // filtre export : |écart XPF| >= seuil
  const [openGroups, setOpenGroups] = useState(() => new Set());
  const [isExporting, setIsExporting] = useState(false);

  const { data: entreprises } = useGetMyEntreprisesQuery();

  const {
    data: recap,
    isLoading,
    isFetching,
    error,
    refetch,
  } = useGetRecapZonesQuery(selectedEntreprise, {
    skip: !selectedEntreprise,
  });

  const entrepriseObj = entreprises?.find((e) => e._id === selectedEntreprise);

  const totaux = recap?.totaux || null;
  const session = recap?.session || null;

  // Source selon le regroupement choisi
  const groupesBruts = useMemo(() => {
    if (!recap) return [];
    if (groupBy === "FOURN") {
      return (recap.fournisseurs || []).map((f) => ({
        key: f.fourn,
        titre: f.fourn,
        sousTitre: "",
        ...f,
      }));
    }
    return (recap.zones || []).map((z) => ({
      key: z.zoneCode,
      titre: z.zoneCode,
      sousTitre: z.zoneLibelle || "",
      ...z,
    }));
  }, [recap, groupBy]);

  // Filtrage affichage (recherche + écarts seulement)
  const groupes = useMemo(() => {
    const q = search.trim().toLowerCase();
    return groupesBruts
      .map((g) => {
        let lignes = g.lignes;
        if (filterEcart === "ECARTS") {
          lignes = lignes.filter((l) => l.ecart !== 0);
        }
        if (q) {
          lignes = lignes.filter(
            (l) =>
              (l.nart || "").toLowerCase().includes(q) ||
              (l.gencod || "").toLowerCase().includes(q) ||
              (l.designation || "").toLowerCase().includes(q) ||
              (l.fourn || "").toLowerCase().includes(q),
          );
        }
        return { ...g, lignesFiltrees: lignes };
      })
      .filter((g) => {
        if (q || filterEcart === "ECARTS") return g.lignesFiltrees.length > 0;
        return true;
      });
  }, [groupesBruts, search, filterEcart]);

  const toggleGroup = useCallback((key) => {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const expandAll = useCallback(() => {
    setOpenGroups(new Set(groupes.map((g) => g.key)));
  }, [groupes]);

  const collapseAll = useCallback(() => {
    setOpenGroups(new Set());
  }, []);

  const handleEntrepriseChange = (e) => {
    setSelectedEntreprise(e.target.value);
    setSearch("");
    setFilterEcart("TOUT");
    setSeuilXpf("");
    setOpenGroups(new Set());
  };

  // === FORMAT ===
  const fmt = (n, decimals = 0) => {
    const v = parseFloat(n);
    if (isNaN(v)) return "0";
    return v.toLocaleString("fr-FR", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  };

  const fmtXpf = (n) => `${fmt(Math.round(n))} XPF`;

  const ecartClass = (ecart) => {
    if (ecart > 0) return "ecart-positif";
    if (ecart < 0) return "ecart-negatif";
    return "ecart-nul";
  };

  // Seuil numérique pour l'export (0 = pas de filtre)
  const seuilNum = useMemo(() => {
    const v = Math.abs(parseFloat(seuilXpf) || 0);
    return isNaN(v) ? 0 : v;
  }, [seuilXpf]);

  // Applique le filtre seuil XPF (uniquement export/PDF)
  const filtreExport = useCallback(
    (lignes) => {
      if (seuilNum <= 0) return lignes;
      return lignes.filter((l) => Math.abs(l.ecartXpf) >= seuilNum);
    },
    [seuilNum],
  );

  // =============================================
  // EXPORT EXCEL : 1 onglet récap + 1 onglet par groupe
  // (respecte le filtre seuil XPF)
  // =============================================
  const handleExportExcel = useCallback(() => {
    if (!recap || !groupesBruts.length) return;
    setIsExporting(true);
    try {
      const wb = XLSX.utils.book_new();
      const libGroupe = groupBy === "FOURN" ? "Fournisseur" : "Zone";

      // ----- Onglet RÉCAP -----
      const recapRows = [
        [`RÉCAP PAR ${libGroupe.toUpperCase()}`],
        [
          "Entreprise",
          entrepriseObj
            ? `${entrepriseObj.trigramme} - ${entrepriseObj.nomComplet}`
            : "",
        ],
        ["Session", session?.nom || "(session active)"],
        seuilNum > 0 ? ["Filtre écart", `|écart XPF| >= ${fmt(seuilNum)}`] : [],
        [],
        [
          libGroupe,
          "Articles",
          "Qté bipée",
          "Stock théorique",
          "Écart qté",
          "Écart XPF",
          "Nb écarts",
        ],
      ];
      groupesBruts.forEach((g) => {
        const lignes = filtreExport(g.lignes);
        if (!lignes.length) return;
        const eQte = lignes.reduce((s, l) => s + l.ecart, 0);
        const eXpf = lignes.reduce((s, l) => s + l.ecartXpf, 0);
        const qte = lignes.reduce((s, l) => s + l.qteBipee, 0);
        const stock = lignes.reduce((s, l) => s + l.stockTheorique, 0);
        const nbE = lignes.filter((l) => l.ecart !== 0).length;
        recapRows.push([
          g.titre,
          lignes.length,
          qte,
          stock,
          eQte,
          Math.round(eXpf),
          nbE,
        ]);
      });
      const wsRecap = XLSX.utils.aoa_to_sheet(recapRows);
      XLSX.utils.book_append_sheet(wb, wsRecap, "Récap");

      // ----- Un onglet par groupe -----
      const usedNames = new Set(["Récap"]);
      groupesBruts.forEach((g) => {
        const lignes = filtreExport(g.lignes);
        if (!lignes.length) return;

        const rows = [
          [`${libGroupe.toUpperCase()} ${g.titre}`, g.sousTitre || ""],
          [],
          [
            "NART",
            "GENCOD",
            "Désignation",
            "Fourn.",
            "Qté bipée",
            "Stock théo.",
            "Écart qté",
            "PA",
            "Écart XPF",
          ],
        ];
        lignes.forEach((l) => {
          rows.push([
            l.nart,
            l.gencod,
            l.designation,
            l.fourn,
            l.qteBipee,
            l.stockTheorique,
            l.ecart,
            l.prixAchat,
            Math.round(l.ecartXpf),
          ]);
        });
        const eQte = lignes.reduce((s, l) => s + l.ecart, 0);
        const eXpf = lignes.reduce((s, l) => s + l.ecartXpf, 0);
        rows.push([]);
        rows.push([
          "TOTAL",
          "",
          "",
          "",
          lignes.reduce((s, l) => s + l.qteBipee, 0),
          lignes.reduce((s, l) => s + l.stockTheorique, 0),
          eQte,
          "",
          Math.round(eXpf),
        ]);

        let base = `${groupBy === "FOURN" ? "F" : "Z"}_${String(
          g.titre,
        ).replace(/[\\/?*[\]:]/g, "_")}`.slice(0, 28);
        let name = base;
        let i = 1;
        while (usedNames.has(name)) {
          name = `${base}_${i++}`.slice(0, 31);
        }
        usedNames.add(name);

        const ws = XLSX.utils.aoa_to_sheet(rows);
        XLSX.utils.book_append_sheet(wb, ws, name);
      });

      const trig = entrepriseObj?.trigramme || "inv";
      const now = new Date();
      const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
      const suff = groupBy === "FOURN" ? "fourn" : "zones";
      XLSX.writeFile(wb, `recap_${suff}_${trig}_${stamp}.xlsx`);
    } finally {
      setIsExporting(false);
    }
  }, [
    recap,
    groupesBruts,
    groupBy,
    totaux,
    session,
    entrepriseObj,
    filtreExport,
    seuilNum,
  ]);

  // =============================================
  // PDF d'UNE zone (vrai PDF backend = feuille de contrôle)
  // =============================================
  const openZonePdf = useCallback(
    (zoneCode) => {
      if (!selectedEntreprise || !zoneCode) return;
      const url = `${API_BASE}/api/inventaires-collecte/recap-zones/${selectedEntreprise}/pdf?zoneCode=${encodeURIComponent(
        zoneCode,
      )}`;
      window.open(url, "_blank");
    },
    [selectedEntreprise],
  );

  return (
    <div className="admin-recap-zones-page">
      {/* HEADER */}
      <div className="recap-header">
        <div className="header-title">
          <HiViewGrid className="title-icon" />
          <h1>Récap par {groupBy === "FOURN" ? "fournisseur" : "zone"}</h1>
        </div>

        <div className="header-center">
          <div className="entreprise-selector">
            <select value={selectedEntreprise} onChange={handleEntrepriseChange}>
              <option value="">— Choisir une entreprise —</option>
              {entreprises?.map((e) => (
                <option key={e._id} value={e._id}>
                  {e.trigramme} — {e.nomComplet}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="header-actions">
          <button
            className="btn-action"
            onClick={() => refetch()}
            disabled={!selectedEntreprise || isFetching}
            title="Rafraîchir"
          >
            <HiRefresh className={isFetching ? "spinning" : ""} />
          </button>
          <button
            className="btn-action primary"
            onClick={handleExportExcel}
            disabled={!groupesBruts.length || isExporting}
            title="Exporter en Excel"
          >
            <HiDownload />
          </button>
        </div>
      </div>

      {/* CORPS */}
      <div className="recap-content">
        {!selectedEntreprise && (
          <div className="empty-state">
            <HiViewGrid className="empty-icon" />
            <h2>Sélectionnez une entreprise</h2>
            <p>
              Le récap affiche la session d'inventaire active, regroupée par zone
              ou par fournisseur, avec les écarts en quantité et en valeur (XPF).
            </p>
          </div>
        )}

        {selectedEntreprise && isLoading && (
          <div className="loading-state">
            <div className="loading-spinner" />
            <p>Chargement du récap…</p>
          </div>
        )}

        {selectedEntreprise && error && (
          <div className="error-state">
            <HiExclamation className="error-icon" />
            <h2>Erreur</h2>
            <p>{error?.data?.message || "Impossible de charger le récap."}</p>
            <button onClick={() => refetch()}>Réessayer</button>
          </div>
        )}

        {selectedEntreprise && !isLoading && !error && (
          <>
            {/* Barre de totaux */}
            {totaux && (
              <div className="totaux-bar">
                <div className="totaux-card">
                  <span className="t-label">
                    {groupBy === "FOURN" ? "Fournisseurs" : "Zones"}
                  </span>
                  <span className="t-value">
                    {groupBy === "FOURN"
                      ? totaux.totalFournisseurs
                      : totaux.totalZones}
                  </span>
                </div>
                <div className="totaux-card">
                  <span className="t-label">Articles</span>
                  <span className="t-value">{fmt(totaux.totalArticles)}</span>
                </div>
                <div className="totaux-card">
                  <span className="t-label">Qté bipée</span>
                  <span className="t-value">{fmt(totaux.totalQteBipee)}</span>
                </div>
                <div className="totaux-card">
                  <span className="t-label">Écart qté</span>
                  <span className={`t-value ${ecartClass(totaux.totalEcart)}`}>
                    {fmt(totaux.totalEcart)}
                  </span>
                </div>
                <div className="totaux-card highlight">
                  <span className="t-label">Écart valeur</span>
                  <span
                    className={`t-value ${ecartClass(totaux.totalEcartXpf)}`}
                  >
                    {fmtXpf(totaux.totalEcartXpf)}
                  </span>
                </div>
                <div className="totaux-card">
                  <span className="t-label">Nb écarts</span>
                  <span className="t-value">{fmt(totaux.nbEcarts)}</span>
                </div>
              </div>
            )}

            {/* Outils */}
            <div className="tools-bar">
              <div className="search-box">
                <HiSearch className="search-icon" />
                <input
                  type="text"
                  placeholder="Rechercher (NART, code-barres, désignation, fourn.)…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                {search && (
                  <button className="clear-search" onClick={() => setSearch("")}>
                    <HiX />
                  </button>
                )}
              </div>

              <div className="filter-group">
                <button
                  className={groupBy === "ZONE" ? "active" : ""}
                  onClick={() => {
                    setGroupBy("ZONE");
                    setOpenGroups(new Set());
                  }}
                >
                  Par zone
                </button>
                <button
                  className={groupBy === "FOURN" ? "active" : ""}
                  onClick={() => {
                    setGroupBy("FOURN");
                    setOpenGroups(new Set());
                  }}
                >
                  Par fournisseur
                </button>
              </div>

              <div className="filter-group">
                <button
                  className={filterEcart === "TOUT" ? "active" : ""}
                  onClick={() => setFilterEcart("TOUT")}
                >
                  Tout
                </button>
                <button
                  className={filterEcart === "ECARTS" ? "active" : ""}
                  onClick={() => setFilterEcart("ECARTS")}
                >
                  Écarts seulement
                </button>
              </div>

              <div className="seuil-box" title="Filtre appliqué à l'export Excel uniquement">
                <label>Export si |écart| ≥</label>
                <input
                  type="number"
                  min="0"
                  step="1000"
                  placeholder="0"
                  value={seuilXpf}
                  onChange={(e) => setSeuilXpf(e.target.value)}
                />
                <span className="seuil-unit">XPF</span>
              </div>

              <div className="expand-group">
                <button onClick={expandAll}>Tout déplier</button>
                <button onClick={collapseAll}>Tout replier</button>
              </div>
            </div>

            {/* Liste des groupes */}
            {groupes.length === 0 ? (
              <div className="empty-state small">
                <HiCheckCircle className="empty-icon" />
                <p>
                  Aucun élément à afficher (ou aucune collecte sur la session
                  active).
                </p>
              </div>
            ) : (
              <div className="zones-list">
                {groupes.map((g) => {
                  const isOpen = openGroups.has(g.key);
                  const lignes = g.lignesFiltrees;
                  return (
                    <div className="zone-card" key={g.key}>
                      <div className="zone-head-row">
                        <button
                          className="zone-head"
                          onClick={() => toggleGroup(g.key)}
                        >
                          <span className="zone-toggle">
                            {isOpen ? <HiChevronDown /> : <HiChevronRight />}
                          </span>
                          <span className="zone-code">{g.titre}</span>
                          {g.sousTitre && (
                            <span className="zone-libelle">{g.sousTitre}</span>
                          )}
                          <span className="zone-stats">
                            <span className="zs">{g.totalArticles} art.</span>
                            <span className="zs">
                              bipé&nbsp;{fmt(g.totalQteBipee)}
                            </span>
                            <span className={`zs ecart ${ecartClass(g.totalEcart)}`}>
                              éc.&nbsp;{fmt(g.totalEcart)}
                            </span>
                            <span
                              className={`zs ecart ${ecartClass(g.totalEcartXpf)}`}
                            >
                              {fmtXpf(g.totalEcartXpf)}
                            </span>
                            {g.nbEcarts > 0 && (
                              <span className="zs badge-ecart">
                                {g.nbEcarts} écart(s)
                              </span>
                            )}
                          </span>
                        </button>

                        {/* Bouton PDF : seulement en regroupement par zone */}
                        {groupBy === "ZONE" && (
                          <button
                            className="btn-pdf-zone"
                            onClick={() => openZonePdf(g.titre)}
                            title="Feuille de contrôle PDF de cette zone"
                          >
                            <HiDocumentDownload />
                            <span>PDF</span>
                          </button>
                        )}
                      </div>

                      {isOpen && (
                        <div className="zone-body">
                          <table className="lignes-table">
                            <thead>
                              <tr>
                                <th>NART</th>
                                <th>GENCOD</th>
                                <th>Désignation</th>
                                {groupBy === "FOURN" ? (
                                  <th>Zone</th>
                                ) : (
                                  <th>Fourn.</th>
                                )}
                                <th className="num">Qté bipée</th>
                                <th className="num">Stock théo.</th>
                                <th className="num">Écart</th>
                                <th className="num">PA</th>
                                <th className="num">Écart XPF</th>
                              </tr>
                            </thead>
                            <tbody>
                              {lignes.map((l, idx) => (
                                <tr key={`${l.nart}-${idx}`}>
                                  <td className="mono">{l.nart}</td>
                                  <td className="mono">{l.gencod}</td>
                                  <td className="design">
                                    {l.designation}
                                    {l.isRenvoi && (
                                      <span className="tag renvoi">renvoi</span>
                                    )}
                                    {l.isUnknown && (
                                      <span className="tag unknown">inconnu</span>
                                    )}
                                    {!l.articleTrouve && (
                                      <span className="tag absent">hors DBF</span>
                                    )}
                                  </td>
                                  <td className="mono">
                                    {groupBy === "FOURN" ? l.zoneCode : l.fourn}
                                  </td>
                                  <td className="num">{fmt(l.qteBipee)}</td>
                                  <td className="num">{fmt(l.stockTheorique)}</td>
                                  <td className={`num ${ecartClass(l.ecart)}`}>
                                    {fmt(l.ecart)}
                                  </td>
                                  <td className="num">{fmt(l.prixAchat)}</td>
                                  <td className={`num ${ecartClass(l.ecartXpf)}`}>
                                    {fmt(Math.round(l.ecartXpf))}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                            <tfoot>
                              <tr>
                                <td colSpan={4}>Total</td>
                                <td className="num">{fmt(g.totalQteBipee)}</td>
                                <td className="num">
                                  {fmt(g.totalStockTheorique)}
                                </td>
                                <td className={`num ${ecartClass(g.totalEcart)}`}>
                                  {fmt(g.totalEcart)}
                                </td>
                                <td className="num"></td>
                                <td
                                  className={`num ${ecartClass(g.totalEcartXpf)}`}
                                >
                                  {fmt(Math.round(g.totalEcartXpf))}
                                </td>
                              </tr>
                            </tfoot>
                          </table>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default AdminRecapZonesScreen;