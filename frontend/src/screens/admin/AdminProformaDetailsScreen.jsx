// src/screens/admin/AdminProformaDetailScreen.jsx
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
} from "react-icons/hi";
import {
  useGetProformaByNumfactQuery,
  useSaveProformaDatMutation,
} from "../../slices/proformaApiSlice";
import { useGetEntrepriseByDossierQuery } from "../../slices/entrepriseApiSlice";
import * as XLSX from "xlsx";
import "./AdminProformaDetailScreen.css";

// Labels et styles des états
const ETAT_CONFIG = {
  0: { label: "Brouillon", color: "muted", icon: HiDocumentText },
  1: { label: "Validée", color: "success", icon: HiCheckCircle },
  2: { label: "Facturée", color: "info", icon: HiCurrencyDollar },
};

const ETAT_LABELS = {
  0: "Brouillon",
  1: "Validée",
  2: "Facturée",
};

const AdminProformaDetailScreen = () => {
  const { nomDossierDBF, numfact } = useParams();
  const navigate = useNavigate();

  const [searchLignes, setSearchLignes] = useState("");
  const [filterType, setFilterType] = useState("TOUT");
  const [isExporting, setIsExporting] = useState(false);
  const [isSavingDat, setIsSavingDat] = useState(false);
  const [datMessage, setDatMessage] = useState(null);
  const [showDatPanel, setShowDatPanel] = useState(false);

  // Nom par défaut du fichier .dat : "stock.dat YYYYMMDD"
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
    data: proformaData,
    isLoading,
    error,
    refetch,
  } = useGetProformaByNumfactQuery(
    { nomDossierDBF, numfact },
    { skip: !nomDossierDBF || !numfact },
  );

  const { data: entrepriseData } = useGetEntrepriseByDossierQuery(
    nomDossierDBF,
    { skip: !nomDossierDBF },
  );

  const [saveProformaDat] = useSaveProformaDatMutation();

  const proforma = proformaData?.proforma;
  const detail = proformaData?.detail;
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
          (l.NUMSERIE &&
            l.NUMSERIE.trim().toLowerCase().includes(searchLower)),
      );
    }
    return result;
  }, [lignes, searchLignes, filterType]);

  // Totaux calculés
  const totaux = useMemo(() => {
    const lignesArticle = lignes.filter((l) => !l._isComment);
    const totalQte = lignesArticle.reduce(
      (sum, l) => sum + (parseFloat(l.QTE) || 0),
      0,
    );
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

  const getEtatInfo = (etat) => {
    const base =
      ETAT_CONFIG[etat] || {
        label: `État ${etat}`,
        color: "muted",
        icon: HiDocumentText,
      };
    const custom = entrepriseData?.mappingEtatsProforma?.[etat];
    return custom ? { ...base, label: custom } : base;
  };

  // =============================================
  // GÉNÉRATION DU CONTENU .DAT
  // Format : GENCOD_OU_NART(13 car)|QTE(8 chiffres zéro-padded)|000
  // =============================================
  const generateDatContent = useCallback(() => {
    const lignesArticle = lignes.filter((l) => !l._isComment);
    const datLines = [];

    for (const ligne of lignesArticle) {
      const qte = Math.round(parseFloat(ligne.QTE) || 0);
      if (qte <= 0) continue;

      // Récupérer GENCOD depuis _articleInfo, sinon utiliser NART
      const gencod = safeTrim(ligne._articleInfo?.GENCOD);
      const nart = safeTrim(ligne.NART);

      // Identifiant : GENCOD prioritaire, sinon NART
      let identifiant = gencod || nart;
      if (!identifiant) continue;

      // Padder à 13 caractères (espaces à droite)
      identifiant = identifiant.padEnd(13, " ");

      // Quantité : zéro-padded à 8 chiffres
      const qteStr = String(qte).padStart(8, "0");

      datLines.push(`${identifiant}|${qteStr}|000`);
    }

    return datLines.join("\n");
  }, [lignes]);

  // =============================================
  // EXPORT .DAT (téléchargement local)
  // =============================================
  const handleDownloadDat = useCallback(() => {
    if (!proforma || !lignes.length) return;
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
  }, [proforma, lignes, generateDatContent]);

  // =============================================
  // ENREGISTRER .DAT SUR LE SERVEUR
  // =============================================
  const handleSaveDatToServer = useCallback(async () => {
    if (!proforma || !lignes.length) return;
    const content = generateDatContent();
    if (!content) {
      alert("Aucune ligne article avec quantité positive à exporter.");
      return;
    }

    setIsSavingDat(true);
    setDatMessage(null);

    try {
      const result = await saveProformaDat({
        nomDossierDBF,
        numfact: safeTrim(proforma.NUMFACT),
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
  }, [proforma, lignes, nomDossierDBF, generateDatContent, saveProformaDat]);

  // =============================================
  // EXPORT EXCEL - 3 onglets (enrichi avec NART/GENCOD/DESIGN article)
  // =============================================
  const handleExportExcel = useCallback(() => {
    if (!proforma || !lignes.length) return;
    setIsExporting(true);

    try {
      const wb = XLSX.utils.book_new();

      // ========== ONGLET 1 : ENTÊTE ==========
      const enteteData = [
        ["PROFORMA - ENTÊTE"],
        [],
        ["Champ", "Valeur"],
        ["NUMFACT", safeTrim(proforma.NUMFACT)],
        ["DATFACT", formatDateForExcel(proforma.DATFACT)],
        ["TIERS", proforma.TIERS ?? ""],
        ["NOM", safeTrim(proforma.NOM)],
        ["TEXTE", safeTrim(proforma.TEXTE)],
        ["REPRES", proforma.REPRES ?? ""],
        ["MONTANT", proforma.MONTANT ?? 0],
        ["DATCHANT", formatDateForExcel(proforma.DATCHANT)],
        ["ETAT", proforma.ETAT ?? ""],
        [
          "ETAT (Libellé)",
          entrepriseData?.mappingEtatsProforma?.[proforma.ETAT] ||
            ETAT_LABELS[proforma.ETAT] ||
            `État ${proforma.ETAT}`,
        ],
        ["MAILING1", safeTrim(proforma.MAILING1)],
        ["MAILING2", safeTrim(proforma.MAILING2)],
        ["MAILING3", safeTrim(proforma.MAILING3)],
        ["MAILING4", safeTrim(proforma.MAILING4)],
        ["MAILING5", safeTrim(proforma.MAILING5)],
      ];

      const wsEntete = XLSX.utils.aoa_to_sheet(enteteData);
      wsEntete["!cols"] = [{ wch: 18 }, { wch: 50 }];
      XLSX.utils.book_append_sheet(wb, wsEntete, "Entête");

      // ========== ONGLET 2 : LIGNES DÉTAIL (champs prodet + article enrichi) ==========
      const detailHeaders = [
        // Champs bruts prodet
        "NUMFACT",
        "NART",
        "DESIGN",
        "QTE",
        "PVTE",
        "PREV",
        "POURC",
        "DTVA",
        "CLIENT",
        "NL",
        "COMPOSE",
        "NONIMP",
        "PVTTC",
        "NUMSERIE",
        "GARANTIE",
        // Champs enrichis depuis article.dbf
        "NART (article)",
        "GENCOD (article)",
        "DESIGN (article)",
        // Colonnes calculées
        "Type",
        "Montant HT Brut",
        "Remise",
        "Montant HT Net",
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
          parseFloat(ligne.DTVA) || 0,
          safeTrim(ligne.CLIENT),
          parseFloat(ligne.NL) || 0,
          safeTrim(ligne.COMPOSE),
          safeTrim(ligne.NONIMP),
          parseFloat(ligne.PVTTC) || 0,
          safeTrim(ligne.NUMSERIE),
          safeTrim(ligne.GARANTIE),
          // Champs enrichis article
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
        { wch: 12 }, { wch: 12 }, { wch: 8 }, { wch: 8 },
        { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 8 },
        { wch: 10 }, { wch: 30 }, { wch: 12 },
        { wch: 10 }, { wch: 16 }, { wch: 40 },
        { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 14 },
      ];
      XLSX.utils.book_append_sheet(wb, wsDetail, "Lignes Détail");

      // ========== ONGLET 3 : ARTICLES LIÉS ==========
      const lignesAvecArticle = lignes.filter(
        (l) => !l._isComment && l._articleInfo,
      );

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

      // ========== TÉLÉCHARGEMENT ==========
      const fileName = `Proforma_${safeTrim(proforma.NUMFACT)}_${nomDossierDBF}.xlsx`;
      XLSX.writeFile(wb, fileName);
    } catch (err) {
      console.error("Erreur export Excel:", err);
      alert("Erreur lors de l'export Excel. Veuillez réessayer.");
    } finally {
      setIsExporting(false);
    }
  }, [proforma, lignes, nomDossierDBF, entrepriseData]);

  // === LOADING ===
  if (isLoading) {
    return (
      <div className="proforma-detail-page">
        <div className="detail-loading">
          <div className="loading-spinner"></div>
          <p>Chargement de la proforma...</p>
        </div>
      </div>
    );
  }

  // === ERROR ===
  if (error) {
    return (
      <div className="proforma-detail-page">
        <div className="detail-error">
          <HiExclamation />
          <h2>Erreur</h2>
          <p>{error?.data?.message || "Impossible de charger la proforma"}</p>
          <div className="error-actions">
            <button onClick={refetch} className="btn-retry">
              <HiRefresh /> Réessayer
            </button>
            <Link to={`/admin/proformas/${nomDossierDBF}`} className="btn-back">
              <HiArrowLeft /> Retour aux proformas
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (!proforma) return null;

  const etatInfo = getEtatInfo(proforma.ETAT);
  const EtatIcon = etatInfo.icon;

  return (
    <div className="proforma-detail-page">
      {/* ============ TOP BAR ============ */}
      <div className="detail-topbar">
        <Link to={`/admin/proformas/${nomDossierDBF}`} className="btn-back-list">
          <HiArrowLeft />
          <span>Proformas</span>
        </Link>

        <div className="topbar-nav">
          <span className="nav-current">
            <HiDocumentText />
            N° {safeTrim(proforma.NUMFACT)}
          </span>
        </div>

        <div className="topbar-meta">
          {proformaData?._queryTime && (
            <span className="query-time">{proformaData._queryTime}</span>
          )}
          {/* Bouton Export Excel */}
          <button
            className="btn-export-excel"
            onClick={handleExportExcel}
            disabled={isExporting || !lignes.length}
            title="Télécharger les détails en Excel"
          >
            <HiDownload />
            <span>{isExporting ? "Export..." : "Excel"}</span>
          </button>
          {/* Bouton .DAT - ouvre le panneau */}
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
                onClick={() => {
                  handleDownloadDat();
                  setShowDatPanel(false);
                }}
                disabled={!lignes.length}
              >
                <HiDownload />
                <span>Télécharger</span>
              </button>
              <button
                className="btn-dat-server"
                onClick={() => {
                  handleSaveDatToServer();
                  setShowDatPanel(false);
                }}
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
          {datMessage.path && (
            <span className="dat-path">{datMessage.path}</span>
          )}
          <button onClick={() => setDatMessage(null)}>
            <HiX />
          </button>
        </div>
      )}

      {/* ============ MAIN CONTENT ============ */}
      <div className="detail-content">
        {/* Header Card */}
        <div className="detail-header-card">
          <div className="header-card-top">
            <div className="header-card-title">
              <div className="numfact-display">
                <span className="numfact-label">Proforma</span>
                <span className="numfact-value">
                  {safeTrim(proforma.NUMFACT)}
                </span>
              </div>
              <span className={`etat-badge etat-${etatInfo.color} large`}>
                <EtatIcon />
                {etatInfo.label}
              </span>
            </div>
          </div>

          <div className="header-info-grid">
            <div className="info-card">
              <div className="info-card-icon"><HiUser /></div>
              <div className="info-card-content">
                <label>Tiers / Client</label>
                <span>{proforma.TIERS || "-"}</span>
              </div>
            </div>
            <div className="info-card">
              <div className="info-card-icon"><HiTag /></div>
              <div className="info-card-content">
                <label>Nom</label>
                <span>{safeTrim(proforma.NOM) || "-"}</span>
              </div>
            </div>
            <div className="info-card">
              <div className="info-card-icon"><HiCalendar /></div>
              <div className="info-card-content">
                <label>Date proforma</label>
                <span>{formatDate(proforma.DATFACT)}</span>
              </div>
            </div>
            <div className="info-card">
              <div className="info-card-icon"><HiCalendar /></div>
              <div className="info-card-content">
                <label>Date chantier</label>
                <span>{formatDate(proforma.DATCHANT)}</span>
              </div>
            </div>
            <div className="info-card">
              <div className="info-card-icon"><HiUserGroup /></div>
              <div className="info-card-content">
                <label>Représentant</label>
                <span>{proforma.REPRES || "-"}</span>
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
          </div>

          {safeTrim(proforma.TEXTE) && (
            <div className="header-observ">
              <span className="observ-label">📝 Texte / Objet</span>
              <p>{safeTrim(proforma.TEXTE)}</p>
            </div>
          )}
        </div>

        {/* Montants */}
        <div className="montants-cards">
          <div className="montant-card main">
            <span className="montant-label">Montant (entête)</span>
            <span className="montant-value">{formatPrice(proforma.MONTANT)}</span>
          </div>
          <div className="montant-card calculated">
            <span className="montant-label">Total HT (détails)</span>
            <span className="montant-value">{formatPrice(totaux.totalHT)}</span>
          </div>
          <div className="montant-card">
            <span className="montant-label">Total Qté</span>
            <span className="montant-value">{formatNumber(totaux.totalQte)}</span>
          </div>
        </div>

        {/* Adresse mailing */}
        {(safeTrim(proforma.MAILING1) || safeTrim(proforma.MAILING2)) && (
          <div className="mailing-card">
            <h3>📮 Adresse mailing</h3>
            <div className="mailing-lines">
              {[1, 2, 3, 4, 5].map((i) => {
                const line = safeTrim(proforma[`MAILING${i}`]);
                return line ? <p key={i} className="mailing-line">{line}</p> : null;
              })}
            </div>
          </div>
        )}

        {/* ============ LIGNES DE PROFORMA ============ */}
        <div className="detail-lines-section">
          <div className="lines-header">
            <h2>
              <HiDocumentText />
              Lignes de proforma
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
                    : "Cette proforma ne contient aucune ligne"}
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

export default AdminProformaDetailScreen;