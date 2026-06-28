// src/screens/admin/AdminFournisseurInfosScreen.jsx
import React, { useState, useEffect } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import {
  HiArrowLeft, HiOfficeBuilding, HiPhone, HiLocationMarker, HiDocumentText,
  HiCube, HiChevronLeft, HiChevronRight, HiRefresh, HiExternalLink, HiExclamation,
  HiChip, HiCalculator, HiCalendar, HiMail, HiAnnotation
} from "react-icons/hi";
import { useGetEntreprisesQuery } from "../../slices/entrepriseApiSlice";
import {
  useGetFournisseurByCodeQuery,
  useGetArticlesByFournisseurQuery,
} from "../../slices/fournissApiSlice";
import "./AdminFournisseurInfosScreen.css";

const AdminFournisseurInfosScreen = () => {
  const { nomDossierDBF, fournId } = useParams();
  const navigate = useNavigate();
  
  const [selectedEntreprise, setSelectedEntreprise] = useState(nomDossierDBF || "");
  const [articlePage, setArticlePage] = useState(1);
  const [articleLimit] = useState(25);

  // Queries
  const { data: entreprises } = useGetEntreprisesQuery();
  
  // Query Fournisseur avec les stats incluses
  const { data: fournData, isLoading: loadingFourn, refetch } = 
    useGetFournisseurByCodeQuery({ nomDossierDBF: selectedEntreprise, fourn: fournId }, { skip: !selectedEntreprise || !fournId });
  
  // Query Articles liés
  const { data: articlesData, isLoading: loadingArticles, isFetching: fetchingArticles } = 
    useGetArticlesByFournisseurQuery(
      { nomDossierDBF: selectedEntreprise, fourn: fournId, page: articlePage, limit: articleLimit }, 
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

  const safeTrim = (val) => (val === null || val === undefined ? "" : String(val).trim());

  const formatPrice = (p) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "XPF" }).format(p || 0);

  const calculateStockTotal = (art) => {
    if (!art) return 0;
    return (parseFloat(art.S1) || 0) + (parseFloat(art.S2) || 0) + (parseFloat(art.S3) || 0) + (parseFloat(art.S4) || 0) + (parseFloat(art.S5) || 0);
  };

  const isDepreciated = (art) => {
    const design = safeTrim(art.DESIGN);
    const stock = calculateStockTotal(art);
    return design.includes("**") && stock === 0;
  };

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
                  <p className="dep-warning-a">⚠️ Attention : Ce fournisseur a un fort taux d'articles dépréciés (contenant "**" et stock nul).</p>
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
                <span className="badge">{articlesData?.pagination?.totalRecords || 0} références</span>
              </div>

              {loadingArticles ? (
                <div className="loading-inline"><div className="loading-spinner small"></div></div>
              ) : articlesData?.articles?.length > 0 ? (
                <>
                  <table className="linked-articles-table">
                    <thead>
                      <tr>
                        <th>Code</th>
                        <th>Désignation</th>
                        <th className="text-right">Stock</th>
                        <th className="text-right">PV TTC</th>
                      </tr>
                    </thead>
                    <tbody>
                      {articlesData.articles.map((art) => {
                        const deprecated = isDepreciated(art);
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
                            <td className="text-right">{calculateStockTotal(art)}</td>
                            <td className="text-right">{formatPrice(art.PVTETTC)}</td>
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
                </>
              ) : (
                <div className="empty-state-mini">
                  <p>Aucun article trouvé pour ce fournisseur.</p>
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