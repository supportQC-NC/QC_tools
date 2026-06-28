


// src/screens/user/UserReappro.jsx
import React, { useState, useEffect, useRef } from "react";
import {
  HiQrcode,
  HiOfficeBuilding,
  HiTrash,
  HiPencil,
  HiCheck,
  HiX,
  HiDownload,
  HiRefresh,
  HiPlus,
  HiSwitchHorizontal,
  HiServer,
  HiDesktopComputer,
  HiFolder,
  HiCube,
  HiLocationMarker,
  HiExclamation,
} from "react-icons/hi";
import { useGetMyEntreprisesQuery } from "../../slices/entrepriseApiSlice";
import {
  useCreateReapproMutation,
  useGetReapproEnCoursQuery,
  useScanArticleReapproMutation,
  useAddLigneReapproMutation,
  useUpdateLigneReapproMutation,
  useDeleteLigneReapproMutation,
  useExportReapproMutation,
  useDownloadReapproMutation,
  useDeleteReapproMutation,
} from "../../slices/reapproApiSlice";
import "./UserReappro.css";

const UserReappro = () => {
  // États
  const [selectedEntreprise, setSelectedEntreprise] = useState("");
  const [scanValue, setScanValue] = useState("");
  const [currentArticle, setCurrentArticle] = useState(null);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [quantite, setQuantite] = useState("");           // ← changé : vide au lieu de "1"
  const [editingLigne, setEditingLigne] = useState(null);
  const [editQuantite, setEditQuantite] = useState("");
  const [showExportModal, setShowExportModal] = useState(false);
  const [nomReappro, setNomReappro] = useState("");
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

  const { data: reappro, refetch: refetchReappro } = useGetReapproEnCoursQuery(
    selectedEntreprise,
    {
      skip: !selectedEntreprise,
    },
  );

  // Mutations
  const [createReappro] = useCreateReapproMutation();
  const [scanArticle, { isLoading: scanning }] =
    useScanArticleReapproMutation();
  const [addLigne, { isLoading: adding }] = useAddLigneReapproMutation();
  const [updateLigne] = useUpdateLigneReapproMutation();
  const [deleteLigne] = useDeleteLigneReapproMutation();
  const [exportReappro, { isLoading: exporting }] = useExportReapproMutation();
  const [downloadReappro, { isLoading: downloading }] =
    useDownloadReapproMutation();
  const [deleteReappro] = useDeleteReapproMutation();

  // Auto-select si une seule entreprise
  useEffect(() => {
    if (entreprises?.length === 1) {
      setSelectedEntreprise(entreprises[0]._id);
    }
  }, [entreprises]);

  // Mettre à jour le chemin serveur quand le réappro est chargé
  useEffect(() => {
    if (reappro?.entreprise?.cheminExportInventaire) {
      setCheminServeur(reappro.entreprise.cheminExportInventaire);
    }
  }, [reappro]);

  // Focus automatique sur scan quand prêt
  useEffect(() => {
    if (
      selectedEntreprise &&
      reappro &&
      !currentArticle &&
      !showConfirmation &&
      scanInputRef.current
    ) {
      scanInputRef.current.focus();
      setTimeout(() => {
        if (document.activeElement === scanInputRef.current) {
          scanInputRef.current.blur();
          setTimeout(() => scanInputRef.current?.focus(), 50);
        }
      }, 0);
    }
  }, [selectedEntreprise, reappro, currentArticle, showConfirmation]);

  // Handler pour soumettre le scan
  const handleScan = async (e) => {
    e?.preventDefault();
    if (!scanValue.trim() || !reappro) return;

    try {
      const result = await scanArticle({
        reapproId: reappro._id,
        code: scanValue.trim(),
      }).unwrap();

      setCurrentArticle(result.articleInfo);
      setShowConfirmation(true);
      setScanValue("");

      if (result.articleInfo.isRenvoi) {
        showMessage(
          `🔄 Renvoi détecté: ${result.articleInfo.articleOriginal?.nart} → ${result.articleInfo.nart}`,
          "warning",
        );
      }
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
    setShowConfirmation(false);
    setScanValue("");
    setQuantite("");
  };

  const handleStartReappro = async () => {
    if (!selectedEntreprise) return;
    try {
      await createReappro({ entrepriseId: selectedEntreprise }).unwrap();
      refetchReappro();
      showMessage("Réappro démarré", "success");
    } catch (err) {
      showMessage(err?.data?.message || "Erreur", "error");
    }
  };

  // Réponse à "Souhaitez-vous créer un Réappro ?"
  const handleConfirmReappro = (confirm) => {
    if (confirm) {
      // Oui → saisie quantité (vide + focus)
      setShowConfirmation(false);
      setQuantite("");                           // ← changé : vide
      setTimeout(() => quantiteInputRef.current?.focus(), 100);
      setTimeout(() => quantiteInputRef.current?.select(), 150); // bonus : sélectionne le champ
    } else {
      // Non → retour au scan
      setCurrentArticle(null);
      setShowConfirmation(false);
      setQuantite("");
      setTimeout(() => scanInputRef.current?.focus(), 100);
    }
  };

  const handleAddLigne = async (e) => {
    e.preventDefault();
    if (!currentArticle || !quantite || parseInt(quantite) < 1) return;

    try {
      await addLigne({
        reapproId: reappro._id,
        nart: currentArticle.nart,
        gencod: currentArticle.gencod,
        designation: currentArticle.designation,
        refer: currentArticle.refer,
        quantite: parseInt(quantite),
        stocks: currentArticle.stocks,
        isUnknown: currentArticle.isUnknown,
        isRenvoi: currentArticle.isRenvoi,
        articleOriginal: currentArticle.articleOriginal,
      }).unwrap();

      setCurrentArticle(null);
      setQuantite("");
      refetchReappro();
      showMessage("Article ajouté au réappro", "success");

      // Focus sur scan pour le prochain article
      setTimeout(() => scanInputRef.current?.focus(), 100);
    } catch (err) {
      showMessage(err?.data?.message || "Erreur", "error");
    }
  };

  const handleCancelScan = () => {
    setCurrentArticle(null);
    setShowConfirmation(false);
    setQuantite("");
    setScanValue("");
    setTimeout(() => scanInputRef.current?.focus(), 100);
  };

  const handleEditLigne = (ligne) => {
    setEditingLigne(ligne._id);
    setEditQuantite(ligne.quantite.toString());
  };

  const handleSaveEdit = async (ligneId) => {
    if (!editQuantite || parseInt(editQuantite) < 1) return;

    try {
      await updateLigne({
        reapproId: reappro._id,
        ligneId,
        quantite: parseInt(editQuantite),
      }).unwrap();

      setEditingLigne(null);
      setEditQuantite("");
      refetchReappro();
    } catch (err) {
      showMessage(err?.data?.message || "Erreur", "error");
    }
  };

  const handleDeleteLigne = async (ligneId) => {
    if (!window.confirm("Supprimer cette ligne ?")) return;

    try {
      await deleteLigne({
        reapproId: reappro._id,
        ligneId,
      }).unwrap();
      refetchReappro();
    } catch (err) {
      showMessage(err?.data?.message || "Erreur", "error");
    }
  };

  const handleExport = async () => {
    if (!nomReappro.trim()) {
      showMessage("Veuillez saisir un nom pour le réappro", "error");
      return;
    }

    try {
      if (exportMode === "download") {
        const contenu = await downloadReappro({
          reapproId: reappro._id,
          nomReappro: nomReappro.trim(),
        }).unwrap();

        const nomFichier = `stock.dat reappro ${nomReappro.trim().replace(/[^a-zA-Z0-9_\- ]/g, "_")}`;
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
        const result = await exportReappro({
          reapproId: reappro._id,
          nomReappro: nomReappro.trim(),
          cheminDestination: cheminServeur.trim(),
        }).unwrap();

        showMessage(`Fichier enregistré: ${result.fichier.chemin}`, "success");
      }

      setShowExportModal(false);
      setNomReappro("");
      refetchReappro();
    } catch (err) {
      showMessage(
        err?.data?.message || err?.message || "Erreur d'export",
        "error",
      );
    }
  };

  const handleCancelReappro = async () => {
    if (!window.confirm("Annuler et supprimer ce réappro ?")) return;

    try {
      await deleteReappro(reappro._id).unwrap();
      refetchReappro();
      showMessage("Réappro annulé", "success");
    } catch (err) {
      showMessage(err?.data?.message || "Erreur", "error");
    }
  };

  const showMessage = (text, type = "info") => {
    setMessage({ text, type });
    setTimeout(() => setMessage(null), 4000);
  };

  const openExportModal = () => {
    const nom = window.prompt("Nom du réappro:", "");
    if (nom === null) return;
    if (!nom.trim()) {
      showMessage("Veuillez saisir un nom pour le réappro", "error");
      return;
    }

    setNomReappro(nom.trim());
    setShowExportModal(true);
    setExportMode("server");
    setCheminServeur(
      reappro?.entreprise?.cheminExportInventaire ||
        "\\\\192.168.0.250\\Rcommun\\STOCK\\collect_sec",
    );
  };

  const handleEditChemin = () => {
    const chemin = window.prompt("Chemin de destination:", cheminServeur);
    if (chemin !== null) {
      setCheminServeur(chemin);
    }
  };

  // Obtenir le label d'un stock depuis le mapping de l'entreprise
  const getStockLabel = (stockKey) => {
    const labels =
      currentArticle?.stocksLabels ||
      reappro?.entreprise?.mappingEntrepots ||
      {};
    return labels[stockKey] || stockKey;
  };

  // Calculer le stock total
  const getTotalStock = (stocks) => {
    if (!stocks) return 0;
    return (
      (stocks.S1 || 0) +
      (stocks.S2 || 0) +
      (stocks.S3 || 0) +
      (stocks.S4 || 0) +
      (stocks.S5 || 0)
    );
  };

  // Render
  if (loadingEntreprises) {
    return <div className="reappro-loading">Chargement...</div>;
  }

  if (!entreprises || entreprises.length === 0) {
    return (
      <div className="reappro-empty">
        <HiOfficeBuilding />
        <p>Vous n'avez accès à aucune entreprise</p>
      </div>
    );
  }

  return (
    <div className="reappro-screen">
      {/* Header */}
      <div className="reappro-header">
        <h1>
          <HiRefresh /> Réapprovisionnement
        </h1>
        <div className="entreprise-selector">
          <HiOfficeBuilding />
          <select
            value={selectedEntreprise}
            onChange={handleEntrepriseChange}
            disabled={reappro?.status === "en_cours"}
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
        <div className={`reappro-message ${message.type}`}>{message.text}</div>
      )}

      {/* Contenu principal */}
      {!selectedEntreprise ? (
        <div className="reappro-placeholder">
          <HiOfficeBuilding />
          <p>Sélectionnez une entreprise pour démarrer le réappro</p>
        </div>
      ) : !reappro ? (
        <div className="reappro-start">
          <HiRefresh />
          <p>Aucun réappro en cours</p>
          <button className="btn-start" onClick={handleStartReappro}>
            <HiPlus /> Démarrer un réappro
          </button>
        </div>
      ) : (
        <div className="reappro-content">
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
                    placeholder="Scannez un code barre ou saisissez un NART..."
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
            ) : showConfirmation ? (
              /* ========== AFFICHAGE INFOS ARTICLE + STOCKS + CONFIRMATION ========== */
              <div className="article-scanned">
                <div
                  className={`article-info ${currentArticle.isUnknown ? "unknown" : ""} ${currentArticle.isRenvoi ? "renvoi" : ""}`}
                >
                  {/* ===== BANDEAU RENVOI ===== */}
                  {currentArticle.isRenvoi && (
                    <div className="article-renvoi-banner">
                      <HiSwitchHorizontal /> ARTICLE EN RENVOI
                    </div>
                  )}

                  {/* ===== DÉTAILS DU RENVOI ===== */}
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
                          {currentArticle.articleOriginal.gencod && (
                            <span className="renvoi-gencod">
                              CB: {currentArticle.articleOriginal.gencod}
                            </span>
                          )}
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

                  {/* ===== INFOS ARTICLE (SI PAS RENVOI) ===== */}
                  {!currentArticle.isRenvoi && (
                    <div className="article-main-info">
                      <div className="article-code">{currentArticle.nart}</div>
                      <div className="article-designation">
                        {currentArticle.designation}
                      </div>
                      {currentArticle.refer && (
                        <div className="article-refer">
                          <strong>Réf fournisseur:</strong>{" "}
                          {currentArticle.refer}
                        </div>
                      )}
                      {currentArticle.gencod && (
                        <div className="article-gencod">
                          <strong>Code barre:</strong> {currentArticle.gencod}
                        </div>
                      )}
                    </div>
                  )}

                  {/* ===== INFOS ARTICLE FINAL (SI RENVOI) ===== */}
                  {currentArticle.isRenvoi && (
                    <div className="article-final-info">
                      <div className="article-final-label">
                        Article utilisé pour le réappro:
                      </div>
                      <div className="article-code">{currentArticle.nart}</div>
                      <div className="article-designation">
                        {currentArticle.designation}
                      </div>
                      {currentArticle.refer && (
                        <div className="article-refer">
                          <strong>Réf:</strong> {currentArticle.refer}
                        </div>
                      )}
                      {currentArticle.gencod && (
                        <div className="article-gencod">
                          <strong>CB:</strong> {currentArticle.gencod}
                        </div>
                      )}
                    </div>
                  )}

                  {/* ===== ALERTE CHAÎNE DE RENVOIS ===== */}
                  {currentArticle.nombreRenvois > 1 && (
                    <div className="renvoi-chain-warning">
                      <HiExclamation /> Chaîne de {currentArticle.nombreRenvois}{" "}
                      renvois détectée
                    </div>
                  )}

                  {/* ===== AFFICHAGE DE TOUS LES STOCKS PAR ENTREPÔT ===== */}
                  <div className="stocks-section">
                    <div className="stocks-title">
                      <HiLocationMarker /> Stocks disponibles par entrepôt
                    </div>
                    <div className="stocks-grid">
                      <div
                        className={`stock-item ${(currentArticle.stocks?.S1 || 0) === 0 ? "stock-zero" : "stock-positive"}`}
                      >
                        <span className="stock-label">
                          {getStockLabel("S1")}
                        </span>
                        <span className="stock-value">
                          {currentArticle.stocks?.S1 || 0}
                        </span>
                      </div>

                      <div
                        className={`stock-item ${(currentArticle.stocks?.S2 || 0) === 0 ? "stock-zero" : "stock-positive"}`}
                      >
                        <span className="stock-label">
                          {getStockLabel("S2")}
                        </span>
                        <span className="stock-value">
                          {currentArticle.stocks?.S2 || 0}
                        </span>
                      </div>

                      <div
                        className={`stock-item ${(currentArticle.stocks?.S3 || 0) === 0 ? "stock-zero" : "stock-positive"}`}
                      >
                        <span className="stock-label">
                          {getStockLabel("S3")}
                        </span>
                        <span className="stock-value">
                          {currentArticle.stocks?.S3 || 0}
                        </span>
                      </div>

                      <div
                        className={`stock-item ${(currentArticle.stocks?.S4 || 0) === 0 ? "stock-zero" : "stock-positive"}`}
                      >
                        <span className="stock-label">
                          {getStockLabel("S4")}
                        </span>
                        <span className="stock-value">
                          {currentArticle.stocks?.S4 || 0}
                        </span>
                      </div>

                      <div
                        className={`stock-item ${(currentArticle.stocks?.S5 || 0) === 0 ? "stock-zero" : "stock-positive"}`}
                      >
                        <span className="stock-label">
                          {getStockLabel("S5")}
                        </span>
                        <span className="stock-value">
                          {currentArticle.stocks?.S5 || 0}
                        </span>
                      </div>
                    </div>

                    <div className="stock-total">
                      <span className="stock-total-label">STOCK TOTAL:</span>
                      <span
                        className={`stock-total-value ${getTotalStock(currentArticle.stocks) === 0 ? "zero" : ""}`}
                      >
                        {getTotalStock(currentArticle.stocks)}
                      </span>
                    </div>
                  </div>

                  {currentArticle.isUnknown && (
                    <div className="article-warning">
                      <HiExclamation /> Article inconnu dans la base
                    </div>
                  )}
                </div>

                <div className="confirmation-box">
                  <p className="confirmation-question">
                    Souhaitez-vous créer un Réappro ?
                  </p>
                  <div className="confirmation-actions">
                    <button
                      className="btn-yes"
                      onClick={() => handleConfirmReappro(true)}
                    >
                      <HiCheck /> Oui
                    </button>
                    <button
                      className="btn-no"
                      onClick={() => handleConfirmReappro(false)}
                    >
                      <HiX /> Non
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              /* ========== SAISIE DE LA QUANTITÉ APRÈS CONFIRMATION ========== */
              <div className="article-scanned">
                <div
                  className={`article-info compact ${currentArticle.isRenvoi ? "renvoi" : ""}`}
                >
                  {currentArticle.isRenvoi && (
                    <div className="compact-renvoi-badge">
                      <HiSwitchHorizontal /> Renvoi de{" "}
                      {currentArticle.articleOriginal?.nart}
                    </div>
                  )}
                  <div className="article-code">{currentArticle.nart}</div>
                  <div className="article-designation">
                    {currentArticle.designation}
                  </div>
                  <div className="compact-stocks">
                    Stock total:{" "}
                    <strong>{getTotalStock(currentArticle.stocks)}</strong>
                  </div>
                </div>

                <form className="quantite-form" onSubmit={handleAddLigne}>
                  <label>Quantité à réapprovisionner:</label>
                  <div className="quantite-input-wrapper">
                    <button
                      type="button"
                      className="quantite-btn"
                      onClick={() =>
                        setQuantite((prev) =>
                          prev === "" || parseInt(prev) <= 1
                            ? ""
                            : (parseInt(prev) - 1).toString()
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
                      placeholder="Saisir quantité"
                    />
                    <button
                      type="button"
                      className="quantite-btn"
                      onClick={() =>
                        setQuantite((prev) =>
                          prev === "" ? "1" : (parseInt(prev) + 1).toString()
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
                      disabled={!quantite || parseInt(quantite) < 1 || adding}
                    >
                      <HiCheck /> Valider
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

          {/* ========== RÉCAPITULATIF ========== */}
          <div className="recap-section">
            <div className="recap-header">
              <h2>
                <HiCube /> Récap Réappro
              </h2>
              <div className="recap-stats">
                <span>{reappro.totalArticles || 0} art.</span>
                <span>{reappro.totalQuantite || 0} unités</span>
              </div>
            </div>

            <div className="lignes-list">
              {reappro.lignes?.length === 0 ? (
                <div className="no-lignes">
                  Aucun article à réapprovisionner
                </div>
              ) : (
                reappro.lignes?.map((ligne) => (
                  <div
                    key={ligne._id}
                    className={`ligne-item ${ligne.isUnknown ? "unknown" : ""} ${ligne.isRenvoi ? "renvoi" : ""}`}
                  >
                    <div className="ligne-info">
                      <div className="ligne-main">
                        {ligne.isRenvoi && (
                          <span
                            className="ligne-renvoi-badge"
                            title={`Renvoi de ${ligne.articleOriginal?.nart || "?"}`}
                          >
                            <HiSwitchHorizontal />
                          </span>
                        )}
                        <span className="ligne-code">{ligne.nart}</span>
                        <span className="ligne-design">
                          {ligne.designation}
                        </span>
                      </div>
                      {ligne.refer && (
                        <div className="ligne-refer">
                          <small>Réf: {ligne.refer}</small>
                        </div>
                      )}
                      {ligne.isRenvoi && ligne.articleOriginal && (
                        <div className="ligne-renvoi-info">
                          <small>⤷ Scanné: {ligne.articleOriginal.nart}</small>
                        </div>
                      )}
                      {ligne.stocksSnapshot && (
                        <div className="ligne-stocks">
                          <small>
                            Stk: {ligne.stocksSnapshot.S1 || 0}/
                            {ligne.stocksSnapshot.S2 || 0}/
                            {ligne.stocksSnapshot.S3 || 0}
                          </small>
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
                              Math.max(1, parseInt(prev || 1) - 1).toString(),
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
                        <button className="edit-btn" onClick={() => handleEditLigne(ligne)}>
                          <HiPencil />
                        </button>
                        <button className="delete-btn" onClick={() => handleDeleteLigne(ligne._id)}>
                          <HiTrash />
                        </button>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>

            <div className="reappro-actions">
              <button
                className="btn-export"
                onClick={openExportModal}
                disabled={!reappro.lignes?.length}
              >
                <HiDownload /> Terminer
              </button>
              <button
                className="btn-cancel-reappro"
                onClick={handleCancelReappro}
              >
                <HiTrash /> Annuler
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========== MODAL EXPORT ========== */}
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
              <HiDownload /> Terminer le réappro
            </h2>
            <p className="modal-stats">
              {reappro.totalArticles} articles - {reappro.totalQuantite} unités
            </p>

            <div className="modal-info-row">
              <label>Nom:</label>
              <span className="modal-value">{nomReappro}</span>
              <button
                type="button"
                className="btn-edit-small"
                onClick={() => {
                  const nom = window.prompt("Nom du réappro:", nomReappro);
                  if (nom !== null && nom.trim()) setNomReappro(nom.trim());
                }}
              >
                <HiPencil />
              </button>
            </div>

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

            {exportMode === "download" && (
              <div className="export-info">
                <small>
                  ℹ️ Le fichier sera téléchargé via votre navigateur.
                </small>
              </div>
            )}

            <div className="modal-actions">
              <button
                className="btn-confirm"
                onClick={handleExport}
                disabled={
                  !nomReappro.trim() ||
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

export default UserReappro;