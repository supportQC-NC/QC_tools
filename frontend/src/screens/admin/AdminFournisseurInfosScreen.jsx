// src/screens/admin/AdminFournisseurInfosScreen.jsx
import React, { useState, useEffect } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import {
  HiArrowLeft, HiOfficeBuilding, HiPhone, HiLocationMarker, HiDocumentText,
  HiCube, HiChevronLeft, HiChevronRight, HiRefresh, HiExternalLink, HiExclamation,
  HiChip, HiCalculator, HiCalendar, HiMail, HiAnnotation, HiFilter, HiTable,
  HiTrendingUp, HiArchive
} from "react-icons/hi";
import { useGetEntreprisesQuery } from "../../slices/entrepriseApiSlice";
import {
  useGetFournisseurByCodeQuery,
  useGetArticlesByFournisseurQuery,
} from "../../slices/fournissApiSlice";
import { BASE_URL } from "../../constants";
import "./AdminFournisseurInfosScreen.css";

// Filtre de dépréciation (stock total nul ET DEPREC > 1) — valeurs alignées
// sur celles attendues par l'API.
const DEPRECATION_OPTIONS = [
  { value: "tout", label: "Tous les articles" },
  { value: "non-deprecies", label: "Non dépréciés" },
  { value: "deprecies", label: "Dépréciés" },
];

// Filtre sur le stock total S1..S5. Les deux valeurs sont complémentaires :
// le stock négatif (rare) est compté avec le stock nul.
const STOCK_OPTIONS = [
  { value: "tout", label: "Tous stocks" },
  { value: "positif", label: "Stock positif" },
  { value: "zero", label: "Stock nul" },
];

const AdminFournisseurInfosScreen = () => {
  const { nomDossierDBF, fournId } = useParams();
  const navigate = useNavigate();
  
  const [selectedEntreprise, setSelectedEntreprise] = useState(nomDossierDBF || "");
  const [articlePage, setArticlePage] = useState(1);
  const [articleLimit] = useState(25);
  const [deprecation, setDeprecation] = useState("tout");
  const [stockFilter, setStockFilter] = useState("tout");
  const [exporting, setExporting] = useState(false);

  // Queries
  const { data: entreprises } = useGetEntreprisesQuery();
  
  // Query Fournisseur avec les stats incluses
  const { data: fournData, isLoading: loadingFourn, refetch } = 
    useGetFournisseurByCodeQuery({ nomDossierDBF: selectedEntreprise, fourn: fournId }, { skip: !selectedEntreprise || !fournId });
  
  // Query Articles liés
  const { data: articlesData, isLoading: loadingArticles, isFetching: fetchingArticles } =
    useGetArticlesByFournisseurQuery(
      { nomDossierDBF: selectedEntreprise, fourn: fournId, page: articlePage, limit: articleLimit, deprecation, stock: stockFilter },
      { skip: !selectedEntreprise || !fournId }
    );

  const fournisseur = fournData?.fournisseur;
  const depStats = fournData?.depreciationStats; // Les stats reçues du backend

  useEffect(() => {
    if (nomDossierDBF) setSelectedEntreprise(nomDossierDBF);
  }, [nomDossierDBF]);
  
  useEffect(() => {
    setArticlePage(1);
  }, [fournId]);

  // Changer de filtre remet la pagination à la première page.
  useEffect(() => {
    setArticlePage(1);
  }, [deprecation, stockFilter]);

  // Export Excel : reprend les filtres actifs, toutes pages confondues.
  const exporterArticles = async () => {
    if (!selectedEntreprise || !fournId) return;
    setExporting(true);
    try {
      const params = new URLSearchParams();
      if (deprecation !== "tout") params.set("deprecation", deprecation);
      if (stockFilter !== "tout") params.set("stock", stockFilter);
      const qs = params.toString();
      const url = `${BASE_URL}/api/fournisseurs/${selectedEntreprise}/code/${fournId}/articles/export${qs ? `?${qs}` : ""}`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) {
        let msg = `Export échoué (${res.status})`;
        try {
          const j = await res.json();
          if (j?.message) msg = j.message;
        } catch {
          /* réponse non-JSON */
        }
        throw new Error(msg);
      }
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      const suffixe =
        (deprecation === "tout" ? "" : `_${deprecation}`) +
        (stockFilter === "tout" ? "" : `_stock-${stockFilter}`);
      a.download = `articles_fournisseur_${fournId}${suffixe}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(href), 60000);
    } catch (e) {
      alert(e.message || "Impossible de générer l'export Excel");
    } finally {
      setExporting(false);
    }
  };

  const safeTrim = (val) => (val === null || val === undefined ? "" : String(val).trim());

  const formatPrice = (p) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "XPF" }).format(p || 0);

  const formatNombre = (n) =>
    new Intl.NumberFormat("fr-FR").format(Math.round(n || 0));

  // Stock total, dépréciation et ventes sont calculés côté serveur
  // (_stockTotal, _deprecie, _ventes) : une seule règle métier fait foi.
  const calculateStockTotal = (art) =>
    art?._stockTotal ??
    (parseFloat(art?.S1) || 0) + (parseFloat(art?.S2) || 0) + (parseFloat(art?.S3) || 0) +
    (parseFloat(art?.S4) || 0) + (parseFloat(art?.S5) || 0);

  const isDepreciated = (art) => !!art?._deprecie;

  const ventes = articlesData?.ventes;

  // Helper pour afficher un champ s'il existe
  const InfoItem = ({ label, value, icon }) => (
    (value ? (
      <div className="info-item">
        <label>{icon && <span className="label-icon">{icon}</span>} {label}</label>
        <span className="value">{value}</span>
      </div>
    ) : null)
  );

  if (loadingFourn) return <div className="fourn-infos-page"><div className="loading-spinner"></div></div>;
  if (!fournisseur) return <div className="fourn-infos-page"><div className="error-state">Fournisseur non trouvé</div></div>;

  return (
    <div className="fourn-infos-page">
      {/* Header */}
      <header className="fourn-infos-header">
        <div className="header-left">
          <button className="btn-back" onClick={() => navigate(-1)}><HiArrowLeft /></button>
          <div className="header-title">
            <div className="header-icon small"><HiOfficeBuilding /></div>
            <div>
              <h1>{safeTrim(fournisseur.NOM)}</h1>
              <span className="header-subtitle">Code Fournisseur : {fournisseur.FOURN}</span>
            </div>
          </div>
        </div>
        <div className="header-actions">
          <button className="btn-action" onClick={refetch}><HiRefresh /></button>
        </div>
      </header>

      <div className="fourn-infos-content">
        <div className="fourn-main-grid">
          {/* Colonne Gauche: Infos Fournisseur */}
          <div className="fourn-left-col">
            
            {/* Carte Dépréciation */}
            {depStats && (
              <div className={`fourn-card dep-card ${parseFloat(depStats.rate) > 10 ? 'alert' : ''}`}>
                <h3><HiExclamation /> Taux de Dépréciation</h3>
                <div className="dep-stats-grid">
                  <div className="dep-stat main">
                    <span className="dep-value">{depStats.rate}%</span>
                    <span className="dep-label">Articles Dépréciés</span>
                  </div>
                  <div className="dep-stat">
                    <span className="dep-num">{depStats.deprecated}</span>
                    <span className="dep-label">Dépréciés</span>
                  </div>
                  <div className="dep-stat">
                    <span className="dep-num">{depStats.total}</span>
                    <span className="dep-label">Total Articles</span>
                  </div>
                </div>
                <div className="progress-bar-dep">
                  <div className="progress-fill" style={{ width: `${depStats.rate}%` }}></div>
                </div>
                {parseFloat(depStats.rate) > 60 && (
                  <p className="dep-warning-a">⚠️ Attention : Ce fournisseur a un fort taux d'articles dépréciés (stock nul et DEPREC &gt; 1).</p>
                )}
              </div>
            )}

            {/* Coordonnées */}
            <div className="fourn-card">
              <h3><HiLocationMarker /> Coordonnées</h3>
              <div className="info-grid-2cols">
                <InfoItem label="Adresse 1" value={safeTrim(fournisseur.AD1)} />
                <InfoItem label="Adresse 2" value={safeTrim(fournisseur.AD2)} />
                <InfoItem label="Adresse 3" value={safeTrim(fournisseur.AD3)} />
                <InfoItem label="Adresse 4" value={safeTrim(fournisseur.AD4)} />
                <InfoItem label="Adresse 5" value={safeTrim(fournisseur.AD5)} />
                <InfoItem label="Localisation" value={safeTrim(fournisseur.LOCAL)} icon={<HiLocationMarker />} />
              </div>
              <div className="info-grid-2cols mt-1">
                 <InfoItem label="Téléphone" value={safeTrim(fournisseur.TEL)} icon={<HiPhone />} />
                 <InfoItem label="Fax" value={safeTrim(fournisseur.FAX)} icon={<HiDocumentText />} />
                 <InfoItem label="Télex / Email" value={safeTrim(fournisseur.TLX)} icon={<HiMail />} />
              </div>
            </div>

            {/* Informations Commerciales */}
            <div className="fourn-card">
              <h3><HiCalculator /> Informations Commerciales</h3>
              <div className="info-grid-2cols">
                <InfoItem label="Délai Appro (Jours)" value={safeTrim(fournisseur.DELAPRO)} icon={<HiCalendar />} />
                <InfoItem label="Coef Stock Mini" value={safeTrim(fournisseur.COEFSMINI)} />
                <InfoItem label="Franco" value={safeTrim(fournisseur.FRANCO)} />
                <InfoItem label="Code Texte" value={safeTrim(fournisseur.TEXTE)} />
              </div>
            </div>

            {/* Observations */}
            {safeTrim(fournisseur.OBSERV) && (
              <div className="fourn-card observations">
                <h3><HiAnnotation /> Observations</h3>
                <p>{safeTrim(fournisseur.OBSERV)}</p>
              </div>
            )}
            
            {/* Notes (NOT1-NOT10) - On affiche seulement si au moins une existe */}
            {Array.from({length: 10}, (_, i) => safeTrim(fournisseur[`NOT${i+1}`])).some(v => v) && (
               <div className="fourn-card notes-section">
               <h3><HiDocumentText /> Notes & Textes</h3>
               <div className="notes-grid">
                 {Array.from({length: 10}, (_, i) => safeTrim(fournisseur[`NOT${i+1}`])).map((note, idx) => (
                   note && <div key={idx} className="note-item">{note}</div>
                 ))}
               </div>
             </div>
            )}

          </div>

          {/* Colonne Droite: Articles Liés */}
          <div className="fourn-right-col">
            <div className="fourn-card articles-section">
              <div className="section-header">
                <h3><HiCube /> Articles fournis</h3>
                <span className="badge">
                  {articlesData?.pagination?.totalRecords || 0} référence
                  {(articlesData?.pagination?.totalRecords || 0) > 1 ? "s" : ""}
                  {deprecation !== "tout" || stockFilter !== "tout" ? " (filtrées)" : ""}
                </span>
              </div>

              {/* Filtres + export Excel (l'export reprend les filtres actifs) */}
              <div className="articles-toolbar">
                <label className="deprec-filter">
                  <HiFilter />
                  <select
                    value={deprecation}
                    onChange={(e) => setDeprecation(e.target.value)}
                  >
                    {DEPRECATION_OPTIONS.map((o) => {
                      const total = depStats ? parseInt(depStats.total, 10) : null;
                      const deprecies = depStats ? parseInt(depStats.deprecated, 10) : null;
                      let compte = null;
                      if (total !== null && deprecies !== null) {
                        if (o.value === "tout") compte = total;
                        else if (o.value === "deprecies") compte = deprecies;
                        else compte = total - deprecies;
                      }
                      return (
                        <option key={o.value} value={o.value}>
                          {o.label}{compte !== null ? ` (${compte})` : ""}
                        </option>
                      );
                    })}
                  </select>
                </label>

                <label className="deprec-filter">
                  <HiArchive />
                  <select
                    value={stockFilter}
                    onChange={(e) => setStockFilter(e.target.value)}
                  >
                    {STOCK_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </label>

                <button
                  type="button"
                  className="btn-export-excel"
                  onClick={exporterArticles}
                  disabled={exporting || fetchingArticles}
                  title="Exporter en Excel les articles affichés (filtres inclus)"
                >
                  <HiTable /> {exporting ? "Export…" : "Exporter Excel"}
                </button>
              </div>

              {/* Ventes cumulées du fournisseur sur les articles filtrés
                  (V1 = mois courant, CA HT = quantité × PVTE) */}
              {ventes && (
                <div className="ventes-fourn">
                  <h4><HiTrendingUp /> Ventes du fournisseur</h4>
                  <div className="ventes-grid">
                    {[
                      { cle: "Mois courant", qte: ventes.qteMois, ca: ventes.caMois },
                      { cle: "3 derniers mois", qte: ventes.qte3Mois, ca: ventes.ca3Mois },
                      { cle: "12 derniers mois", qte: ventes.qte12Mois, ca: ventes.ca12Mois },
                    ].map((p) => (
                      <div className="vente-periode" key={p.cle}>
                        <span className="vente-label">{p.cle}</span>
                        <span className="vente-ca">{formatPrice(p.ca)}</span>
                        <span className="vente-qte">{formatNombre(p.qte)} u.</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* fetchingArticles inclus : au changement de filtre on n'affiche
                  jamais les lignes du filtre précédent */}
              {loadingArticles || fetchingArticles ? (
                <div className="loading-inline"><div className="loading-spinner small"></div></div>
              ) : articlesData?.articles?.length > 0 ? (
                <div className="articles-table-scroll">
                  <table className="linked-articles-table">
                    <thead>
                      <tr>
                        <th>Code</th>
                        <th>Désignation</th>
                        <th className="text-right">Stock</th>
                        <th className="text-right">PV HT</th>
                        <th className="text-right" title="Quantité vendue le mois courant (V1)">Qté mois</th>
                        <th className="text-right" title="Quantité vendue sur 3 mois (V1+V2+V3)">Qté 3 m.</th>
                        <th className="text-right" title="Quantité vendue sur 12 mois (V1..V12)">Qté 12 m.</th>
                        <th className="text-right" title="Chiffre d'affaires HT sur 12 mois (quantité × PVTE)">CA HT 12 m.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {articlesData.articles.map((art) => {
                        const deprecated = isDepreciated(art);
                        const v = art._ventes || {};
                        return (
                          <tr key={art.NART} className={deprecated ? "row-deprecated" : ""}>
                            <td>
                              <Link to={`/admin/articles/${selectedEntreprise}/${safeTrim(art.NART)}`} className="link-nart">
                                {safeTrim(art.NART)} <HiExternalLink />
                              </Link>
                            </td>
                            <td>
                              {safeTrim(art.DESIGN)}
                              {deprecated && <span className="deprecated-badge"><HiExclamation /> Déprécié</span>}
                            </td>
                            <td className="text-right">{formatNombre(calculateStockTotal(art))}</td>
                            <td className="text-right">{formatPrice(art.PVTE)}</td>
                            <td className="text-right">{formatNombre(v.qteMois)}</td>
                            <td className="text-right">{formatNombre(v.qte3Mois)}</td>
                            <td className="text-right">{formatNombre(v.qte12Mois)}</td>
                            <td className="text-right">{formatPrice(v.ca12Mois)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>

                  {/* Pagination Articles */}
                  {articlesData.pagination?.totalPages > 1 && (
                    <div className="pagination-mini">
                      <button 
                        disabled={!articlesData.pagination.hasPrevPage} 
                        onClick={() => setArticlePage(p => p - 1)}
                      >
                        <HiChevronLeft />
                      </button>
                      <span>Page {articlesData.pagination.page} / {articlesData.pagination.totalPages}</span>
                      <button 
                        disabled={!articlesData.pagination.hasNextPage} 
                        onClick={() => setArticlePage(p => p + 1)}
                      >
                        <HiChevronRight />
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="empty-state-mini">
                  <p>
                    Aucun article pour ce fournisseur avec ces filtres
                    {deprecation !== "tout" || stockFilter !== "tout"
                      ? ` (${[
                          DEPRECATION_OPTIONS.find((o) => o.value === deprecation)?.label,
                          STOCK_OPTIONS.find((o) => o.value === stockFilter)?.label,
                        ].filter(Boolean).join(" · ")})`
                      : ""}
                    .
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminFournisseurInfosScreen;