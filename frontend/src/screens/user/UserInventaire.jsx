// src/screens/user/InventaireScreen.jsx
import React, { useState, useEffect, useRef } from "react";
import {
  HiQrcode,
  HiOfficeBuilding,
  HiTrash,
  HiPencil,
  HiCheck,
  HiX,
  HiDownload,
  HiClipboardList,
  HiPlus,
  HiSwitchHorizontal,
  HiServer,
  HiDesktopComputer,
  HiFolder,
} from "react-icons/hi";
import { useGetMyEntreprisesQuery } from "../../slices/entrepriseApiSlice";
import {
  useCreateInventaireMutation,
  useGetInventaireEnCoursQuery,
  useScanArticleMutation,
  useAddLigneMutation,
  useUpdateLigneMutation,
  useDeleteLigneMutation,
  useExportInventaireMutation,
  useDownloadInventaireMutation,
  useDeleteInventaireMutation,
} from "../../slices/inventaireApiSlice";
import "./UserInventaire.css";

const InventaireScreen = () => {
  // États
  const [selectedEntreprise, setSelectedEntreprise] = useState("");
  const [scanValue, setScanValue] = useState("");
  const [currentArticle, setCurrentArticle] = useState(null);
  const [quantite, setQuantite] = useState("");
  const [editingLigne, setEditingLigne] = useState(null);
  const [editQuantite, setEditQuantite] = useState("");
  const [showExportModal, setShowExportModal] = useState(false);
  const [nomInventaire, setNomInventaire] = useState("");
  const [message, setMessage] = useState(null);

  // États pour l'export
  const [exportMode, setExportMode] = useState("server");
  const [cheminServeur, setCheminServeur] = useState("");

  const scanInputRef = useRef(null);
  const quantiteInputRef = useRef(null);
  const editQuantiteInputRef = useRef(null);

  // Queries
  const { data: entreprises, isLoading: loadingEntreprises } =
    useGetMyEntreprisesQuery();

  const { data: inventaire, refetch: refetchInventaire } =
    useGetInventaireEnCoursQuery(selectedEntreprise, {
      skip: !selectedEntreprise,
    });

  // Mutations
  const [createInventaire] = useCreateInventaireMutation();
  const [scanArticle, { isLoading: scanning }] = useScanArticleMutation();
  const [addLigne, { isLoading: adding }] = useAddLigneMutation();
  const [updateLigne] = useUpdateLigneMutation();
  const [deleteLigne] = useDeleteLigneMutation();
  const [exportInventaire, { isLoading: exporting }] =
    useExportInventaireMutation();
  const [downloadInventaire, { isLoading: downloading }] =
    useDownloadInventaireMutation();
  const [deleteInventaire] = useDeleteInventaireMutation();

  // Auto-select si une seule entreprise
  useEffect(() => {
    if (entreprises?.length === 1) {
      setSelectedEntreprise(entreprises[0]._id);
    }
  }, [entreprises]);

  // Mettre à jour le chemin serveur quand l'inventaire est chargé
  useEffect(() => {
    if (inventaire?.entreprise?.cheminExportInventaire) {
      setCheminServeur(inventaire.entreprise.cheminExportInventaire);
    }
  }, [inventaire]);

  // Focus automatique sur scan quand prêt (sans déclencher le clavier)
  useEffect(() => {
    if (
      selectedEntreprise &&
      inventaire &&
      !currentArticle &&
      scanInputRef.current
    ) {
      // Focus l'input pour recevoir le scanner
      scanInputRef.current.focus();
      // Blur immédiat pour fermer le clavier virtuel si ouvert
      setTimeout(() => {
        if (document.activeElement === scanInputRef.current) {
          scanInputRef.current.blur();
          // Re-focus après pour recevoir le scanner
          setTimeout(() => scanInputRef.current?.focus(), 50);
        }
      }, 0);
    }
  }, [selectedEntreprise, inventaire, currentArticle]);

  // Handler pour soumettre le scan
  const handleScan = async (e) => {
    e?.preventDefault();
    if (!scanValue.trim() || !inventaire) return;

    try {
      const result = await scanArticle({
        inventaireId: inventaire._id,
        code: scanValue.trim(),
      }).unwrap();

      setCurrentArticle(result.articleInfo);
      setQuantite("1");
      setScanValue("");

      if (result.articleInfo.isRenvoi) {
        showMessage(
          `🔄 Renvoi détecté → ${result.articleInfo.nart}`,
          "warning",
        );
      }

      // Focus sur quantité
      setTimeout(() => quantiteInputRef.current?.focus(), 100);
    } catch (err) {
      showMessage(err?.data?.message || "Erreur de scan", "error");
      setScanValue("");
    }
  };

  // Handlers
  const handleEntrepriseChange = async (e) => {
    const entrepriseId = e.target.value;
    setSelectedEntreprise(entrepriseId);
    setCurrentArticle(null);
    setScanValue("");
    setQuantite("");
  };

  const handleStartInventaire = async () => {
    if (!selectedEntreprise) return;
    try {
      await createInventaire({ entrepriseId: selectedEntreprise }).unwrap();
      refetchInventaire();
      showMessage("Inventaire démarré", "success");
    } catch (err) {
      showMessage(err?.data?.message || "Erreur", "error");
    }
  };

  const handleAddLigne = async (e) => {
    e.preventDefault();
    if (!currentArticle || !quantite || parseInt(quantite) < 0) return;

    try {
      await addLigne({
        inventaireId: inventaire._id,
        nart: currentArticle.nart,
        gencod: currentArticle.gencod,
        designation: currentArticle.designation,
        quantite: parseInt(quantite),
        isUnknown: currentArticle.isUnknown,
        isRenvoi: currentArticle.isRenvoi,
        articleOriginal: currentArticle.articleOriginal,
      }).unwrap();

      setCurrentArticle(null);
      setQuantite("");
      refetchInventaire();
      showMessage("Article ajouté", "success");

      // Focus sur scan pour le prochain article
      setTimeout(() => scanInputRef.current?.focus(), 100);
    } catch (err) {
      showMessage(err?.data?.message || "Erreur", "error");
    }
  };

  const handleCancelScan = () => {
    setCurrentArticle(null);
    setQuantite("");
    setScanValue("");
    setTimeout(() => scanInputRef.current?.focus(), 100);
  };

  const handleEditLigne = (ligne) => {
    setEditingLigne(ligne._id);
    setEditQuantite(ligne.quantite.toString());
  };

  const handleSaveEdit = async (ligneId) => {
    if (!editQuantite || parseInt(editQuantite) < 0) return;

    try {
      await updateLigne({
        inventaireId: inventaire._id,
        ligneId,
        quantite: parseInt(editQuantite),
      }).unwrap();

      setEditingLigne(null);
      setEditQuantite("");
      refetchInventaire();
    } catch (err) {
      showMessage(err?.data?.message || "Erreur", "error");
    }
  };

  const handleDeleteLigne = async (ligneId) => {
    if (!window.confirm("Supprimer cette ligne ?")) return;

    try {
      await deleteLigne({
        inventaireId: inventaire._id,
        ligneId,
      }).unwrap();
      refetchInventaire();
    } catch (err) {
      showMessage(err?.data?.message || "Erreur", "error");
    }
  };

  const handleExport = async () => {
    if (!nomInventaire.trim()) {
      showMessage("Veuillez saisir un nom pour l'inventaire", "error");
      return;
    }

    try {
      if (exportMode === "download") {
        const contenu = await downloadInventaire({
          inventaireId: inventaire._id,
          nomInventaire: nomInventaire.trim(),
        }).unwrap();

        const nomFichier = `stock.dat invent ${nomInventaire.trim().replace(/[^a-zA-Z0-9_\- ]/g, "_")}`;
        const blob = new Blob([contenu], { type: "text/plain;charset=utf-8" });
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = nomFichier;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);

        showMessage(`Fichier téléchargé: ${nomFichier}`, "success");
      } else {
        const result = await exportInventaire({
          inventaireId: inventaire._id,
          nomInventaire: nomInventaire.trim(),
          cheminDestination: cheminServeur.trim(),
        }).unwrap();

        showMessage(`Fichier enregistré: ${result.fichier.chemin}`, "success");
      }

      setShowExportModal(false);
      setNomInventaire("");
      refetchInventaire();
    } catch (err) {
      showMessage(
        err?.data?.message || err?.message || "Erreur d'export",
        "error",
      );
    }
  };

  const handleCancelInventaire = async () => {
    if (!window.confirm("Annuler et supprimer cet inventaire ?")) return;

    try {
      await deleteInventaire(inventaire._id).unwrap();
      refetchInventaire();
      showMessage("Inventaire annulé", "success");
    } catch (err) {
      showMessage(err?.data?.message || "Erreur", "error");
    }
  };

  const showMessage = (text, type = "info") => {
    setMessage({ text, type });
    setTimeout(() => setMessage(null), 4000);
  };

  const openExportModal = () => {
    // Utiliser prompt natif pour le nom de l'inventaire
    const nom = window.prompt("Nom de l'inventaire:", "");
    if (nom === null) return; // Annulé
    if (!nom.trim()) {
      showMessage("Veuillez saisir un nom pour l'inventaire", "error");
      return;
    }

    setNomInventaire(nom.trim());
    setShowExportModal(true);
    setExportMode("server");
    setCheminServeur(
      inventaire?.entreprise?.cheminExportInventaire ||
        "\\\\192.168.0.250\\Rcommun\\STOCK\\collect_sec",
    );
  };

  const handleEditChemin = () => {
    const chemin = window.prompt("Chemin de destination:", cheminServeur);
    if (chemin !== null) {
      setCheminServeur(chemin);
    }
  };

  // Render
  if (loadingEntreprises) {
    return <div className="inventaire-loading">Chargement...</div>;
  }

  if (!entreprises || entreprises.length === 0) {
    return (
      <div className="inventaire-empty">
        <HiOfficeBuilding />
        <p>Vous n'avez accès à aucune entreprise</p>
      </div>
    );
  }

  return (
    <div className="inventaire-screen">
      {/* Header */}
      <div className="inventaire-header">
        <h1>
          <HiClipboardList /> Mode Inventaire
        </h1>
        <div className="entreprise-selector">
          <HiOfficeBuilding />
          <select
            value={selectedEntreprise}
            onChange={handleEntrepriseChange}
            disabled={inventaire?.status === "en_cours"}
          >
            <option value="">-- Choisir une entreprise --</option>
            {entreprises?.map((e) => (
              <option key={e._id} value={e._id}>
                {e.trigramme} - {e.nomComplet}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Message */}
      {message && (
        <div className={`inventaire-message ${message.type}`}>
          {message.text}
        </div>
      )}

      {/* Contenu principal */}
      {!selectedEntreprise ? (
        <div className="inventaire-placeholder">
          <HiOfficeBuilding />
          <p>Sélectionnez une entreprise pour démarrer l'inventaire</p>
        </div>
      ) : !inventaire ? (
        <div className="inventaire-start">
          <HiClipboardList />
          <p>Aucun inventaire en cours</p>
          <button className="btn-start" onClick={handleStartInventaire}>
            <HiPlus /> Démarrer un inventaire
          </button>
        </div>
      ) : (
        <div className="inventaire-content">
          {/* Zone de scan */}
          <div className="scan-section">
            <h2>Scanner un article</h2>
            {!currentArticle ? (
              <form className="scan-form" onSubmit={handleScan}>
                <div className="scan-input-wrapper">
                  <HiQrcode />
                  <input
                    ref={scanInputRef}
                    type="text"
                    placeholder="Scannez un code barre..."
                    value={scanValue}
                    onChange={(e) => setScanValue(e.target.value)}
                    onTouchStart={(e) => e.preventDefault()}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={(e) => e.preventDefault()}
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck="false"
                  />
                </div>
                <button type="submit" disabled={!scanValue.trim() || scanning}>
                  {scanning ? "..." : "OK"}
                </button>
              </form>
            ) : (
              <div className="article-scanned">
                <div
                  className={`article-info ${currentArticle.isUnknown ? "unknown" : ""} ${currentArticle.isRenvoi ? "renvoi" : ""}`}
                >
                  {currentArticle.isRenvoi && (
                    <div className="article-renvoi-banner">
                      <HiSwitchHorizontal /> ARTICLE EN RENVOI
                    </div>
                  )}

                  {currentArticle.isRenvoi &&
                    currentArticle.articleOriginal && (
                      <div className="renvoi-details">
                        <div className="renvoi-from">
                          <span className="renvoi-label">Article scanné</span>
                          <span className="renvoi-nart">
                            {currentArticle.articleOriginal.nart}
                          </span>
                          <span className="renvoi-design">
                            {currentArticle.articleOriginal.designation}
                          </span>
                        </div>
                        <div className="renvoi-arrow">
                          <HiSwitchHorizontal />
                        </div>
                        <div className="renvoi-to">
                          <span className="renvoi-label">Remplacé par</span>
                          <span className="renvoi-nart">
                            {currentArticle.nart}
                          </span>
                          <span className="renvoi-design">
                            {currentArticle.designation}
                          </span>
                        </div>
                      </div>
                    )}

                  {!currentArticle.isRenvoi && (
                    <>
                      <div className="article-code">{currentArticle.nart}</div>
                      <div className="article-designation">
                        {currentArticle.designation}
                      </div>
                      {currentArticle.gencod && (
                        <div className="article-gencod">
                          Code barre: {currentArticle.gencod}
                        </div>
                      )}
                    </>
                  )}

                  {currentArticle.isRenvoi && (
                    <div className="article-final-info">
                      <div className="article-code">{currentArticle.nart}</div>
                      {currentArticle.gencod && (
                        <div className="article-gencod">
                          Code barre: {currentArticle.gencod}
                        </div>
                      )}
                    </div>
                  )}

                  {currentArticle.nombreRenvois > 1 && (
                    <div className="renvoi-chain-warning">
                      ⚠️ Chaîne de {currentArticle.nombreRenvois} renvois
                    </div>
                  )}

                  {currentArticle.isUnknown && (
                    <div className="article-warning">⚠️ Article inconnu</div>
                  )}
                </div>

                <form className="quantite-form" onSubmit={handleAddLigne}>
                  <label>Quantité:</label>
                  <div className="quantite-input-wrapper">
                    <button
                      type="button"
                      className="quantite-btn"
                      onClick={() =>
                        setQuantite((prev) =>
                          Math.max(0, parseInt(prev || 0) - 1).toString(),
                        )
                      }
                    >
                      −
                    </button>
                    <input
                      ref={quantiteInputRef}
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={quantite}
                      onChange={(e) => {
                        const val = e.target.value.replace(/[^0-9]/g, "");
                        setQuantite(val);
                      }}
                      onTouchStart={(e) => e.preventDefault()}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={(e) => e.preventDefault()}
                      className="quantite-input"
                    />
                    <button
                      type="button"
                      className="quantite-btn"
                      onClick={() =>
                        setQuantite((prev) =>
                          (parseInt(prev || 0) + 1).toString(),
                        )
                      }
                    >
                      +
                    </button>
                  </div>
                  <div className="quantite-actions">
                    <button
                      type="submit"
                      className="btn-confirm"
                      disabled={!quantite || adding}
                    >
                      <HiCheck /> OK
                    </button>
                    <button
                      type="button"
                      className="btn-cancel"
                      onClick={handleCancelScan}
                    >
                      <HiX />
                    </button>
                  </div>
                </form>
              </div>
            )}
          </div>

          {/* Récapitulatif */}
          <div className="recap-section">
            <div className="recap-header">
              <h2>Récap</h2>
              <div className="recap-stats">
                <span>{inventaire.totalArticles || 0} art.</span>
                <span>{inventaire.totalQuantite || 0} unités</span>
              </div>
            </div>

            <div className="lignes-list">
              {inventaire.lignes?.length === 0 ? (
                <div className="no-lignes">Aucun article scanné</div>
              ) : (
                inventaire.lignes?.map((ligne) => (
                  <div
                    key={ligne._id}
                    className={`ligne-item ${ligne.isUnknown ? "unknown" : ""} ${ligne.isRenvoi ? "renvoi" : ""}`}
                  >
                    <div className="ligne-info">
                      <div className="ligne-main">
                        {ligne.isRenvoi && (
                          <span
                            className="ligne-renvoi-badge"
                            title="Article en renvoi"
                          >
                            <HiSwitchHorizontal />
                          </span>
                        )}
                        <span className="ligne-code">{ligne.nart}</span>
                        <span className="ligne-design">
                          {ligne.designation}
                        </span>
                      </div>
                      {ligne.isRenvoi && ligne.articleOriginal && (
                        <div className="ligne-renvoi-info">
                          <small>Scanné: {ligne.articleOriginal.nart}</small>
                        </div>
                      )}
                    </div>
                    {editingLigne === ligne._id ? (
                      <div className="ligne-edit">
                        <button
                          type="button"
                          className="edit-btn"
                          onClick={() =>
                            setEditQuantite((prev) =>
                              Math.max(0, parseInt(prev || 0) - 1).toString(),
                            )
                          }
                        >
                          −
                        </button>
                        <input
                          ref={editQuantiteInputRef}
                          type="text"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          value={editQuantite}
                          onChange={(e) => {
                            const val = e.target.value.replace(/[^0-9]/g, "");
                            setEditQuantite(val);
                          }}
                          onTouchStart={(e) => e.preventDefault()}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={(e) => e.preventDefault()}
                          className="edit-input"
                        />
                        <button
                          type="button"
                          className="edit-btn"
                          onClick={() =>
                            setEditQuantite((prev) =>
                              (parseInt(prev || 0) + 1).toString(),
                            )
                          }
                        >
                          +
                        </button>
                        <button onClick={() => handleSaveEdit(ligne._id)}>
                          <HiCheck />
                        </button>
                        <button onClick={() => setEditingLigne(null)}>
                          <HiX />
                        </button>
                      </div>
                    ) : (
                      <div className="ligne-actions">
                        <span className="ligne-quantite">{ligne.quantite}</span>
                        <button onClick={() => handleEditLigne(ligne)}>
                          <HiPencil />
                        </button>
                        <button onClick={() => handleDeleteLigne(ligne._id)}>
                          <HiTrash />
                        </button>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>

            {/* Actions */}
            <div className="inventaire-actions">
              <button
                className="btn-export"
                onClick={openExportModal}
                disabled={!inventaire.lignes?.length}
              >
                <HiDownload /> Terminer
              </button>
              <button
                className="btn-cancel-inv"
                onClick={handleCancelInventaire}
              >
                <HiTrash /> Annuler
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Export - SANS INPUTS */}
      {showExportModal && (
        <div
          className="modal-overlay"
          onClick={() => setShowExportModal(false)}
        >
          <div
            className="modal-content modal-export"
            onClick={(e) => e.stopPropagation()}
          >
            <h2>
              <HiDownload /> Terminer l'inventaire
            </h2>
            <p className="modal-stats">
              {inventaire.totalArticles} articles - {inventaire.totalQuantite}{" "}
              unités
            </p>

            {/* Nom de l'inventaire - affichage seulement */}
            <div className="modal-info-row">
              <label>Nom:</label>
              <span className="modal-value">{nomInventaire}</span>
              <button
                type="button"
                className="btn-edit-small"
                onClick={() => {
                  const nom = window.prompt(
                    "Nom de l'inventaire:",
                    nomInventaire,
                  );
                  if (nom !== null && nom.trim()) setNomInventaire(nom.trim());
                }}
              >
                <HiPencil />
              </button>
            </div>

            {/* Choix du mode d'export */}
            <div className="export-mode-selector">
              <label>Destination:</label>
              <div className="export-mode-options">
                <button
                  type="button"
                  className={`export-mode-btn ${exportMode === "server" ? "active" : ""}`}
                  onClick={() => setExportMode("server")}
                >
                  <HiServer />
                  <span>Serveur</span>
                </button>
                <button
                  type="button"
                  className={`export-mode-btn ${exportMode === "download" ? "active" : ""}`}
                  onClick={() => setExportMode("download")}
                >
                  <HiDesktopComputer />
                  <span>Mon poste</span>
                </button>
              </div>
            </div>

            {/* Chemin serveur - affichage seulement */}
            {exportMode === "server" && (
              <div className="modal-info-row chemin-row">
                <label>
                  <HiFolder /> Chemin:
                </label>
                <span className="modal-value mono">{cheminServeur}</span>
                <button
                  type="button"
                  className="btn-edit-small"
                  onClick={handleEditChemin}
                >
                  <HiPencil />
                </button>
              </div>
            )}

            {/* Info mode download */}
            {exportMode === "download" && (
              <div className="export-info">
                <small>
                  ℹ️ Le fichier sera téléchargé via votre navigateur.
                </small>
              </div>
            )}

            {/* Actions */}
            <div className="modal-actions">
              <button
                className="btn-confirm"
                onClick={handleExport}
                disabled={
                  !nomInventaire.trim() ||
                  (exportMode === "server" && !cheminServeur.trim()) ||
                  exporting ||
                  downloading
                }
              >
                {exporting || downloading ? (
                  "Export..."
                ) : exportMode === "download" ? (
                  <>
                    <HiDownload /> Télécharger
                  </>
                ) : (
                  <>
                    <HiServer /> Enregistrer
                  </>
                )}
              </button>
              <button
                className="btn-cancel"
                onClick={() => setShowExportModal(false)}
              >
                Annuler
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default InventaireScreen;
