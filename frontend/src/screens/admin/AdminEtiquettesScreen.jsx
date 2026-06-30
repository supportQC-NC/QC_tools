import React, { useEffect, useRef, useState } from "react";
import {
  HiTag,
  HiOfficeBuilding,
  HiDocumentText,
  HiPencilAlt,
  HiUpload,
  HiTruck,
} from "react-icons/hi";
import { useGetMyEntreprisesQuery } from "../../slices/entrepriseApiSlice";
import { BASE_URL } from "../../constants";
import "./AdminEtiquettesScreen.css";

// Types d'étiquettes (clés alignées avec le backend etiquetteService.js)
const LABEL_TYPES = [
  {
    type: "standard",
    title: "🏷️ Standard",
    desc: "Petite étiquette rayonnage (5 × 4 cm, plusieurs par page).",
  },
  {
    type: "promo",
    title: "🔥 Promotion",
    desc: "Pleine page A4 avec prix barré, prix promo et dates.",
  },
  {
    type: "solde",
    title: "💥 Solde",
    desc: "Pleine page A4 pour les articles en solde.",
  },
  {
    type: "destockage",
    title: "📦 Destockage",
    desc: "Pleine page A4, jusqu'à épuisement du stock.",
  },
  {
    type: "sans_prix",
    title: "🏪 Sans prix",
    desc: "Pleine page A4 sans prix (vitrine / présentation).",
  },
  {
    type: "normal",
    title: "📋 Normal",
    desc: "Pleine page A4 avec prix et code-barres.",
  },
];

const AdminEtiquettesScreen = () => {
  const { data: entreprises, isLoading: loadingEntreprises } =
    useGetMyEntreprisesQuery();

  const [selectedEntreprise, setSelectedEntreprise] = useState("");
  const [mode, setMode] = useState("proforma"); // proforma | commande | nart
  const [numfact, setNumfact] = useState("");
  const [numcde, setNumcde] = useState("");
  const [nartText, setNartText] = useState("");
  const [type, setType] = useState("standard");
  const [format, setFormat] = useState("a4"); // a4 | demi (types pleine page)
  const [loading, setLoading] = useState(false);
  const [info, setInfo] = useState(null);
  const [error, setError] = useState("");
  const [csvCount, setCsvCount] = useState(0);
  const fileInputRef = useRef(null);

  // Détecte le séparateur le plus fréquent et extrait la 1re colonne de chaque ligne.
  const parseCsvNarts = (text) => {
    const content = String(text).replace(/^\uFEFF/, ""); // BOM éventuel
    const lines = content.split(/\r\n|\r|\n/).filter((l) => l.trim() !== "");
    if (lines.length === 0) return [];

    const candidates = [";", ",", "\t", "|"];
    let sep = null;
    let best = 0;
    for (const c of candidates) {
      const count = (content.match(new RegExp(`\\${c}`, "g")) || []).length;
      if (count > best) { best = count; sep = c; }
    }

    const clean = (cell) =>
      String(cell).trim().replace(/^["']+|["']+$/g, "").trim();

    const narts = lines.map((line) => {
      const first = sep ? line.split(sep)[0] : line;
      return clean(first);
    });

    // Ignorer une éventuelle ligne d'en-tête (ex. "NART", "code", "reference")
    if (narts.length && /^(nart|code|r[ée]f[ée]rence|ref)$/i.test(narts[0])) {
      narts.shift();
    }
    return narts.filter(Boolean);
  };

  const handleCsvImport = (e) => {
    setError("");
    setInfo(null);
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const narts = parseCsvNarts(ev.target.result);
        if (narts.length === 0) {
          setError("Aucun NART trouvé dans le fichier.");
          setCsvCount(0);
        } else {
          setNartText(narts.join("\n"));
          setCsvCount(narts.length);
          setInfo(`${narts.length} NART importé(s) depuis « ${file.name} ».`);
        }
      } catch {
        setError("Fichier illisible ou format non reconnu.");
      }
    };
    reader.onerror = () => setError("Impossible de lire le fichier.");
    reader.readAsText(file);
    // Réinitialise pour permettre de réimporter le même fichier
    e.target.value = "";
  };

  // Auto-sélection si une seule entreprise
  useEffect(() => {
    if (entreprises?.length === 1) setSelectedEntreprise(entreprises[0]._id);
  }, [entreprises]);

  const entrepriseData = entreprises?.find((e) => e._id === selectedEntreprise);
  const nomDossierDBF = entrepriseData?.nomDossierDBF;

  const genererEtiquettes = async () => {
    setError("");
    setInfo(null);

    if (!nomDossierDBF) {
      setError("Sélectionnez une entreprise.");
      return;
    }
    if (mode === "proforma" && !numfact.trim()) {
      setError("Saisissez un numéro de proforma.");
      return;
    }
    if (mode === "commande" && !numcde.trim()) {
      setError("Saisissez un numéro de commande.");
      return;
    }
    const narts =
      mode === "nart"
        ? nartText.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean)
        : [];
    if (mode === "nart" && narts.length === 0) {
      setError("Saisissez au moins un NART.");
      return;
    }

    setLoading(true);
    try {
      let body;
      if (mode === "proforma") {
        body = { type, mode: "proforma", numfact: numfact.trim() };
      } else if (mode === "commande") {
        body = { type, mode: "commande", numcde: numcde.trim() };
      } else {
        body = { type, mode: "nart", narts };
      }
      body.format = format;

      const res = await fetch(
        `${BASE_URL}/api/etiquettes/${nomDossierDBF}/generer`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );

      if (!res.ok) {
        let msg = `Génération échouée (${res.status})`;
        try {
          const j = await res.json();
          if (j?.message) msg = j.message;
        } catch {
          /* réponse non-JSON */
        }
        throw new Error(msg);
      }

      const total = res.headers.get("X-Articles-Total");
      const trouves = res.headers.get("X-Articles-Trouves");
      const introuvables = res.headers.get("X-Articles-Introuvables");

      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = `etiquettes_${type}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(href), 60000);

      let note = `${trouves || "?"} étiquette(s) générée(s).`;
      if (introuvables && Number(introuvables) > 0) {
        note += ` ${introuvables} NART introuvable(s) sur ${total} ignoré(s).`;
      }
      setInfo(note);
    } catch (e) {
      setError(e.message || "Impossible de générer les étiquettes");
    } finally {
      setLoading(false);
    }
  };

  if (loadingEntreprises) {
    return (
      <div className="etiq-screen">
        <div className="etiq-placeholder">Chargement des entreprises…</div>
      </div>
    );
  }

  if (!entreprises || entreprises.length === 0) {
    return (
      <div className="etiq-screen">
        <div className="etiq-placeholder">
          Vous n'avez accès à aucune entreprise.
        </div>
      </div>
    );
  }

  return (
    <div className="etiq-screen">
      <div className="etiq-header">
        <h1>
          <HiTag /> Générateur d'étiquettes
        </h1>
        <p>
          Générez vos étiquettes PDF (code-barres EAN-13) depuis une proforma ou
          une liste de NART.
        </p>
      </div>

      {/* Entreprise */}
      <div className="etiq-card">
        <label className="etiq-label">
          <HiOfficeBuilding /> Entreprise
        </label>
        <select
          className="etiq-select"
          value={selectedEntreprise}
          onChange={(e) => setSelectedEntreprise(e.target.value)}
        >
          <option value="">— Sélectionner —</option>
          {entreprises.map((e) => (
            <option key={e._id} value={e._id}>
              {e.trigramme ? `${e.trigramme} · ` : ""}
              {e.nomComplet || e.nom || e.nomDossierDBF}
            </option>
          ))}
        </select>
      </div>

      {/* Source des articles */}
      <div className="etiq-card">
        <div className="etiq-mode-tabs">
          <button
            type="button"
            className={`etiq-mode-btn ${mode === "proforma" ? "active" : ""}`}
            onClick={() => setMode("proforma")}
          >
            <HiDocumentText /> N° de proforma
          </button>
          <button
            type="button"
            className={`etiq-mode-btn ${mode === "commande" ? "active" : ""}`}
            onClick={() => setMode("commande")}
          >
            <HiTruck /> N° de commande
          </button>
          <button
            type="button"
            className={`etiq-mode-btn ${mode === "nart" ? "active" : ""}`}
            onClick={() => setMode("nart")}
          >
            <HiPencilAlt /> Saisie manuelle (NART)
          </button>
        </div>

        {mode === "proforma" && (
          <div className="etiq-field">
            <label className="etiq-label">Numéro de proforma</label>
            <input
              type="text"
              className="etiq-input"
              value={numfact}
              onChange={(e) => setNumfact(e.target.value)}
              placeholder="Ex. 0001234"
              autoCapitalize="characters"
            />
            <span className="etiq-hint">
              Les articles sont récupérés et triés par numéro de ligne (NL).
            </span>
          </div>
        )}

        {mode === "commande" && (
          <div className="etiq-field">
            <label className="etiq-label">Numéro de commande</label>
            <input
              type="text"
              className="etiq-input"
              value={numcde}
              onChange={(e) => setNumcde(e.target.value)}
              placeholder="Ex. CMD0001234"
              autoCapitalize="characters"
            />
            <span className="etiq-hint">
              Les articles de la commande sont récupérés et triés par numéro de
              ligne (NL).
            </span>
          </div>
        )}

        {mode === "nart" && (
          <div className="etiq-field">
            <label className="etiq-label">Liste de NART</label>
            <div className="etiq-csv-row">
              <button
                type="button"
                className="etiq-csv-btn"
                onClick={() => fileInputRef.current && fileInputRef.current.click()}
              >
                <HiUpload /> Importer un CSV
              </button>
              {csvCount > 0 && (
                <span className="etiq-csv-count">
                  {csvCount} NART chargé(s)
                </span>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.txt,text/csv,text/plain"
                onChange={handleCsvImport}
                style={{ display: "none" }}
              />
            </div>
            <textarea
              className="etiq-textarea"
              rows={5}
              value={nartText}
              onChange={(e) => { setNartText(e.target.value); setCsvCount(0); }}
              placeholder={"Un NART par ligne (ou séparés par , ou ;)"}
            />
            <span className="etiq-hint">
              Les NART sont traités dans l'ordre. L'import CSV détecte le
              séparateur automatiquement et prend la première colonne.
            </span>
          </div>
        )}
      </div>

      {/* Type d'étiquette */}
      <div className="etiq-card">
        <label className="etiq-label">Type d'étiquette</label>
        <div className="etiq-types">
          {LABEL_TYPES.map((lt) => (
            <button
              type="button"
              key={lt.type}
              className={`etiq-type-card ${type === lt.type ? "selected" : ""}`}
              onClick={() => setType(lt.type)}
            >
              <span className="etiq-type-title">{lt.title}</span>
              <span className="etiq-type-desc">{lt.desc}</span>
            </button>
          ))}
        </div>

        {type !== "standard" && (
          <div className="etiq-format">
            <span className="etiq-format-label">Format :</span>
            <button
              type="button"
              className={`etiq-mode-btn ${format === "a4" ? "active" : ""}`}
              onClick={() => setFormat("a4")}
            >
              A4 entier (1 / page)
            </button>
            <button
              type="button"
              className={`etiq-mode-btn ${format === "demi" ? "active" : ""}`}
              onClick={() => setFormat("demi")}
            >
              Demi A4 (2 / page)
            </button>
          </div>
        )}
      </div>

      {error && <div className="etiq-error">{error}</div>}
      {info && <div className="etiq-info">{info}</div>}

      <div className="etiq-actions">
        <button
          type="button"
          className="etiq-generate"
          onClick={genererEtiquettes}
          disabled={loading}
        >
          {loading ? "Génération…" : "🏷️ Générer les étiquettes"}
        </button>
      </div>
    </div>
  );
};

export default AdminEtiquettesScreen;