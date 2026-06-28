// src/screens/admin/AdminBipagesScreen.jsx
import React, { useState, useEffect, useRef } from "react";
import {
  HiClipboardList,
  HiDownload,
  HiRefresh,
  HiSearch,
  HiTrash,
} from "react-icons/hi";
import {
  useGetBipagesQuery,
  useUpdateBipageMutation,
  useRecommencerZoneMutation,
  getBipagesCsvUrl,
} from "../../slices/bipageApiSlice";
import { useGetMyEntreprisesQuery } from "../../slices/entrepriseApiSlice";
import { BASE_URL } from "../../constants";
import "./AdminBipagesScreen.css";

const AdminBipagesScreen = () => {
  const [selectedEntreprise, setSelectedEntreprise] = useState("");
  const [type, setType] = useState("");
  const [zone, setZone] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [msg, setMsg] = useState("");
  const [exporting, setExporting] = useState(false);

  const dirty = useRef(new Set());

  const { data: entreprises } = useGetMyEntreprisesQuery();

  // debounce de la recherche
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  // efface le message d'info après quelques secondes
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(""), 5000);
    return () => clearTimeout(t);
  }, [msg]);

  const { data, isLoading, isFetching, refetch } = useGetBipagesQuery(
    { entrepriseId: selectedEntreprise, zone, type, search },
    { skip: !selectedEntreprise },
  );

  const [updateBipage] = useUpdateBipageMutation();
  const [recommencerZone, { isLoading: recommencing }] =
    useRecommencerZoneMutation();

  const [lignes, setLignes] = useState([]);
  useEffect(() => {
    setLignes(data?.lignes || []);
    dirty.current = new Set();
  }, [data]);

  const active = data?.active;
  const types = data?.types || [];
  const zonesMeta = data?.zonesMeta || [];

  // Options de zones filtrées par le type sélectionné
  const zoneOptions = (
    type ? zonesMeta.filter((z) => z.type === type) : zonesMeta
  ).map((z) => z.code);

  const onTypeChange = (e) => {
    setType(e.target.value);
    setZone(""); // une zone choisie peut ne plus appartenir au nouveau type
  };

  const updateLocal = (id, field, value) => {
    dirty.current.add(id);
    setLignes((prev) =>
      prev.map((l) => (l._id === id ? { ...l, [field]: value } : l)),
    );
  };

  const saveLine = async (id) => {
    if (!dirty.current.has(id)) return;
    dirty.current.delete(id);
    const ligne = lignes.find((l) => l._id === id);
    if (!ligne) return;
    try {
      const res = await updateBipage({
        entrepriseId: selectedEntreprise,
        id,
        body: {
          qteScan: ligne.qteScan,
          nart: ligne.nart,
          observation: ligne.observation,
        },
      }).unwrap();
      setLignes((prev) => prev.map((l) => (l._id === id ? res : l)));
    } catch {
      /* on garde la saisie locale ; l'admin peut réessayer */
    }
  };

  const onCellKeyDown = (e) => {
    if (e.key === "Enter") e.target.blur();
  };

  // Export CSV authentifié : fetch avec cookie (credentials) → blob → download.
  // (window.open ne transmet pas correctement la requête API et casse en dev.)
  const exportCsv = async () => {
    if (!selectedEntreprise) return;
    setExporting(true);
    try {
      const url = `${BASE_URL}${getBipagesCsvUrl(selectedEntreprise, {
        zone,
        type,
        search,
      })}`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error(`Export échoué (${res.status})`);

      const blob = await res.blob();

      // Nom de fichier depuis l'en-tête, sinon défaut.
      let filename = "bipages.csv";
      const cd = res.headers.get("Content-Disposition");
      if (cd) {
        const m = cd.match(/filename\*?=(?:UTF-8'')?"?([^"\n;]+)"?/i);
        if (m && m[1]) filename = decodeURIComponent(m[1]);
      }

      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(href);
    } catch (e) {
      alert(e.message || "Export impossible");
    } finally {
      setExporting(false);
    }
  };

  const handleRecommencer = async () => {
    if (!zone) return;
    const ok = window.confirm(
      `Recommencer la zone « ${zone} » ?\n\n` +
        `Tous les bipages de cette zone seront supprimés (lignes, statut ` +
        `imprimé, et fichiers .DAT/PDF archivés sur le partage réseau). ` +
        `La zone pourra ensuite être re-bipée.\n\nAction irréversible.`,
    );
    if (!ok) return;
    try {
      const r = await recommencerZone({
        entrepriseId: selectedEntreprise,
        zoneCode: zone,
      }).unwrap();
      setMsg(r?.message || "Zone réinitialisée.");
      if (r?.avertissements?.length) {
        setMsg(
          `${r.message} (⚠ ${r.avertissements.length} fichier(s) non supprimé(s))`,
        );
      }
      setZone("");
      refetch();
    } catch (e) {
      alert(e?.data?.message || "Échec du recommencement de la zone");
    }
  };

  return (
    <div className="admin-bipages">
      <div className="admin-bipages-header">
        <h1>
          <HiClipboardList /> Détail des bipages
        </h1>
        <div className="admin-bipages-actions">
          <select
            className="filter-select"
            value={selectedEntreprise}
            onChange={(e) => setSelectedEntreprise(e.target.value)}
          >
            <option value="">Sélectionner une entreprise…</option>
            {entreprises?.map((e) => (
              <option key={e._id} value={e._id}>
                {e.trigramme} - {e.nomComplet}
              </option>
            ))}
          </select>
          <button
            className="btn-icon"
            onClick={refetch}
            disabled={!selectedEntreprise}
            title="Rafraîchir"
          >
            <HiRefresh />
          </button>
        </div>
      </div>

      {!selectedEntreprise ? (
        <div className="admin-bipages-placeholder">
          <HiClipboardList />
          <p>Sélectionnez une entreprise pour voir le détail des bipages.</p>
        </div>
      ) : isLoading ? (
        <div className="admin-loading">Chargement…</div>
      ) : !active ? (
        <div className="admin-bipages-placeholder">
          <HiClipboardList />
          <p>
            Aucun inventaire actif. Initialisez-en un depuis l'écran
            « Progression d'inventaire ».
          </p>
        </div>
      ) : (
        <>
          <div className="bipages-toolbar">
            <select
              className="filter-select"
              value={type}
              onChange={onTypeChange}
            >
              <option value="">Tous les types</option>
              {types.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>

            <select
              className="filter-select"
              value={zone}
              onChange={(e) => setZone(e.target.value)}
            >
              <option value="">Toutes les zones</option>
              {zoneOptions.map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </select>

            <div className="search-box">
              <HiSearch />
              <input
                type="text"
                placeholder="Rechercher NART ou GENCODE…"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
              />
            </div>

            <span className="bipages-count">
              {lignes.length} ligne{lignes.length > 1 ? "s" : ""}
              {isFetching ? " …" : ""}
            </span>

            <button
              className="btn-danger"
              onClick={handleRecommencer}
              disabled={!zone || recommencing}
              title={
                zone
                  ? `Recommencer la zone ${zone}`
                  : "Sélectionnez une zone pour la recommencer"
              }
            >
              <HiTrash /> {recommencing ? "…" : "Recommencer la zone"}
            </button>

            <button
              className="btn-primary"
              onClick={exportCsv}
              disabled={lignes.length === 0 || exporting}
            >
              <HiDownload /> {exporting ? "Export…" : "Export CSV"}
            </button>
          </div>

          {msg ? <div className="bipages-msg">{msg}</div> : null}

          <div className="admin-bipages-table-container">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Zone</th>
                  <th>EAN article</th>
                  <th>Qté scan</th>
                  <th>NART</th>
                  <th>Désignation</th>
                  <th>Observation</th>
                  <th>Stock</th>
                </tr>
              </thead>
              <tbody>
                {lignes.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="no-data">
                      Aucune ligne. Les bipages apparaissent ici dès qu'un .DAT
                      est traité.
                    </td>
                  </tr>
                ) : (
                  lignes.map((l) => (
                    <tr key={l._id} className={l.found ? "" : "row-unknown"}>
                      <td className="zone-cell">{l.zoneCode}</td>
                      <td className="mono">{l.eanArticle}</td>
                      <td>
                        <input
                          className="cell-input num"
                          type="number"
                          value={l.qteScan ?? ""}
                          onChange={(e) =>
                            updateLocal(l._id, "qteScan", e.target.value)
                          }
                          onBlur={() => saveLine(l._id)}
                          onKeyDown={onCellKeyDown}
                        />
                      </td>
                      <td>
                        <input
                          className="cell-input"
                          type="text"
                          value={l.nart ?? ""}
                          onChange={(e) =>
                            updateLocal(l._id, "nart", e.target.value)
                          }
                          onBlur={() => saveLine(l._id)}
                          onKeyDown={onCellKeyDown}
                        />
                      </td>
                      <td className="desig-cell">{l.designation}</td>
                      <td>
                        <input
                          className="cell-input"
                          type="text"
                          value={l.observation ?? ""}
                          onChange={(e) =>
                            updateLocal(l._id, "observation", e.target.value)
                          }
                          onBlur={() => saveLine(l._id)}
                          onKeyDown={onCellKeyDown}
                        />
                      </td>
                      <td className="num-cell">
                        {l.stock === null || l.stock === undefined
                          ? "—"
                          : l.stock}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
};

export default AdminBipagesScreen;