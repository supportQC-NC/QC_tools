// src/screens/admin/AdminZonesScreen.jsx
import React, { useState, useMemo, useEffect } from "react";
import {
  HiTemplate,
  HiUpload,
  HiSearch,
  HiRefresh,
  HiTrash,
  HiX,
  HiCheckCircle,
  HiExclamationCircle,
  HiDocumentText,
  HiBookOpen,
  HiQrcode,
  HiDownload,
} from "react-icons/hi";
import {
  useGetZonesQuery,
  useImportZonesMutation,
  useGenererZonesDepuisDictionnaireMutation,
  useDeleteAllZonesMutation,
} from "../../slices/zoneApiSlice";
import { useGetMyEntreprisesQuery } from "../../slices/entrepriseApiSlice";
import { useSelector } from "react-redux";
import { selectGlobalEntrepriseId } from "../../slices/entrepriseGlobalSlice";
import { BASE_URL } from "../../constants";
import "./AdminZonesScreen.css";

const AdminZonesScreen = () => {
  const selectedEntreprise = useSelector(selectGlobalEntrepriseId) || "";
  const [file, setFile] = useState(null);
  const [search, setSearch] = useState("");
  const [confirm, setConfirm] = useState(null); // "import" | "generateDico" | "deleteAll" | null
  const [importResult, setImportResult] = useState(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [downloadingPdf, setDownloadingPdf] = useState(false);

  const { data: entreprises } = useGetMyEntreprisesQuery();

  const {
    data: zonesData,
    isLoading: loadingZones,
    isFetching: fetchingZones,
    error: zonesError,
    refetch,
  } = useGetZonesQuery(
    { entrepriseId: selectedEntreprise },
    { skip: !selectedEntreprise },
  );

  const [importZones, { isLoading: importing }] = useImportZonesMutation();
  const [genererDepuisDico, { isLoading: generatingDico }] =
    useGenererZonesDepuisDictionnaireMutation();
  const [deleteAllZones, { isLoading: deleting }] = useDeleteAllZonesMutation();

  const zones = useMemo(() => zonesData?.zones || [], [zonesData]);

  const filteredZones = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return zones;
    return zones.filter((z) =>
      [
        z.code,
        z.libelle,
        z.type,
        z.eanPrincipal,
        z.eanPapillonnage,
        z.eanBipage,
        z.eanControle,
      ].some((v) => (v || "").toLowerCase().includes(q)),
    );
  }, [zones, search]);

  const entrepriseObj = entreprises?.find((e) => e._id === selectedEntreprise);

  // Réinitialise l'état de la carte d'import quand la société globale change.
  useEffect(() => {
    setImportResult(null);
    setErrorMsg("");
    setSearch("");
    setFile(null);
    const input = document.getElementById("zone-file-input");
    if (input) input.value = "";
  }, [selectedEntreprise]);

  const handleFileChange = (e) => {
    const f = e.target.files?.[0] || null;
    setFile(f);
    setImportResult(null);
    setErrorMsg("");
  };

  const handleConfirmImport = async () => {
    setConfirm(null);
    setErrorMsg("");
    try {
      const res = await importZones({
        entrepriseId: selectedEntreprise,
        fichier: file,
      }).unwrap();
      setImportResult(res);
      setFile(null);
      const input = document.getElementById("zone-file-input");
      if (input) input.value = "";
    } catch (err) {
      setErrorMsg(err?.data?.message || "Erreur lors de l'import");
    }
  };

  const handleConfirmGenerateDico = async () => {
    setConfirm(null);
    setErrorMsg("");
    try {
      const res = await genererDepuisDico({
        entrepriseId: selectedEntreprise,
      }).unwrap();
      setImportResult(res);
    } catch (err) {
      setErrorMsg(
        err?.data?.message ||
          "Erreur lors de la génération depuis le dictionnaire des rayons",
      );
    }
  };

  const handleDownloadFiches = async () => {
    if (!selectedEntreprise) return;
    setErrorMsg("");
    setDownloadingPdf(true);
    try {
      const res = await fetch(
        `${BASE_URL}/api/zones/${selectedEntreprise}/fiches-pdf`,
        { method: "POST", credentials: "include" },
      );
      if (!res.ok) {
        let msg = `Génération du PDF échouée (${res.status})`;
        try {
          const j = await res.json();
          if (j?.message) msg = j.message;
        } catch {
          /* non-JSON */
        }
        throw new Error(msg);
      }
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = `fiches_rayons_${entrepriseObj?.trigramme || selectedEntreprise}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(href), 60000);
    } catch (err) {
      setErrorMsg(err.message || "Impossible de générer le PDF des fiches.");
    } finally {
      setDownloadingPdf(false);
    }
  };

  const handleConfirmDeleteAll = async () => {
    setConfirm(null);
    setErrorMsg("");
    try {
      await deleteAllZones({ entrepriseId: selectedEntreprise }).unwrap();
      setImportResult(null);
    } catch (err) {
      setErrorMsg(err?.data?.message || "Erreur lors de la suppression");
    }
  };

  const canImport = !!selectedEntreprise && !!file && !importing;

  return (
    <div className="admin-zones">
      {/* En-tête */}
      <div className="admin-zones-header">
        <h1>
          <HiTemplate /> Fiches inventaires (Zones)
        </h1>
        <div className="admin-zones-actions">
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
        <div className="admin-zones-placeholder">
          <HiTemplate />
          <p>Sélectionnez une entreprise pour importer ou consulter ses zones.</p>
        </div>
      ) : (
        <>
          {/* Carte d'import */}
          <div className="import-card">
            <div className="import-card-head">
              <h2>
                <HiUpload /> Importer un fichier CSV
              </h2>
              <span className="import-target">
                {entrepriseObj?.trigramme} — {entrepriseObj?.nomComplet}
              </span>
            </div>

            <p className="import-warning">
              <HiExclamationCircle />
              L'import <strong>remplace la totalité</strong> des zones existantes
              de cette entreprise. Colonnes attendues :{" "}
              <code>
                code; libelle; type; metre_lineaire; ean_principal;
                ean_papillonnage; ean_bipage; ean_controle
              </code>{" "}
              (séparateur <code>;</code>).
            </p>

            <div className="import-row">
              <label className="file-label" htmlFor="zone-file-input">
                <HiDocumentText />
                <span>{file ? file.name : "Choisir un fichier .csv"}</span>
                <input
                  id="zone-file-input"
                  type="file"
                  accept=".csv,text/csv,text/plain"
                  onChange={handleFileChange}
                  hidden
                />
              </label>

              <button
                className="btn-primary"
                disabled={!canImport}
                onClick={() => setConfirm("import")}
              >
                <HiUpload /> {importing ? "Import en cours…" : "Importer"}
              </button>

              <button
                className="btn-danger"
                disabled={deleting || zones.length === 0}
                onClick={() => setConfirm("deleteAll")}
                title="Supprimer toutes les zones de cette entreprise"
              >
                <HiTrash /> Tout supprimer
              </button>
            </div>

            {errorMsg && (
              <div className="import-feedback error">
                <HiExclamationCircle /> {errorMsg}
              </div>
            )}

            {importResult && (
              <div className="import-feedback success">
                <HiCheckCircle />
                <div>
                  <strong>Import terminé.</strong>{" "}
                  {importResult.resume?.importees} zone(s) importée(s)
                  {importResult.resume?.doublonsFusionnes > 0 &&
                    `, ${importResult.resume.doublonsFusionnes} doublon(s) fusionné(s)`}
                  {importResult.resume?.lignesIgnorees > 0 &&
                    `, ${importResult.resume.lignesIgnorees} ligne(s) ignorée(s)`}
                  .{" "}
                  {importResult._queryTime && (
                    <span className="import-time">
                      ({importResult._queryTime})
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Carte : source dictionnaire + fiches PDF */}
          <div className="import-card">
            <div className="import-card-head">
              <h2>
                <HiBookOpen /> Générer depuis le dictionnaire des rayons
              </h2>
            </div>

            <p className="import-warning">
              <HiExclamationCircle />
              Alternative au CSV : crée une fiche par rayon du{" "}
              <strong>dictionnaire des rayons</strong> (jamais les sous-zones) et{" "}
              <strong>remplace la totalité</strong> des zones existantes. Les 3 EAN
              (papillonnage / bipage / contrôle) sont <strong>générés</strong> ; le
              code principal est un <strong>QR code</strong>.
            </p>

            <div className="import-row">
              <button
                className="btn-primary"
                disabled={!selectedEntreprise || generatingDico}
                onClick={() => setConfirm("generateDico")}
              >
                <HiBookOpen />{" "}
                {generatingDico
                  ? "Génération en cours…"
                  : "Générer depuis le dictionnaire"}
              </button>

              <button
                className="btn-secondary"
                disabled={downloadingPdf || zones.length === 0}
                onClick={handleDownloadFiches}
                title="Télécharger le PDF imprimable des fiches (QR principal + 3 codes-barres)"
              >
                <HiDownload />{" "}
                {downloadingPdf
                  ? "Préparation…"
                  : "Télécharger les fiches (PDF)"}
              </button>
              <span className="import-target">
                <HiQrcode /> QR principal + EAN-13 papillonnage/bipage/contrôle
              </span>
            </div>
          </div>

          {/* Stats + recherche */}
          <div className="admin-zones-toolbar">
            <div className="zones-stats">
              <div className="stat-card">
                <span className="stat-value">{zonesData?.total ?? 0}</span>
                <span className="stat-label">Zones</span>
              </div>
              <div className="stat-card">
                <span className="stat-value">{filteredZones.length}</span>
                <span className="stat-label">Affichées</span>
              </div>
            </div>
            <div className="search-box">
              <HiSearch />
              <input
                type="text"
                placeholder="Rechercher (code, libellé, EAN)…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>

          {/* Tableau des zones */}
          <div className="admin-zones-table-container">
            {loadingZones ? (
              <div className="admin-loading">Chargement…</div>
            ) : zonesError ? (
              <div className="admin-error">
                Erreur : {zonesError?.data?.message || "chargement impossible"}
              </div>
            ) : (
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Libellé</th>
                    <th>Type</th>
                    <th>Mètre lin.</th>
                    <th>EAN principal</th>
                    <th>EAN papillonnage</th>
                    <th>EAN bipage</th>
                    <th>EAN contrôle</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredZones.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="no-data">
                        {fetchingZones
                          ? "Chargement…"
                          : zones.length === 0
                            ? "Aucune zone. Importez un CSV ou générez depuis le dictionnaire des rayons."
                            : "Aucune zone ne correspond à la recherche."}
                      </td>
                    </tr>
                  ) : (
                    filteredZones.map((z) => (
                      <tr key={z._id}>
                        <td className="code-cell">{z.code}</td>
                        <td>{z.libelle}</td>
                        <td>{z.type}</td>
                        <td className="num-cell">
                          {Number(z.metreLineaire || 0).toFixed(2)}
                        </td>
                        <td className="ean-cell">{z.eanPrincipal}</td>
                        <td className="ean-cell">{z.eanPapillonnage}</td>
                        <td className="ean-cell">{z.eanBipage}</td>
                        <td className="ean-cell">{z.eanControle}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {/* Modal de confirmation */}
      {confirm && (
        <div className="modal-backdrop" onClick={() => setConfirm(null)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>
                {confirm === "import" ? (
                  <>
                    <HiUpload /> Confirmer l'import
                  </>
                ) : confirm === "generateDico" ? (
                  <>
                    <HiBookOpen /> Générer depuis le dictionnaire
                  </>
                ) : (
                  <>
                    <HiTrash /> Tout supprimer
                  </>
                )}
              </h2>
              <button
                className="btn-close-modal"
                onClick={() => setConfirm(null)}
              >
                <HiX />
              </button>
            </div>
            <div className="modal-content">
              {confirm === "import" ? (
                <p>
                  L'import va <strong>supprimer toutes les zones existantes</strong>{" "}
                  de <strong>{entrepriseObj?.trigramme}</strong> puis insérer
                  celles du fichier <strong>{file?.name}</strong>. Continuer ?
                </p>
              ) : confirm === "generateDico" ? (
                <p>
                  La génération va{" "}
                  <strong>supprimer toutes les zones existantes</strong> de{" "}
                  <strong>{entrepriseObj?.trigramme}</strong> puis créer une fiche
                  par rayon du <strong>dictionnaire des rayons</strong> (EAN générés,
                  principal en QR). Continuer ?
                </p>
              ) : (
                <p>
                  Supprimer <strong>toutes les zones</strong> de{" "}
                  <strong>{entrepriseObj?.trigramme}</strong> ? Cette action est
                  irréversible.
                </p>
              )}
            </div>
            <div className="modal-footer">
              <button
                className={confirm === "deleteAll" ? "btn-danger" : "btn-primary"}
                onClick={
                  confirm === "import"
                    ? handleConfirmImport
                    : confirm === "generateDico"
                      ? handleConfirmGenerateDico
                      : handleConfirmDeleteAll
                }
                disabled={importing || deleting || generatingDico}
              >
                {confirm === "import"
                  ? "Importer"
                  : confirm === "generateDico"
                    ? "Générer"
                    : "Supprimer"}
              </button>
              <button className="btn-secondary" onClick={() => setConfirm(null)}>
                Annuler
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminZonesScreen;