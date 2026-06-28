// src/screens/admin/AdminClientDetailScreen.jsx
import React from "react";
import { Link, useParams } from "react-router-dom";
import {
  HiArrowLeft, HiExclamation, HiRefresh, HiUser, HiUserGroup,
  HiPhone, HiMail, HiLocationMarker, HiIdentification,
  HiCurrencyDollar, HiExternalLink, HiOfficeBuilding, HiCalendar,
  HiClipboardList, HiDocumentText, HiShieldCheck, HiChat,
  HiTag, HiCollection,
} from "react-icons/hi";
import {
  useGetClientByTiersQuery,
  useGetClientCrossEntrepriseQuery,
} from "../../slices/clientApiSlice";
import "./AdminClientDetailsScreen.css";

const AdminClientDetailScreen = () => {
  const { nomDossierDBF, tiers } = useParams();

  const { data: clientData, isLoading, error, refetch } = useGetClientByTiersQuery(
    { nomDossierDBF, tiers },
    { skip: !nomDossierDBF || !tiers },
  );

  const { data: crossData, isLoading: loadingCross } = useGetClientCrossEntrepriseQuery(
    { nomDossierDBF, tiers },
    { skip: !nomDossierDBF || !tiers },
  );

  const client = clientData?.client;

  const safeTrim = (value) => {
    if (value === null || value === undefined) return "";
    if (typeof value === "string") return value.trim();
    return String(value);
  };

  const formatPrice = (price) => {
    if (!price && price !== 0) return "-";
    return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "XPF", minimumFractionDigits: 0 }).format(price);
  };

  const formatDate = (dateValue) => {
    if (!dateValue) return "-";
    if (dateValue instanceof Date) {
      if (isNaN(dateValue.getTime())) return "-";
      return dateValue.toLocaleDateString("fr-FR");
    }
    if (typeof dateValue === "string" && dateValue.length === 8) {
      return `${dateValue.substring(6, 8)}/${dateValue.substring(4, 6)}/${dateValue.substring(0, 4)}`;
    }
    if (typeof dateValue === "string" && dateValue.includes("-")) {
      const d = new Date(dateValue);
      if (!isNaN(d.getTime())) return d.toLocaleDateString("fr-FR");
    }
    return "-";
  };

  if (isLoading) {
    return (
      <div className="client-detail-page">
        <div className="detail-loading"><div className="loading-spinner"></div><p>Chargement du client...</p></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="client-detail-page">
        <div className="detail-error">
          <HiExclamation />
          <h2>Erreur</h2>
          <p>{error?.data?.message || "Impossible de charger le client"}</p>
          <div className="error-actions">
            <button onClick={refetch} className="btn-retry"><HiRefresh /> Réessayer</button>
            <Link to={`/admin/clients/${nomDossierDBF}`} className="btn-back"><HiArrowLeft /> Retour</Link>
          </div>
        </div>
      </div>
    );
  }

  if (!client) return null;

  const solde = (client.DEBIT || 0) - (client.CREDIT || 0);
  const crossEntreprises = crossData?.crossEntreprise || [];
  const ridet = crossData?.ridet || client._ridet || "";
  const tiersInfo = client._tiersInfo || [];
  const comptes = client._comptes || [];

  return (
    <div className="client-detail-page">
      {/* TOP BAR */}
      <div className="detail-topbar">
        <Link to={`/admin/clients/${nomDossierDBF}`} className="btn-back-list"><HiArrowLeft /><span>Clients</span></Link>
        <div className="topbar-nav"><span className="nav-current"><HiUser /> Tiers {client.TIERS}</span></div>
        <div className="topbar-meta">
          {clientData?._queryTime && <span className="query-time">{clientData._queryTime}</span>}
          <button className="btn-refresh" onClick={refetch} title="Rafraîchir"><HiRefresh /></button>
        </div>
      </div>

      <div className="detail-content">
        {/* HEADER CARD */}
        <div className="detail-header-card">
          <div className="header-card-top">
            <div className="header-card-title">
              <div className="numfact-display">
                <span className="numfact-label">Client</span>
                <span className="numfact-value">{safeTrim(client.NOM) || `Tiers ${client.TIERS}`}</span>
              </div>
              <span className="tiers-badge-large">Tiers {client.TIERS}</span>
            </div>
          </div>

          <div className="header-info-grid">
            <div className="info-card">
              <div className="info-card-icon"><HiIdentification /></div>
              <div className="info-card-content">
                <label>RIDET</label>
                <span>{ridet || "-"}</span>
                {ridet && <small className="ridet-raw">Brut: {safeTrim(client.AD5)}</small>}
              </div>
            </div>
            <div className="info-card">
              <div className="info-card-icon"><HiUserGroup /></div>
              <div className="info-card-content"><label>Représentant</label><span>{client.REPRES || "-"}</span></div>
            </div>
            <div className="info-card">
              <div className="info-card-icon"><HiTag /></div>
              <div className="info-card-content"><label>Cat. client (CATCLI)</label><span>{safeTrim(client.CATCLI) || "-"}</span></div>
            </div>
            <div className="info-card">
              <div className="info-card-icon"><HiCollection /></div>
              <div className="info-card-content"><label>Type</label><span>{safeTrim(client.TYPE) || "-"}</span></div>
            </div>
            <div className="info-card">
              <div className="info-card-icon">📂</div>
              <div className="info-card-content"><label>Catégorie</label><span>{safeTrim(client.CATEGORIE) || "-"}</span></div>
            </div>
            <div className="info-card">
              <div className="info-card-icon">👥</div>
              <div className="info-card-content"><label>Groupe</label><span>{safeTrim(client.GROUPE) || "-"}</span></div>
            </div>
            <div className="info-card">
              <div className="info-card-icon"><HiCalendar /></div>
              <div className="info-card-content"><label>Création</label><span>{formatDate(client.CREATION)}</span></div>
            </div>
            <div className="info-card">
              <div className="info-card-icon"><HiPhone /></div>
              <div className="info-card-content"><label>Téléphone</label><span>{safeTrim(client.TEL) || "-"}</span></div>
            </div>
            <div className="info-card">
              <div className="info-card-icon"><HiMail /></div>
              <div className="info-card-content"><label>Email</label><span>{safeTrim(client.ADMAIL) || "-"}</span></div>
            </div>
            <div className="info-card">
              <div className="info-card-icon"><HiCurrencyDollar /></div>
              <div className="info-card-content">
                <label>Compte(s) tiers</label>
                <span>{comptes.length > 0 ? comptes.join(", ") : "-"}</span>
              </div>
            </div>
          </div>

          {safeTrim(client.OBSERV) && (
            <div className="header-observ">
              <span className="observ-label">📝 Observations</span>
              <p>{safeTrim(client.OBSERV)}</p>
            </div>
          )}
        </div>

        {/* ADRESSE */}
        <div className="section-card">
          <h3><HiLocationMarker /> Adresse</h3>
          <div className="address-block">
            {[1, 2, 3, 4].map((i) => {
              const line = safeTrim(client[`AD${i}`]);
              return line ? <p key={i} className="address-line">{line}</p> : null;
            })}
            {!safeTrim(client.AD1) && <p className="no-data">Aucune adresse renseignée</p>}
          </div>
        </div>

        {/* MONTANTS CLIENT */}
        <div className="montants-cards">
          <div className="montant-card">
            <span className="montant-label">Débit</span>
            <span className="montant-value debit">{formatPrice(client.DEBIT)}</span>
          </div>
          <div className="montant-card">
            <span className="montant-label">Crédit</span>
            <span className="montant-value credit">{formatPrice(client.CREDIT)}</span>
          </div>
          <div className={`montant-card main ${solde > 0 ? "solde-debiteur" : "solde-crediteur"}`}>
            <span className="montant-label">Solde</span>
            <span className="montant-value">{formatPrice(solde)}</span>
          </div>
          <div className="montant-card">
            <span className="montant-label">Débit max</span>
            <span className="montant-value">{formatPrice(client.DEBIMAX)}</span>
          </div>
          <div className="montant-card">
            <span className="montant-label">Remise</span>
            <span className="montant-value">{client.REMISE || 0}%</span>
          </div>
        </div>

        {/* COMPTES TIERS (tiers.dbf) */}
        {tiersInfo.length > 0 && (
          <div className="section-card tiers-compta-section">
            <h3><HiCurrencyDollar /> Comptes tiers (comptabilité)</h3>
            <p className="tiers-compta-desc">Données <strong>tiers.dbf</strong> — liées par TIERS {client.TIERS}</p>
            <div className="tiers-compta-cards">
              {tiersInfo.map((t, idx) => {
                const ts = (t.DEBIT || 0) - (t.CREDIT || 0);
                return (
                  <div key={idx} className="tiers-compta-card">
                    <div className="tiers-compta-card-header">
                      <span className="tiers-compta-compte-large">{t.COMPTE}</span>
                      <span className="tiers-compta-nom-large">{t.NOM}</span>
                    </div>
                    <div className="tiers-compta-card-body">
                      <div className="tiers-compta-montant"><span className="tiers-compta-label">Débit</span><span className="tiers-compta-val debit">{formatPrice(t.DEBIT)}</span></div>
                      <div className="tiers-compta-montant"><span className="tiers-compta-label">Crédit</span><span className="tiers-compta-val credit">{formatPrice(t.CREDIT)}</span></div>
                      <div className="tiers-compta-montant"><span className="tiers-compta-label">Solde</span><span className={`tiers-compta-val ${ts > 0 ? "debit" : "credit"}`}>{formatPrice(ts)}</span></div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* CONTACT */}
        <div className="section-card">
          <h3><HiUser /> Contact & Interlocuteur</h3>
          <div className="contact-grid">
            <div className="contact-item"><label>Interlocuteur</label><span>{safeTrim(client.INTERLOC) || "-"}</span></div>
            <div className="contact-item"><label>Profession</label><span>{safeTrim(client.PROFES) || "-"}</span></div>
            <div className="contact-item"><label>Fax</label><span>{safeTrim(client.FAX) || "-"}</span></div>
            <div className="contact-item"><label>Cond. paiement</label><span>{safeTrim(client.CONDPAI) || "-"}</span></div>
            <div className="contact-item"><label>Banque</label><span>{safeTrim(client.BANQUE) || "-"}</span></div>
            <div className="contact-item"><label>Groupe</label><span>{safeTrim(client.GROUPE) || "-"}</span></div>
          </div>
        </div>

        {/* CONTACTS 1-4 */}
        {(safeTrim(client.CONTACT1) || safeTrim(client.CONTACT2) || safeTrim(client.CONTACT3) || safeTrim(client.CONTACT4)) && (
          <div className="section-card">
            <h3><HiChat /> Contacts supplémentaires</h3>
            <div className="contacts-list">
              {[1, 2, 3, 4].map((i) => {
                const contact = safeTrim(client[`CONTACT${i}`]);
                return contact ? <div key={i} className="contact-line"><span className="contact-num">#{i}</span>{contact}</div> : null;
              })}
            </div>
          </div>
        )}

        {/* SUIVI */}
        {(safeTrim(client.CAUTION) || safeTrim(client.BLOCAGE) || safeTrim(client.RELANCE) || safeTrim(client.ACTION) || safeTrim(client.COMMENT)) && (
          <div className="section-card">
            <h3><HiClipboardList /> Suivi</h3>
            <div className="suivi-grid">
              {safeTrim(client.CAUTION) && <div className="suivi-item"><label><HiShieldCheck /> Caution</label><span>{safeTrim(client.CAUTION)}</span><small>{formatDate(client.DATCAUTION)}</small></div>}
              {safeTrim(client.BLOCAGE) && <div className="suivi-item blocage"><label>🚫 Blocage</label><span>{safeTrim(client.BLOCAGE)}</span><small>{formatDate(client.DATBLOCAGE)}</small></div>}
              {safeTrim(client.RELANCE) && <div className="suivi-item"><label>📞 Relance</label><span>{safeTrim(client.RELANCE)}</span><small>Par: {safeTrim(client.FAITPAR)} le {formatDate(client.DATFAIPAR)}</small></div>}
              {safeTrim(client.ACTION) && <div className="suivi-item"><label>⚡ Action</label><span>{safeTrim(client.ACTION)}</span><small>Par: {safeTrim(client.ACTPAR)} le {formatDate(client.DATACTPAR)}</small></div>}
              {safeTrim(client.COMMENT) && <div className="suivi-item"><label>💬 Commentaire</label><span>{safeTrim(client.COMMENT)}</span><small>Par: {safeTrim(client.COMMENTPAR)} le {formatDate(client.DATCOMPAR)}</small></div>}
            </div>
          </div>
        )}

        {/* MÉMOS LIVRAISON */}
        {(safeTrim(client.MEMOLIVR1) || safeTrim(client.MEMOLIVR2) || safeTrim(client.MEMOLIVR3)) && (
          <div className="section-card">
            <h3><HiDocumentText /> Mémos livraison</h3>
            <div className="memo-lines">
              {[1, 2, 3].map((i) => { const memo = safeTrim(client[`MEMOLIVR${i}`]); return memo ? <p key={i}>{memo}</p> : null; })}
            </div>
          </div>
        )}

        {/* CROSS-ENTREPRISE */}
        <div className="section-card cross-entreprise-section">
          <h3><HiOfficeBuilding /> Même client dans d'autres entreprises</h3>
          {loadingCross ? (
            <div className="cross-loading"><div className="loading-spinner small"></div><span>Recherche en cours...</span></div>
          ) : crossEntreprises.length === 0 ? (
            <div className="cross-empty">
              <HiIdentification />
              <p>
                {ridet
                  ? <>RIDET <strong>{ridet}</strong> — Aucun client trouvé dans les autres entreprises.</>
                  : <>Pas de RIDET. Recherche par nom "<strong>{safeTrim(client.NOM)}</strong>" — Aucune correspondance.</>
                }
              </p>
            </div>
          ) : (
            <div className="cross-results">
              <div className="cross-header-info">
                {crossData?.matchType === "ridet" ? (
                  <span className="cross-ridet-badge"><HiIdentification /> RIDET : {crossData.matchValue}</span>
                ) : (
                  <span className="cross-nom-badge"><HiUser /> NOM : {crossData?.matchValue}</span>
                )}
                <span className={`cross-match-type match-${crossData?.matchType}`}>
                  Correspondance par {crossData?.matchType === "ridet" ? "RIDET" : "NOM"}
                </span>
                <span className="cross-count">{crossEntreprises.length} autre{crossEntreprises.length > 1 ? "s" : ""} entreprise{crossEntreprises.length > 1 ? "s" : ""}</span>
              </div>
              <div className="cross-cards">
                {crossEntreprises.map((result) => (
                  <div key={result.entreprise.nomDossierDBF} className="cross-card">
                    <div className="cross-card-header">
                      <HiOfficeBuilding />
                      <div>
                        <span className="cross-entreprise-name">
                          {result.entreprise.trigramme || result.entreprise.nomDossierDBF}
                          {result.entreprise.nomComplet && ` — ${result.entreprise.nomComplet}`}
                        </span>
                      </div>
                      {result.matchType && <span className={`cross-match-badge match-${result.matchType}`}>{result.matchType === "ridet" ? "RIDET" : "NOM"}</span>}
                    </div>
                    <div className="cross-card-body">
                      {result.clients.map((c, idx) => (
                        <div key={idx} className="cross-client-row">
                          <div className="cross-client-info">
                            <span className="cross-tiers">Tiers {c.TIERS}</span>
                            <span className="cross-nom">{safeTrim(c.NOM)}</span>
                            {c._ridet && <span className="cross-ridet-small">RIDET: {c._ridet}</span>}
                          </div>
                          <div className="cross-client-meta">
                            <span>Débit: {formatPrice(c.DEBIT)}</span>
                            <span>Crédit: {formatPrice(c.CREDIT)}</span>
                          </div>
                          <Link to={`/admin/clients/${result.entreprise.nomDossierDBF}/${c.TIERS}`} className="cross-link">
                            <HiExternalLink /> Voir fiche
                          </Link>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AdminClientDetailScreen;