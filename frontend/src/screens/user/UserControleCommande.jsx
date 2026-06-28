import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  HiQrcode,
  HiOfficeBuilding,
  HiTrash,
  HiPencil,
  HiCheck,
  HiX,
  HiDownload,
  HiClipboardCheck,
  HiSearch,
  HiServer,
  HiDesktopComputer,
  HiFolder,
  HiExclamation,
  HiDocumentText,
  HiChevronDown,
  HiChevronUp,
  HiTruck,
  HiCheckCircle,
  HiSwitchHorizontal,
} from "react-icons/hi";
import { useGetMyEntreprisesQuery } from "../../slices/entrepriseApiSlice";
import {
  useGetCommandeByNumcdeQuery,
} from "../../slices/commandeApiSlice";
import {
  useScanArticleMutation,
} from "../../slices/inventaireApiSlice";
import "./UserControleCommande.css";

const UserControleCommande = () => {
  // ==========================================
  // ÉTATS
  // ==========================================
  const [selectedEntreprise, setSelectedEntreprise] = useState("");
  const [selectedEntrepriseData, setSelectedEntrepriseData] = useState(null);

  // Commande
  const [numcdeInput, setNumcdeInput] = useState("");
  const [numcdeLoaded, setNumcdeLoaded] = useState("");
  const [commandeError, setCommandeError] = useState(null);

  // Scan
  const [scanValue, setScanValue] = useState("");
  const [currentArticle, setCurrentArticle] = useState(null);
  const [quantite, setQuantite] = useState("");

  // Lignes contrôlées (local state)
  const [lignesControlees, setLignesControlees] = useState([]);
  const [editingLigne, setEditingLigne] = useState(null);
  const [editQuantite, setEditQuantite] = useState("");

  // Export
  const [showExportModal, setShowExportModal] = useState(false);
  const [nomExport, setNomExport] = useState("");
  const [exportMode, setExportMode] = useState("server");
  const [cheminServeur, setCheminServeur] = useState("");
  const [isExporting, setIsExporting] = useState(false);

  // UI
  const [message, setMessage] = useState(null);
  const [showLignesAttendues, setShowLignesAttendues] = useState(true);

  // Refs
  const scanInputRef = useRef(null);
  const quantiteInputRef = useRef(null);
  const numcdeInputRef = useRef(null);

  // ==========================================
  // QUERIES
  // ==========================================
  const { data: entreprises, isLoading: loadingEntreprises } =
    useGetMyEntreprisesQuery();

  // Charger la commande quand numcdeLoaded est renseigné
  const {
    data: commandeData,
    isLoading: loadingCommande,
    error: commandeFetchError,
    isFetching: fetchingCommande,
  } = useGetCommandeByNumcdeQuery(
    {
      nomDossierDBF: selectedEntrepriseData?.nomDossierDBF,
      numcde: numcdeLoaded,
    },
    {
      skip: !selectedEntrepriseData?.nomDossierDBF || !numcdeLoaded,
    },
  );

  const commande = commandeData?.commande;
  const lignesAttendues = commandeData?.details?.lignes || [];

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

  // Mettre à jour le chemin serveur quand l'entreprise est chargée
  useEffect(() => {
    if (selectedEntrepriseData?.cheminExportInventaire) {
      setCheminServeur(selectedEntrepriseData.cheminExportInventaire);
    }
  }, [selectedEntrepriseData]);

  // Focus sur scan quand commande chargée
  useEffect(() => {
    if (commande && !currentArticle && scanInputRef.current) {
      scanInputRef.current.focus();
    }
  }, [commande, currentArticle]);

  // ==========================================
  // DONNÉES CALCULÉES
  // ==========================================

  // Fusionner lignes attendues avec lignes contrôlées
  const lignesMerged = useMemo(() => {
    if (!lignesAttendues.length) return [];

    return lignesAttendues.map((la) => {
      const nart = (la.NART || "").trim();
      const controlee = lignesControlees.find(
        (lc) => lc.nart === nart,
      );
      return {
        nart,
        design: (la.DESIGN || "").trim(),
        refer: (la.REFER || "").trim(),
        qteAttendue: parseFloat(la.QTE) || 0,
        qteRecue: controlee ? controlee.quantite : 0,
        isControlee: !!controlee,
        ligneId: controlee?.id || null,
      };
    });
  }, [lignesAttendues, lignesControlees]);

  // Articles hors commande (scannés mais pas dans la commande)
  const lignesHorsCommande = useMemo(() => {
    return lignesControlees.filter(
      (lc) => !lignesAttendues.some((la) => (la.NART || "").trim() === lc.nart),
    );
  }, [lignesControlees, lignesAttendues]);

  // Stats
  const stats = useMemo(() => {
    const totalAttendues = lignesAttendues.length;
    const totalControlees = lignesMerged.filter((l) => l.isControlee).length;
    const totalQteRecue = lignesControlees.reduce(
      (sum, l) => sum + l.quantite, 0,
    );
    const totalQteAttendue = lignesAttendues.reduce(
      (sum, l) => sum + (parseFloat(l.QTE) || 0), 0,
    );
    const conformes = lignesMerged.filter(
      (l) => l.isControlee && l.qteRecue === l.qteAttendue,
    ).length;
    const ecarts = lignesMerged.filter(
      (l) => l.isControlee && l.qteRecue !== l.qteAttendue,
    ).length;

    return {
      totalAttendues,
      totalControlees,
      totalQteRecue,
      totalQteAttendue,
      conformes,
      ecarts,
      horsCommande: lignesHorsCommande.length,
      progression: totalAttendues > 0
        ? Math.round((totalControlees / totalAttendues) * 100)
        : 0,
    };
  }, [lignesMerged, lignesControlees, lignesAttendues, lignesHorsCommande]);

  // ==========================================
  // HANDLERS
  // ==========================================

  const showMessage = (text, type = "info") => {
    setMessage({ text, type });
    setTimeout(() => setMessage(null), 4000);
  };

  const safeTrim = (value) => {
    if (value === null || value === undefined) return "";
    if (typeof value === "string") return value.trim();
    return String(value);
  };

  const handleEntrepriseChange = (e) => {
    const entrepriseId = e.target.value;
    setSelectedEntreprise(entrepriseId);
    const ent = entreprises?.find((ent) => ent._id === entrepriseId);
    setSelectedEntrepriseData(ent || null);
    // Reset tout
    resetControle();
  };

  const resetControle = () => {
    setNumcdeInput("");
    setNumcdeLoaded("");
    setCommandeError(null);
    setCurrentArticle(null);
    setScanValue("");
    setQuantite("");
    setLignesControlees([]);
    setEditingLigne(null);
  };

  const handleLoadCommande = (e) => {
    e?.preventDefault();
    if (!numcdeInput.trim()) return;
    setNumcdeLoaded(numcdeInput.trim().toUpperCase());
    setLignesControlees([]);
    setCurrentArticle(null);
    setScanValue("");
    setCommandeError(null);
  };

  const handleScan = (e) => {
    e?.preventDefault();
    if (!scanValue.trim()) return;

    const code = scanValue.trim().toUpperCase();

    // Chercher dans les lignes attendues par NART
    const ligneAttendue = lignesAttendues.find(
      (la) => safeTrim(la.NART).toUpperCase() === code,
    );

    if (ligneAttendue) {
      setCurrentArticle({
        nart: safeTrim(ligneAttendue.NART),
        design: safeTrim(ligneAttendue.DESIGN),
        refer: safeTrim(ligneAttendue.REFER),
        qteAttendue: parseFloat(ligneAttendue.QTE) || 0,
        isInCommande: true,
      });
      // Pré-remplir la quantité attendue
      const existante = lignesControlees.find(
        (lc) => lc.nart === safeTrim(ligneAttendue.NART),
      );
      setQuantite(existante ? existante.quantite.toString() : String(parseFloat(ligneAttendue.QTE) || 1));
    } else {
      // Article pas dans la commande
      setCurrentArticle({
        nart: code,
        design: "Article non prévu dans la commande",
        refer: "",
        qteAttendue: 0,
        isInCommande: false,
      });
      setQuantite("1");
      showMessage(`⚠️ Article ${code} non trouvé dans la commande`, "warning");
    }

    setScanValue("");
    setTimeout(() => quantiteInputRef.current?.focus(), 100);
  };

  const handleAddLigne = (e) => {
    e.preventDefault();
    if (!currentArticle || !quantite || parseInt(quantite) < 0) return;

    const nart = currentArticle.nart;
    const qty = parseInt(quantite);

    setLignesControlees((prev) => {
      const existing = prev.find((l) => l.nart === nart);
      if (existing) {
        return prev.map((l) =>
          l.nart === nart ? { ...l, quantite: qty } : l,
        );
      }
      return [
        {
          id: Date.now().toString(),
          nart,
          design: currentArticle.design,
          quantite: qty,
          isInCommande: currentArticle.isInCommande,
        },
        ...prev,
      ];
    });

    const qteAttendue = currentArticle.qteAttendue;
    if (currentArticle.isInCommande && qty !== qteAttendue) {
      showMessage(
        `⚠️ Écart: attendu ${qteAttendue}, reçu ${qty}`,
        "warning",
      );
    } else if (currentArticle.isInCommande) {
      showMessage("✅ Article conforme", "success");
    } else {
      showMessage(`📦 Article hors commande ajouté (qté: ${qty})`, "warning");
    }

    setCurrentArticle(null);
    setQuantite("");
    setTimeout(() => scanInputRef.current?.focus(), 100);
  };

  const handleCancelScan = () => {
    setCurrentArticle(null);
    setQuantite("");
    setScanValue("");
    setTimeout(() => scanInputRef.current?.focus(), 100);
  };

  const handleEditLigne = (ligne) => {
    setEditingLigne(ligne.id || ligne.nart);
    setEditQuantite(ligne.quantite.toString());
  };

  const handleSaveEdit = (ligneKey) => {
    if (!editQuantite || parseInt(editQuantite) < 0) return;
    setLignesControlees((prev) =>
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
    setLignesControlees((prev) =>
      prev.filter((l) => l.id !== ligneKey && l.nart !== ligneKey),
    );
  };

  // ==========================================
  // EXPORT .DAT (même format que réappro: NART|QTE)
  // ==========================================

  const generateDatContent = () => {
    // Format identique au réappro: NART|QTE
    const lines = lignesControlees.map(
      (l) => `${l.nart}|${l.quantite}`,
    );
    return lines.join("\n");
  };

  const openExportModal = () => {
    if (lignesControlees.length === 0) {
      showMessage("Aucune ligne contrôlée à exporter", "error");
      return;
    }
    const nom = window.prompt(
      "Nom du contrôle:",
      `CTRL_${numcdeLoaded}`,
    );
    if (nom === null) return;
    if (!nom.trim()) {
      showMessage("Veuillez saisir un nom", "error");
      return;
    }
    setNomExport(nom.trim());
    setShowExportModal(true);
    setExportMode("server");
    setCheminServeur(
      selectedEntrepriseData?.cheminExportInventaire ||
        "\\\\192.168.0.250\\Rcommun\\STOCK\\collect_sec",
    );
  };

  const handleEditChemin = () => {
    const chemin = window.prompt("Chemin de destination:", cheminServeur);
    if (chemin !== null) {
      setCheminServeur(chemin);
    }
  };

  const handleExport = async () => {
    if (!nomExport.trim()) {
      showMessage("Veuillez saisir un nom pour le contrôle", "error");
      return;
    }

    setIsExporting(true);

    try {
      const contenu = generateDatContent();
      const nomFichier = `stock.dat ctrl ${nomExport.trim().replace(/[^a-zA-Z0-9_\- ]/g, "_")}`;

      if (exportMode === "download") {
        // Téléchargement via le navigateur (identique au réappro)
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
        // Export serveur via API (identique au réappro)
        const response = await fetch("/api/controle-commande/export", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            nomExport: nomExport.trim(),
            cheminDestination: cheminServeur.trim(),
            contenu,
            numcde: numcdeLoaded,
            entrepriseId: selectedEntreprise,
            lignes: lignesControlees,
            stats: {
              totalControlees: stats.totalControlees,
              totalAttendues: stats.totalAttendues,
              conformes: stats.conformes,
              ecarts: stats.ecarts,
              horsCommande: stats.horsCommande,
            },
          }),
        });

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          throw new Error(errData.message || "Erreur d'export serveur");
        }

        const result = await response.json();
        showMessage(`Fichier enregistré: ${result.fichier?.chemin || nomFichier}`, "success");
      }

      setShowExportModal(false);
      setNomExport("");
    } catch (err) {
      showMessage(
        err?.message || "Erreur d'export",
        "error",
      );
    } finally {
      setIsExporting(false);
    }
  };

  // ==========================================
  // RENDER
  // ==========================================

  if (loadingEntreprises) {
    return (
      <div className="ctrl-cmd-loading">
        <div className="loading-spinner"></div>
        <p>Chargement...</p>
      </div>
    );
  }

  if (!entreprises || entreprises.length === 0) {
    return (
      <div className="ctrl-cmd-empty">
        <HiOfficeBuilding />
        <p>Vous n'avez accès à aucune entreprise</p>
      </div>
    );
  }

  return (
    <div className="ctrl-cmd-screen">
      {/* Header */}
      <div className="ctrl-cmd-header">
        <h1>
          <HiClipboardCheck /> Contrôle Commande
        </h1>
        <div className="entreprise-selector">
          <HiOfficeBuilding />
          <select
            value={selectedEntreprise}
            onChange={handleEntrepriseChange}
            disabled={!!commande}
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
        <div className={`ctrl-cmd-message ${message.type}`}>
          {message.text}
        </div>
      )}

      {/* Sélection entreprise */}
      {!selectedEntreprise ? (
        <div className="ctrl-cmd-placeholder">
          <HiOfficeBuilding />
          <p>Sélectionnez une entreprise pour démarrer</p>
        </div>
      ) : !commande ? (
        /* Saisie du NUMCDE */
        <div className="ctrl-cmd-numcde-section">
          <div className="numcde-card">
            <HiDocumentText className="numcde-icon" />
            <h2>Entrer le numéro de commande</h2>
            <form className="numcde-form" onSubmit={handleLoadCommande}>
              <div className="numcde-input-wrapper">
                <HiSearch />
                <input
                  ref={numcdeInputRef}
                  type="text"
                  placeholder="Saisir le NUMCDE..."
                  value={numcdeInput}
                  onChange={(e) =>
                    setNumcdeInput(e.target.value.toUpperCase())
                  }
                  autoFocus
                />
              </div>
              <button
                type="submit"
                disabled={!numcdeInput.trim() || loadingCommande || fetchingCommande}
              >
                {loadingCommande || fetchingCommande ? "..." : "Charger"}
              </button>
            </form>
            {commandeFetchError && (
              <div className="numcde-error">
                <HiExclamation />
                {commandeFetchError?.data?.message ||
                  "Commande introuvable"}
              </div>
            )}
            {loadingCommande && (
              <div className="numcde-loading">
                <div className="loading-spinner small"></div>
                <span>Chargement de la commande...</span>
              </div>
            )}
          </div>
        </div>
      ) : (
        /* Mode contrôle actif */
        <div className="ctrl-cmd-content">
          {/* Bandeau commande chargée */}
          <div className="commande-banner">
            <div className="banner-info">
              <div className="banner-numcde">
                <HiTruck />
                <span className="numcde-label">Commande</span>
                <span className="numcde-value">{safeTrim(commande.NUMCDE)}</span>
              </div>
              <div className="banner-meta">
                <span>Fourn: <strong>{commande.FOURN || "-"}</strong></span>
                <span>Lignes: <strong>{lignesAttendues.length}</strong></span>
                {safeTrim(commande.BATEAU) && (
                  <span>Bateau: <strong>{safeTrim(commande.BATEAU)}</strong></span>
                )}
              </div>
            </div>
            <button
              className="btn-change-cmd"
              onClick={resetControle}
              title="Changer de commande"
            >
              <HiSwitchHorizontal />
              <span>Changer</span>
            </button>
          </div>

          {/* Barre de progression */}
          <div className="progression-bar">
            <div className="progression-stats">
              <span className="stat-prog">
                <strong>{stats.totalControlees}</strong>/{stats.totalAttendues} lignes
              </span>
              <span className="stat-conformes">✅ {stats.conformes} conformes</span>
              {stats.ecarts > 0 && (
                <span className="stat-ecarts">⚠️ {stats.ecarts} écarts</span>
              )}
              {stats.horsCommande > 0 && (
                <span className="stat-hors">📦 {stats.horsCommande} hors cmd</span>
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
            {!currentArticle ? (
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
            ) : (
              <div className="article-scanned">
                <div
                  className={`article-info ${!currentArticle.isInCommande ? "hors-commande" : ""}`}
                >
                  {!currentArticle.isInCommande && (
                    <div className="article-hors-banner">
                      <HiExclamation /> ARTICLE HORS COMMANDE
                    </div>
                  )}
                  <div className="article-code">{currentArticle.nart}</div>
                  <div className="article-designation">
                    {currentArticle.design}
                  </div>
                  {currentArticle.isInCommande && (
                    <div className="article-attendu">
                      Qté attendue: <strong>{currentArticle.qteAttendue}</strong>
                    </div>
                  )}
                </div>

                <form className="quantite-form" onSubmit={handleAddLigne}>
                  <label>Qté reçue:</label>
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
                      onChange={(e) =>
                        setQuantite(e.target.value.replace(/[^0-9]/g, ""))
                      }
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
                      disabled={!quantite}
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

          {/* Lignes attendues (toggle) */}
          <div className="lignes-attendues-section">
            <button
              className="section-toggle"
              onClick={() => setShowLignesAttendues(!showLignesAttendues)}
            >
              <HiDocumentText />
              <span>
                Lignes de la commande ({lignesAttendues.length})
              </span>
              {showLignesAttendues ? <HiChevronUp /> : <HiChevronDown />}
            </button>

            {showLignesAttendues && (
              <div className="lignes-attendues-list">
                {lignesMerged.map((ligne, i) => {
                  const isConforme =
                    ligne.isControlee && ligne.qteRecue === ligne.qteAttendue;
                  const hasEcart =
                    ligne.isControlee && ligne.qteRecue !== ligne.qteAttendue;

                  return (
                    <div
                      key={`${ligne.nart}-${i}`}
                      className={`ligne-attendue ${
                        isConforme
                          ? "conforme"
                          : hasEcart
                            ? "ecart"
                            : ligne.isControlee
                              ? "controlee"
                              : ""
                      }`}
                    >
                      <div className="la-status">
                        {isConforme ? (
                          <HiCheckCircle className="status-ok" />
                        ) : hasEcart ? (
                          <HiExclamation className="status-ecart" />
                        ) : (
                          <span className="status-empty"></span>
                        )}
                      </div>
                      <div className="la-info">
                        <span className="la-nart">{ligne.nart}</span>
                        <span className="la-design">{ligne.design}</span>
                      </div>
                      <div className="la-qtes">
                        <span className="la-attendue">{ligne.qteAttendue}</span>
                        <span className="la-separator">→</span>
                        <span
                          className={`la-recue ${
                            isConforme ? "ok" : hasEcart ? "ko" : "pending"
                          }`}
                        >
                          {ligne.isControlee ? ligne.qteRecue : "-"}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Récap lignes contrôlées */}
          <div className="recap-section">
            <div className="recap-header">
              <h2>Lignes contrôlées</h2>
              <div className="recap-stats">
                <span>{lignesControlees.length} art.</span>
                <span>
                  {lignesControlees.reduce((s, l) => s + l.quantite, 0)} unités
                </span>
              </div>
            </div>

            <div className="lignes-list">
              {lignesControlees.length === 0 ? (
                <div className="no-lignes">
                  Scannez des articles pour commencer le contrôle
                </div>
              ) : (
                lignesControlees.map((ligne) => {
                  const attendue = lignesMerged.find(
                    (l) => l.nart === ligne.nart,
                  );
                  const isConforme =
                    attendue && ligne.quantite === attendue.qteAttendue;
                  const hasEcart =
                    attendue && ligne.quantite !== attendue.qteAttendue;

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
                            <span className="ligne-hors-badge" title="Hors commande">
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
                        {attendue && (
                          <div className="ligne-compare">
                            <small>
                              Attendu: {attendue.qteAttendue} → Reçu:{" "}
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
                                Math.max(0, parseInt(prev || 0) - 1).toString(),
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
                          <button className="edit-btn" onClick={() => handleEditLigne(ligne)}>
                            <HiPencil />
                          </button>
                          <button
                            className="delete-btn"
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

            {/* Actions - même style que réappro */}
            <div className="reappro-actions">
              <button
                className="btn-export"
                onClick={openExportModal}
                disabled={lignesControlees.length === 0}
              >
                <HiDownload /> Terminer
              </button>
              <button className="btn-cancel-reappro" onClick={resetControle}>
                <HiTrash /> Annuler
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========== MODAL EXPORT - IDENTIQUE AU RÉAPPRO ========== */}
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
              <HiDownload /> Terminer le contrôle
            </h2>
            <p className="modal-stats">
              Commande {numcdeLoaded} — {lignesControlees.length} articles —{" "}
              {lignesControlees.reduce((s, l) => s + l.quantite, 0)} unités
            </p>

            {/* Nom du contrôle - affichage seulement */}
            <div className="modal-info-row">
              <label>Nom:</label>
              <span className="modal-value">{nomExport}</span>
              <button
                type="button"
                className="btn-edit-small"
                onClick={() => {
                  const nom = window.prompt("Nom du contrôle:", nomExport);
                  if (nom !== null && nom.trim()) setNomExport(nom.trim());
                }}
              >
                <HiPencil />
              </button>
            </div>

            {/* Choix du mode d'export - identique au réappro */}
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

            {/* Actions - identique au réappro */}
            <div className="modal-actions">
              <button
                className="btn-confirm"
                onClick={handleExport}
                disabled={
                  !nomExport.trim() ||
                  (exportMode === "server" && !cheminServeur.trim()) ||
                  isExporting
                }
              >
                {isExporting ? (
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

export default UserControleCommande;