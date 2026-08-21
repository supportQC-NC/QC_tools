// src/screens/admin/AdminBipagesScreen.jsx
import React, { useState, useEffect, useRef } from "react";
import {
  HiClipboardList,
  HiDownload,
  HiRefresh,
  HiSearch,
  HiTrash,
  HiDocumentText,
  HiUpload,
  HiX,
} from "react-icons/hi";
import {
  useGetBipagesQuery,
  useUpdateBipageMutation,
  useRecommencerZoneMutation,
  useLazyGetProformasBipageQuery,
  useImportProformasBipageMutation,
  useImportExcelBipageMutation,
  getBipagesCsvUrl,
  getModeleExcelBipageUrl,
} from "../../slices/bipageApiSlice";
import { useSelector } from "react-redux";
import { selectGlobalEntrepriseId } from "../../slices/entrepriseGlobalSlice";
import { BASE_URL } from "../../constants";
import "./AdminBipagesScreen.css";

const AdminBipagesScreen = () => {
  // Société active : lue depuis la sélection GLOBALE (Header).
  const selectedEntreprise = useSelector(selectGlobalEntrepriseId) || "";
  const [type, setType] = useState("");
  const [zone, setZone] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [msg, setMsg] = useState("");
  const [exporting, setExporting] = useState(false);

  const dirty = useRef(new Set());

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
  const [importExcel, { isLoading: importingExcel }] =
    useImportExcelBipageMutation();
  const [showProformas, setShowProformas] = useState(false);
  // Mode d'import Excel : comptage normal, ou déduction (quantités retranchées
  // pour une partie du magasin restée ouverte pendant l'inventaire).
  const [modeExcel, setModeExcel] = useState("inventaire");
  const fileRef = useRef(null);

  const [lignes, setLignes] = useState([]);
  useEffect(() => {
    setLignes(data?.lignes || []);
    dirty.current = new Set();
  }, [data]);

  const active = data?.active;
  const types = data?.types || [];
  const zonesMeta = data?.zonesMeta || [];

  // Options de zones filtrées par le type sélectionné (codes distincts).
  const zoneOptions = [
    ...new Set(
      (type ? zonesMeta.filter((z) => z.type === type) : zonesMeta).map(
        (z) => z.code,
      ),
    ),
  ];

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

          {/* ─── Intégration de bipages faits hors collecteur ─────────────── */}
          <div className="bipages-toolbar bipages-imports">
            <span className="bipages-imports-label">
              <HiUpload /> Intégrer des bipages :
            </span>

            <button className="btn-primary" onClick={() => setShowProformas(true)}>
              <HiDocumentText /> Depuis des proformas
            </button>

            <span className="bipages-sep" />

            <select
              className="filter-select mode-select"
              value={modeExcel}
              onChange={(e) => setModeExcel(e.target.value)}
              title="Comptage : les quantités s'ajoutent. Déduction : elles sont retranchées (ventes d'une partie du magasin restée ouverte)."
            >
              <option value="inventaire">Mode : comptage</option>
              <option value="deduction">Mode : déduction (−)</option>
            </select>

            <button
              className={`btn-primary ${modeExcel === "deduction" ? "btn-deduction" : ""}`}
              onClick={() => fileRef.current?.click()}
              disabled={importingExcel}
            >
              <HiUpload /> {importingExcel ? "Import…" : "Importer un Excel"}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xlsm,.xls"
              style={{ display: "none" }}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = ""; // permet de réimporter le même fichier
                if (!file) return;
                try {
                  const r = await importExcel({
                    entrepriseId: selectedEntreprise,
                    file,
                    mode: modeExcel,
                  }).unwrap();
                  setMsg(r?.message || "Fichier importé.");
                } catch (err) {
                  setMsg(err?.data?.message || "Import Excel impossible.");
                }
              }}
            />
            <a
              className="bipages-modele"
              href={`${BASE_URL}${getModeleExcelBipageUrl(selectedEntreprise)}`}
              title="Télécharger le modèle Excel (le mode d'emploi est dans l'onglet Aide)"
            >
              <HiDownload /> Modèle Excel
            </a>

            <span className="bipages-hint">
              Nom du fichier : <code>bipage_&lt;agent&gt;_&lt;zone&gt;_&lt;EMPLACEMENT&gt;.xlsx</code>
            </span>
          </div>

          {msg ? <div className="bipages-msg">{msg}</div> : null}

          <div className="admin-bipages-table-container">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Zone</th>
                  <th>Emplacement</th>
                  <th>EAN article</th>
                  <th>Qté scan</th>
                  <th>NART</th>
                  <th>Désignation</th>
                  <th>Agent</th>
                  <th>Observation</th>
                  <th>Stock</th>
                </tr>
              </thead>
              <tbody>
                {lignes.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="no-data">
                      Aucune ligne. Les bipages apparaissent ici dès qu'un .DAT
                      est traité.
                    </td>
                  </tr>
                ) : (
                  lignes.map((l) => (
                    <tr
                      key={l._id}
                      className={`${l.found ? "" : "row-unknown"} ${
                        l.modeImport === "deduction" ? "row-deduction" : ""
                      }`.trim()}
                    >
                      <td className="zone-cell">{l.zoneCode}</td>
                      <td className="zone-cell">{l.zoneType || "—"}</td>
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
                      <td className="agent-cell">
                        {l.agentNom || l.agentCode ? (
                          <>
                            {l.agentNom || `Code ${l.agentCode}`}
                            {l.source && l.source !== "dat" && (
                              <span className="src-badge">
                                {l.source === "proforma" ? "proforma" : "excel"}
                              </span>
                            )}
                            {l.modeImport === "deduction" && (
                              <span className="src-badge deduction">déduction</span>
                            )}
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
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

      {showProformas && (
        <ProformasModal
          entrepriseId={selectedEntreprise}
          onClose={() => setShowProformas(false)}
          onDone={(message) => {
            setMsg(message);
            setShowProformas(false);
          }}
        />
      )}
    </div>
  );
};

// ════════════════════════════════════════════════════════════════════════════
//  MODALE « Intégrer des proformas »
//
//  On choisit une plage de dates et un ou plusieurs numéros de client ; toute
//  proforma de cette sélection dont l'OBSERVATION respecte la convention
//  « <zone>_<EMPLACEMENT> » peut être intégrée. L'agent vient du code vendeur
//  (REPRES) de la proforma.
// ════════════════════════════════════════════════════════════════════════════
const ProformasModal = ({ entrepriseId, onClose, onDone }) => {
  const [dateDebut, setDateDebut] = useState("");
  const [dateFin, setDateFin] = useState("");
  const [clients, setClients] = useState("");
  const [selected, setSelected] = useState([]);
  const [erreur, setErreur] = useState("");
  const [voirToutes, setVoirToutes] = useState(false);

  const [chercher, { data, isFetching }] = useLazyGetProformasBipageQuery();
  const [importer, { isLoading: importing }] = useImportProformasBipageMutation();

  const proformas = data?.proformas || [];
  const affichees = voirToutes ? proformas : proformas.filter((p) => p.eligible);

  const lancerRecherche = async () => {
    setErreur("");
    setSelected([]);
    if (!dateDebut && !dateFin && !clients.trim()) {
      setErreur(
        "Renseignez au moins une plage de dates ou un numéro de client : sans filtre, toute la table des proformas serait balayée.",
      );
      return;
    }
    try {
      await chercher({ entrepriseId, dateDebut, dateFin, clients }).unwrap();
    } catch (e) {
      setErreur(e?.data?.message || "Recherche impossible.");
    }
  };

  const toggle = (numfact) =>
    setSelected((s) =>
      s.includes(numfact) ? s.filter((n) => n !== numfact) : [...s, numfact],
    );

  const eligibles = proformas.filter((p) => p.eligible);
  const toutCoche =
    eligibles.length > 0 && eligibles.every((p) => selected.includes(p.numfact));

  const valider = async () => {
    try {
      const r = await importer({ entrepriseId, numfacts: selected }).unwrap();
      onDone(r?.message || "Proformas intégrées.");
    } catch (e) {
      setErreur(e?.data?.message || "Import impossible.");
    }
  };

  return (
    <div className="bipages-overlay" onClick={onClose}>
      <div className="bipages-modal" onClick={(e) => e.stopPropagation()}>
        <div className="bipages-modal-head">
          <h2>
            <HiDocumentText /> Intégrer des bipages depuis des proformas
          </h2>
          <button className="btn-icon" onClick={onClose} title="Fermer">
            <HiX />
          </button>
        </div>

        <p className="bipages-convention">
          L'observation de la proforma doit être <code>&lt;zone&gt;_&lt;EMPLACEMENT&gt;</code>{" "}
          — par exemple <code>A_1_MAGASIN</code> ou <code>B_5d_DOCK</code>. Le code
          de zone est tout ce qui précède le dernier « _ ». L'agent est le vendeur
          de la proforma.
          {data?.emplacements?.length ? (
            <> Emplacements reconnus : <b>{data.emplacements.join(", ")}</b>.</>
          ) : null}
        </p>

        <div className="bipages-filtres">
          <label>
            Du
            <input
              type="date"
              value={dateDebut}
              onChange={(e) => setDateDebut(e.target.value)}
            />
          </label>
          <label>
            au
            <input
              type="date"
              value={dateFin}
              onChange={(e) => setDateFin(e.target.value)}
            />
          </label>
          <label className="grow">
            Client(s)
            <input
              type="text"
              placeholder="9900 ou 9900, 9901…"
              value={clients}
              onChange={(e) => setClients(e.target.value)}
            />
          </label>
          <button className="btn-primary" onClick={lancerRecherche} disabled={isFetching}>
            <HiSearch /> {isFetching ? "Recherche…" : "Rechercher"}
          </button>
        </div>

        {erreur && <div className="bipages-msg err">{erreur}</div>}

        {data && (
          <div className="bipages-resultats">
            <span>
              {data.total} proforma(s) trouvée(s), <b>{data.nbEligibles}</b>{" "}
              intégrable(s).
            </span>
            <label className="bipages-check">
              <input
                type="checkbox"
                checked={voirToutes}
                onChange={(e) => setVoirToutes(e.target.checked)}
              />
              Afficher aussi les non intégrables
            </label>
          </div>
        )}

        <div className="bipages-modal-table">
          <table className="admin-table">
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    checked={toutCoche}
                    onChange={() =>
                      setSelected(toutCoche ? [] : eligibles.map((p) => p.numfact))
                    }
                  />
                </th>
                <th>N° proforma</th>
                <th>Date</th>
                <th>Client</th>
                <th>Observation</th>
                <th>Zone</th>
                <th>Emplacement</th>
                <th>Agent</th>
                <th>Lignes</th>
              </tr>
            </thead>
            <tbody>
              {!data ? (
                <tr>
                  <td colSpan={9} className="no-data">
                    Choisissez une plage de dates et/ou des clients, puis lancez la
                    recherche.
                  </td>
                </tr>
              ) : affichees.length === 0 ? (
                <tr>
                  <td colSpan={9} className="no-data">
                    Aucune proforma intégrable sur cette sélection.
                  </td>
                </tr>
              ) : (
                affichees.map((p) => (
                  <tr key={p.numfact} className={p.eligible ? "" : "row-unknown"}>
                    <td>
                      {p.eligible && (
                        <input
                          type="checkbox"
                          checked={selected.includes(p.numfact)}
                          onChange={() => toggle(p.numfact)}
                        />
                      )}
                    </td>
                    <td className="mono">{p.numfact}</td>
                    <td>
                      {p.datfact
                        ? new Date(p.datfact).toLocaleDateString("fr-FR")
                        : "—"}
                    </td>
                    <td className="desig-cell">
                      {p.tiers} {p.nomClient}
                    </td>
                    <td className="desig-cell">
                      {p.observation || "—"}
                      {!p.eligible && p.raison && (
                        <div className="bipages-raison">{p.raison}</div>
                      )}
                    </td>
                    <td className="zone-cell">{p.zoneCode || "—"}</td>
                    <td className="zone-cell">{p.emplacement || "—"}</td>
                    <td>{p.agentNom || (p.agentCode ? `Code ${p.agentCode}` : "—")}</td>
                    <td className="num-cell">{p.nbLignes}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="bipages-modal-actions">
          <button className="btn-icon" onClick={onClose}>
            Annuler
          </button>
          <button
            className="btn-primary"
            onClick={valider}
            disabled={selected.length === 0 || importing}
          >
            <HiUpload />{" "}
            {importing
              ? "Intégration…"
              : `Intégrer ${selected.length} proforma(s)`}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AdminBipagesScreen;