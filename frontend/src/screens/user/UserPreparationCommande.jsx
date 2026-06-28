// src/screens/user/UserPreparationCommande.jsx
import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  HiQrcode,
  HiOfficeBuilding,
  HiTrash,
  HiPencil,
  HiCheck,
  HiX,
  HiDownload,
  HiShoppingCart,
  HiServer,
  HiDesktopComputer,
  HiFolder,
  HiExclamation,
  HiDocumentText,
  HiChevronDown,
  HiChevronUp,
  HiTruck,
  HiCheckCircle,
  HiClock,
} from "react-icons/hi";
import { useGetMyEntreprisesQuery } from "../../slices/entrepriseApiSlice";
import {
  useGetCommandesQuery,
  useGetCommandeByNumcdeQuery,
} from "../../slices/commandeApiSlice";
import "./UserPreparationCommande.css";

const UserPreparationCommande = () => {
  // ==========================================
  // ÉTATS
  // ==========================================
  const [selectedEntreprise, setSelectedEntreprise] = useState("");
  const [selectedEntrepriseData, setSelectedEntrepriseData] = useState(null);

  // Commande
  const [selectedNumcde, setSelectedNumcde] = useState("");
  const [numcdeLoaded, setNumcdeLoaded] = useState("");

  // Scan
  const [scanValue, setScanValue] = useState("");

  // Lignes préparées (local state) — { nart, design, quantite, isInCommande }
  const [lignesPreparees, setLignesPreparees] = useState([]);
  const [editingLigne, setEditingLigne] = useState(null);
  const [editQuantite, setEditQuantite] = useState("");

  // Export
  const [showExportModal, setShowExportModal] = useState(false);
  const [nomExport, setNomExport] = useState("");
  const [exportMode, setExportMode] = useState("download");
  const [cheminServeur, setCheminServeur] = useState("");

  // UI
  const [message, setMessage] = useState(null);
  const [showLignesRestantes, setShowLignesRestantes] = useState(true);

  // Refs
  const scanInputRef = useRef(null);

  // ==========================================
  // QUERIES
  // ==========================================
  const { data: entreprises, isLoading: loadingEntreprises } =
    useGetMyEntreprisesQuery();

  // Charger les commandes ETAT=1 (à préparer)
  const {
    data: commandesData,
    isLoading: loadingCommandes,
  } = useGetCommandesQuery(
    {
      nomDossierDBF: selectedEntrepriseData?.nomDossierDBF,
      page: 1,
      limit: 200,
      etat: 1,
    },
    {
      skip: !selectedEntrepriseData?.nomDossierDBF,
    },
  );

  const commandesAP = commandesData?.commandes || [];

  // Charger le détail de la commande sélectionnée
  const {
    data: commandeDetailData,
    isLoading: loadingDetail,
    isFetching: fetchingDetail,
  } = useGetCommandeByNumcdeQuery(
    {
      nomDossierDBF: selectedEntrepriseData?.nomDossierDBF,
      numcde: numcdeLoaded,
    },
    {
      skip: !selectedEntrepriseData?.nomDossierDBF || !numcdeLoaded,
    },
  );

  const commande = commandeDetailData?.commande;
  const lignesCommande = commandeDetailData?.details?.lignes || [];

  // ==========================================
  // EFFETS
  // ==========================================

  // Auto-select si une seule entreprise
  useEffect(() => {
    if (entreprises?.length === 1) {
      setSelectedEntreprise(entreprises[0]._id);
      setSelectedEntrepriseData(entreprises[0]);
    }
  }, [entreprises]);

  // Chemin serveur
  useEffect(() => {
    if (selectedEntrepriseData?.cheminExportInventaire) {
      setCheminServeur(selectedEntrepriseData.cheminExportInventaire);
    }
  }, [selectedEntrepriseData]);

  // Focus scan quand commande chargée
  useEffect(() => {
    if (commande && scanInputRef.current) {
      scanInputRef.current.focus();
    }
  }, [commande]);

  // ==========================================
  // DONNÉES CALCULÉES
  // ==========================================

  const safeTrim = (value) => {
    if (value === null || value === undefined) return "";
    if (typeof value === "string") return value.trim();
    return String(value);
  };

  // Fusionner lignes commande avec lignes préparées
  const lignesMerged = useMemo(() => {
    if (!lignesCommande.length) return [];

    return lignesCommande.map((lc) => {
      const nart = safeTrim(lc.NART);
      const preparee = lignesPreparees.find((lp) => lp.nart === nart);
      return {
        nart,
        design: safeTrim(lc.DESIGN),
        refer: safeTrim(lc.REFER),
        qteAttendue: parseFloat(lc.QTE) || 0,
        qtePreparee: preparee ? preparee.quantite : 0,
        isPreparee: !!preparee,
        ligneId: preparee?.id || null,
      };
    });
  }, [lignesCommande, lignesPreparees]);

  // Lignes hors commande
  const lignesHorsCommande = useMemo(() => {
    return lignesPreparees.filter(
      (lp) =>
        !lignesCommande.some((lc) => safeTrim(lc.NART) === lp.nart),
    );
  }, [lignesPreparees, lignesCommande]);

  // Lignes restantes (non encore préparées)
  const lignesRestantes = useMemo(() => {
    return lignesMerged.filter((l) => !l.isPreparee);
  }, [lignesMerged]);

  // Stats
  const stats = useMemo(() => {
    const totalLignes = lignesCommande.length;
    const totalPreparees = lignesMerged.filter((l) => l.isPreparee).length;
    const totalQtePreparee = lignesPreparees.reduce(
      (sum, l) => sum + l.quantite,
      0,
    );
    const conformes = lignesMerged.filter(
      (l) => l.isPreparee && l.qtePreparee === l.qteAttendue,
    ).length;
    const ecarts = lignesMerged.filter(
      (l) => l.isPreparee && l.qtePreparee !== l.qteAttendue,
    ).length;

    return {
      totalLignes,
      totalPreparees,
      totalQtePreparee,
      conformes,
      ecarts,
      horsCommande: lignesHorsCommande.length,
      progression:
        totalLignes > 0
          ? Math.round((totalPreparees / totalLignes) * 100)
          : 0,
    };
  }, [lignesMerged, lignesPreparees, lignesCommande, lignesHorsCommande]);

  // ==========================================
  // HANDLERS
  // ==========================================

  const showMsg = (text, type = "info") => {
    setMessage({ text, type });
    setTimeout(() => setMessage(null), 4000);
  };

  const handleEntrepriseChange = (e) => {
    const entrepriseId = e.target.value;
    setSelectedEntreprise(entrepriseId);
    const ent = entreprises?.find((en) => en._id === entrepriseId);
    setSelectedEntrepriseData(ent || null);
    resetPreparation();
  };

  const resetPreparation = () => {
    setSelectedNumcde("");
    setNumcdeLoaded("");
    setLignesPreparees([]);
    setScanValue("");
    setEditingLigne(null);
  };

  const handleSelectCommande = (e) => {
    const numcde = e.target.value;
    setSelectedNumcde(numcde);
    if (numcde) {
      setNumcdeLoaded(numcde);
      setLignesPreparees([]);
      setScanValue("");
    }
  };

  // SCAN — coche la ligne avec qté attendue
  const handleScan = (e) => {
    e?.preventDefault();
    if (!scanValue.trim()) return;

    const code = scanValue.trim().toUpperCase();
    setScanValue("");

    // Vérifier si déjà préparé
    const dejaPreparee = lignesPreparees.find((lp) => lp.nart === code);
    if (dejaPreparee) {
      showMsg(`ℹ️ ${code} déjà préparé (qté: ${dejaPreparee.quantite})`, "warning");
      setTimeout(() => scanInputRef.current?.focus(), 100);
      return;
    }

    // Chercher dans les lignes commande
    const ligneAttendue = lignesCommande.find(
      (lc) => safeTrim(lc.NART).toUpperCase() === code,
    );

    if (ligneAttendue) {
      const nart = safeTrim(ligneAttendue.NART);
      const qte = parseFloat(ligneAttendue.QTE) || 0;
      const design = safeTrim(ligneAttendue.DESIGN);

      setLignesPreparees((prev) => [
        {
          id: Date.now().toString(),
          nart,
          design,
          quantite: qte,
          isInCommande: true,
        },
        ...prev,
      ]);

      showMsg(`✅ ${nart} — ${design} (qté: ${qte})`, "success");
    } else {
      // Article pas dans la commande
      setLignesPreparees((prev) => [
        {
          id: Date.now().toString(),
          nart: code,
          design: "Article hors commande",
          quantite: 1,
          isInCommande: false,
        },
        ...prev,
      ]);
      showMsg(`⚠️ ${code} non trouvé dans la commande`, "warning");
    }

    setTimeout(() => scanInputRef.current?.focus(), 100);
  };

  // Édition quantité
  const handleEditLigne = (ligne) => {
    setEditingLigne(ligne.id || ligne.nart);
    setEditQuantite(ligne.quantite.toString());
  };

  const handleSaveEdit = (ligneKey) => {
    if (!editQuantite || parseInt(editQuantite) < 0) return;
    setLignesPreparees((prev) =>
      prev.map((l) =>
        (l.id === ligneKey || l.nart === ligneKey)
          ? { ...l, quantite: parseInt(editQuantite) }
          : l,
      ),
    );
    setEditingLigne(null);
    setEditQuantite("");
  };

  const handleDeleteLigne = (ligneKey) => {
    setLignesPreparees((prev) =>
      prev.filter((l) => l.id !== ligneKey && l.nart !== ligneKey),
    );
  };

  // ==========================================
  // EXPORT .DAT
  // ==========================================

  const generateDatContent = () => {
    return lignesPreparees.map((l) => `${l.nart};${l.quantite}`).join("\n");
  };

  const openExportModal = () => {
    if (lignesPreparees.length === 0) {
      showMsg("Aucune ligne préparée à exporter", "error");
      return;
    }
    const nom = window.prompt("Nom de la préparation:", `PREPA_${numcdeLoaded}`);
    if (nom === null) return;
    if (!nom.trim()) {
      showMsg("Veuillez saisir un nom", "error");
      return;
    }
    setNomExport(nom.trim());
    setShowExportModal(true);
    setExportMode("download");
  };

  const handleExport = () => {
    const contenu = generateDatContent();
    const nomFichier = `stock.dat prepa ${nomExport.replace(/[^a-zA-Z0-9_\- ]/g, "_")}`;

    if (exportMode === "download") {
      const blob = new Blob([contenu], { type: "text/plain;charset=utf-8" });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = nomFichier;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      showMsg(`Fichier téléchargé: ${nomFichier}`, "success");
    }

    setShowExportModal(false);
    setNomExport("");
  };

  // ==========================================
  // RENDER
  // ==========================================

  if (loadingEntreprises) {
    return (
      <div className="prep-cmd-loading">
        <div className="loading-spinner"></div>
        <p>Chargement...</p>
      </div>
    );
  }

  if (!entreprises || entreprises.length === 0) {
    return (
      <div className="prep-cmd-empty">
        <HiOfficeBuilding />
        <p>Vous n'avez accès à aucune entreprise</p>
      </div>
    );
  }

  return (
    <div className="prep-cmd-screen">
      {/* Header */}
      <div className="prep-cmd-header">
        <h1>
          <HiShoppingCart /> Préparation Commande
        </h1>
        <div className="entreprise-selector">
          <HiOfficeBuilding />
          <select
            value={selectedEntreprise}
            onChange={handleEntrepriseChange}
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
        <div className={`prep-cmd-message ${message.type}`}>
          {message.text}
        </div>
      )}

      {/* Pas d'entreprise */}
      {!selectedEntreprise ? (
        <div className="prep-cmd-placeholder">
          <HiOfficeBuilding />
          <p>Sélectionnez une entreprise pour démarrer</p>
        </div>
      ) : !numcdeLoaded || !commande ? (
        /* Sélection de la commande */
        <div className="prep-cmd-select-section">
          <div className="select-card">
            <HiShoppingCart className="select-icon" />
            <h2>Choisir une commande à préparer</h2>
            <p className="select-hint">
              Seules les commandes <strong>en cours</strong> (état 1) sont
              affichées
            </p>

            {loadingCommandes ? (
              <div className="select-loading">
                <div className="loading-spinner small"></div>
                <span>Chargement des commandes...</span>
              </div>
            ) : commandesAP.length === 0 ? (
              <div className="select-empty">
                <HiExclamation />
                <span>Aucune commande à préparer</span>
              </div>
            ) : (
              <div className="select-dropdown-wrapper">
                <HiDocumentText />
                <select
                  value={selectedNumcde}
                  onChange={handleSelectCommande}
                  className="select-commande"
                >
                  <option value="">
                    -- {commandesAP.length} commande
                    {commandesAP.length > 1 ? "s" : ""} disponible
                    {commandesAP.length > 1 ? "s" : ""} --
                  </option>
                  {commandesAP.map((cmd) => (
                    <option key={safeTrim(cmd.NUMCDE)} value={safeTrim(cmd.NUMCDE)}>
                      {safeTrim(cmd.NUMCDE)} — Fourn: {cmd.FOURN || "?"} —{" "}
                      {cmd.COMPTLIG || 0} lignes
                      {safeTrim(cmd.BATEAU)
                        ? ` — ${safeTrim(cmd.BATEAU)}`
                        : ""}
                    </option>
                  ))}
                </select>
                <HiChevronDown className="select-arrow" />
              </div>
            )}

            {(loadingDetail || fetchingDetail) && (
              <div className="select-loading">
                <div className="loading-spinner small"></div>
                <span>Chargement du détail...</span>
              </div>
            )}
          </div>
        </div>
      ) : (
        /* Mode préparation actif */
        <div className="prep-cmd-content">
          {/* Bandeau commande */}
          <div className="commande-banner prep">
            <div className="banner-info">
              <div className="banner-numcde">
                <HiTruck />
                <span className="numcde-label">Commande</span>
                <span className="numcde-value">
                  {safeTrim(commande.NUMCDE)}
                </span>
              </div>
              <div className="banner-meta">
                <span>
                  Fourn: <strong>{commande.FOURN || "-"}</strong>
                </span>
                <span>
                  Lignes: <strong>{lignesCommande.length}</strong>
                </span>
                {safeTrim(commande.BATEAU) && (
                  <span>
                    Bateau: <strong>{safeTrim(commande.BATEAU)}</strong>
                  </span>
                )}
              </div>
            </div>
            <button
              className="btn-change-cmd"
              onClick={resetPreparation}
              title="Changer de commande"
            >
              <HiX />
              <span>Changer</span>
            </button>
          </div>

          {/* Progression */}
          <div className="progression-bar">
            <div className="progression-stats">
              <span className="stat-prog">
                <strong>{stats.totalPreparees}</strong>/{stats.totalLignes}{" "}
                lignes
              </span>
              <span className="stat-conformes">
                ✅ {stats.conformes}
              </span>
              {stats.ecarts > 0 && (
                <span className="stat-ecarts">⚠️ {stats.ecarts}</span>
              )}
              {stats.horsCommande > 0 && (
                <span className="stat-hors">📦 {stats.horsCommande}</span>
              )}
            </div>
            <div className="progression-track">
              <div
                className="progression-fill"
                style={{ width: `${stats.progression}%` }}
              ></div>
            </div>
            <span className="progression-pct">{stats.progression}%</span>
          </div>

          {/* Zone de scan */}
          <div className="scan-section">
            <h2>Scanner un article</h2>
            <form className="scan-form" onSubmit={handleScan}>
              <div className="scan-input-wrapper">
                <HiQrcode />
                <input
                  ref={scanInputRef}
                  type="text"
                  placeholder="Scannez ou saisissez un code article..."
                  value={scanValue}
                  onChange={(e) => setScanValue(e.target.value)}
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck="false"
                />
              </div>
              <button type="submit" disabled={!scanValue.trim()}>
                OK
              </button>
            </form>
          </div>

          {/* Lignes restantes à préparer */}
          <div className="lignes-restantes-section">
            <button
              className="section-toggle"
              onClick={() => setShowLignesRestantes(!showLignesRestantes)}
            >
              <HiClock />
              <span>
                Restantes à préparer ({lignesRestantes.length})
              </span>
              {showLignesRestantes ? <HiChevronUp /> : <HiChevronDown />}
            </button>

            {showLignesRestantes && (
              <div className="lignes-restantes-list">
                {lignesRestantes.length === 0 ? (
                  <div className="all-done">
                    <HiCheckCircle />
                    <span>Toutes les lignes sont préparées !</span>
                  </div>
                ) : (
                  lignesRestantes.map((ligne, i) => (
                    <div key={`${ligne.nart}-${i}`} className="ligne-restante">
                      <div className="lr-info">
                        <span className="lr-nart">{ligne.nart}</span>
                        <span className="lr-design">{ligne.design}</span>
                      </div>
                      <div className="lr-qte">
                        <span>{ligne.qteAttendue}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>

          {/* Récap lignes préparées */}
          <div className="recap-section">
            <div className="recap-header">
              <h2>Lignes préparées</h2>
              <div className="recap-stats">
                <span>{lignesPreparees.length} art.</span>
                <span>{stats.totalQtePreparee} unités</span>
              </div>
            </div>

            <div className="lignes-list">
              {lignesPreparees.length === 0 ? (
                <div className="no-lignes">
                  Scannez des articles pour préparer la commande
                </div>
              ) : (
                lignesPreparees.map((ligne) => {
                  const attendue = lignesMerged.find(
                    (l) => l.nart === ligne.nart,
                  );
                  const isConforme =
                    attendue &&
                    ligne.quantite === attendue.qteAttendue;
                  const hasEcart =
                    attendue &&
                    ligne.quantite !== attendue.qteAttendue;

                  return (
                    <div
                      key={ligne.id || ligne.nart}
                      className={`ligne-item ${
                        !ligne.isInCommande
                          ? "hors-commande"
                          : isConforme
                            ? "conforme"
                            : hasEcart
                              ? "ecart"
                              : ""
                      }`}
                    >
                      <div className="ligne-info">
                        <div className="ligne-main">
                          {!ligne.isInCommande && (
                            <span
                              className="ligne-hors-badge"
                              title="Hors commande"
                            >
                              <HiExclamation />
                            </span>
                          )}
                          {isConforme && (
                            <span className="ligne-ok-badge" title="Conforme">
                              <HiCheckCircle />
                            </span>
                          )}
                          {hasEcart && (
                            <span className="ligne-ecart-badge" title="Écart">
                              <HiExclamation />
                            </span>
                          )}
                          <span className="ligne-code">{ligne.nart}</span>
                          <span className="ligne-design">{ligne.design}</span>
                        </div>
                        {attendue && hasEcart && (
                          <div className="ligne-compare">
                            <small>
                              Attendu: {attendue.qteAttendue} → Préparé:{" "}
                              {ligne.quantite}
                            </small>
                          </div>
                        )}
                      </div>

                      {editingLigne === (ligne.id || ligne.nart) ? (
                        <div className="ligne-edit">
                          <button
                            type="button"
                            className="edit-btn"
                            onClick={() =>
                              setEditQuantite((prev) =>
                                Math.max(
                                  0,
                                  parseInt(prev || 0) - 1,
                                ).toString(),
                              )
                            }
                          >
                            −
                          </button>
                          <input
                            type="text"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            value={editQuantite}
                            onChange={(e) =>
                              setEditQuantite(
                                e.target.value.replace(/[^0-9]/g, ""),
                              )
                            }
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
                          <button
                            onClick={() =>
                              handleSaveEdit(ligne.id || ligne.nart)
                            }
                          >
                            <HiCheck />
                          </button>
                          <button onClick={() => setEditingLigne(null)}>
                            <HiX />
                          </button>
                        </div>
                      ) : (
                        <div className="ligne-actions">
                          <span className="ligne-quantite">
                            {ligne.quantite}
                          </span>
                          <button onClick={() => handleEditLigne(ligne)}>
                            <HiPencil />
                          </button>
                          <button
                            onClick={() =>
                              handleDeleteLigne(ligne.id || ligne.nart)
                            }
                          >
                            <HiTrash />
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* Actions */}
            <div className="inventaire-actions">
              <button
                className="btn-export"
                onClick={openExportModal}
                disabled={lignesPreparees.length === 0}
              >
                <HiDownload /> Terminer
              </button>
              <button className="btn-cancel-inv" onClick={resetPreparation}>
                <HiTrash /> Réinitialiser
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Export */}
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
              <HiDownload /> Exporter la préparation
            </h2>
            <p className="modal-stats">
              Commande {numcdeLoaded} — {lignesPreparees.length} articles —{" "}
              {stats.conformes} conformes, {stats.ecarts} écarts
            </p>

            {/* Nom */}
            <div className="modal-info-row">
              <label>Nom:</label>
              <span className="modal-value">{nomExport}</span>
              <button
                type="button"
                className="btn-edit-small"
                onClick={() => {
                  const nom = window.prompt("Nom:", nomExport);
                  if (nom !== null && nom.trim()) setNomExport(nom.trim());
                }}
              >
                <HiPencil />
              </button>
            </div>

            {/* Mode export */}
            <div className="export-mode-selector">
              <label>Destination:</label>
              <div className="export-mode-options">
                <button
                  type="button"
                  className={`export-mode-btn ${exportMode === "download" ? "active" : ""}`}
                  onClick={() => setExportMode("download")}
                >
                  <HiDesktopComputer />
                  <span>Mon poste</span>
                </button>
                <button
                  type="button"
                  className={`export-mode-btn ${exportMode === "server" ? "active" : ""}`}
                  onClick={() => setExportMode("server")}
                >
                  <HiServer />
                  <span>Serveur</span>
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
                  onClick={() => {
                    const chemin = window.prompt("Chemin:", cheminServeur);
                    if (chemin !== null) setCheminServeur(chemin);
                  }}
                >
                  <HiPencil />
                </button>
              </div>
            )}

            {exportMode === "download" && (
              <div className="export-info">
                <small>
                  ℹ️ Le fichier sera téléchargé au format NART;QTE
                </small>
              </div>
            )}

            <div className="modal-actions">
              <button className="btn-confirm" onClick={handleExport}>
                <HiDownload /> Télécharger
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

export default UserPreparationCommande;