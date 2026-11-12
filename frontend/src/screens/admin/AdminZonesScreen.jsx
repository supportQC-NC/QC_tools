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
  HiPlus,
  HiPencilAlt,
} from "react-icons/hi";
import {
  useGetZonesQuery,
  useImportZonesMutation,
  useGenererZonesDepuisDictionnaireMutation,
  useGetZonesDictionnaireQuery,
  useDeleteAllZonesMutation,
  useCreateZoneMutation,
  useDeleteZoneMutation,
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

  // Sélection du tableau : on retient des _id, pas des index de ligne — la
  // recherche filtre l'affichage et un index ne désignerait plus la même fiche.
  const [selection, setSelection] = useState(() => new Set());
  // Fiche manuelle en cours de saisie (null = formulaire fermé)
  const [formZone, setFormZone] = useState(null);
  const [formError, setFormError] = useState("");
  // Fiche manuelle dont on demande la suppression
  const [zoneASupprimer, setZoneASupprimer] = useState(null);

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

  // État du dictionnaire de la société : le dossier « collecteur » est commun à
  // toutes les sociétés, seul le préfixe trigramme distingue leurs fichiers
  // (QC_dictionnaire_rayons.xlsx, DQ_...). Sans fichier au trigramme, on l'annonce
  // ici plutôt que de laisser l'utilisateur buter sur un 404 à la génération.
  const { data: dico, isFetching: fetchingDico } = useGetZonesDictionnaireQuery(
    { entrepriseId: selectedEntreprise },
    { skip: !selectedEntreprise },
  );
  const dicoDisponible = !!dico?.disponible;

  const [importZones, { isLoading: importing }] = useImportZonesMutation();
  const [genererDepuisDico, { isLoading: generatingDico }] =
    useGenererZonesDepuisDictionnaireMutation();
  const [deleteAllZones, { isLoading: deleting }] = useDeleteAllZonesMutation();
  const [createZone, { isLoading: creating }] = useCreateZoneMutation();
  const [deleteZone, { isLoading: deletingOne }] = useDeleteZoneMutation();

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

  // Les _id réellement sélectionnés ET toujours présents : une fiche supprimée
  // ou balayée par une régénération sort d'elle-même de la sélection.
  const idsSelectionnes = useMemo(
    () => zones.filter((z) => selection.has(z._id)).map((z) => z._id),
    [zones, selection],
  );
  const filtreesSelectionnees = useMemo(
    () => filteredZones.filter((z) => selection.has(z._id)).length,
    [filteredZones, selection],
  );
  const toutesFiltreesCochees =
    filteredZones.length > 0 && filtreesSelectionnees === filteredZones.length;

  const basculerZone = (id) => {
    setSelection((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // La case d'en-tête ne porte que sur les lignes AFFICHÉES : cocher tout en
  // pleine recherche ne doit pas embarquer les 300 fiches masquées.
  const basculerToutesFiltrees = () => {
    setSelection((prev) => {
      const next = new Set(prev);
      if (toutesFiltreesCochees) filteredZones.forEach((z) => next.delete(z._id));
      else filteredZones.forEach((z) => next.add(z._id));
      return next;
    });
  };

  // Réinitialise l'état de la carte d'import quand la société globale change.
  useEffect(() => {
    setImportResult(null);
    setErrorMsg("");
    setSearch("");
    setFile(null);
    setSelection(new Set());
    setFormZone(null);
    setZoneASupprimer(null);
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

  // ids = null  -> toutes les fiches (bouton historique, inchangé)
  // ids = [...] -> uniquement les fiches cochées dans le tableau
  const handleDownloadFiches = async (ids = null) => {
    if (!selectedEntreprise) return;
    setErrorMsg("");
    setDownloadingPdf(true);
    try {
      const res = await fetch(
        `${BASE_URL}/api/zones/${selectedEntreprise}/fiches-pdf`,
        {
          method: "POST",
          credentials: "include",
          ...(ids && ids.length
            ? {
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ids }),
              }
            : {}),
        },
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
      const trig = entrepriseObj?.trigramme || selectedEntreprise;
      a.download =
        ids && ids.length
          ? `fiches_rayons_${trig}_selection_${ids.length}.pdf`
          : `fiches_rayons_${trig}.pdf`;
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

  const handleSubmitZone = async (e) => {
    e.preventDefault();
    setFormError("");
    setErrorMsg("");
    try {
      await createZone({
        entrepriseId: selectedEntreprise,
        code: formZone.code,
        libelle: formZone.libelle,
        type: formZone.type,
        metreLineaire: formZone.metreLineaire,
      }).unwrap();
      setFormZone(null);
    } catch (err) {
      setFormError(err?.data?.message || "Création impossible");
    }
  };

  const handleConfirmDeleteOne = async () => {
    const cible = zoneASupprimer;
    setZoneASupprimer(null);
    setErrorMsg("");
    try {
      await deleteZone({
        entrepriseId: selectedEntreprise,
        id: cible._id,
      }).unwrap();
      setSelection((prev) => {
        const next = new Set(prev);
        next.delete(cible._id);
        return next;
      });
    } catch (err) {
      setErrorMsg(err?.data?.message || "Suppression impossible");
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
                  {importResult.resume?.sousZonesIgnorees > 0 &&
                    `, ${importResult.resume.sousZonesIgnorees} sous-zone(s) écartée(s)`}
                  {importResult.resume?.manuellesConservees > 0 &&
                    `, ${importResult.resume.manuellesConservees} fiche(s) manuelle(s) conservée(s)`}
                  {importResult.resume?.ecartesParManuel > 0 &&
                    `, ${importResult.resume.ecartesParManuel} écartée(s) car une fiche manuelle porte déjà ce code`}
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
              Alternative au CSV : crée une fiche par <strong>rayon</strong> du{" "}
              <strong>dictionnaire de cette société</strong> —{" "}
              <strong>jamais les sous-zones</strong> (« CODE_A », « CODE_B »…) — et{" "}
              <strong>remplace les fiches issues du dictionnaire ou du CSV</strong>.
              Les fiches <strong>ajoutées à la main sont conservées</strong>. Les 3
              EAN (papillonnage / bipage / contrôle) sont <strong>générés</strong> ;
              le code principal est un <strong>QR code</strong>.
            </p>

            {/* État du dictionnaire au trigramme de la société */}
            {fetchingDico ? (
              <div className="import-feedback info">
                <HiBookOpen /> Vérification du dictionnaire…
              </div>
            ) : dicoDisponible ? (
              <div className="import-feedback info">
                <HiBookOpen />
                <div>
                  Dictionnaire <strong>{dico.nomFichier}</strong> —{" "}
                  <strong>{dico.rayons}</strong> rayon(s) :{" "}
                  {dico.parEmplacement?.MAGASIN ?? 0} magasin,{" "}
                  {dico.parEmplacement?.DOCK ?? 0} dock.
                  {dico.sousZonesIgnorees > 0 &&
                    ` ${dico.sousZonesIgnorees} sous-zone(s) écartée(s).`}
                </div>
              </div>
            ) : (
              <div className="import-feedback warn">
                <HiExclamationCircle />
                <div>
                  {dico?.message ||
                    "Aucun dictionnaire disponible pour cette entreprise."}{" "}
                  {dico?.lisible !== false && (
                    <>
                      Renseignez-le dans <strong>Dictionnaire des rayons</strong>{" "}
                      avant de générer les fiches.
                    </>
                  )}
                </div>
              </div>
            )}

            <div className="import-row">
              <button
                className="btn-primary"
                disabled={!selectedEntreprise || generatingDico || !dicoDisponible}
                title={
                  dicoDisponible
                    ? "Générer une fiche par rayon du dictionnaire de cette société"
                    : "Aucun dictionnaire disponible pour cette entreprise"
                }
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
                onClick={() => handleDownloadFiches(null)}
                title="Télécharger le PDF imprimable de TOUTES les fiches (QR principal + 3 codes-barres)"
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
              <div className="stat-card">
                <span className="stat-value">{idsSelectionnes.length}</span>
                <span className="stat-label">Sélectionnées</span>
              </div>
            </div>

            <div className="zones-toolbar-actions">
              <button
                className="btn-primary"
                disabled={!selectedEntreprise}
                onClick={() => {
                  setFormError("");
                  setFormZone({
                    code: "",
                    libelle: "",
                    type: "MAGASIN",
                    metreLineaire: "",
                  });
                }}
                title="Ajouter une fiche rayon qui n'existe pas dans le dictionnaire"
              >
                <HiPlus /> Ajouter une zone
              </button>

              <button
                className="btn-secondary"
                disabled={downloadingPdf || idsSelectionnes.length === 0}
                onClick={() => handleDownloadFiches(idsSelectionnes)}
                title="Télécharger le PDF des seules fiches cochées"
              >
                <HiDownload />{" "}
                {downloadingPdf
                  ? "Préparation…"
                  : `Télécharger la sélection (${idsSelectionnes.length})`}
              </button>

              {idsSelectionnes.length > 0 && (
                <button
                  className="btn-link"
                  onClick={() => setSelection(new Set())}
                  title="Tout décocher"
                >
                  <HiX /> Effacer la sélection
                </button>
              )}
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
                    <th className="select-cell">
                      <input
                        type="checkbox"
                        checked={toutesFiltreesCochees}
                        ref={(el) => {
                          if (el)
                            el.indeterminate =
                              filtreesSelectionnees > 0 && !toutesFiltreesCochees;
                        }}
                        onChange={basculerToutesFiltrees}
                        disabled={filteredZones.length === 0}
                        title="Cocher / décocher les lignes affichées"
                      />
                    </th>
                    <th>Code</th>
                    <th>Libellé</th>
                    <th>Type</th>
                    <th>Origine</th>
                    <th>Mètre lin.</th>
                    <th>EAN principal</th>
                    <th>EAN papillonnage</th>
                    <th>EAN bipage</th>
                    <th>EAN contrôle</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredZones.length === 0 ? (
                    <tr>
                      <td colSpan={11} className="no-data">
                        {fetchingZones
                          ? "Chargement…"
                          : zones.length === 0
                            ? "Aucune zone. Importez un CSV ou générez depuis le dictionnaire des rayons."
                            : "Aucune zone ne correspond à la recherche."}
                      </td>
                    </tr>
                  ) : (
                    filteredZones.map((z) => {
                      const manuelle = z.origine === "manuel";
                      return (
                        <tr
                          key={z._id}
                          className={selection.has(z._id) ? "row-selected" : ""}
                        >
                          <td className="select-cell">
                            <input
                              type="checkbox"
                              checked={selection.has(z._id)}
                              onChange={() => basculerZone(z._id)}
                              title="Inclure cette fiche dans le téléchargement"
                            />
                          </td>
                          <td className="code-cell">{z.code}</td>
                          <td>{z.libelle}</td>
                          <td>{z.type}</td>
                          <td>
                            {manuelle ? (
                              <span
                                className="badge-origine manuel"
                                title="Ajoutée à la main — conservée lors d'une régénération"
                              >
                                <HiPencilAlt /> manuelle
                              </span>
                            ) : (
                              <span className="badge-origine">
                                {z.origine === "csv" ? "CSV" : "dictionnaire"}
                              </span>
                            )}
                          </td>
                          <td className="num-cell">
                            {Number(z.metreLineaire || 0).toFixed(2)}
                          </td>
                          <td className="ean-cell">{z.eanPrincipal}</td>
                          <td className="ean-cell">{z.eanPapillonnage}</td>
                          <td className="ean-cell">{z.eanBipage}</td>
                          <td className="ean-cell">{z.eanControle}</td>
                          <td className="actions-cell">
                            {/* Seules les fiches manuelles se suppriment à l'unité :
                                celles du dictionnaire reviennent à la régénération
                                suivante, les retirer une par une n'avancerait à rien. */}
                            {manuelle && (
                              <button
                                className="btn-icon danger"
                                onClick={() => setZoneASupprimer(z)}
                                disabled={deletingOne}
                                title="Supprimer cette fiche manuelle"
                              >
                                <HiTrash />
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {/* Formulaire d'ajout d'une fiche à la main */}
      {formZone && (
        <div className="modal-backdrop" onClick={() => setFormZone(null)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <form onSubmit={handleSubmitZone}>
              <div className="modal-header">
                <h2>
                  <HiPlus /> Ajouter une zone
                </h2>
                <button
                  type="button"
                  className="btn-close-modal"
                  onClick={() => setFormZone(null)}
                >
                  <HiX />
                </button>
              </div>

              <div className="modal-content">
                <p className="modal-intro">
                  La fiche <strong>s'ajoute</strong> à celles du dictionnaire et{" "}
                  <strong>survit aux régénérations</strong>. Le QR principal et
                  les 3 EAN de phase sont <strong>générés automatiquement</strong>,
                  exactement comme pour une fiche du dictionnaire.
                </p>

                <div className="form-grid">
                  <label>
                    <span>
                      Code du rayon <em>*</em>
                    </span>
                    <input
                      type="text"
                      autoFocus
                      required
                      value={formZone.code}
                      placeholder="ex. A_12"
                      onChange={(e) =>
                        setFormZone({ ...formZone, code: e.target.value })
                      }
                    />
                  </label>

                  <label>
                    <span>Emplacement</span>
                    <select
                      value={formZone.type}
                      onChange={(e) =>
                        setFormZone({ ...formZone, type: e.target.value })
                      }
                    >
                      <option value="MAGASIN">MAGASIN</option>
                      <option value="DOCK">DOCK</option>
                    </select>
                  </label>

                  <label className="form-wide">
                    <span>Libellé</span>
                    <input
                      type="text"
                      value={formZone.libelle}
                      placeholder="ex. Ventilateurs muraux"
                      onChange={(e) =>
                        setFormZone({ ...formZone, libelle: e.target.value })
                      }
                    />
                  </label>

                  <label>
                    <span>Mètre linéaire</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={formZone.metreLineaire}
                      placeholder="0"
                      onChange={(e) =>
                        setFormZone({
                          ...formZone,
                          metreLineaire: e.target.value,
                        })
                      }
                    />
                  </label>
                </div>

                <p className="form-hint">
                  Un même code peut exister en <strong>MAGASIN</strong> et en{" "}
                  <strong>DOCK</strong> : ce sont deux fiches distinctes.
                </p>

                {formError && (
                  <div className="import-feedback error">
                    <HiExclamationCircle /> {formError}
                  </div>
                )}
              </div>

              <div className="modal-footer">
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={creating || !formZone.code.trim()}
                >
                  {creating ? "Création…" : "Créer la fiche"}
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setFormZone(null)}
                >
                  Annuler
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Suppression d'une fiche manuelle */}
      {zoneASupprimer && (
        <div className="modal-backdrop" onClick={() => setZoneASupprimer(null)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>
                <HiTrash /> Supprimer la fiche
              </h2>
              <button
                className="btn-close-modal"
                onClick={() => setZoneASupprimer(null)}
              >
                <HiX />
              </button>
            </div>
            <div className="modal-content">
              <p>
                Supprimer la fiche manuelle{" "}
                <strong>{zoneASupprimer.code}</strong>
                {zoneASupprimer.libelle ? ` — ${zoneASupprimer.libelle}` : ""} (
                {zoneASupprimer.type || "MAGASIN"}) ? Cette action est
                irréversible.
              </p>
            </div>
            <div className="modal-footer">
              <button
                className="btn-danger"
                onClick={handleConfirmDeleteOne}
                disabled={deletingOne}
              >
                {deletingOne ? "Suppression…" : "Supprimer"}
              </button>
              <button
                className="btn-secondary"
                onClick={() => setZoneASupprimer(null)}
              >
                Annuler
              </button>
            </div>
          </div>
        </div>
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
                  L'import va <strong>supprimer les fiches issues du
                  dictionnaire et du CSV</strong> de{" "}
                  <strong>{entrepriseObj?.trigramme}</strong> puis insérer celles
                  du fichier <strong>{file?.name}</strong>. Les fiches{" "}
                  <strong>ajoutées à la main sont conservées</strong>. Continuer ?
                </p>
              ) : confirm === "generateDico" ? (
                <p>
                  La génération va{" "}
                  <strong>
                    supprimer les fiches issues du dictionnaire et du CSV
                  </strong>{" "}
                  de <strong>{entrepriseObj?.trigramme}</strong> puis créer une
                  fiche par rayon de son dictionnaire{" "}
                  <strong>{dico?.nomFichier}</strong> — {dico?.rayons} rayon(s),
                  sous-zones exclues (EAN générés, principal en QR). Les fiches{" "}
                  <strong>ajoutées à la main sont conservées</strong>. Continuer ?
                </p>
              ) : (
                <p>
                  Supprimer <strong>toutes les zones</strong> de{" "}
                  <strong>{entrepriseObj?.trigramme}</strong>,{" "}
                  <strong>y compris celles ajoutées à la main</strong> ? Cette
                  action est irréversible.
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