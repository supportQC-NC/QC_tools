import React, { useState, useEffect, useMemo, useCallback } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import {
  HiArrowLeft,
  HiChevronLeft,
  HiChevronRight,
  HiCube,
  HiOfficeBuilding,
  HiPhotograph,
  HiTag,
  HiExclamation,
  HiGlobe,
  HiQrcode,
  HiCurrencyDollar,
  HiTrendingUp,
  HiTrendingDown,
  HiChartBar,
  HiLocationMarker,
  HiCalendar,
  HiClipboardList,
  HiRefresh,
  HiExternalLink,
  HiSwitchHorizontal,
  HiShieldCheck,
  HiCog,
  HiArchive,
  HiCollection,
  HiDocumentText,
  HiChevronDown,
  HiPrinter,
  HiLink,
  HiCheckCircle,
  HiXCircle,
  HiTruck,
  HiClock,
  HiCurrencyEuro,
  HiSparkles,
  HiFire,
  HiDownload,
  HiEye,
} from "react-icons/hi";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
} from "recharts";
import { useGetEntreprisesQuery } from "../../slices/entrepriseApiSlice";
import {
  useGetArticleByNartQuery,
  useGetAdjacentArticlesQuery,
  useInvalidateArticleCacheMutation,
  getPhotoUrl,
} from "../../slices/articleApiSlice";
import { useGetArticleFilialeDataQuery } from "../../slices/fillialeApiSlice";
import "./AdminArticleInfosScreen.css";

// ─────────────────────────────────────────────────────────────────────────────
// Helper : construire l'URL du PDF à partir du trigramme et du NART
// Convention : même dossier que les photos, extension .pdf
// ─────────────────────────────────────────────────────────────────────────────
const getPdfUrl = (trigramme, nart) => {
  if (!trigramme || !nart) return null;
  const cleanNart = String(nart).trim();
  // Adapte ce chemin selon ta convention de nommage réelle
  return `/photos/${trigramme}/${cleanNart}.pdf`;
};

// ─────────────────────────────────────────────────────────────────────────────
// Sous-composant : MediaCard
// Gère l'affichage de la photo et/ou du PDF de fiche technique.
// Le statut photo + PDF est TOUJOURS affiché, même pendant la vérification.
// ─────────────────────────────────────────────────────────────────────────────
const MediaCard = ({
  photoUrl,
  pdfUrl,
  hasPhotosConfigured,
  articleDesign,
  hasActivePromo,
  promoDiscount,
}) => {
  // "loading" | "ok" | "error"
  const [photoStatus, setPhotoStatus] = useState(hasPhotosConfigured ? "loading" : "error");
  // "checking" | "available" | "unavailable"
  const [pdfStatus, setPdfStatus] = useState("checking");
  const [pdfModalOpen, setPdfModalOpen] = useState(false);

  // Reset photo status quand l'URL change
  useEffect(() => {
    setPhotoStatus(hasPhotosConfigured && photoUrl ? "loading" : "error");
  }, [photoUrl, hasPhotosConfigured]);

  // Vérifier l'existence du PDF via HEAD request dès que l'URL est connue
  useEffect(() => {
    if (!pdfUrl) {
      setPdfStatus("unavailable");
      return;
    }
    let cancelled = false;
    setPdfStatus("checking");
    fetch(pdfUrl, { method: "HEAD" })
      .then((res) => { if (!cancelled) setPdfStatus(res.ok ? "available" : "unavailable"); })
      .catch(() => { if (!cancelled) setPdfStatus("unavailable"); });
    return () => { cancelled = true; };
  }, [pdfUrl]);

  const photoOk  = hasPhotosConfigured && photoStatus === "ok";
  const pdfOk    = pdfStatus === "available";
  const checking = pdfStatus === "checking";

  return (
    <>
      <div className="photo-card">

        {/* ── Zone image ─────────────────────────────────────────────────── */}
        {hasPhotosConfigured && photoStatus !== "error" ? (
          <div className={`photo-wrapper ${photoStatus === "ok" ? "loaded" : ""}`}>
            <img
              src={photoUrl}
              alt={articleDesign}
              onError={() => setPhotoStatus("error")}
              onLoad={() => setPhotoStatus("ok")}
            />
            {photoStatus === "loading" && (
              <div className="photo-loading">
                <div className="loading-spinner small" />
              </div>
            )}
            {hasActivePromo && (
              <div className="photo-badge promo">-{promoDiscount}%</div>
            )}
          </div>
        ) : (
          <div className={`no-photo ${pdfOk ? "no-photo--has-pdf" : ""}`}>
            <HiPhotograph />
            <span>Photo indisponible</span>
          </div>
        )}

        {/* ── Bandeau statut médias — TOUJOURS VISIBLE ───────────────────── */}
        <div className="media-status-bar">

          {/* — Bloc Photo — */}
          <div className={`media-status-pill ${photoOk ? "pill--ok" : "pill--ko"}`}>
            <HiPhotograph className="pill-icon" />
            <span className="pill-label">
              {photoStatus === "loading" ? "Photo…" : photoOk ? "Photo disponible" : "Photo indisponible"}
            </span>
            {photoStatus === "loading"
              ? <div className="pill-spinner" />
              : photoOk
                ? <HiCheckCircle className="pill-check" />
                : <HiXCircle className="pill-cross" />
            }
          </div>

          {/* — Bloc PDF — */}
          <div className={`media-status-pill ${checking ? "pill--checking" : pdfOk ? "pill--ok" : "pill--ko"}`}>
            <HiDocumentText className="pill-icon" />
            <span className="pill-label">
              {checking ? "Fiche technique…" : pdfOk ? "Fiche technique disponible" : "Fiche technique indisponible"}
            </span>
            {checking
              ? <div className="pill-spinner" />
              : pdfOk
                ? <HiCheckCircle className="pill-check" />
                : <HiXCircle className="pill-cross" />
            }
          </div>
        </div>

        {/* ── Boutons PDF — visibles uniquement si PDF trouvé ───────────── */}
        {pdfOk && (
          <div className="pdf-actions">
            <button
              className="btn-pdf btn-pdf--view"
              onClick={() => setPdfModalOpen(true)}
              title="Voir la fiche technique"
            >
              <HiEye />
              <span>Voir la fiche</span>
            </button>
            <a
              className="btn-pdf btn-pdf--download"
              href={pdfUrl}
              download
              target="_blank"
              rel="noopener noreferrer"
              title="Télécharger la fiche technique"
            >
              <HiDownload />
              <span>Télécharger</span>
            </a>
          </div>
        )}

      </div>

      {/* ── Modale PDF (iframe) ───────────────────────────────────────────── */}
      {pdfModalOpen && (
        <div
          className="pdf-modal-overlay"
          onClick={(e) => { if (e.target === e.currentTarget) setPdfModalOpen(false); }}
        >
          <div className="pdf-modal">
            <div className="pdf-modal-header">
              <h3><HiDocumentText /> Fiche technique — {articleDesign}</h3>
              <div className="pdf-modal-actions">
                <a href={pdfUrl} download className="btn-pdf btn-pdf--download small" title="Télécharger">
                  <HiDownload /><span>Télécharger</span>
                </a>
                <a href={pdfUrl} target="_blank" rel="noopener noreferrer" className="btn-pdf btn-pdf--view small" title="Ouvrir dans un nouvel onglet">
                  <HiExternalLink /><span>Nouvel onglet</span>
                </a>
                <button className="pdf-modal-close" onClick={() => setPdfModalOpen(false)} title="Fermer">
                  <HiXCircle />
                </button>
              </div>
            </div>
            <div className="pdf-modal-body">
              <iframe
                src={`${pdfUrl}#toolbar=1&navpanes=0`}
                title="Fiche technique"
                width="100%"
                height="100%"
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Composant principal
// ─────────────────────────────────────────────────────────────────────────────
const AdminArticleInfosScreen = () => {
  const { nomDossierDBF, nart } = useParams();
  const navigate = useNavigate();

  // États
  const [selectedEntreprise, setSelectedEntreprise] = useState(
    nomDossierDBF || "",
  );
  const [selectedEntrepriseData, setSelectedEntrepriseData] = useState(null);
  const [activeTab, setActiveTab] = useState("general");

  // State pour les taux de change
  const [exchangeRates, setExchangeRates] = useState(null);
  const [exchangeRatesLoading, setExchangeRatesLoading] = useState(false);
  const [exchangeRatesError, setExchangeRatesError] = useState(null);

  const XPF_EUR_RATE = 119.332;

  const DEVISE_MAPPING = {
    EUR: "EUR", EURO: "EUR", E: "EUR", "€": "EUR",
    USD: "USD", US: "USD", $: "USD", DOLLAR: "USD",
    AUD: "AUD", NZD: "NZD", JPY: "JPY", YEN: "JPY",
    CNY: "CNY", YUAN: "CNY", GBP: "GBP", CHF: "CHF",
    CAD: "CAD", SGD: "SGD", HKD: "HKD",
    XPF: "XPF", CFP: "XPF", F: "XPF",
  };

  const fetchExchangeRates = useCallback(async () => {
    setExchangeRatesLoading(true);
    setExchangeRatesError(null);
    try {
      const response = await fetch("https://api.frankfurter.dev/v1/latest?base=EUR");
      if (!response.ok) throw new Error("Erreur lors de la récupération des taux de change");
      const data = await response.json();
      setExchangeRates({ base: "EUR", date: data.date, rates: { ...data.rates, EUR: 1, XPF: XPF_EUR_RATE } });
    } catch (error) {
      setExchangeRatesError(error.message);
      setExchangeRates({
        base: "EUR",
        date: new Date().toISOString().split("T")[0],
        rates: { EUR: 1, USD: 1.08, XPF: XPF_EUR_RATE, AUD: 1.65, NZD: 1.78, JPY: 162, GBP: 0.85, CHF: 0.95, CNY: 7.8, CAD: 1.47 },
        isFallback: true,
      });
    } finally {
      setExchangeRatesLoading(false);
    }
  }, []);

  useEffect(() => { fetchExchangeRates(); }, [fetchExchangeRates]);

  const convertToXPF = useCallback((amount, fromCurrency) => {
    if (!amount || amount === 0) return { amountXPF: 0, rate: null, fromCurrency: "XPF", error: null };
    if (!fromCurrency || fromCurrency.trim() === "") return { amountXPF: amount, rate: 1, fromCurrency: "XPF", error: null };
    const normalizedCurrency = fromCurrency.trim().toUpperCase();
    const isoCurrency = DEVISE_MAPPING[normalizedCurrency] || normalizedCurrency;
    if (isoCurrency === "XPF") return { amountXPF: amount, rate: 1, fromCurrency: "XPF", error: null };
    if (!exchangeRates?.rates) return { amountXPF: null, rate: null, fromCurrency: isoCurrency, error: "Taux de change non disponibles" };
    const rateFromEUR = exchangeRates.rates[isoCurrency];
    if (!rateFromEUR) return { amountXPF: null, rate: null, fromCurrency: isoCurrency, error: `Devise ${isoCurrency} non supportée` };
    return {
      amountXPF: Math.round((amount / rateFromEUR) * XPF_EUR_RATE),
      rate: XPF_EUR_RATE / rateFromEUR,
      fromCurrency: isoCurrency,
      error: null,
    };
  }, [exchangeRates]);

  // Queries
  const { data: entreprises, isLoading: loadingEntreprises } = useGetEntreprisesQuery();

  const { data: articleData, isLoading: loadingArticle, error: articleError, refetch, isFetching } =
    useGetArticleByNartQuery({ nomDossierDBF: selectedEntreprise, nart }, { skip: !selectedEntreprise || !nart });

  const { data: adjacentData, isLoading: loadingAdjacent } =
    useGetAdjacentArticlesQuery({ nomDossierDBF: selectedEntreprise, nart }, { skip: !selectedEntreprise || !nart });

  const [invalidateCache, { isLoading: invalidating }] = useInvalidateArticleCacheMutation();

  const article = articleData?.article;
  const previousArticle = adjacentData?.previous || null;
  const nextArticle = adjacentData?.next || null;

  const { data: filialeData, isLoading: loadingFiliales, isFetching: fetchingFiliales } =
    useGetArticleFilialeDataQuery(
      { nomDossierDBF: selectedEntreprise, nart: article?.NART?.trim() || "" },
      { skip: !selectedEntreprise || !article?.NART },
    );

  useEffect(() => {
    if (entreprises && nomDossierDBF) {
      const entreprise = entreprises.find((e) => e.nomDossierDBF === nomDossierDBF);
      if (entreprise) { setSelectedEntrepriseData(entreprise); setSelectedEntreprise(nomDossierDBF); }
    }
  }, [entreprises, nomDossierDBF]);

  // Handlers
  const handleEntrepriseChange = (e) => {
    const newNomDossier = e.target.value;
    const entreprise = entreprises?.find((ent) => ent.nomDossierDBF === newNomDossier);
    setSelectedEntreprise(newNomDossier);
    setSelectedEntrepriseData(entreprise);
    navigate(`/admin/articles/${newNomDossier}/${nart}`, { replace: true });
  };

  const handleInvalidateCache = async () => {
    if (selectedEntreprise) { await invalidateCache(selectedEntreprise); refetch(); }
  };

  const handleNavigatePrevious = () => {
    if (previousArticle) navigate(`/admin/articles/${selectedEntreprise}/${previousArticle.NART.trim()}`);
  };

  const handleNavigateNext = () => {
    if (nextArticle) navigate(`/admin/articles/${selectedEntreprise}/${nextArticle.NART.trim()}`);
  };

  // Helpers
  const safeTrim = (value) => {
    if (value === null || value === undefined) return "";
    return typeof value === "string" ? value.trim() : String(value);
  };

  const formatPrice = (price) => {
    if (!price && price !== 0) return "-";
    return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "XPF", minimumFractionDigits: 0 }).format(price);
  };

  const formatStock = (stock) => {
    if (stock === null || stock === undefined) return "-";
    return parseFloat(stock).toLocaleString("fr-FR");
  };

  const formatDate = (dateValue) => {
    if (!dateValue) return "-";
    if (dateValue instanceof Date) return isNaN(dateValue.getTime()) ? "-" : dateValue.toLocaleDateString("fr-FR");
    if (typeof dateValue === "string") {
      if (dateValue.length === 8 && /^\d{8}$/.test(dateValue)) {
        const y = parseInt(dateValue.substring(0, 4));
        const m = parseInt(dateValue.substring(4, 6));
        const d = parseInt(dateValue.substring(6, 8));
        if (y > 0 && m >= 1 && m <= 12 && d >= 1 && d <= 31)
          return `${d.toString().padStart(2, "0")}/${m.toString().padStart(2, "0")}/${y}`;
        return "-";
      }
      const parsed = new Date(dateValue);
      return !isNaN(parsed.getTime()) ? parsed.toLocaleDateString("fr-FR") : "-";
    }
    if (typeof dateValue === "number") {
      const parsed = new Date(dateValue);
      return !isNaN(parsed.getTime()) ? parsed.toLocaleDateString("fr-FR") : "-";
    }
    return "-";
  };

  const formatPercent = (value) => {
    if (value === null || value === undefined) return "-";
    return `${parseFloat(value).toFixed(1)}%`;
  };

  const isPromoActive = (art) => {
    if (!art?.DPROMOD || !art?.DPROMOF || !art?.PVPROMO) return false;
    const parsePromoDate = (v) => {
      if (!v) return null;
      if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
      if (typeof v === "string" && v.length === 8 && /^\d{8}$/.test(v)) {
        return new Date(parseInt(v.substring(0, 4)), parseInt(v.substring(4, 6)) - 1, parseInt(v.substring(6, 8)));
      }
      const parsed = new Date(v);
      return isNaN(parsed.getTime()) ? null : parsed;
    };
    const dateDebut = parsePromoDate(art.DPROMOD);
    const dateFin = parsePromoDate(art.DPROMOF);
    if (!dateDebut || !dateFin) return false;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    dateDebut.setHours(0, 0, 0, 0); dateFin.setHours(23, 59, 59, 999);
    return today >= dateDebut && today <= dateFin;
  };

  const calculateDiscount = (originalPrice, promoPrice) => {
    if (!originalPrice || !promoPrice || originalPrice <= 0) return 0;
    return Math.round(((originalPrice - promoPrice) / originalPrice) * 100);
  };

  const calculateStockTotal = (art) => {
    if (!art) return 0;
    return (parseFloat(art.S1) || 0) + (parseFloat(art.S2) || 0) + (parseFloat(art.S3) || 0) + (parseFloat(art.S4) || 0) + (parseFloat(art.S5) || 0);
  };

  const getEnCommande = (art) => (!art ? 0 : parseFloat(art.ENCDE) || 0);

  const getMonthsData = useMemo(() => {
    const monthNames = ["Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre"];
    const shortMonthNames = ["Jan","Fév","Mar","Avr","Mai","Jun","Jul","Aoû","Sep","Oct","Nov","Déc"];
    const now = new Date();
    const lastCompleteMonth = (now.getMonth() - 1 + 12) % 12;
    return Array.from({ length: 12 }, (_, i) => {
      const monthIndex = (lastCompleteMonth - (11 - i) + 12) % 12;
      return { vKey: `V${i + 1}`, rupKey: `RUP${i + 1}`, name: monthNames[monthIndex], shortName: shortMonthNames[monthIndex], monthIndex };
    });
  }, []);

  const salesData = useMemo(() => {
    if (!articleData?.article) return [];
    return getMonthsData.map((m) => ({ name: m.shortName, fullName: m.name, ventes: parseFloat(articleData.article[m.vKey]) || 0 }));
  }, [articleData, getMonthsData]);

  const ruptureData = useMemo(() => {
    if (!articleData?.article) return [];
    return getMonthsData.map((m) => ({ name: m.shortName, fullName: m.name, ruptures: parseFloat(articleData.article[m.rupKey]) || 0 }));
  }, [articleData, getMonthsData]);

  const totalSales = useMemo(() => salesData.reduce((s, i) => s + i.ventes, 0), [salesData]);
  const totalRuptures = useMemo(() => ruptureData.reduce((s, i) => s + i.ruptures, 0), [ruptureData]);
  const averageMonthlySales = useMemo(() => (totalSales === 0 ? 0 : totalSales / 12), [totalSales]);

  const stockEnJours = useMemo(() => {
    if (!article) return null;
    const st = calculateStockTotal(article);
    if (st === 0) return 0;
    if (averageMonthlySales === 0) return Infinity;
    return Math.round((st / averageMonthlySales) * 30);
  }, [article, averageMonthlySales]);

  const stockEnMois = useMemo(() => {
    if (!article) return null;
    const st = calculateStockTotal(article);
    if (st === 0) return 0;
    if (averageMonthlySales === 0) return Infinity;
    return (st / averageMonthlySales).toFixed(1);
  }, [article, averageMonthlySales]);

  const formatStockEnJours = (j) => j === null || j === undefined ? "-" : j === Infinity ? "∞" : j === 0 ? "0 jour" : j === 1 ? "1 jour" : `${j} jours`;
  const formatStockEnMois = (m) => m === null || m === undefined ? "-" : m === Infinity ? "∞" : `${m} mois`;

  const calculateMarge = (art) => {
    if (!art) return null;
    const pvHT = parseFloat(art.PVTE) || 0;
    const prixRevient = (parseFloat(art.DERPREV) || 0) > 0 ? parseFloat(art.DERPREV) : parseFloat(art.PREV) || 0;
    if (pvHT <= 0 || prixRevient <= 0) return null;
    return ((pvHT - prixRevient) / pvHT * 100).toFixed(1);
  };

  // Dérivés
  const isRenvoi = articleData?.isRenvoi || false;
  const articleOriginal = articleData?.articleOriginal;
  const nombreRenvois = articleData?.nombreRenvois || 0;
  const hasActivePromo = article ? isPromoActive(article) : false;
  const hasPhotosConfigured = !!selectedEntrepriseData?.cheminPhotos;

  // ── URLs médias ──────────────────────────────────────────────────────────
  const photoUrl = hasPhotosConfigured && article
    ? getPhotoUrl(selectedEntrepriseData?.trigramme, article.NART)
    : null;

  const pdfUrl = hasPhotosConfigured && article
    ? getPdfUrl(selectedEntrepriseData?.trigramme, article.NART)
    : null;

  const mappingEntrepots = selectedEntrepriseData?.mappingEntrepots || { S1: "Magasin", S2: "S2", S3: "S3", S4: "S4", S5: "S5" };

  // ── Rendu onglet Filiales ─────────────────────────────────────────────────
  const renderFilialesTab = () => {
    if (loadingFiliales || fetchingFiliales)
      return (<div className="filiales-loading"><div className="loading-spinner"></div><p>Chargement des données inter-entreprises...</p></div>);

    if (!filialeData?.filiales?.length)
      return (<div className="filiales-empty"><HiGlobe className="filiales-empty-icon" /><h3>Aucune donnée disponible</h3><p>Cet article n'a pas de correspondance dans les autres entités</p></div>);

    const filiales = filialeData.filiales;
    const stockFiliales = filialeData.stockTotal || 0;
    const stockEntrepriseSelectionnee = calculateStockTotal(article);
    const stockTotalGroupe = stockFiliales + stockEntrepriseSelectionnee;
    const filialesAvecStock = filiales.filter((f) => f.stock > 0);
    const filialesSansStock = filiales.filter((f) => f.stock === 0);
    const nbEntitesAvecStock = filialesAvecStock.length + (stockEntrepriseSelectionnee > 0 ? 1 : 0);

    return (
      <div className="tab-panel filiales-tab">
        <div className="filiales-content">
          <div className="filiales-summary">
            <div className="filiales-summary-card total"><HiChartBar className="summary-icon" /><div className="summary-info"><span className="summary-label">Stock Total Groupe</span><span className={`summary-value ${stockTotalGroupe > 0 ? "positive" : "zero"}`}>{formatStock(stockTotalGroupe)}</span></div></div>
            <div className="filiales-summary-card count"><HiOfficeBuilding className="summary-icon" /><div className="summary-info"><span className="summary-label">Autres entités</span><span className="summary-value">{filiales.length}</span></div></div>
            <div className="filiales-summary-card available"><HiCube className="summary-icon" /><div className="summary-info"><span className="summary-label">Entités en stock</span><span className="summary-value positive">{nbEntitesAvecStock}</span></div></div>
          </div>
          <div className="filiales-list">
            <h3 className="filiales-list-title"><HiGlobe /> Disponibilité par entité</h3>
            <div className="filiales-cards-container">
              {filialesAvecStock.map((f, i) => (
                <div key={`stock-${i}`} className="filiale-card has-stock">
                  <div className="filiale-card-header"><div className="filiale-card-entity"><span className="filiale-trigramme">{f.trigramme}</span><span className="filiale-nom">{f.entrepriseNom}</span></div><div className="filiale-card-status in-stock"><HiCheckCircle /><span>En stock</span></div></div>
                  <div className="filiale-card-body"><div className="filiale-card-info"><span className="filiale-card-label">Code Article</span><code className="filiale-card-nart">{f.nartFiliale}</code></div><div className="filiale-card-info"><span className="filiale-card-label">Stock</span><span className="filiale-card-stock positive">{formatStock(f.stock)}</span></div><div className="filiale-card-info"><span className="filiale-card-label">Prix TTC</span>{f.hasPrix ? <span className="filiale-card-prix">{formatPrice(f.prix)}</span> : <span className="filiale-card-prix-na">Grossiste</span>}</div></div>
                </div>
              ))}
              {filialesSansStock.map((f, i) => (
                <div key={`nostock-${i}`} className="filiale-card no-stock">
                  <div className="filiale-card-header"><div className="filiale-card-entity"><span className="filiale-trigramme">{f.trigramme}</span><span className="filiale-nom">{f.entrepriseNom}</span></div><div className="filiale-card-status out-of-stock"><HiXCircle /><span>Rupture</span></div></div>
                  <div className="filiale-card-body"><div className="filiale-card-info"><span className="filiale-card-label">Code Article</span><code className="filiale-card-nart">{f.nartFiliale}</code></div><div className="filiale-card-info"><span className="filiale-card-label">Stock</span><span className="filiale-card-stock zero">0</span></div><div className="filiale-card-info"><span className="filiale-card-label">Prix TTC</span>{f.hasPrix ? <span className="filiale-card-prix muted">{formatPrice(f.prix)}</span> : <span className="filiale-card-prix-na">Grossiste</span>}</div></div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  };

  if (loadingEntreprises) return (<div className="admin-article-infos-page"><div className="loading-state"><div className="loading-spinner"></div><p>Chargement...</p></div></div>);

  return (
    <div className="admin-article-infos-page">
      {/* Header */}
      <header className="article-infos-header">
        <div className="header-left">
          <button className="btn-back" onClick={() => navigate(-1)}><HiArrowLeft /></button>
          <div className="header-title">
            <h1><HiCube className="title-icon" />Fiche Article</h1>
            <span className="article-nart-badge">{nart}</span>
          </div>
          {hasActivePromo && (
            <div className="promo-indicator-header"><HiFire /><div className="promo-text"><span className="promo-label">Promo</span><span className="promo-discount">-{calculateDiscount(article.PVTETTC, article.PVPROMO)}%</span></div></div>
          )}
        </div>

        <div className="article-navigation">
          <button className="btn-nav btn-prev" onClick={handleNavigatePrevious} disabled={!previousArticle || loadingAdjacent} title={previousArticle ? `Article précédent: ${previousArticle.NART?.trim()}` : "Aucun article précédent"}>
            <HiChevronLeft /><span className="nav-label"></span>
            {previousArticle && <span className="nav-nart">{previousArticle.NART?.trim()}</span>}
          </button>
          <div className="nav-divider" />
          <button className="btn-nav btn-next" onClick={handleNavigateNext} disabled={!nextArticle || loadingAdjacent} title={nextArticle ? `Article suivant: ${nextArticle.NART?.trim()}` : "Aucun article suivant"}>
            {nextArticle && <span className="nav-nart">{nextArticle.NART?.trim()}</span>}
            <span className="nav-label"></span><HiChevronRight />
          </button>
        </div>

        <div className="header-center">
          <div className="entreprise-selector">
            <HiOfficeBuilding className="selector-icon" />
            <select value={selectedEntreprise} onChange={handleEntrepriseChange}>
              <option value="">Sélectionner une entreprise</option>
              {entreprises?.map((e) => (<option key={e._id} value={e.nomDossierDBF}>{e.trigramme} - {e.nomComplet}</option>))}
            </select>
            <HiChevronDown className="selector-arrow" />
          </div>
        </div>

        <div className="header-actions">
          <button className="btn-action" onClick={refetch} disabled={isFetching} title="Rafraîchir"><HiRefresh className={isFetching ? "spinning" : ""} /></button>
          <button className="btn-action" onClick={handleInvalidateCache} disabled={invalidating} title="Invalider le cache"><HiCog className={invalidating ? "spinning" : ""} /></button>
          <button className="btn-action" onClick={() => window.print()} title="Imprimer"><HiPrinter /></button>
        </div>
      </header>

      {/* Content */}
      {!selectedEntreprise ? (
        <div className="empty-state"><HiOfficeBuilding className="empty-icon" /><h2>Sélectionnez une entreprise</h2><p>Choisissez une entreprise pour voir les informations de l'article</p></div>
      ) : loadingArticle ? (
        <div className="loading-state"><div className="loading-spinner"></div><p>Chargement de l'article...</p></div>
      ) : articleError ? (
        <div className="error-state"><HiExclamation className="error-icon" /><h2>Article non trouvé</h2><p>L'article {nart} n'existe pas dans {selectedEntrepriseData?.nomComplet}</p><button onClick={() => navigate(-1)}>Retour à la liste</button></div>
      ) : article ? (
        <div className="article-infos-content">
          {/* Bannière promo */}
          {hasActivePromo && (
            <div className="promo-mega-banner">
              <div className="promo-mega-content">
                <div className="promo-mega-icon"><HiFire /></div>
                <div className="promo-mega-info">
                  <span className="promo-mega-title">🔥 PROMOTION EN COURS 🔥</span>
                  <span className="promo-mega-dates">Du <strong>{formatDate(article.DPROMOD)}</strong> au <strong>{formatDate(article.DPROMOF)}</strong></span>
                </div>
              </div>
              <div className="promo-mega-prices">
                <span className="promo-old-price">{formatPrice(article.PVTETTC)}</span>
                <span className="promo-new-price">{formatPrice(article.PVPROMO)}</span>
                <div className="promo-discount-badge">-{calculateDiscount(article.PVTETTC, article.PVPROMO)}%</div>
              </div>
            </div>
          )}

          {isRenvoi && (
            <div className="alert-banner renvoi">
              <HiSwitchHorizontal className="banner-icon" />
              <div className="banner-content"><strong>ARTICLE EN RENVOI</strong><span>Remplace l'article {articleOriginal?.nart} ({articleOriginal?.designation})</span></div>
              {nombreRenvois > 1 && <span className="renvoi-chain">Chaîne de {nombreRenvois} renvois</span>}
            </div>
          )}

          {isRenvoi && articleOriginal && (
            <div className="renvoi-details-section">
              <div className="renvoi-details">
                <div className="renvoi-from">
                  <span className="renvoi-label">Article recherché</span>
                  <span className="renvoi-nart">{articleOriginal.nart}</span>
                  <span className="renvoi-design">{articleOriginal.designation}</span>
                  {articleOriginal.gencod && <span className="renvoi-gencod"><HiQrcode /> {articleOriginal.gencod}</span>}
                </div>
                <div className="renvoi-arrow"><HiSwitchHorizontal /></div>
                <Link to={`/admin/articles/${selectedEntreprise}/${safeTrim(article.NART)}`} className="renvoi-to renvoi-to-clickable">
                  <span className="renvoi-label">Remplacé par <HiExternalLink className="renvoi-link-icon" /></span>
                  <span className="renvoi-nart">{safeTrim(article.NART)}</span>
                  <span className="renvoi-design">{safeTrim(article.DESIGN)}</span>
                  {safeTrim(article.GENCOD) && <span className="renvoi-gencod"><HiQrcode /> {safeTrim(article.GENCOD)}</span>}
                  <span className="renvoi-click-hint">Cliquer pour voir la fiche →</span>
                </Link>
              </div>
              {nombreRenvois > 1 && <div className="renvoi-chain-warning">⚠️ Chaîne de {nombreRenvois} renvois</div>}
            </div>
          )}

          {(parseFloat(article.DEPREC) || 0) > 0 && (
            <div className="alert-banner deprec"><HiExclamation className="banner-icon" /><div className="banner-content"><strong>ARTICLE DÉPRÉCIÉ</strong><span>Dépréciation de {article.DEPREC}%</span></div></div>
          )}

          {/* Main Grid */}
          <div className="article-main-grid">
            {/* ── Colonne gauche ── */}
            <div className="article-left-column">

              {/* ── MEDIA CARD (photo + pdf) ─────────────────────────────── */}
              <MediaCard
                photoUrl={photoUrl}
                pdfUrl={pdfUrl}
                hasPhotosConfigured={hasPhotosConfigured}
                articleDesign={safeTrim(article.DESIGN)}
                hasActivePromo={hasActivePromo}
                promoDiscount={calculateDiscount(article.PVTETTC, article.PVPROMO)}
              />

              {/* Quick Badges */}
              <div className="quick-badges">
                {hasActivePromo && <div className="quick-badge promo"><HiFire /> PROMO -{calculateDiscount(article.PVTETTC, article.PVPROMO)}%</div>}
                {safeTrim(article.WEB) === "O" && <div className="quick-badge web"><HiGlobe /> Visible Web</div>}
                {safeTrim(article.FOTO) === "F" && <div className="quick-badge photo"><HiPhotograph /> Photo dispo</div>}
                {safeTrim(article.SAV) === "O" && <div className="quick-badge sav"><HiShieldCheck /> SAV</div>}
                {safeTrim(article.COMPOSE) === "O" && <div className="quick-badge compose"><HiCollection /> Composé</div>}
                {safeTrim(article.RENV) === "O" && <div className="quick-badge renvoi"><HiSwitchHorizontal /> Renvoi</div>}
              </div>

              {/* Quick Stats */}
              <div className="quick-stats">
                <div className="quick-stat"><span className="stat-label">Stock Total</span><span className={`stat-value ${calculateStockTotal(article) > 0 ? "positive" : "zero"}`}>{formatStock(calculateStockTotal(article))}</span></div>
                <div className="quick-stat"><span className="stat-label">En Commande</span><span className={`stat-value ${getEnCommande(article) > 0 ? "encde" : ""}`}>{formatStock(getEnCommande(article))}</span></div>
                <div className="quick-stat"><span className="stat-label">Ventes 12 mois</span><span className="stat-value">{formatStock(totalSales)}</span></div>
                <div className="quick-stat"><span className="stat-label">Ruptures 12 mois</span><span className={`stat-value ${totalRuptures > 0 ? "warning" : ""}`}>{formatStock(totalRuptures)}</span></div>
                <div className="quick-stat highlight">
                  <span className="stat-label"><HiClock style={{ marginRight: "4px", verticalAlign: "middle" }} />Stock en jours</span>
                  <span className={`stat-value ${stockEnJours === 0 ? "zero" : stockEnJours === Infinity ? "positive" : stockEnJours < 30 ? "warning" : stockEnJours < 90 ? "" : "positive"}`}>{formatStockEnJours(stockEnJours)}</span>
                </div>
                <div className="quick-stat"><span className="stat-label">Stock en mois</span><span className="stat-value">{formatStockEnMois(stockEnMois)}</span></div>
                <div className="quick-stat full-width"><span className="stat-label">Marge</span><span className="stat-value">{calculateMarge(article) ? `${calculateMarge(article)}%` : "-"}</span></div>
              </div>

              {safeTrim(article.GENDOUBL) && (
                <div className="linked-article-card renvoi-card">
                  <h4><HiSwitchHorizontal /> Article de renvoi vers</h4>
                  <Link to={`/admin/articles/${selectedEntreprise}/${safeTrim(article.GENDOUBL)}`} className="linked-article-link"><span className="linked-nart">{safeTrim(article.GENDOUBL)}</span><HiExternalLink /></Link>
                  <p className="linked-article-hint">Cet article renvoie vers un autre article</p>
                </div>
              )}

              {safeTrim(article.ASSOCIE) && (
                <div className="linked-article-card">
                  <h4><HiCollection /> Article associé</h4>
                  <Link to={`/admin/articles/${selectedEntreprise}/${safeTrim(article.ASSOCIE)}`} className="linked-article-link"><span className="linked-nart">{safeTrim(article.ASSOCIE)}</span><HiExternalLink /></Link>
                </div>
              )}
            </div>

            {/* ── Colonne droite ── */}
            <div className="article-right-column">
              {/* Tabs Navigation */}
              <div className="tabs-nav">
                <button className={`tab-btn ${activeTab === "general" ? "active" : ""}`} onClick={() => setActiveTab("general")}><HiClipboardList /> <span>Général</span></button>
                <button className={`tab-btn ${activeTab === "stocks" ? "active" : ""}`} onClick={() => setActiveTab("stocks")}><HiArchive /> <span>Stocks</span></button>
                <button className={`tab-btn ${activeTab === "prix" ? "active" : ""}`} onClick={() => setActiveTab("prix")}><HiCurrencyDollar /> <span>Prix</span></button>
                <button className={`tab-btn ${activeTab === "ventes" ? "active" : ""}`} onClick={() => setActiveTab("ventes")}><HiChartBar /> <span>Ventes</span></button>
                <button className={`tab-btn ${activeTab === "filiales" ? "active" : ""}`} onClick={() => setActiveTab("filiales")}>
                  <HiGlobe /> <span>Stock Groupe</span>
                  {filialeData?.filiales?.length > 0 && <span className="tab-badge">{filialeData.filiales.length}</span>}
                </button>
                <button className={`tab-btn ${activeTab === "autres" ? "active" : ""}`} onClick={() => setActiveTab("autres")}><HiCog /> <span>Autres</span></button>
              </div>

              {/* Tab Content */}
              <div className="tab-content">
                {/* ── Général ── */}
                {activeTab === "general" && (
                  <div className="tab-panel">
                    <div className="info-section designation-section">
                      <h2 className="article-design-main">{safeTrim(article.DESIGN)}</h2>
                      {safeTrim(article.DESIGN2) && <p className="article-design-sub">{safeTrim(article.DESIGN2)}</p>}
                      {safeTrim(article.DESIFRN) && <p className="article-design-frn"><span>Désignation fournisseur:</span> {safeTrim(article.DESIFRN)}</p>}
                    </div>
                    <div className="info-section">
                      <h3><HiQrcode /> Identification</h3>
                      <div className="info-grid cols-3">
                        <div className="info-item"><label>Code NART</label><span className="value highlight mono">{safeTrim(article.NART)}</span></div>
                        <div className="info-item"><label>Code barre (GENCOD)</label><span className="value mono">{safeTrim(article.GENCOD) || "-"}</span></div>
                        <div className="info-item"><label>Réf. fournisseur</label><span className="value">{safeTrim(article.REFER) || "-"}</span></div>
                        <div className="info-item"><label>Fournisseur</label><span className="value">{article.FOURN || "-"}</span></div>
                        <div className="info-item"><label>Groupe / Famille</label><span className="value tag">{safeTrim(article.GROUPE) || "-"}</span></div>
                        <div className="info-item"><label>Code tarif</label><span className="value">{safeTrim(article.CODTAR) || "-"}</span></div>
                      </div>
                    </div>
                    <div className="info-section">
                      <h3><HiArchive /> Conditionnement</h3>
                      <div className="info-grid cols-4">
                        <div className="info-item"><label>Unité</label><span className="value">{safeTrim(article.UNITE) || "-"}</span></div>
                        <div className="info-item"><label>Conditionnement</label><span className="value">{article.CONDITNM || "-"}</span></div>
                        <div className="info-item"><label>Volume</label><span className="value">{article.VOL || "-"}</span></div>
                        <div className="info-item"><label>Colisage (KL)</label><span className="value">{safeTrim(article.KL) || "-"}</span></div>
                      </div>
                    </div>
                    <div className="info-section">
                      <h3><HiLocationMarker /> Emplacements / Gisements</h3>
                      <div className="info-grid cols-3">
                        <div className="info-item highlight-box"><label>Place principale</label><span className="value">{safeTrim(article.PLACE) || "-"}</span></div>
                        {["GISM1","GISM2","GISM3","GISM4","GISM5"].map((g, i) => (
                          <div key={g} className="info-item"><label>Gisement {i + 1}</label><span className="value">{safeTrim(article[g]) || "-"}</span></div>
                        ))}
                      </div>
                    </div>
                    {safeTrim(article.OBSERV) && (
                      <div className="info-section observations-section">
                        <h3><HiDocumentText /> Observations</h3>
                        <p className="observations-text">{safeTrim(article.OBSERV)}</p>
                      </div>
                    )}
                  </div>
                )}

                {/* ── Stocks ── */}
                {activeTab === "stocks" && (
                  <div className="tab-panel">
                    <div className="info-section">
                      <h3><HiArchive /> Stocks par emplacement</h3>
                      <div className="stocks-grid">
                        <div className="stock-card total"><div className="stock-card-header"><span className="stock-label">Stock Total</span><HiArchive className="stock-icon" /></div><span className={`stock-value ${calculateStockTotal(article) > 0 ? "positive" : "zero"}`}>{formatStock(calculateStockTotal(article))}</span></div>
                        <div className="stock-card encde"><div className="stock-card-header"><span className="stock-label">En Commande</span><HiTruck className="stock-icon" /></div><span className={`stock-value ${getEnCommande(article) > 0 ? "encde" : ""}`}>{formatStock(getEnCommande(article))}</span></div>
                        <div className="stock-card stock-days"><div className="stock-card-header"><span className="stock-label">Stock en Jours</span><HiClock className="stock-icon" /></div><span className={`stock-value ${stockEnJours === 0 ? "zero" : stockEnJours === Infinity ? "positive" : stockEnJours < 30 ? "warning" : stockEnJours < 90 ? "" : "positive"}`}>{formatStockEnJours(stockEnJours)}</span><span className="stock-subvalue">({formatStockEnMois(stockEnMois)})</span></div>
                        {["S1","S2","S3","S4","S5"].map((key) => (
                          <div key={key} className="stock-card"><div className="stock-card-header"><span className="stock-label">{mappingEntrepots[key]}</span><span className="stock-key">{key}</span></div><span className={`stock-value ${parseFloat(article[key]) > 0 ? "positive" : "zero"}`}>{formatStock(article[key])}</span></div>
                        ))}
                      </div>
                    </div>
                    <div className="info-section">
                      <h3><HiTrendingDown /> Gestion des stocks</h3>
                      <div className="info-grid cols-4">
                        <div className="info-item"><label>Stock STOCK (ancien)</label><span className={`value ${parseFloat(article.STOCK) > 0 ? "positive" : "zero"}`}>{formatStock(article.STOCK)}</span></div>
                        <div className="info-item"><label>Stock local 2 (STLOC2)</label><span className="value">{formatStock(article.STLOC2)}</span></div>
                        <div className="info-item"><label>Stock mini (SMINI)</label><span className="value warning">{formatStock(article.SMINI)}</span></div>
                        <div className="info-item"><label>Réservé</label><span className="value reserved">{formatStock(article.RESERV)}</span></div>
                        <div className="info-item"><label>En commande (ENCDE)</label><span className="value">{formatStock(article.ENCDE)}</span></div>
                        <div className="info-item"><label>Commande spéciale</label><span className="value">{formatStock(article.CDESPEC)}</span></div>
                        <div className="info-item"><label>Stock sécurité</label><span className="value">{formatStock(article.STSECUR)}</span></div>
                        <div className="info-item"><label>Tarif liste (TARIFL)</label><span className="value">{article.TARIFL ? "Oui" : "Non"}</span></div>
                      </div>
                    </div>
                    <div className="info-section chart-section">
                      <h3><HiChartBar /> Répartition des stocks</h3>
                      <div className="chart-container">
                        <ResponsiveContainer width="100%" height={300}>
                          <BarChart data={["S1","S2","S3","S4","S5"].map((k) => ({ name: mappingEntrepots[k], value: parseFloat(article[k]) || 0 }))} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3a" /><XAxis dataKey="name" stroke="#a0a0b0" /><YAxis stroke="#a0a0b0" />
                            <Tooltip contentStyle={{ backgroundColor: "#1a1a25", border: "1px solid #2a2a3a", borderRadius: "8px" }} labelStyle={{ color: "#f0f0f5" }} />
                            <Bar dataKey="value" name="Stock" fill="#6366f1" radius={[4, 4, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  </div>
                )}

                {/* ── Prix ── */}
                {activeTab === "prix" && (
                  <div className="tab-panel">
                    <div className="info-section">
                      <h3><HiCurrencyDollar /> Prix de vente</h3>
                      <div className="price-cards">
                        <div className={`price-card main ${hasActivePromo ? "has-promo" : ""}`}><span className="price-label">Prix TTC</span><span className={`price-value ${hasActivePromo ? "strikethrough" : ""}`}>{formatPrice(article.PVTETTC)}</span></div>
                        {hasActivePromo && (<div className="price-card promo"><span className="price-label">Prix PROMO</span><span className="price-value">{formatPrice(article.PVPROMO)}</span><span className="discount-badge">-{calculateDiscount(article.PVTETTC, article.PVPROMO)}%</span></div>)}
                        <div className="price-card"><span className="price-label">Prix HT</span><span className="price-value">{formatPrice(article.PVTE)}</span></div>
                        <div className="price-card"><span className="price-label">Prix détail</span><span className="price-value">{formatPrice(article.PDETAIL)}</span></div>
                      </div>
                    </div>
                    <div className="info-section">
                      <h3><HiTrendingUp /> Prix d'achat & Marges</h3>
                      <div className="info-grid cols-4">
                        <div className="info-item highlight-box">
                          <label>Prix d'achat (PACHAT){safeTrim(article.DEVISE) && safeTrim(article.DEVISE) !== "XPF" && <span className="devise-badge"><HiCurrencyEuro /> {safeTrim(article.DEVISE)}</span>}</label>
                          <span className="value">
                            {(() => {
                              const devise = safeTrim(article.DEVISE);
                              const pachat = parseFloat(article.PACHAT) || 0;
                              if (!devise || devise === "XPF" || devise === "CFP" || devise === "F") return formatPrice(pachat);
                              return `${pachat.toLocaleString("fr-FR", { minimumFractionDigits: 2 })} ${devise}`;
                            })()}
                          </span>
                          {safeTrim(article.DEVISE) && !["XPF","CFP","F"].includes(safeTrim(article.DEVISE)) && (
                            <div className="conversion-info">
                              {(() => {
                                const conv = convertToXPF(parseFloat(article.PACHAT) || 0, safeTrim(article.DEVISE));
                                if (conv.error) return <span className="conversion-error">⚠️ {conv.error}</span>;
                                if (conv.amountXPF !== null) return (<><span className="conversion-result">≈ {formatPrice(conv.amountXPF)}</span><span className="conversion-rate">(1 {conv.fromCurrency} = {conv.rate?.toFixed(2)} XPF)</span>{exchangeRates?.isFallback && <span className="conversion-warning">Taux approximatif</span>}</>);
                                return null;
                              })()}
                            </div>
                          )}
                        </div>
                        <div className="info-item"><label>Prix de revient (PREV)</label><span className="value">{formatPrice(article.PREV)}</span></div>
                        <div className="info-item"><label>Dernier prix revient</label><span className="value">{formatPrice(article.DERPREV)}</span></div>
                        <div className="info-item highlight-box success"><label>Marge calculée</label><span className="value">{calculateMarge(article) ? `${calculateMarge(article)}%` : "-"}</span>{calculateMarge(article) && <span className="marge-formula">(PVTE - DERPREV) / PVTE</span>}</div>
                        <div className="info-item"><label>% Marge (POURC)</label><span className="value">{formatPercent(article.POURC)}</span></div>
                        <div className="info-item"><label>Devise achat</label><span className="value">{safeTrim(article.DEVISE) || "XPF (défaut)"}</span></div>
                        {exchangeRates && (<div className="info-item"><label>Taux de change{exchangeRatesLoading && " (chargement...)"}</label><span className="value small">{exchangeRates.isFallback ? <span className="warning">Taux approximatifs</span> : `Mis à jour: ${exchangeRates.date}`}</span></div>)}
                      </div>
                    </div>
                    <div className="info-section">
                      <h3><HiTag /> Remises quantité</h3>
                      <div className="info-grid cols-4">
                        <div className="info-item"><label>Qté niveau 2</label><span className="value">{article.QT2 || "-"}</span></div>
                        <div className="info-item"><label>Prix niveau 2</label><span className="value">{formatPrice(article.PR2)}</span></div>
                        <div className="info-item"><label>Qté niveau 3</label><span className="value">{article.QT3 || "-"}</span></div>
                        <div className="info-item"><label>Prix niveau 3</label><span className="value">{formatPrice(article.PR3)}</span></div>
                      </div>
                    </div>
                    <div className="info-section">
                      <h3><HiDocumentText /> Fiscalité</h3>
                      <div className="info-grid cols-4">
                        <div className="info-item highlight-box"><label>Taux TGC (TAXES)</label><span className="value">{formatPercent(article.TAXES)}</span></div>
                        <div className="info-item"><label>Autre TVA (ATVA)</label><span className="value">{formatPercent(article.ATVA)}</span></div>
                        <div className="info-item"><label>Taux à déduire</label><span className="value">{formatPercent(article.TXADEDUIRE)}</span></div>
                        <div className="info-item"><label>Code TGC</label><span className="value">{safeTrim(article.CODTGC) || "-"}</span></div>
                      </div>
                    </div>
                    {(article.DPROMOD || article.DPROMOF) && (
                      <div className="info-section promo-section">
                        <h3><HiTag /> Informations promotion</h3>
                        <div className="info-grid cols-3">
                          <div className="info-item"><label>Date début promo</label><span className="value">{formatDate(article.DPROMOD)}</span></div>
                          <div className="info-item"><label>Date fin promo</label><span className="value">{formatDate(article.DPROMOF)}</span></div>
                          <div className="info-item"><label>Prix promo</label><span className="value promo">{formatPrice(article.PVPROMO)}</span></div>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* ── Ventes ── */}
                {activeTab === "ventes" && (
                  <div className="tab-panel">
                    <div className="info-section chart-section">
                      <h3><HiTrendingUp /> Historique des ventes (12 derniers mois)</h3>
                      <div className="chart-stats">
                        <div className="chart-stat"><span className="stat-value">{formatStock(totalSales)}</span><span className="stat-label">Total ventes</span></div>
                        <div className="chart-stat"><span className="stat-value">{averageMonthlySales.toFixed(1)}</span><span className="stat-label">Moyenne/mois</span></div>
                        <div className="chart-stat highlight"><span className="stat-value">{formatStockEnJours(stockEnJours)}</span><span className="stat-label">Stock en jours</span></div>
                      </div>
                      <div className="chart-container large">
                        <ResponsiveContainer width="100%" height={350}>
                          <AreaChart data={salesData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                            <defs><linearGradient id="colorVentes" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#6366f1" stopOpacity={0.8} /><stop offset="95%" stopColor="#6366f1" stopOpacity={0.1} /></linearGradient></defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3a" /><XAxis dataKey="name" stroke="#a0a0b0" /><YAxis stroke="#a0a0b0" />
                            <Tooltip contentStyle={{ backgroundColor: "#1a1a25", border: "1px solid #2a2a3a", borderRadius: "8px" }} labelStyle={{ color: "#f0f0f5" }} formatter={(v) => [v, "Ventes"]} labelFormatter={(l, p) => p?.[0]?.payload?.fullName || l} />
                            <Area type="monotone" dataKey="ventes" stroke="#6366f1" strokeWidth={2} fillOpacity={1} fill="url(#colorVentes)" />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                    <div className="info-section">
                      <h3><HiChartBar /> Détail des ventes par mois</h3>
                      <div className="sales-table">
                        <table>
                          <thead><tr><th>Mois</th><th className="text-right">Ventes</th><th className="text-right">Ruptures</th></tr></thead>
                          <tbody>
                            {salesData.map((item, i) => (
                              <tr key={item.name + i}>
                                <td>{item.fullName}</td>
                                <td className="text-right"><span className={item.ventes > 0 ? "positive" : ""}>{formatStock(item.ventes)}</span></td>
                                <td className="text-right"><span className={ruptureData[i]?.ruptures > 0 ? "warning" : ""}>{formatStock(ruptureData[i]?.ruptures || 0)}</span></td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot><tr><td><strong>Total</strong></td><td className="text-right"><strong>{formatStock(totalSales)}</strong></td><td className="text-right"><strong>{formatStock(totalRuptures)}</strong></td></tr></tfoot>
                        </table>
                      </div>
                    </div>
                    {totalRuptures > 0 && (
                      <div className="info-section chart-section">
                        <h3><HiExclamation /> Historique des ruptures (12 derniers mois)</h3>
                        <div className="chart-stats warning"><div className="chart-stat"><span className="stat-value">{formatStock(totalRuptures)}</span><span className="stat-label">Total ruptures</span></div></div>
                        <div className="chart-container">
                          <ResponsiveContainer width="100%" height={250}>
                            <BarChart data={ruptureData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                              <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3a" /><XAxis dataKey="name" stroke="#a0a0b0" /><YAxis stroke="#a0a0b0" />
                              <Tooltip contentStyle={{ backgroundColor: "#1a1a25", border: "1px solid #2a2a3a", borderRadius: "8px" }} labelStyle={{ color: "#f0f0f5" }} formatter={(v) => [v, "Ruptures"]} labelFormatter={(l, p) => p?.[0]?.payload?.fullName || l} />
                              <Bar dataKey="ruptures" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* ── Filiales ── */}
                {activeTab === "filiales" && renderFilialesTab()}

                {/* ── Autres ── */}
                {activeTab === "autres" && (
                  <div className="tab-panel">
                    <div className="info-section">
                      <h3><HiCalendar /> Dates importantes</h3>
                      <div className="info-grid cols-3">
                        <div className="info-item"><label>Date création</label><span className="value">{formatDate(article.CREATION)}</span></div>
                        <div className="info-item"><label>Date inventaire</label><span className="value">{formatDate(article.DATINV)}</span></div>
                        <div className="info-item"><label>Date inventaire 2</label><span className="value">{formatDate(article.DATINV2)}</span></div>
                      </div>
                    </div>
                    <div className="info-section">
                      <h3><HiDocumentText /> Informations douanières</h3>
                      <div className="info-grid cols-3">
                        <div className="info-item"><label>Code douane</label><span className="value mono">{safeTrim(article.DOUANE) || "-"}</span></div>
                        <div className="info-item"><label>Devise</label><span className="value">{safeTrim(article.DEVISE) || "-"}</span></div>
                        <div className="info-item"><label>Code mise à jour</label><span className="value">{safeTrim(article.CODMAJ) || "-"}</span></div>
                      </div>
                    </div>
                    <div className="info-section">
                      <h3><HiCog /> Paramètres spéciaux</h3>
                      <div className="info-grid cols-4">
                        <div className="info-item"><label>SAV</label><span className={`value badge ${safeTrim(article.SAV) === "O" ? "success" : ""}`}>{safeTrim(article.SAV) === "O" ? "Oui" : "Non"}</span></div>
                        <div className="info-item"><label>Garantie</label><span className="value">{safeTrim(article.GARANTIE) || "-"}</span></div>
                        <div className="info-item"><label>Article composé</label><span className={`value badge ${safeTrim(article.COMPOSE) === "O" ? "info" : ""}`}>{safeTrim(article.COMPOSE) === "O" ? "Oui" : "Non"}</span></div>
                        <div className="info-item"><label>Article en renvoi</label><span className={`value badge ${safeTrim(article.RENV) === "O" ? "warning" : ""}`}>{safeTrim(article.RENV) === "O" ? "Oui" : "Non"}</span></div>
                        <div className="info-item"><label>Visible Web</label><span className={`value badge ${safeTrim(article.WEB) === "O" ? "success" : ""}`}>{safeTrim(article.WEB) === "O" ? "Oui" : "Non"}</span></div>
                        <div className="info-item"><label>Photo disponible</label><span className={`value badge ${safeTrim(article.FOTO) === "F" ? "success" : ""}`}>{safeTrim(article.FOTO) === "F" ? "Oui" : "Non"}</span></div>
                        <div className="info-item"><label>Texte</label><span className="value">{safeTrim(article.TEXTE) || "-"}</span></div>
                        <div className="info-item"><label>Couleur</label><span className="value">{safeTrim(article.COULR) || "-"}</span></div>
                      </div>
                    </div>
                    <div className="info-section">
                      <h3><HiExclamation /> Dépréciation</h3>
                      <div className="info-grid cols-2"><div className="info-item highlight-box warning"><label>Taux de dépréciation</label><span className="value">{formatPercent(article.DEPREC)}</span></div></div>
                    </div>
                    <div className="info-section">
                      <h3><HiLink /> Articles liés</h3>
                      <div className="info-grid cols-2">
                        <div className="info-item"><label>Article de renvoi (GENDOUBL)</label>{safeTrim(article.GENDOUBL) ? <Link to={`/admin/articles/${selectedEntreprise}/${safeTrim(article.GENDOUBL)}`} className="value link">{safeTrim(article.GENDOUBL)}<HiExternalLink /></Link> : <span className="value">-</span>}</div>
                        <div className="info-item"><label>Article associé</label>{safeTrim(article.ASSOCIE) ? <Link to={`/admin/articles/${selectedEntreprise}/${safeTrim(article.ASSOCIE)}`} className="value link">{safeTrim(article.ASSOCIE)}<HiExternalLink /></Link> : <span className="value">-</span>}</div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default AdminArticleInfosScreen;

