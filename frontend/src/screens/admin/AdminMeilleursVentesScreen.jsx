import React, { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  HiArrowLeft,
  HiChevronDown,
  HiOfficeBuilding,
  HiCube,
  HiPhotograph,
  HiTrendingUp,
  HiExclamation,
  HiArchive,
  HiRefresh,
  HiCog,
  HiFilter,
  HiChartBar,
  HiTruck,
  HiCheckCircle,
} from "react-icons/hi";

import * as XLSX from "xlsx";
import { saveAs } from "file-saver";

import { useGetEntreprisesQuery } from "../../slices/entrepriseApiSlice";
import {
  useGetArticlesQuery,
  useInvalidateArticleCacheMutation,
  getPhotoUrl,
} from "../../slices/articleApiSlice";

import "./AdminMeilleursVentesScreen.css";

const AdminMeilleuresVentesScreen = () => {
  const navigate = useNavigate();

  /* =======================
     STATES
  ======================= */
  const [selectedEntreprise, setSelectedEntreprise] = useState("");
  const [selectedEntrepriseData, setSelectedEntrepriseData] = useState(null);
  const [fournisseurFilter, setFournisseurFilter] = useState("");
  const [showFilters, setShowFilters] = useState(false);

  /* =======================
     API QUERIES
  ======================= */
  const { data: entreprises, isLoading: loadingEntreprises } =
    useGetEntreprisesQuery();

  const {
    data: articlesData,
    isLoading: loadingArticles,
    isFetching,
    refetch,
  } = useGetArticlesQuery(
    {
      nomDossierDBF: selectedEntreprise,
      page: 1,
      limit: 999999,
    },
    { skip: !selectedEntreprise },
  );

  const [invalidateCache, { isLoading: invalidating }] =
    useInvalidateArticleCacheMutation();

  /* =======================
     INIT ENTREPRISE
  ======================= */
  useEffect(() => {
    if (entreprises?.length && !selectedEntreprise) {
      setSelectedEntreprise(entreprises[0].nomDossierDBF);
      setSelectedEntrepriseData(entreprises[0]);
    }
  }, [entreprises, selectedEntreprise]);

  const handleEntrepriseChange = (e) => {
    const value = e.target.value;
    const ent = entreprises.find((e) => e.nomDossierDBF === value);
    setSelectedEntreprise(value);
    setSelectedEntrepriseData(ent);
    setFournisseurFilter("");
  };

  const handleInvalidateCache = async () => {
    if (!selectedEntreprise) return;
    await invalidateCache(selectedEntreprise);
    refetch();
  };

  /* =======================
     CALCULS METIERS
  ======================= */
  const articlesAvecStats = useMemo(() => {
    if (!articlesData?.articles) return [];

    return articlesData.articles
      .map((a) => {
        const totalVentes = Array.from(
          { length: 12 },
          (_, i) => parseFloat(a[`V${i + 1}`]) || 0,
        ).reduce((s, v) => s + v, 0);

        const totalRuptures = Array.from(
          { length: 12 },
          (_, i) => parseFloat(a[`RUP${i + 1}`]) || 0,
        ).reduce((s, v) => s + v, 0);

        const stockTotal =
          (parseFloat(a.S1) || 0) +
          (parseFloat(a.S2) || 0) +
          (parseFloat(a.S3) || 0) +
          (parseFloat(a.S4) || 0) +
          (parseFloat(a.S5) || 0);

        return {
          ...a,
          totalVentes,
          totalRuptures,
          stockTotal,
          enCommande: parseFloat(a.ENCDE) || 0,
        };
      })
      .filter((a) => {
        if (!fournisseurFilter) return true;
        return String(a.FOURN || "")
          .toLowerCase()
          .includes(fournisseurFilter.toLowerCase());
      })
      .sort((a, b) => b.totalVentes - a.totalVentes);
  }, [articlesData, fournisseurFilter]);

  /* =======================
     EXPORT EXCEL
  ======================= */
  const handleExportExcel = () => {
    if (!articlesAvecStats.length) return;

    const rows = articlesAvecStats.map((a, index) => ({
      Rang: index + 1,
      NART: a.NART,
      Désignation: a.DESIGN,
      "Désignation 2": a.DESIGN2 || "",
      Fournisseur: a.FOURN || "",
      "Ventes 12 mois": a.totalVentes,
      Ruptures: a.totalRuptures,
      Stock: a.stockTotal,
      "En commande": a.enCommande,
      "Prix TTC (XPF)": a.PVTETTC || 0,
    }));

    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Meilleures ventes");

    const excelBuffer = XLSX.write(workbook, {
      bookType: "xlsx",
      type: "array",
    });

    const blob = new Blob([excelBuffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });

    saveAs(
      blob,
      `meilleures_ventes_${selectedEntreprise}_${new Date()
        .toISOString()
        .slice(0, 10)}.xlsx`,
    );
  };

  /* =======================
     HELPERS
  ======================= */
  const formatStock = (v) =>
    v === null || v === undefined ? "-" : v.toLocaleString("fr-FR");

  const formatPrice = (v) =>
    v || v === 0
      ? new Intl.NumberFormat("fr-FR", {
          style: "currency",
          currency: "XPF",
          minimumFractionDigits: 0,
        }).format(v)
      : "-";

  const hasPhotosConfigured = !!selectedEntrepriseData?.cheminPhotos;

  /* =======================
     RENDER
  ======================= */
  if (loadingEntreprises) {
    return <div className="loading-state">Chargement...</div>;
  }

  return (
    <div className="admin-meilleures-ventes-page">
      {/* HEADER */}
      <header className="meilleures-ventes-header">
        <div className="header-left">
          <button onClick={() => navigate(-1)}>
            <HiArrowLeft />
          </button>
          <h1>
            <HiChartBar /> Meilleures ventes
          </h1>
        </div>

        <div className="header-center">
          <select value={selectedEntreprise} onChange={handleEntrepriseChange}>
            {entreprises.map((e) => (
              <option key={e._id} value={e.nomDossierDBF}>
                {e.trigramme} - {e.nomComplet}
              </option>
            ))}
          </select>
        </div>

        <div className="header-actions">
          <button onClick={() => setShowFilters(!showFilters)}>
            <HiFilter />
          </button>
          <button onClick={refetch} disabled={isFetching}>
            <HiRefresh />
          </button>
          <button onClick={handleInvalidateCache} disabled={invalidating}>
            <HiCog />
          </button>
          <button onClick={handleExportExcel} title="Exporter Excel">
            📥 Excel
          </button>
        </div>
      </header>

      {/* TABLE */}
      {loadingArticles ? (
        <div className="loading-state">Chargement des articles…</div>
      ) : (
        <table className="meilleures-ventes-table">
          <thead>
            <tr>
              <th>#</th>
              <th>NART</th>
              <th>Désignation</th>
              <th>Fournisseur</th>
              <th>Ventes 12M</th>
              <th>Ruptures</th>
              <th>Stock</th>
              <th>En cde</th>
              <th>Prix TTC</th>
            </tr>
          </thead>
          <tbody>
            {articlesAvecStats.map((a, i) => (
              <tr key={a.NART}>
                <td>{i + 1}</td>
                <td>{a.NART}</td>
                <td>{a.DESIGN}</td>
                <td>{a.FOURN || "-"}</td>
                <td>{formatStock(a.totalVentes)}</td>
                <td>{formatStock(a.totalRuptures)}</td>
                <td>{formatStock(a.stockTotal)}</td>
                <td>{formatStock(a.enCommande)}</td>
                <td>{formatPrice(a.PVTETTC)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};

export default AdminMeilleuresVentesScreen;