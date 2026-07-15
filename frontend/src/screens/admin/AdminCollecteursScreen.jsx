// src/screens/admin/AdminCollecteursScreen.jsx
import React, { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import {
  HiPlus,
  HiRefresh,
  HiDownload,
  HiSearch,
  HiPencil,
  HiTrash,
  HiDeviceMobile,
} from "react-icons/hi";
import {
  useGetCollecteursQuery,
  useDeleteCollecteurMutation,
} from "../../slices/collecteurApiSlice";
import CollecteurModal, { STATUTS } from "../../components/Admin/CollecteurModal";
import { useGetCurrentAppReleaseQuery } from "../../slices/appReleaseApiSlice";
import "./AdminCollecteursScreen.css";

const statutLabel = (v) => STATUTS.find((s) => s.value === v)?.label || v || "—";

const fmtDate = (d) => {
  if (!d) return "";
  const dd = new Date(d);
  if (isNaN(dd.getTime())) return "";
  const p = (n) => String(n).padStart(2, "0");
  return `${p(dd.getDate())}/${p(dd.getMonth() + 1)}/${dd.getFullYear()}`;
};

const AdminCollecteursScreen = () => {
  const { data: collecteurs, isLoading, error, refetch } =
    useGetCollecteursQuery();
  const [deleteCollecteur] = useDeleteCollecteurMutation();
  const { data: currentRelease } = useGetCurrentAppReleaseQuery();
  const latestVersion =
    currentRelease && !currentRelease.empty ? currentRelease.version : null;
  const isOutdated = (c) =>
    !!latestVersion && (c.versionApp || "") !== latestVersion;

  const [search, setSearch] = useState("");
  const [fStatut, setFStatut] = useState("");
  const [fEntreprise, setFEntreprise] = useState("");
  const [fGachette, setFGachette] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  const list = useMemo(() => collecteurs || [], [collecteurs]);

  // Options entreprises (à partir des collecteurs présents)
  const entreprisesOptions = useMemo(() => {
    const map = new Map();
    list.forEach((c) => {
      if (c.entreprise?._id) {
        map.set(c.entreprise._id, c.entreprise.trigramme || c.entreprise.nomComplet);
      }
    });
    return [...map.entries()];
  }, [list]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return list.filter((c) => {
      if (fStatut && c.statut !== fStatut) return false;
      if (fEntreprise && (c.entreprise?._id || "") !== fEntreprise) return false;
      if (fGachette === "oui" && !c.gachette) return false;
      if (fGachette === "non" && c.gachette) return false;
      if (s) {
        const hay = [
          c.identifiant,
          c.emplacement,
          c.entreprise?.trigramme,
          c.entreprise?.nomComplet,
          c.agent ? `${c.agent.prenom} ${c.agent.nom}` : "",
        ]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(s)) return false;
      }
      return true;
    });
  }, [list, search, fStatut, fEntreprise, fGachette]);

  const compteurs = useMemo(() => {
    const c = { total: list.length };
    STATUTS.forEach((s) => (c[s.value] = 0));
    list.forEach((it) => {
      if (c[it.statut] !== undefined) c[it.statut] += 1;
    });
    return c;
  }, [list]);

  const handleNew = () => {
    setEditing(null);
    setModalOpen(true);
  };
  const handleEdit = (c) => {
    setEditing(c);
    setModalOpen(true);
  };
  const handleDelete = async (c) => {
    if (!window.confirm(`Supprimer le collecteur "${c.identifiant}" ?`)) return;
    try {
      await deleteCollecteur(c._id).unwrap();
    } catch (e) {
      /* ignore */
    }
  };

  const handleExport = () => {
    const aoa = [
      [
        "IDENTIFIANT",
        "NOM",
        "RECU",
        "GACHETTE",
        "MISE EN SERVICE",
        "STATUT",
        "VERSION APP",
        "ENTREPRISE",
        "AGENT",
        "EMPLACEMENT",
        "ACCESSOIRES",
        "OBSERVATIONS",
        "ACTIF",
      ],
    ];
    filtered.forEach((c) =>
      aoa.push([
        c.identifiant,
        c.nom || "",
        fmtDate(c.recu),
        c.gachette ? "OUI" : "NON",
        fmtDate(c.miseEnService),
        statutLabel(c.statut),
        c.versionApp || "",
        c.entreprise?.trigramme || c.entreprise?.nomComplet || "",
        c.agent ? `${c.agent.prenom} ${c.agent.nom}` : "",
        c.emplacement || "",
        (c.accessoires || []).join(", "),
        c.observations || "",
        c.isActive ? "OUI" : "NON",
      ]),
    );
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Collecteurs");
    const today = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `collecteurs_${today}.xlsx`);
  };

  return (
    <div className="admin-collecteurs">
      <div className="col-header">
        <h1>
          <HiDeviceMobile /> Flotte de collecteurs
        </h1>
        <div className="col-actions">
          <button className="btn-icon" onClick={refetch} title="Rafraîchir">
            <HiRefresh />
          </button>
          <button
            className="btn-secondary"
            onClick={handleExport}
            disabled={!filtered.length}
          >
            <HiDownload /> Excel
          </button>
          <button className="btn-primary" onClick={handleNew}>
            <HiPlus /> Nouveau
          </button>
        </div>
      </div>

      {/* Compteurs par statut */}
      <div className="col-stats">
        <div className="col-stat total">
          <span className="v">{compteurs.total}</span>
          <span className="l">Total</span>
        </div>
        {STATUTS.map((s) => (
          <div className={`col-stat st-${s.value}`} key={s.value}>
            <span className="v">{compteurs[s.value]}</span>
            <span className="l">{s.label}</span>
          </div>
        ))}
      </div>

      {/* Filtres */}
      <div className="col-filters">
        <div className="search-box">
          <HiSearch />
          <input
            type="text"
            placeholder="Rechercher (identifiant, agent, emplacement…)"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select value={fStatut} onChange={(e) => setFStatut(e.target.value)}>
          <option value="">Tous statuts</option>
          {STATUTS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <select
          value={fEntreprise}
          onChange={(e) => setFEntreprise(e.target.value)}
        >
          <option value="">Toutes entreprises</option>
          {entreprisesOptions.map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
        <select value={fGachette} onChange={(e) => setFGachette(e.target.value)}>
          <option value="">Gâchette : toutes</option>
          <option value="oui">Gâchette : Oui</option>
          <option value="non">Gâchette : Non</option>
        </select>
      </div>

      {latestVersion && (
        <div className="col-legend">
          Dernière version&nbsp;: <strong>{latestVersion}</strong> — les
          collecteurs en{" "}
          <span className="ver-badge outdated">rouge</span> ne l'ont pas.
        </div>
      )}

      {isLoading ? (
        <div className="col-empty">Chargement…</div>
      ) : error ? (
        <div className="col-error">
          {error?.data?.message || "Erreur de chargement."}
        </div>
      ) : filtered.length === 0 ? (
        <div className="col-empty">Aucun collecteur.</div>
      ) : (
        <div className="col-table-wrap">
          <table className="col-table">
            <thead>
              <tr>
                <th>Identifiant</th>
                <th>Nom</th>
                <th>Reçu</th>
                <th>Gâchette</th>
                <th>Mise en service</th>
                <th>Statut</th>
                <th>Version</th>
                <th>Entreprise</th>
                <th>Agent</th>
                <th>Emplacement</th>
                <th>Accessoires</th>
                <th>Actif</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr
                  key={c._id}
                  className={`${!c.isActive ? "row-inactive" : ""} ${
                    isOutdated(c) ? "row-outdated" : ""
                  }`.trim()}
                >
                  <td className="mono">{c.identifiant}</td>
                  <td>{c.nom || "—"}</td>
                  <td>{fmtDate(c.recu)}</td>
                  <td>
                    <span className={`ga ${c.gachette ? "oui" : "non"}`}>
                      {c.gachette ? "OUI" : "NON"}
                    </span>
                  </td>
                  <td>{fmtDate(c.miseEnService)}</td>
                  <td>
                    <span className={`statut-badge st-${c.statut}`}>
                      {statutLabel(c.statut)}
                    </span>
                  </td>
                  <td>
                    {c.versionApp ? (
                      <span
                        className={`ver-badge ${
                          isOutdated(c) ? "outdated" : "uptodate"
                        }`}
                      >
                        {c.versionApp}
                      </span>
                    ) : (
                      <span className="ver-badge unknown">—</span>
                    )}
                  </td>
                  <td>{c.entreprise?.trigramme || c.entreprise?.nomComplet || "—"}</td>
                  <td>{c.agent ? `${c.agent.prenom} ${c.agent.nom}` : "—"}</td>
                  <td>{c.emplacement || "—"}</td>
                  <td className="acc-cell" title={(c.accessoires || []).join(", ")}>
                    {(c.accessoires || []).join(", ") || "—"}
                  </td>
                  <td>{c.isActive ? "Oui" : "Non"}</td>
                  <td className="col-row-actions">
                    <button
                      className="btn-row"
                      onClick={() => handleEdit(c)}
                      title="Modifier"
                    >
                      <HiPencil />
                    </button>
                    <button
                      className="btn-row danger"
                      onClick={() => handleDelete(c)}
                      title="Supprimer"
                    >
                      <HiTrash />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modalOpen && (
        <CollecteurModal
          collecteur={editing}
          onClose={() => setModalOpen(false)}
        />
      )}
    </div>
  );
};

export default AdminCollecteursScreen;