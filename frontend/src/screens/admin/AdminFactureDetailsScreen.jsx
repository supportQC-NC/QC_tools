// src/screens/admin/AdminFactureDetailScreen.jsx
import React, { useState, useMemo, useCallback } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import {
  HiArrowLeft,
  HiDocumentText,
  HiCalendar,
  HiCurrencyDollar,
  HiCheckCircle,
  HiExclamation,
  HiRefresh,
  HiSearch,
  HiX,
  HiExternalLink,
  HiEye,
  HiUser,
  HiUserGroup,
  HiChat,
  HiTag,
  HiDownload,
  HiSave,
  HiReceiptTax,
  HiSwitchHorizontal,
  HiReply,
  HiClock,
  HiClipboardList,
} from "react-icons/hi";
import {
  useGetFactureByNumfactQuery,
  useSaveFactureDatMutation,
} from "../../slices/factureApiSlice";
import { useGetEntrepriseByDossierQuery } from "../../slices/entrepriseApiSlice";
import * as XLSX from "xlsx";
import "./AdminFactureDetailScreen.css";

// Config TYPFACT
const TYPFACT_CONFIG = {
  F: { label: "Facture", color: "primary", icon: HiReceiptTax },
  A: { label: "Avoir", color: "danger", icon: HiReply },
  R: { label: "RESA", color: "warning", icon: HiClock },
  T: { label: "Transfert", color: "info", icon: HiSwitchHorizontal },
};

const TYPFACT_LABELS = {
  F: "Facture",
  A: "Avoir",
  R: "RESA",
  T: "Transfert",
};

const AdminFactureDetailScreen = () => {
  const { nomDossierDBF, numfact } = useParams();
  const navigate = useNavigate();

  const [searchLignes, setSearchLignes] = useState("");
  const [filterType, setFilterType] = useState("TOUT");
  const [isExporting, setIsExporting] = useState(false);
  const [isSavingDat, setIsSavingDat] = useState(false);
  const [datMessage, setDatMessage] = useState(null);
  const [showDatPanel, setShowDatPanel] = useState(false);

  const getDefaultDatName = () => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    return `stock.dat ${y}${m}${d}`;
  };
  const [datFileName, setDatFileName] = useState(getDefaultDatName);

  // Queries
  const {
    data: factureData,
    isLoading,
    error,
    refetch,
  } = useGetFactureByNumfactQuery(
    { nomDossierDBF, numfact },
    { skip: !nomDossierDBF || !numfact },
  );

  const { data: entrepriseData } = useGetEntrepriseByDossierQuery(
    nomDossierDBF,
    { skip: !nomDossierDBF },
  );

  const [saveFactureDat] = useSaveFactureDatMutation();

  const facture = factureData?.facture;
  const detail = factureData?.detail;
  const lignes = detail?.lignes || [];

  // Filtrage local des lignes
  const filteredLignes = useMemo(() => {
    let result = [...lignes];
    if (filterType === "ARTICLES") {
      result = result.filter((l) => !l._isComment);
    } else if (filterType === "COMMENTAIRES") {
      result = result.filter((l) => l._isComment);
    }
    if (searchLignes) {
      const searchLower = searchLignes.toLowerCase();
      result = result.filter(
        (l) =>
          (l.NART && l.NART.trim().toLowerCase().includes(searchLower)) ||
          (l.DESIGN && l.DESIGN.trim().toLowerCase().includes(searchLower)) ||
          (l.NUMSERIE && l.NUMSERIE.trim().toLowerCase().includes(searchLower)),
      );
    }
    return result;
  }, [lignes, searchLignes, filterType]);

  // Totaux calculés
  const totaux = useMemo(() => {
    const lignesArticle = lignes.filter((l) => !l._isComment);
    const totalQte = lignesArticle.reduce((sum, l) => sum + (parseFloat(l.QTE) || 0), 0);
    const totalHT = lignesArticle.reduce((sum, l) => {
      const qte = parseFloat(l.QTE) || 0;
      const pvte = parseFloat(l.PVTE) || 0;
      const pourc = parseFloat(l.POURC) || 0;
      const montantBrut = qte * pvte;
      const remise = montantBrut * (pourc / 100);
      return sum + (montantBrut - remise);
    }, 0);
    const totalTTC = lignesArticle.reduce((sum, l) => {
      const qte = parseFloat(l.QTE) || 0;
      const pvttc = parseFloat(l.PVTTC) || 0;
      return sum + qte * pvttc;
    }, 0);
    return { totalQte, totalHT, totalTTC };
  }, [lignes]);

  // === HELPERS ===
  const safeTrim = (value) => {
    if (value === null || value === undefined) return "";
    if (typeof value === "string") return value.trim();
    return String(value);
  };

  const formatPrice = (price) => {
    if (!price && price !== 0) return "-";
    return new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency: "XPF",
      minimumFractionDigits: 0,
    }).format(price);
  };

  const formatNumber = (num, decimals = 2) => {
    if (num === null || num === undefined) return "-";
    const n = parseFloat(num);
    if (isNaN(n)) return "-";
    return n.toLocaleString("fr-FR", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
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

  const formatDateForExcel = (dateValue) => {
    if (!dateValue) return "";
    if (dateValue instanceof Date) {
      return isNaN(dateValue.getTime()) ? "" : dateValue;
    }
    if (typeof dateValue === "string" && dateValue.length === 8) {
      const y = parseInt(dateValue.substring(0, 4));
      const m = parseInt(dateValue.substring(4, 6)) - 1;
      const d = parseInt(dateValue.substring(6, 8));
      const date = new Date(y, m, d);
      return isNaN(date.getTime()) ? "" : date;
    }
    if (typeof dateValue === "string" && dateValue.includes("-")) {
      const d = new Date(dateValue);
      return isNaN(d.getTime()) ? "" : d;
    }
    return "";
  };

  const getTypfactInfo = (typfact) => {
    const t = safeTrim(typfact).toUpperCase();
    return TYPFACT_CONFIG[t] || { label: `Type ${t}`, color: "muted", icon: HiDocumentText };
  };

  // =============================================
  // GÉNÉRATION DU CONTENU .DAT
  // =============================================
  const generateDatContent = useCallback(() => {
    const lignesArticle = lignes.filter((l) => !l._isComment);
    const datLines = [];

    for (const ligne of lignesArticle) {
      const qte = Math.round(parseFloat(ligne.QTE) || 0);
      if (qte <= 0) continue;

      const gencod = safeTrim(ligne._articleInfo?.GENCOD);
      const nart = safeTrim(ligne.NART);
      let identifiant = gencod || nart;
      if (!identifiant) continue;

      identifiant = identifiant.padEnd(13, " ");
      const qteStr = String(qte).padStart(8, "0");
      datLines.push(`${identifiant}|${qteStr}|000`);
    }

    return datLines.join("\n");
  }, [lignes]);

  // =============================================
  // EXPORT .DAT (téléchargement local)
  // =============================================
  const handleDownloadDat = useCallback(() => {
    if (!facture || !lignes.length) return;
    const content = generateDatContent();
    if (!content) {
      alert("Aucune ligne article avec quantité positive à exporter.");
      return;
    }
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = datFileName || getDefaultDatName();
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [facture, lignes, generateDatContent, datFileName]);

  // =============================================
  // ENREGISTRER .DAT SUR LE SERVEUR
  // =============================================
  const handleSaveDatToServer = useCallback(async () => {
    if (!facture || !lignes.length) return;
    const content = generateDatContent();
    if (!content) {
      alert("Aucune ligne article avec quantité positive à exporter.");
      return;
    }

    setIsSavingDat(true);
    setDatMessage(null);

    try {
      const result = await saveFactureDat({
        nomDossierDBF,
        numfact: safeTrim(facture.NUMFACT),
        datContent: content,
        fileName: datFileName || getDefaultDatName(),
      }).unwrap();

      setDatMessage({
        type: "success",
        text: `Fichier .dat enregistré : ${result.fileName}`,
        path: result.filePath,
      });
    } catch (err) {
      setDatMessage({
        type: "error",
        text: err?.data?.message || "Erreur lors de l'enregistrement du .dat",
      });
    } finally {
      setIsSavingDat(false);
    }
  }, [facture, lignes, nomDossierDBF, generateDatContent, saveFactureDat, datFileName]);

  // =============================================
  // EXPORT EXCEL - 3 onglets
  // =============================================
  const handleExportExcel = useCallback(() => {
    if (!facture || !lignes.length) return;
    setIsExporting(true);

    try {
      const wb = XLSX.utils.book_new();
      const typLabel = TYPFACT_LABELS[safeTrim(facture.TYPFACT).toUpperCase()] || "Pièce";

      // ========== ONGLET 1 : ENTÊTE ==========
      const enteteData = [
        [`${typLabel.toUpperCase()} - ENTÊTE`],
        [],
        ["Champ", "Valeur"],
        ["NUMFACT", safeTrim(facture.NUMFACT)],
        ["TYPFACT", safeTrim(facture.TYPFACT)],
        ["Type (Libellé)", typLabel],
        ["DATFACT", formatDateForExcel(facture.DATFACT)],
        ["DATTRAV", formatDateForExcel(facture.DATTRAV)],
        ["TIERS", facture.TIERS ?? ""],
        ["NOM", safeTrim(facture.NOM)],
        ["TEXTE", safeTrim(facture.TEXTE)],
        ["BONCDE", safeTrim(facture.BONCDE)],
        ["REPRES", facture.REPRES ?? ""],
        ["MONTANT", facture.MONTANT ?? 0],
        ["MONTAXES", facture.MONTAXES ?? 0],
        ["FACTREM", facture.FACTREM ?? 0],
        ["FACTREV", facture.FACTREV ?? 0],
        ["FACTNBLG", facture.FACTNBLG ?? 0],
        ["CHEQUE", safeTrim(facture.CHEQUE)],
        ["ACOMPTE", safeTrim(facture.ACOMPTE)],
        ["ETAT", facture.ETAT ?? ""],
        [
          "ETAT (Libellé)",
          entrepriseData?.mappingEtatsFacture?.[facture.ETAT] ||
            (facture.ETAT != null && facture.ETAT !== ""
              ? `État ${facture.ETAT}`
              : ""),
        ],
        ["HEURE", safeTrim(facture.HEURE)],
        ["AP", safeTrim(facture.AP)],
        ["EXTIERS", facture.EXTIERS ?? ""],
        ["MECANO", facture.MECANO ?? ""],
        ["SUPPR", safeTrim(facture.SUPPR)],
      ];

      const wsEntete = XLSX.utils.aoa_to_sheet(enteteData);
      wsEntete["!cols"] = [{ wch: 18 }, { wch: 50 }];
      XLSX.utils.book_append_sheet(wb, wsEntete, "Entête");

      // ========== ONGLET 2 : LIGNES DÉTAIL ==========
      const detailHeaders = [
        "NUMFACT", "NART", "DESIGN", "QTE", "PVTE", "PREV", "POURC",
        "TYPFACT", "DTVA", "CLIENT", "NL", "COMPOSE", "NONIMP",
        "PVTTC", "POINTE", "PROMO", "STKREST", "NUMSERIE", "GARANTIE",
        // Enrichis article
        "NART (article)", "GENCOD (article)", "DESIGN (article)",
        // Calculés
        "Type", "Montant HT Brut", "Remise", "Montant HT Net",
      ];

      const detailRows = lignes.map((ligne) => {
        const isComment = ligne._isComment;
        const art = ligne._articleInfo;
        const qte = parseFloat(ligne.QTE) || 0;
        const pvte = parseFloat(ligne.PVTE) || 0;
        const pourc = parseFloat(ligne.POURC) || 0;
        const montantBrut = qte * pvte;
        const remise = montantBrut * (pourc / 100);
        const montantNet = montantBrut - remise;

        return [
          safeTrim(ligne.NUMFACT),
          safeTrim(ligne.NART),
          safeTrim(ligne.DESIGN),
          qte,
          pvte,
          parseFloat(ligne.PREV) || 0,
          pourc,
          safeTrim(ligne.TYPFACT),
          parseFloat(ligne.DTVA) || 0,
          safeTrim(ligne.CLIENT),
          parseFloat(ligne.NL) || 0,
          safeTrim(ligne.COMPOSE),
          safeTrim(ligne.NONIMP),
          parseFloat(ligne.PVTTC) || 0,
          safeTrim(ligne.POINTE),
          safeTrim(ligne.PROMO),
          parseFloat(ligne.STKREST) || 0,
          safeTrim(ligne.NUMSERIE),
          safeTrim(ligne.GARANTIE),
          // Enrichis
          art ? safeTrim(art.NART) : "",
          art ? safeTrim(art.GENCOD) : "",
          art ? safeTrim(art.DESIGN) : "",
          // Calculés
          isComment ? "Commentaire" : "Article",
          isComment ? "" : montantBrut,
          isComment ? "" : remise,
          isComment ? "" : montantNet,
        ];
      });

      const wsDetail = XLSX.utils.aoa_to_sheet([detailHeaders, ...detailRows]);
      wsDetail["!cols"] = [
        { wch: 10 }, { wch: 8 }, { wch: 40 }, { wch: 10 },
        { wch: 12 }, { wch: 12 }, { wch: 8 }, { wch: 6 },
        { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 8 },
        { wch: 8 }, { wch: 10 }, { wch: 8 }, { wch: 6 },
        { wch: 10 }, { wch: 30 }, { wch: 12 },
        { wch: 10 }, { wch: 16 }, { wch: 40 },
        { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 14 },
      ];
      XLSX.utils.book_append_sheet(wb, wsDetail, "Lignes Détail");

      // ========== ONGLET 3 : ARTICLES LIÉS ==========
      const lignesAvecArticle = lignes.filter((l) => !l._isComment && l._articleInfo);

      if (lignesAvecArticle.length > 0) {
        const articleHeaders = [
          "NART", "DESIGN (article)", "DESIGN2", "GENCOD", "REFER",
          "FOURN", "PVTE (article)", "PVTETTC", "PACHAT",
          "S1", "S2", "S3", "S4", "S5", "Stock Total",
          "GROUPE", "UNITE", "TAXES", "WEB", "FOTO",
        ];

        const articleRows = lignesAvecArticle.map((ligne) => {
          const art = ligne._articleInfo;
          const s1 = parseFloat(art.S1) || 0;
          const s2 = parseFloat(art.S2) || 0;
          const s3 = parseFloat(art.S3) || 0;
          const s4 = parseFloat(art.S4) || 0;
          const s5 = parseFloat(art.S5) || 0;

          return [
            safeTrim(art.NART), safeTrim(art.DESIGN), safeTrim(art.DESIGN2),
            safeTrim(art.GENCOD), safeTrim(art.REFER), art.FOURN ?? "",
            parseFloat(art.PVTE) || 0, parseFloat(art.PVTETTC) || 0,
            parseFloat(art.PACHAT) || 0,
            s1, s2, s3, s4, s5, s1 + s2 + s3 + s4 + s5,
            safeTrim(art.GROUPE), safeTrim(art.UNITE),
            parseFloat(art.TAXES) || 0, safeTrim(art.WEB), safeTrim(art.FOTO),
          ];
        });

        const wsArticles = XLSX.utils.aoa_to_sheet([articleHeaders, ...articleRows]);
        wsArticles["!cols"] = [
          { wch: 8 }, { wch: 40 }, { wch: 25 }, { wch: 16 }, { wch: 15 },
          { wch: 8 }, { wch: 12 }, { wch: 10 }, { wch: 12 },
          { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 8 },
          { wch: 12 }, { wch: 8 }, { wch: 6 }, { wch: 8 },
          { wch: 5 }, { wch: 5 },
        ];
        XLSX.utils.book_append_sheet(wb, wsArticles, "Articles Liés");
      }

      // Téléchargement
      const fileName = `${typLabel}_${safeTrim(facture.NUMFACT)}_${nomDossierDBF}.xlsx`;
      XLSX.writeFile(wb, fileName);
    } catch (err) {
      console.error("Erreur export Excel:", err);
      alert("Erreur lors de l'export Excel. Veuillez réessayer.");
    } finally {
      setIsExporting(false);
    }
  }, [facture, lignes, nomDossierDBF, entrepriseData]);

  // === LOADING ===
  if (isLoading) {
    return (
      <div className="facture-detail-page">
        <div className="detail-loading">
          <div className="loading-spinner"></div>
          <p>Chargement de la facture...</p>
        </div>
      </div>
    );
  }

  // === ERROR ===
  if (error) {
    return (
      <div className="facture-detail-page">
        <div className="detail-error">
          <HiExclamation />
          <h2>Erreur</h2>
          <p>{error?.data?.message || "Impossible de charger la facture"}</p>
          <div className="error-actions">
            <button onClick={refetch} className="btn-retry"><HiRefresh /> Réessayer</button>
            <Link to={`/admin/factures/${nomDossierDBF}`} className="btn-back"><HiArrowLeft /> Retour aux factures</Link>
          </div>
        </div>
      </div>
    );
  }

  if (!facture) return null;

  const typInfo = getTypfactInfo(facture.TYPFACT);
  const TypIcon = typInfo.icon;

  return (
    <div className="facture-detail-page">
      {/* ============ TOP BAR ============ */}
      <div className="detail-topbar">
        <Link to={`/admin/factures/${nomDossierDBF}`} className="btn-back-list">
          <HiArrowLeft />
          <span>Factures</span>
        </Link>

        <div className="topbar-nav">
          <span className="nav-current">
            <HiReceiptTax />
            N° {safeTrim(facture.NUMFACT)}
          </span>
        </div>

        <div className="topbar-meta">
          {factureData?._queryTime && (
            <span className="query-time">{factureData._queryTime}</span>
          )}
          <button
            className="btn-export-excel"
            onClick={handleExportExcel}
            disabled={isExporting || !lignes.length}
            title="Télécharger les détails en Excel"
          >
            <HiDownload />
            <span>{isExporting ? "Export..." : "Excel"}</span>
          </button>
          <button
            className="btn-export-dat"
            onClick={() => setShowDatPanel(!showDatPanel)}
            disabled={!lignes.length}
            title="Options fichier .dat (collecte)"
          >
            <HiDownload />
            <span>.DAT</span>
          </button>
          <button className="btn-refresh" onClick={refetch} title="Rafraîchir">
            <HiRefresh />
          </button>
        </div>
      </div>

      {/* Panneau .DAT */}
      {showDatPanel && (
        <div className="dat-panel">
          <div className="dat-panel-header">
            <span>📄 Export fichier .dat</span>
            <button className="btn-close-dat" onClick={() => setShowDatPanel(false)}>
              <HiX />
            </button>
          </div>
          <div className="dat-panel-body">
            <div className="dat-filename-group">
              <label>Nom du fichier</label>
              <input
                type="text"
                value={datFileName}
                onChange={(e) => setDatFileName(e.target.value)}
                placeholder="stock.dat 20260304"
              />
              <button
                className="btn-dat-reset-name"
                onClick={() => setDatFileName(getDefaultDatName())}
                title="Réinitialiser le nom par défaut"
              >
                <HiRefresh />
              </button>
            </div>
            <div className="dat-panel-actions">
              <button
                className="btn-dat-download"
                onClick={() => { handleDownloadDat(); setShowDatPanel(false); }}
                disabled={!lignes.length}
              >
                <HiDownload />
                <span>Télécharger</span>
              </button>
              <button
                className="btn-dat-server"
                onClick={() => { handleSaveDatToServer(); setShowDatPanel(false); }}
                disabled={isSavingDat || !lignes.length}
              >
                <HiSave />
                <span>{isSavingDat ? "Envoi..." : "Enregistrer sur serveur"}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Message DAT */}
      {datMessage && (
        <div className={`dat-message dat-message-${datMessage.type}`}>
          <span>{datMessage.text}</span>
          {datMessage.path && <span className="dat-path">{datMessage.path}</span>}
          <button onClick={() => setDatMessage(null)}><HiX /></button>
        </div>
      )}

      {/* ============ MAIN CONTENT ============ */}
      <div className="detail-content">
        {/* Header Card */}
        <div className="detail-header-card">
          <div className="header-card-top">
            <div className="header-card-title">
              <div className="numfact-display">
                <span className="numfact-label">{typInfo.label}</span>
                <span className="numfact-value">{safeTrim(facture.NUMFACT)}</span>
              </div>
              <span className={`typfact-badge typ-${typInfo.color} large`}>
                <TypIcon />
                {typInfo.label}
              </span>
            </div>
          </div>

          <div className="header-info-grid">
            <div className="info-card">
              <div className="info-card-icon"><HiUser /></div>
              <div className="info-card-content">
                <label>Tiers / Client</label>
                <span>{facture.TIERS || "-"}</span>
              </div>
            </div>
            <div className="info-card">
              <div className="info-card-icon"><HiTag /></div>
              <div className="info-card-content">
                <label>Nom</label>
                <span>{safeTrim(facture.NOM) || "-"}</span>
              </div>
            </div>
            <div className="info-card">
              <div className="info-card-icon"><HiCalendar /></div>
              <div className="info-card-content">
                <label>Date facture</label>
                <span>{formatDate(facture.DATFACT)}</span>
              </div>
            </div>
            <div className="info-card">
              <div className="info-card-icon"><HiCalendar /></div>
              <div className="info-card-content">
                <label>Date travaux</label>
                <span>{formatDate(facture.DATTRAV)}</span>
              </div>
            </div>
            <div className="info-card">
              <div className="info-card-icon"><HiUserGroup /></div>
              <div className="info-card-content">
                <label>Représentant</label>
                <span>{facture.REPRES || "-"}</span>
              </div>
            </div>
            <div className="info-card">
              <div className="info-card-icon"><HiClipboardList /></div>
              <div className="info-card-content">
                <label>Bon commande</label>
                <span>{safeTrim(facture.BONCDE) || "-"}</span>
              </div>
            </div>
            <div className="info-card">
              <div className="info-card-icon"><HiClipboardList /></div>
              <div className="info-card-content">
                <label>État</label>
                <span>
                  {entrepriseData?.mappingEtatsFacture?.[facture.ETAT] ||
                    (facture.ETAT != null && facture.ETAT !== ""
                      ? `État ${facture.ETAT}`
                      : "-")}
                </span>
              </div>
            </div>
            <div className="info-card">
              <div className="info-card-icon"><HiDocumentText /></div>
              <div className="info-card-content">
                <label>Nb lignes</label>
                <span>
                  {detail?.totalLignes || 0} ({detail?.lignesArticle || 0} art. / {detail?.lignesCommentaire || 0} com.)
                </span>
              </div>
            </div>
            <div className="info-card">
              <div className="info-card-icon"><HiClock /></div>
              <div className="info-card-content">
                <label>Heure</label>
                <span>{safeTrim(facture.HEURE) || "-"}</span>
              </div>
            </div>
          </div>

          {safeTrim(facture.TEXTE) && (
            <div className="header-observ">
              <span className="observ-label">📝 Texte / Objet</span>
              <p>{safeTrim(facture.TEXTE)}</p>
            </div>
          )}
        </div>

        {/* Montants */}
        <div className="montants-cards">
          <div className="montant-card main">
            <span className="montant-label">Montant</span>
            <span className="montant-value">{formatPrice(facture.MONTANT)}</span>
          </div>
          <div className="montant-card">
            <span className="montant-label">Taxes</span>
            <span className="montant-value">{formatPrice(facture.MONTAXES)}</span>
          </div>
          <div className="montant-card calculated">
            <span className="montant-label">Total HT (détails)</span>
            <span className="montant-value">{formatPrice(totaux.totalHT)}</span>
          </div>
          <div className="montant-card">
            <span className="montant-label">Total Qté</span>
            <span className="montant-value">{formatNumber(totaux.totalQte)}</span>
          </div>
          {(facture.FACTREM > 0) && (
            <div className="montant-card">
              <span className="montant-label">Remise</span>
              <span className="montant-value">{formatPrice(facture.FACTREM)}</span>
            </div>
          )}
        </div>

        {/* ============ LIGNES DE FACTURE ============ */}
        <div className="detail-lines-section">
          <div className="lines-header">
            <h2>
              <HiDocumentText />
              Lignes de {typInfo.label.toLowerCase()}
              <span className="lines-count">{detail?.totalLignes || 0} lignes</span>
            </h2>
            <div className="lines-controls">
              <div className="lines-search">
                <HiSearch />
                <input
                  type="text"
                  placeholder="Rechercher article, désignation..."
                  value={searchLignes}
                  onChange={(e) => setSearchLignes(e.target.value)}
                />
                {searchLignes && (
                  <button className="btn-clear-search" onClick={() => setSearchLignes("")}>
                    <HiX />
                  </button>
                )}
              </div>
              <select
                className="lines-filter-type"
                value={filterType}
                onChange={(e) => setFilterType(e.target.value)}
              >
                <option value="TOUT">Toutes les lignes</option>
                <option value="ARTICLES">Articles uniquement</option>
                <option value="COMMENTAIRES">Commentaires uniquement</option>
              </select>
            </div>
          </div>

          <div className="lines-summary">
            <div className="summary-item">
              <label>Articles</label>
              <span>{detail?.lignesArticle || 0}</span>
            </div>
            <div className="summary-item">
              <label>Commentaires</label>
              <span>{detail?.lignesCommentaire || 0}</span>
            </div>
            <div className="summary-item">
              <label>Total Qté</label>
              <span>{formatNumber(totaux.totalQte)}</span>
            </div>
            <div className="summary-item">
              <label>Total HT</label>
              <span className="highlight">{formatPrice(totaux.totalHT)}</span>
            </div>
          </div>

          <div className="lines-table-container">
            {filteredLignes.length === 0 ? (
              <div className="table-empty">
                <HiDocumentText />
                <h3>Aucune ligne trouvée</h3>
                <p>
                  {searchLignes || filterType !== "TOUT"
                    ? "Modifiez vos filtres"
                    : "Cette facture ne contient aucune ligne"}
                </p>
              </div>
            ) : (
              <table className="lines-table">
                <thead>
                  <tr>
                    <th className="col-nl">#</th>
                    <th className="col-type">Type</th>
                    <th className="col-nart">Code Art.</th>
                    <th className="col-design">Désignation</th>
                    <th className="col-qte text-right">Qté</th>
                    <th className="col-pvte text-right">PV HT</th>
                    <th className="col-pourc text-right">Rem.%</th>
                    <th className="col-pvttc text-right">PV TTC</th>
                    <th className="col-dtva text-right">TGC%</th>
                    <th className="col-montant text-right">Montant HT</th>
                    <th className="col-numserie">N° Série</th>
                    <th className="col-actions">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredLignes.map((ligne, index) => {
                    const isComment = ligne._isComment;
                    const qte = parseFloat(ligne.QTE) || 0;
                    const pvte = parseFloat(ligne.PVTE) || 0;
                    const pourc = parseFloat(ligne.POURC) || 0;
                    const montantBrut = qte * pvte;
                    const remise = montantBrut * (pourc / 100);
                    const montantNet = montantBrut - remise;

                    return (
                      <tr key={index} className={isComment ? "row-comment" : "row-article"}>
                        <td className="col-nl">
                          <span className="nl-value">{ligne.NL || index + 1}</span>
                        </td>
                        <td className="col-type">
                          {isComment ? (
                            <span className="type-badge comment" title="Commentaire"><HiChat /></span>
                          ) : (
                            <span className="type-badge article" title="Article"><HiTag /></span>
                          )}
                        </td>
                        <td className="col-nart">
                          {isComment ? (
                            <span className="nart-comment">—</span>
                          ) : (
                            <Link
                              to={`/admin/articles/${nomDossierDBF}/${safeTrim(ligne.NART)}`}
                              className="nart-link"
                              title="Voir l'article"
                            >
                              {safeTrim(ligne.NART)}
                              <HiExternalLink className="link-icon" />
                            </Link>
                          )}
                        </td>
                        <td className="col-design" colSpan={isComment ? 9 : 1}>
                          <span
                            className={`design-text ${isComment ? "comment-text" : ""}`}
                            title={safeTrim(ligne.DESIGN)}
                          >
                            {safeTrim(ligne.DESIGN) || "-"}
                          </span>
                        </td>
                        {!isComment && (
                          <>
                            <td className="col-qte text-right">
                              <span className="qte-value">{formatNumber(ligne.QTE, 3)}</span>
                            </td>
                            <td className="col-pvte text-right">{formatNumber(ligne.PVTE)}</td>
                            <td className="col-pourc text-right">
                              {pourc > 0 ? (
                                <span className="remise-value">-{formatNumber(pourc, 0)}%</span>
                              ) : "-"}
                            </td>
                            <td className="col-pvttc text-right">{formatNumber(ligne.PVTTC)}</td>
                            <td className="col-dtva text-right">{formatNumber(ligne.DTVA)}</td>
                            <td className="col-montant text-right">
                              <span className="montant-cell">{formatPrice(montantNet)}</span>
                            </td>
                            <td className="col-numserie">
                              <span className="numserie-text">{safeTrim(ligne.NUMSERIE) || "-"}</span>
                            </td>
                            <td className="col-actions">
                              <Link
                                to={`/admin/articles/${nomDossierDBF}/${safeTrim(ligne.NART)}`}
                                className="btn-view-article"
                                title="Voir l'article"
                              >
                                <HiEye />
                              </Link>
                            </td>
                          </>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminFactureDetailScreen;