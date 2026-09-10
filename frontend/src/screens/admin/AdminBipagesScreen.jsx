// src/screens/admin/AdminBipagesScreen.jsx
import React, { useState, useEffect, useRef } from "react";
import {
  HiClipboardList,
  HiDownload,
  HiDocumentReport,
  HiTable,
  HiRefresh,
  HiSearch,
  HiTrash,
  HiInformationCircle,
  HiPencilAlt,
  HiPlusCircle,
  HiPlus,
  HiX,
} from "react-icons/hi";
import {
  useGetBipagesQuery,
  useUpdateBipageMutation,
  useAjouterLigneBipageMutation,
  useRecommencerZoneMutation,
  getBipagesCsvUrl,
} from "../../slices/bipageApiSlice";
import { useSelector } from "react-redux";
import { selectGlobalEntrepriseId } from "../../slices/entrepriseGlobalSlice";
import { BASE_URL } from "../../constants";
import "./AdminBipagesScreen.css";

/**
 * Trois points animés, affichés le temps que le serveur re-résolve un article
 * après un changement de NART. Sans ça, l'ancienne désignation reste à l'écran
 * pendant l'aller-retour et on croit que la saisie n'a rien fait.
 */
const PointsChargement = () => (
  <span className="cell-loading" aria-label="Recherche de l'article…">
    <i />
    <i />
    <i />
  </span>
);

/**
 * Texte d'infobulle d'une ligne corrigée : ce qui a changé, et par qui.
 * Les valeurs d'origine sont figées à la PREMIÈRE correction côté serveur, donc
 * ce résumé compare toujours à ce que l'agent avait réellement compté, même
 * après plusieurs passes de correction.
 */
const resumeCorrection = (l) => {
  const bouts = [];
  if (l.nartOrigine != null && l.nartOrigine !== l.nart) {
    bouts.push(`NART ${l.nartOrigine || "(vide)"} → ${l.nart || "(vide)"}`);
  }
  if (l.qteScanOrigine != null && Number(l.qteScanOrigine) !== Number(l.qteScan)) {
    bouts.push(`Qté ${l.qteScanOrigine} → ${l.qteScan}`);
  }
  const quoi = bouts.length ? bouts.join(" · ") : "Ligne corrigée";
  const qui = l.modifieParNom ? ` — ${l.modifieParNom}` : "";
  return `${quoi}${qui}`;
};

const AdminBipagesScreen = () => {
  // Société active : lue depuis la sélection GLOBALE (Header).
  const selectedEntreprise = useSelector(selectGlobalEntrepriseId) || "";
  const [type, setType] = useState("");
  const [zone, setZone] = useState("");
  const [searchInput, setSearchInput] = useState("");
  // Provenance : "" (tout) | ajoutees | modifiees | touchees.
  // Répond à la question de fin d'inventaire : « qu'est-ce qui n'est pas brut
  // de collecteur ? » — c'est ce qu'un contrôleur veut relire en priorité.
  const [marque, setMarque] = useState("");
  const [search, setSearch] = useState("");
  const [msg, setMsg] = useState("");
  const [exporting, setExporting] = useState(false);
  // Feuille d'écarts : mêmes réglages que l'écran Inventaire proforma, le
  // document produit étant le même (générateur commun côté serveur).
  const [groupBy, setGroupBy] = useState("famille"); // famille | fournisseur
  const [seuil, setSeuil] = useState(""); // seuil |écart| en XPF
  const [perimetre, setPerimetre] = useState("comptes"); // comptes | stock
  const [ecartsLoading, setEcartsLoading] = useState("");
  // Bulle d'aide du périmètre : la distinction « comptés / stock complet »
  // change complètement le document, elle mérite mieux qu'une infobulle native.
  const [aidePerimetre, setAidePerimetre] = useState(false);

  // Ajout manuel d'une ligne. Ouvert seulement quand l'écran est filtré sur UN
  // emplacement ET UNE zone : la ligne héritera de ce couple, l'utilisateur ne
  // le saisit pas (voir `peutAjouter` plus bas).
  const [ajoutOuvert, setAjoutOuvert] = useState(false);
  const [ajoutNart, setAjoutNart] = useState("");
  const [ajoutQte, setAjoutQte] = useState("");
  const [ajoutObs, setAjoutObs] = useState("");
  const [ajoutErreur, setAjoutErreur] = useState("");

  const dirty = useRef(new Set());
  // Lignes dont le NART vient d'être modifié : leur désignation et leur
  // code-barres sont re-résolus par le serveur, on l'affiche pendant l'attente.
  const nartModifie = useRef(new Set());
  const [enResolution, setEnResolution] = useState(() => new Set());

  // debounce de la recherche
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  // La bulle d'aide se ferme au clic ailleurs et à Échap, comme tout popover.
  useEffect(() => {
    if (!aidePerimetre) return undefined;
    const fermer = (e) => {
      if (!e.target.closest?.(".ecarts-aide")) setAidePerimetre(false);
    };
    const parEchap = (e) => {
      if (e.key === "Escape") setAidePerimetre(false);
    };
    document.addEventListener("mousedown", fermer);
    document.addEventListener("keydown", parEchap);
    return () => {
      document.removeEventListener("mousedown", fermer);
      document.removeEventListener("keydown", parEchap);
    };
  }, [aidePerimetre]);

  // efface le message d'info après quelques secondes
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(""), 5000);
    return () => clearTimeout(t);
  }, [msg]);

  const { data, isLoading, isFetching, refetch } = useGetBipagesQuery(
    { entrepriseId: selectedEntreprise, zone, type, search, marque },
    { skip: !selectedEntreprise },
  );

  const [updateBipage] = useUpdateBipageMutation();
  const [ajouterLigne, { isLoading: ajoutEnCours }] =
    useAjouterLigneBipageMutation();
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
    // Seul le NART entraîne une re-résolution côté serveur : changer la
    // quantité ou l'observation ne doit pas faire clignoter les colonnes.
    if (field === "nart") nartModifie.current.add(id);
    setLignes((prev) =>
      prev.map((l) => (l._id === id ? { ...l, [field]: value } : l)),
    );
  };

  const marquerResolution = (id, actif) =>
    setEnResolution((prev) => {
      const n = new Set(prev);
      if (actif) n.add(id);
      else n.delete(id);
      return n;
    });

  const saveLine = async (id) => {
    if (!dirty.current.has(id)) return;
    dirty.current.delete(id);
    const ligne = lignes.find((l) => l._id === id);
    if (!ligne) return;
    // Le NART a changé : désignation et code-barres vont être re-résolus dans
    // le catalogue. On le montre plutôt que de laisser l'ancienne valeur à
    // l'écran, qui donnerait l'impression que rien ne s'est passé.
    const resout = nartModifie.current.delete(id);
    if (resout) marquerResolution(id, true);
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
    } finally {
      if (resout) marquerResolution(id, false);
    }
  };

  const onCellKeyDown = (e) => {
    if (e.key === "Enter") e.target.blur();
  };

  // ── Ajout manuel ─────────────────────────────────────────────────────────
  // Règle métier : on n'ajoute une ligne QUE dans une zone déjà filtrée, avec
  // son emplacement. Le couple (zone, emplacement) identifie la fiche rayon —
  // un même code existe en MAGASIN et en DOCK — et le laisser saisir à la main
  // reviendrait à autoriser des lignes rattachées à une zone inexistante.
  const peutAjouter = !!(type && zone);

  const fermerAjout = () => {
    setAjoutOuvert(false);
    setAjoutNart("");
    setAjoutQte("");
    setAjoutObs("");
    setAjoutErreur("");
  };

  const validerAjout = async () => {
    setAjoutErreur("");
    const nart = ajoutNart.trim();
    const qte = Number(ajoutQte);
    if (!nart) {
      setAjoutErreur("Saisissez le NART de l'article.");
      return;
    }
    if (!Number.isFinite(qte) || qte === 0) {
      setAjoutErreur("Saisissez une quantité différente de 0.");
      return;
    }
    try {
      await ajouterLigne({
        entrepriseId: selectedEntreprise,
        body: {
          zoneCode: zone,
          zoneType: type,
          nart,
          qteScan: qte,
          observation: ajoutObs.trim(),
        },
      }).unwrap();
      fermerAjout();
      setMsg(`Ligne ajoutée dans ${zone} (${type}).`);
    } catch (err) {
      setAjoutErreur(
        err?.data?.message || "Ajout impossible. Vérifiez la saisie.",
      );
    }
  };

  // Feuille d'écarts (PDF ou Excel). Même document que « Inventaire proforma » :
  // c'est le même générateur côté serveur, seule la source du comptage change.
  const exporterEcarts = async (format) => {
    if (!selectedEntreprise) return;
    setEcartsLoading(format);
    try {
      const params = new URLSearchParams();
      params.set("groupBy", groupBy);
      params.set("format", format);
      params.set("perimetre", perimetre);
      if (seuil) params.set("seuil", seuil);
      // Les filtres de l'écran cadrent le document : on exporte ce qu'on voit.
      if (zone) params.set("zone", zone);
      if (type) params.set("type", type);
      if (search) params.set("search", search);

      const url = `${BASE_URL}/api/bipages/${selectedEntreprise}/ecarts?${params.toString()}`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) {
        let m = `Génération échouée (${res.status})`;
        try {
          const j = await res.json();
          if (j?.message) m = j.message;
        } catch {
          /* réponse non JSON */
        }
        throw new Error(m);
      }
      const blob = await res.blob();
      let filename = format === "xlsx" ? "ecarts.xlsx" : "ecarts.pdf";
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
      setMsg(e.message || "Génération impossible");
    } finally {
      setEcartsLoading("");
    }
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
        marque,
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
          {/* Feuilles d'écarts — en tête d'écran : c'est la sortie qu'on vient
              chercher ici en fin de comptage. Réglages identiques à l'écran
              Inventaire proforma, documents identiques. */}
          <div className="ecarts-bar">
            <span className="ecarts-titre">
              <HiDocumentReport /> Feuille d'écarts
            </span>

            <label>
              Regrouper par
              <select
                className="filter-select"
                value={groupBy}
                onChange={(e) => setGroupBy(e.target.value)}
              >
                <option value="famille">Famille (2 1ers car. NART)</option>
                <option value="fournisseur">Fournisseur</option>
              </select>
            </label>

            <label>
              Seuil écart (XPF)
              <input
                type="number"
                min="0"
                step="1"
                className="ecarts-seuil"
                value={seuil}
                onChange={(e) => setSeuil(e.target.value)}
                placeholder="0"
                title="Les articles dont l'écart en valeur absolue est inférieur ou égal au seuil sont exclus du document."
              />
            </label>

            <label>
              <span className="ecarts-label-aide">
                Périmètre
                <span className="ecarts-aide">
                  <button
                    type="button"
                    className="ecarts-aide-btn"
                    onClick={(e) => {
                      // Le bouton vit dans un <label> : sans ça, le clic
                      // déclencherait aussi l'ouverture du <select> associé.
                      e.preventDefault();
                      e.stopPropagation();
                      setAidePerimetre((o) => !o);
                    }}
                    aria-expanded={aidePerimetre}
                    aria-label="À quoi sert le périmètre ?"
                    title="À quoi sert le périmètre ?"
                  >
                    <HiInformationCircle />
                  </button>
                  {aidePerimetre && (
                    <div
                      className="ecarts-aide-bulle"
                      role="tooltip"
                      onClick={(e) => e.preventDefault()}
                    >
                      <b>Quels articles entrent dans le document ?</b>
                      <p>
                        <b>Articles comptés</b> — seulement ceux qui ont été
                        bipés. Un article en stock que personne n'a compté
                        n'apparaît pas.
                      </p>
                      <p>
                        <b>Stock complet</b> — les articles comptés <i>plus</i>{" "}
                        tous ceux dont l'ERP dit qu'il reste du stock. Ceux qui
                        n'ont jamais été comptés sortent avec une quantité de 0
                        et un écart négatif égal à tout leur stock.
                      </p>
                      <p className="ecarts-aide-regle">
                        <b>Pendant l'inventaire</b>, gardez « Articles comptés » :
                        les rayons pas encore faits rempliraient le document
                        d'écarts négatifs qui ne veulent rien dire.{" "}
                        <b>Une fois tous les rayons comptés</b>, passez à « Stock
                        complet » : ce qui ressort à 0 a été oublié, ou a
                        réellement disparu.
                      </p>
                    </div>
                  )}
                </span>
              </span>
              <select
                className="filter-select"
                value={perimetre}
                onChange={(e) => setPerimetre(e.target.value)}
              >
                <option value="comptes">Articles comptés</option>
                <option value="stock">Stock complet</option>
              </select>
            </label>

            <div className="ecarts-actions">
              <button
                className="btn-primary"
                onClick={() => exporterEcarts("pdf")}
                disabled={!!ecartsLoading}
                title="Feuille d'écarts (PDF paysage)"
              >
                <HiDocumentReport />{" "}
                {ecartsLoading === "pdf" ? "Génération…" : "PDF"}
              </button>
              <button
                className="btn-primary"
                onClick={() => exporterEcarts("xlsx")}
                disabled={!!ecartsLoading}
                title="Feuille d'écarts (classeur Excel)"
              >
                <HiTable />{" "}
                {ecartsLoading === "xlsx" ? "Génération…" : "Excel"}
              </button>
            </div>

            <span className="ecarts-hint">
              Les filtres ci-dessous (emplacement, zone, provenance, recherche)
              cadrent aussi le document.
            </span>
          </div>

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

            {/* Provenance de la ligne. « Ajoutées + modifiées » est la vue
                de contrôle : tout ce qui ne vient pas brut du collecteur. */}
            <select
              className="filter-select"
              value={marque}
              onChange={(e) => setMarque(e.target.value)}
              title="Ne montrer que les lignes touchées à la main"
            >
              <option value="">Toutes les lignes</option>
              <option value="ajoutees">Ajoutées à la main</option>
              <option value="modifiees">Modifiées</option>
              <option value="touchees">Ajoutées + modifiées</option>
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

          {/* L'intégration d'un comptage fait hors collecteur (Excel ou
              proforma) a déménagé dans « Progression inventaire » : on y
              choisit la zone AVANT d'importer, au lieu de la deviner dans le
              nom du fichier ou l'observation. Cet écran reste celui de la
              consultation et de la correction des lignes. */}

          {msg ? <div className="bipages-msg">{msg}</div> : null}

          {/* ── Ajout manuel d'une ligne ──────────────────────────────────
              Le bouton n'apparaît QUE si l'écran est filtré sur un
              emplacement ET une zone : la ligne créée appartiendra à ce
              couple, que l'utilisateur ne saisit donc jamais. Quand le filtre
              n'est pas assez précis, on explique ce qu'il manque plutôt que
              d'afficher un bouton inerte. */}
          <div className="ajout-bar">
            {peutAjouter ? (
              !ajoutOuvert && (
                <button
                  className="btn-secondary"
                  onClick={() => setAjoutOuvert(true)}
                >
                  <HiPlus /> Ajouter une ligne dans {zone} ({type})
                </button>
              )
            ) : (
              <span className="ajout-hint">
                <HiInformationCircle /> Pour ajouter une ligne à la main,
                filtrez d'abord sur un <b>emplacement</b> et une <b>zone</b> :
                la ligne leur sera rattachée.
              </span>
            )}
          </div>

          {peutAjouter && ajoutOuvert && (
            <div className="ajout-form">
              <div className="ajout-form-head">
                <span className="ajout-cible">
                  Nouvelle ligne — <b>{zone}</b> · {type}
                </span>
                <button
                  className="ajout-close"
                  onClick={fermerAjout}
                  title="Annuler"
                  aria-label="Annuler l'ajout"
                >
                  <HiX />
                </button>
              </div>
              <div className="ajout-champs">
                <label>
                  <span>NART</span>
                  <input
                    type="text"
                    value={ajoutNart}
                    onChange={(e) => setAjoutNart(e.target.value)}
                    placeholder="Code article"
                    autoFocus
                  />
                </label>
                <label>
                  <span>Quantité</span>
                  <input
                    type="number"
                    value={ajoutQte}
                    onChange={(e) => setAjoutQte(e.target.value)}
                    placeholder="0"
                  />
                </label>
                <label className="ajout-obs">
                  <span>Observation</span>
                  <input
                    type="text"
                    value={ajoutObs}
                    onChange={(e) => setAjoutObs(e.target.value)}
                    placeholder="Facultatif"
                  />
                </label>
                <button
                  className="btn-primary"
                  onClick={validerAjout}
                  disabled={ajoutEnCours}
                >
                  {ajoutEnCours ? "Ajout…" : "Ajouter"}
                </button>
              </div>
              {/* La désignation n'est pas demandée : elle est résolue par le
                  serveur depuis le NART, comme lors d'une correction. Un NART
                  inconnu donne « Article non trouvé » — la ligne est créée
                  quand même, pour ne pas perdre un comptage. */}
              {ajoutErreur ? (
                <div className="ajout-erreur">{ajoutErreur}</div>
              ) : null}
            </div>
          )}

          <div className="admin-bipages-table-container">
            <table className="admin-table">
              <thead>
                <tr>
                  {/* Colonne de repères : corrigée / ajoutée à la main. */}
                  <th className="marq-col" aria-label="Repères" />
                  <th>Zone</th>
                  <th>Emplacement</th>
                  <th title="Code-barres de l'article dans le catalogue, re-résolu quand le NART change">
                    Gencode
                  </th>
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
                    <td colSpan={10} className="no-data">
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
                      } ${l.source === "manuel" ? "row-manuelle" : ""} ${
                        l.modifie ? "row-modifiee" : ""
                      }`.trim()}
                    >
                      {/* Repères de la ligne. L'infobulle de la correction dit
                          CE QUI a changé : « corrigée » seul obligerait à
                          rouvrir le .DAT pour le savoir. */}
                      <td className="marq-cell">
                        {l.source === "manuel" && (
                          <HiPlusCircle
                            className="marq marq-manuelle"
                            title={`Ligne ajoutée à la main${
                              l.agentNom ? ` par ${l.agentNom}` : ""
                            }`}
                          />
                        )}
                        {l.modifie && (
                          <HiPencilAlt
                            className="marq marq-modifiee"
                            title={resumeCorrection(l)}
                          />
                        )}
                      </td>
                      <td className="zone-cell">{l.zoneCode}</td>
                      <td className="zone-cell">{l.zoneType || "—"}</td>
                      <td className="mono">
                        {enResolution.has(l._id) ? (
                          <PointsChargement />
                        ) : (
                          l.gencod || "—"
                        )}
                      </td>
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
                      <td className="desig-cell">
                        {enResolution.has(l._id) ? (
                          <PointsChargement />
                        ) : (
                          l.designation
                        )}
                      </td>
                      <td className="agent-cell">
                        {l.agentNom || l.agentCode ? (
                          <>
                            {l.agentNom || `Code ${l.agentCode}`}
                            {l.source && l.source !== "dat" && (
                              <span
                                className={`src-badge${
                                  l.source === "manuel" ? " manuel" : ""
                                }`}
                              >
                                {l.source === "proforma"
                                  ? "proforma"
                                  : l.source === "manuel"
                                    ? "ajout manuel"
                                    : "excel"}
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

    </div>
  );
};

export default AdminBipagesScreen;