// src/screens/admin/AdminExecutablesScreen.jsx
//
// Catalogue d'exécutables internes (Données > Exécutables).
// Écran LISTE : une carte compacte cliquable par produit (regroupé par nom).
// Le détail (toutes les versions + documents + gestion) est sur l'écran dédié
// AdminExecutableDetailScreen (/admin/executables/:name).
import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSelector } from "react-redux";
import {
  HiPlus,
  HiCube,
  HiRefresh,
  HiExclamationCircle,
  HiChevronRight,
  HiPaperClip,
  HiCollection,
} from "react-icons/hi";
import { useGetExecutablesQuery } from "../../slices/executableApiSlice";
import ExecutableCreateModal from "../../components/Admin/ExecutableCreateModal";
import { isSuperAdminClient } from "../../config/adminModules";
import { formatDate, compareVersionsDesc } from "../../utils/executableHelpers";
import "./AdminExecutablesScreen.css";

const AdminExecutablesScreen = () => {
  const navigate = useNavigate();
  const { userInfo } = useSelector((state) => state.auth);
  const canManage = isSuperAdminClient(userInfo);

  const { data: executables, isLoading, error, refetch, isFetching } =
    useGetExecutablesQuery();
  const [showCreate, setShowCreate] = useState(false);

  // Un « produit » = un nom ; ses versions sont regroupées et triées.
  const products = useMemo(() => {
    const map = new Map();
    (executables || []).forEach((exe) => {
      if (!map.has(exe.name)) map.set(exe.name, []);
      map.get(exe.name).push(exe);
    });
    return [...map.entries()]
      .map(([name, versions]) => {
        const sorted = [...versions].sort(compareVersionsDesc);
        const latest = sorted[0];
        const docCount = sorted.reduce(
          (n, v) => n + (v.documents?.length || 0),
          0,
        );
        return { name, versions: sorted, latest, docCount };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [executables]);

  return (
    <div className="admin-executables">
      <header className="exe-header">
        <div className="exe-header-title">
          <div className="exe-header-icon">
            <HiCube />
          </div>
          <div>
            <h1>Exécutables</h1>
            <p className="exe-header-sub">
              Outils internes téléchargeables et leur documentation
            </p>
          </div>
        </div>
        <div className="exe-header-actions">
          <button
            className="exe-btn-ghost icon"
            onClick={refetch}
            disabled={isFetching}
            title="Rafraîchir"
          >
            <HiRefresh className={isFetching ? "spinning" : ""} />
          </button>
          {canManage && (
            <button className="exe-btn-primary" onClick={() => setShowCreate(true)}>
              <HiPlus />
              <span>Nouvel exécutable</span>
            </button>
          )}
        </div>
      </header>

      {isLoading ? (
        <div className="exe-state">
          <div className="exe-spinner" />
          <p>Chargement du catalogue…</p>
        </div>
      ) : error ? (
        <div className="exe-state error">
          <HiExclamationCircle />
          <p>Erreur : {error?.data?.message || "chargement impossible"}</p>
          <button onClick={refetch}>Réessayer</button>
        </div>
      ) : products.length === 0 ? (
        <div className="exe-empty">
          <HiCube />
          <h3>Aucun exécutable</h3>
          <p>
            {canManage
              ? "Ajoutez un premier outil avec « Nouvel exécutable »."
              : "Aucun outil n'est disponible pour le moment."}
          </p>
        </div>
      ) : (
        <div className="exe-grid compact">
          {products.map((p) => (
            <button
              key={p.name}
              className="exe-card-compact"
              onClick={() => navigate(`/admin/executables/${encodeURIComponent(p.name)}`)}
              title={`Voir les détails de ${p.name}`}
            >
              <div className="exe-cc-icon">
                <HiCube />
              </div>
              <div className="exe-cc-body">
                <div className="exe-cc-top">
                  <h2>{p.name}</h2>
                  <span className="exe-cc-latest">v{p.latest?.version}</span>
                </div>
                {p.latest?.description && (
                  <p className="exe-cc-desc">{p.latest.description}</p>
                )}
                <div className="exe-cc-meta">
                  <span className="exe-cc-chip">
                    <HiCollection />
                    {p.versions.length} version{p.versions.length > 1 ? "s" : ""}
                  </span>
                  {p.docCount > 0 && (
                    <span className="exe-cc-chip">
                      <HiPaperClip />
                      {p.docCount} doc{p.docCount > 1 ? "s" : ""}
                    </span>
                  )}
                  <span className="exe-cc-date">
                    MàJ {formatDate(p.latest?.createdAt)}
                  </span>
                </div>
              </div>
              <HiChevronRight className="exe-cc-arrow" />
            </button>
          ))}
        </div>
      )}

      {showCreate && (
        <ExecutableCreateModal onClose={() => setShowCreate(false)} />
      )}
    </div>
  );
};

export default AdminExecutablesScreen;
