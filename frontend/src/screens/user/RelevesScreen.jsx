// src/screens/user/ReleveScreen.jsx
import React, { useState, useEffect, useRef } from "react";
import {
  HiQrcode,
  HiOfficeBuilding,
  HiTrash,
  HiPencil,
  HiCheck,
  HiX,
  HiDownload,
  HiPlus,
  HiCurrencyDollar,
  HiTrendingUp,
  HiTrendingDown,
  HiMinus,
  HiShoppingCart,
  HiDocumentDownload,
  HiChevronDown,
  HiCheckCircle,
} from "react-icons/hi";
import { useGetMyEntreprisesQuery } from "../../slices/entrepriseApiSlice";
import { useGetConcurrentsQuery } from "../../slices/concurrentApiSLice";
import {
  useCreateReleveMutation,
  useGetReleveEnCoursQuery,
  useScanArticleReleveMutation,
  useAddLigneReleveMutation,
  useUpdateLigneReleveMutation,
  useDeleteLigneReleveMutation,
  useDownloadReleveMutation,
  useDeleteReleveMutation,
} from "../../slices/releveApiSlice";
import "./RelevesScreen.css";

const ReleveScreen = () => {
  const [selectedEntreprise, setSelectedEntreprise] = useState("");
  const [selectedConcurrent, setSelectedConcurrent] = useState("");
  const [scanValue, setScanValue] = useState("");
  const [currentArticle, setCurrentArticle] = useState(null);
  const [prixReleve, setPrixReleve] = useState("");
  const [editingLigne, setEditingLigne] = useState(null);
  const [editPrix, setEditPrix] = useState("");
  const [showExportModal, setShowExportModal] = useState(false);
  const [nomReleve, setNomReleve] = useState("");
  const [message, setMessage] = useState(null);

  const scanInputRef = useRef(null);
  const prixInputRef = useRef(null);

  const { data: entreprises, isLoading: loadingEntreprises } =
    useGetMyEntreprisesQuery();

  const { data: concurrents, isLoading: loadingConcurrents } =
    useGetConcurrentsQuery({ actifOnly: true });

  const { data: releve, refetch: refetchReleve } = useGetReleveEnCoursQuery(
    { entrepriseId: selectedEntreprise, concurrentId: selectedConcurrent },
    { skip: !selectedEntreprise || !selectedConcurrent },
  );

  const [createReleve] = useCreateReleveMutation();
  const [scanArticle, { isLoading: scanning }] = useScanArticleReleveMutation();
  const [addLigne, { isLoading: adding }] = useAddLigneReleveMutation();
  const [updateLigne] = useUpdateLigneReleveMutation();
  const [deleteLigne] = useDeleteLigneReleveMutation();
  const [downloadReleve, { isLoading: downloading }] =
    useDownloadReleveMutation();
  const [deleteReleve] = useDeleteReleveMutation();

  useEffect(() => {
    if (entreprises?.length === 1) {
      setSelectedEntreprise(entreprises[0]._id);
    }
  }, [entreprises]);

  useEffect(() => {
    if (
      selectedEntreprise &&
      selectedConcurrent &&
      releve &&
      !currentArticle &&
      scanInputRef.current
    ) {
      scanInputRef.current.focus();
    }
  }, [selectedEntreprise, selectedConcurrent, releve, currentArticle]);

  const handleScan = async (e) => {
    e?.preventDefault();
    if (!scanValue.trim() || !releve) return;

    try {
      const result = await scanArticle({
        releveId: releve._id,
        gencod: scanValue.trim(),
      }).unwrap();

      setCurrentArticle(result.articleInfo);
      setPrixReleve("");
      setScanValue("");

      if (result.dejaPresent) {
        showMessage(`Article déjà présent - mise à jour`, "warning");
        setPrixReleve(result.ligneExistante?.prixReleve?.toString() || "");
      }

      setTimeout(() => prixInputRef.current?.focus(), 100);
    } catch (err) {
      showMessage(err?.data?.message || "Article non trouvé", "error");
      setScanValue("");
    }
  };

  const handleEntrepriseChange = (e) => {
    const entrepriseId = e.target.value;
    setSelectedEntreprise(entrepriseId);
    setSelectedConcurrent("");
    setCurrentArticle(null);
    setScanValue("");
    setPrixReleve("");
  };

  const handleConcurrentChange = (e) => {
    setSelectedConcurrent(e.target.value);
    setCurrentArticle(null);
    setScanValue("");
    setPrixReleve("");
  };

  const handleStartReleve = async () => {
    if (!selectedEntreprise || !selectedConcurrent) return;
    try {
      await createReleve({
        entrepriseId: selectedEntreprise,
        concurrentId: selectedConcurrent,
      }).unwrap();
      refetchReleve();
      showMessage("Relevé démarré", "success");
    } catch (err) {
      showMessage(err?.data?.message || "Erreur", "error");
    }
  };

  const handleAddLigne = async (e) => {
    e.preventDefault();
    if (!currentArticle || prixReleve === "" || parseFloat(prixReleve) < 0)
      return;

    try {
      await addLigne({
        releveId: releve._id,
        nart: currentArticle.nart,
        gencod: currentArticle.gencod,
        designation: currentArticle.designation,
        groupe: currentArticle.groupe,
        pvtettc: currentArticle.pvtettc,
        prixReleve: parseFloat(prixReleve),
      }).unwrap();

      setCurrentArticle(null);
      setPrixReleve("");
      refetchReleve();
      showMessage("Prix enregistré ✓", "success");

      setTimeout(() => scanInputRef.current?.focus(), 100);
    } catch (err) {
      showMessage(err?.data?.message || "Erreur", "error");
    }
  };

  const handleCancelScan = () => {
    setCurrentArticle(null);
    setPrixReleve("");
    setScanValue("");
    setTimeout(() => scanInputRef.current?.focus(), 100);
  };

  const handleEditLigne = (ligne) => {
    setEditingLigne(ligne._id);
    setEditPrix(ligne.prixReleve.toString());
  };

  const handleSaveEdit = async (ligneId) => {
    if (editPrix === "" || parseFloat(editPrix) < 0) return;

    try {
      await updateLigne({
        releveId: releve._id,
        ligneId,
        prixReleve: parseFloat(editPrix),
      }).unwrap();

      setEditingLigne(null);
      setEditPrix("");
      refetchReleve();
    } catch (err) {
      showMessage(err?.data?.message || "Erreur", "error");
    }
  };

  const handleDeleteLigne = async (ligneId) => {
    if (!window.confirm("Supprimer cette ligne ?")) return;

    try {
      await deleteLigne({
        releveId: releve._id,
        ligneId,
      }).unwrap();
      refetchReleve();
    } catch (err) {
      showMessage(err?.data?.message || "Erreur", "error");
    }
  };

  // Télécharger le fichier Excel
  const handleDownloadExcel = async () => {
    if (!nomReleve.trim()) {
      showMessage("Saisissez un nom pour le relevé", "error");
      return;
    }

    try {
      const blob = await downloadReleve({
        releveId: releve._id,
        nomReleve: nomReleve.trim(),
      }).unwrap();

      const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      const entrepriseNom = releve.entreprise?.trigramme || "ENT";
      const concurrentNom =
        releve.concurrent?.nom?.replace(/[^a-zA-Z0-9]/g, "_") || "CONCURRENT";
      const nomFichier = `releve_${entrepriseNom}_${concurrentNom}_${dateStr}.xlsx`;

      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = nomFichier;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      showMessage(`Fichier téléchargé ✓`, "success");
      setShowExportModal(false);
      setNomReleve("");
      refetchReleve();
    } catch (err) {
      showMessage(err?.data?.message || "Erreur d'export", "error");
    }
  };

  // Terminer sans télécharger (juste marquer comme terminé)
  const handleTerminerSansTelechargement = async () => {
    if (!nomReleve.trim()) {
      showMessage("Saisissez un nom pour le relevé", "error");
      return;
    }

    try {
      // On utilise downloadReleve mais on ne télécharge pas le fichier
      // Le backend marque le relevé comme exporté
      await downloadReleve({
        releveId: releve._id,
        nomReleve: nomReleve.trim(),
      }).unwrap();

      showMessage(`Relevé terminé ✓`, "success");
      setShowExportModal(false);
      setNomReleve("");
      refetchReleve();
    } catch (err) {
      showMessage(err?.data?.message || "Erreur", "error");
    }
  };

  const handleCancelReleve = async () => {
    if (!window.confirm("Annuler et supprimer ce relevé ?")) return;

    try {
      await deleteReleve(releve._id).unwrap();
      refetchReleve();
      showMessage("Relevé annulé", "success");
    } catch (err) {
      showMessage(err?.data?.message || "Erreur", "error");
    }
  };

  const showMessage = (text, type = "info") => {
    setMessage({ text, type });
    setTimeout(() => setMessage(null), 3000);
  };

  const openExportModal = () => {
    setNomReleve(releve.concurrent?.nom || "");
    setShowExportModal(true);
  };

  const getDifferenceInfo = (pvtettc, prixReleve) => {
    const diff = pvtettc - prixReleve;
    const pct = pvtettc > 0 ? ((diff / pvtettc) * 100).toFixed(1) : 0;

    if (diff > 0) {
      return {
        class: "diff-bad",
        icon: <HiTrendingDown />,
        label: `-${Math.abs(diff).toLocaleString()}F`,
        pct: `${pct}%`,
        text: "Concurrent moins cher",
      };
    } else if (diff < 0) {
      return {
        class: "diff-good",
        icon: <HiTrendingUp />,
        label: `+${Math.abs(diff).toLocaleString()}F`,
        pct: `${pct}%`,
        text: "Nous sommes moins chers",
      };
    }
    return {
      class: "diff-equal",
      icon: <HiMinus />,
      label: "0F",
      pct: "0%",
      text: "Même prix",
    };
  };

  if (loadingEntreprises || loadingConcurrents) {
    return <div className="releve-loading">Chargement...</div>;
  }

  if (!entreprises || entreprises.length === 0) {
    return (
      <div className="releve-empty">
        <HiOfficeBuilding />
        <p>Aucune entreprise accessible</p>
      </div>
    );
  }

  if (!concurrents || concurrents.length === 0) {
    return (
      <div className="releve-empty">
        <HiShoppingCart />
        <p>Aucun concurrent configuré</p>
        <small>Contactez un administrateur</small>
      </div>
    );
  }

  const selectedConcurrentData = concurrents?.find(
    (c) => c._id === selectedConcurrent,
  );

  return (
    <div className="releve-screen">
      <header className="releve-header">
        <h1>
          <HiCurrencyDollar /> Relevé de Prix
        </h1>
      </header>

      {message && (
        <div className={`releve-toast ${message.type}`}>{message.text}</div>
      )}

      <div className="releve-selectors">
        <div className="selector-card">
          <label>
            <HiOfficeBuilding /> Entreprise
          </label>
          <div className="select-wrapper">
            <select
              value={selectedEntreprise}
              onChange={handleEntrepriseChange}
              disabled={releve?.status === "en_cours"}
            >
              <option value="">Sélectionner...</option>
              {entreprises?.map((e) => (
                <option key={e._id} value={e._id}>
                  {e.trigramme} - {e.nomComplet}
                </option>
              ))}
            </select>
            <HiChevronDown className="select-icon" />
          </div>
        </div>

        <div className="selector-card">
          <label>
            <HiShoppingCart /> Concurrent
          </label>
          <div className="select-wrapper">
            <select
              value={selectedConcurrent}
              onChange={handleConcurrentChange}
              disabled={!selectedEntreprise || releve?.status === "en_cours"}
            >
              <option value="">Sélectionner...</option>
              {concurrents?.map((c) => (
                <option key={c._id} value={c._id}>
                  {c.nom} {c.ville ? `(${c.ville})` : ""}
                </option>
              ))}
            </select>
            <HiChevronDown className="select-icon" />
          </div>
        </div>
      </div>

      {!selectedEntreprise || !selectedConcurrent ? (
        <div className="releve-placeholder">
          <div className="placeholder-icon">
            <HiCurrencyDollar />
          </div>
          <p>Sélectionnez une entreprise et un concurrent</p>
        </div>
      ) : !releve ? (
        <div className="releve-start">
          <div className="start-icon">
            <HiShoppingCart />
          </div>
          <h2>Prêt à démarrer</h2>
          <p>
            Relevé chez <strong>{selectedConcurrentData?.nom}</strong>
          </p>
          <button className="btn-start" onClick={handleStartReleve}>
            <HiPlus /> Démarrer le relevé
          </button>
        </div>
      ) : (
        <div className="releve-content">
          <div className="concurrent-badge">
            <HiShoppingCart />
            <span>{releve.concurrent?.nom}</span>
            {releve.concurrent?.ville && (
              <small>{releve.concurrent.ville}</small>
            )}
          </div>

          <section className="scan-section">
            {!currentArticle ? (
              <form className="scan-form" onSubmit={handleScan}>
                <div className="scan-input-box">
                  <HiQrcode className="scan-qr-icon" />
                  <input
                    ref={scanInputRef}
                    type="text"
                    inputMode="numeric"
                    placeholder="Scanner code barre..."
                    value={scanValue}
                    onChange={(e) => setScanValue(e.target.value)}
                    autoComplete="off"
                    disabled={scanning}
                    className="scan-field"
                  />
                  {scanValue && !scanning && (
                    <button
                      type="button"
                      className="scan-clear-btn"
                      onClick={() => setScanValue("")}
                    >
                      <HiX />
                    </button>
                  )}
                </div>
                <button
                  type="submit"
                  className="scan-submit-btn"
                  disabled={!scanValue.trim() || scanning}
                >
                  {scanning ? "..." : "OK"}
                </button>
              </form>
            ) : (
              <div className="article-card">
                <div className="article-header">
                  <div className="article-codes">
                    <span className="article-nart">{currentArticle.nart}</span>
                    <span className="article-gencod">
                      {currentArticle.gencod}
                    </span>
                  </div>
                  <div className="article-notre-prix">
                    <small>Notre prix</small>
                    <strong>
                      {currentArticle.pvtettc?.toLocaleString()} F
                    </strong>
                  </div>
                </div>

                <p className="article-design">{currentArticle.designation}</p>

                <div className="prix-saisie">
                  <label>Prix relevé :</label>
                  <div className="prix-input-group">
                    <input
                      ref={prixInputRef}
                      type="number"
                      inputMode="numeric"
                      min="0"
                      value={prixReleve}
                      onChange={(e) => setPrixReleve(e.target.value)}
                      placeholder="0"
                    />
                    <span className="prix-unit">F</span>
                  </div>
                </div>

                {prixReleve !== "" && (
                  <div
                    className={`prix-diff-display ${getDifferenceInfo(currentArticle.pvtettc, parseFloat(prixReleve)).class}`}
                  >
                    {
                      getDifferenceInfo(
                        currentArticle.pvtettc,
                        parseFloat(prixReleve),
                      ).icon
                    }
                    <span className="diff-amount">
                      {
                        getDifferenceInfo(
                          currentArticle.pvtettc,
                          parseFloat(prixReleve),
                        ).label
                      }
                    </span>
                    <span className="diff-pct">
                      (
                      {
                        getDifferenceInfo(
                          currentArticle.pvtettc,
                          parseFloat(prixReleve),
                        ).pct
                      }
                      )
                    </span>
                    <small>
                      {
                        getDifferenceInfo(
                          currentArticle.pvtettc,
                          parseFloat(prixReleve),
                        ).text
                      }
                    </small>
                  </div>
                )}

                <div className="article-actions">
                  <button
                    className="btn-validate"
                    onClick={handleAddLigne}
                    disabled={prixReleve === "" || adding}
                  >
                    <HiCheck /> {adding ? "..." : "Valider"}
                  </button>
                  <button
                    className="btn-cancel-scan"
                    onClick={handleCancelScan}
                  >
                    <HiX />
                  </button>
                </div>
              </div>
            )}
          </section>

          <section className="recap-section">
            <div className="recap-header">
              <h3>Récapitulatif</h3>
              <div className="recap-badges">
                <span className="badge-total">{releve.totalArticles || 0}</span>
                {releve.stats && (
                  <>
                    <span className="badge-good" title="Moins chers">
                      <HiTrendingUp /> {releve.stats.moinsCherChezNous || 0}
                    </span>
                    <span className="badge-bad" title="Plus chers">
                      <HiTrendingDown /> {releve.stats.plusCherChezNous || 0}
                    </span>
                  </>
                )}
              </div>
            </div>

            <div className="lignes-list">
              {releve.lignes?.length === 0 ? (
                <div className="no-lignes">
                  <HiQrcode />
                  <p>Scannez un article</p>
                </div>
              ) : (
                releve.lignes?.map((ligne) => {
                  const diffInfo = getDifferenceInfo(
                    ligne.pvtettc,
                    ligne.prixReleve,
                  );
                  return (
                    <div
                      key={ligne._id}
                      className={`ligne-card ${diffInfo.class}`}
                    >
                      <div className="ligne-left">
                        <span className="ligne-code">{ligne.nart}</span>
                        <span className="ligne-design">
                          {ligne.designation}
                        </span>
                      </div>
                      <div className="ligne-right">
                        <div className="ligne-prices">
                          <span className="prix-nous">
                            {ligne.pvtettc?.toLocaleString()}
                          </span>
                          <span className="prix-sep">→</span>
                          <span className="prix-eux">
                            {ligne.prixReleve?.toLocaleString()}
                          </span>
                        </div>
                        {editingLigne === ligne._id ? (
                          <div className="ligne-edit-mode">
                            <input
                              type="number"
                              value={editPrix}
                              onChange={(e) => setEditPrix(e.target.value)}
                              autoFocus
                            />
                            <button onClick={() => handleSaveEdit(ligne._id)}>
                              <HiCheck />
                            </button>
                            <button onClick={() => setEditingLigne(null)}>
                              <HiX />
                            </button>
                          </div>
                        ) : (
                          <div className="ligne-btns">
                            <button onClick={() => handleEditLigne(ligne)}>
                              <HiPencil />
                            </button>
                            <button
                              onClick={() => handleDeleteLigne(ligne._id)}
                            >
                              <HiTrash />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </section>

          <div className="releve-footer">
            <button
              className="btn-export"
              onClick={openExportModal}
              disabled={!releve.lignes?.length}
            >
              <HiCheckCircle /> Terminer
            </button>
            <button className="btn-annuler" onClick={handleCancelReleve}>
              <HiTrash />
            </button>
          </div>
        </div>
      )}

      {/* ===== MODAL TERMINER ===== */}
      {showExportModal && (
        <div
          className="modal-backdrop"
          onClick={() => setShowExportModal(false)}
        >
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <h2>
              <HiCheckCircle /> Terminer le relevé
            </h2>

            <div className="modal-info">
              <p>
                <strong>{releve.totalArticles}</strong> articles relevés
              </p>
              <p>
                Concurrent : <strong>{releve.concurrent?.nom}</strong>
              </p>
            </div>

            {releve.stats && (
              <div className="modal-stats">
                <div className="stat-row good">
                  <span>Moins chers chez nous</span>
                  <strong>{releve.stats.moinsCherChezNous}</strong>
                </div>
                <div className="stat-row bad">
                  <span>Plus chers chez nous</span>
                  <strong>{releve.stats.plusCherChezNous}</strong>
                </div>
                <div className="stat-row">
                  <span>Même prix</span>
                  <strong>{releve.stats.memePrix}</strong>
                </div>
              </div>
            )}

            <div className="modal-field">
              <label>Nom du relevé</label>
              <input
                type="text"
                value={nomReleve}
                onChange={(e) => setNomReleve(e.target.value)}
                placeholder="Nom..."
              />
            </div>

            {/* ===== BOUTONS D'ACTION ===== */}
            <div className="modal-actions-terminer">
              {/* Bouton principal : Terminer + Télécharger */}
              <button
                className="btn-download-excel"
                onClick={handleDownloadExcel}
                disabled={!nomReleve.trim() || downloading}
              >
                {downloading ? (
                  "Export..."
                ) : (
                  <>
                    <HiDownload /> Terminer + Télécharger Excel
                  </>
                )}
              </button>

              {/* Bouton secondaire : Terminer sans télécharger */}
              <button
                className="btn-terminer-simple"
                onClick={handleTerminerSansTelechargement}
                disabled={!nomReleve.trim() || downloading}
              >
                <HiCheckCircle /> Terminer sans télécharger
              </button>

              {/* Bouton annuler */}
              <button
                className="btn-close"
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

export default ReleveScreen;
