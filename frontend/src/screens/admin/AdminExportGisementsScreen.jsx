// src/screens/admin/AdminExportGisementsScreen.jsx
//
// Outil admin autour des GISEMENTS (GISM1..GISM5) et des GROUPES (famille) de
// article.dbf. Société lue depuis la sélection GLOBALE (Header). Deux sorties :
//   - Excel  : formats au choix (1 ligne/article, distinct, [par niveau])
//   - Étiquettes : PDF A8 (libellé en gras + code-barres Code128 ou QR),
//                  plusieurs par A4, pour un ou plusieurs codes.
// Libellé lu depuis un fichier de config (gisements/groupe) — non bloquant si absent.

import React, { useEffect, useRef, useState } from "react";
import { HiDownload, HiOfficeBuilding, HiTag, HiX } from "react-icons/hi";
import { useSelector } from "react-redux";
import { useGetMyEntreprisesQuery } from "../../slices/entrepriseApiSlice";
import { selectGlobalEntrepriseId } from "../../slices/entrepriseGlobalSlice";
import {
  useGetGismLevelQuery,
  useGetGroupesQuery,
} from "../../slices/articleApiSlice";
import { BASE_URL } from "../../constants";
import "./AdminExportGisementsScreen.css";

// Modes Excel par dimension (alignés avec gisementsExportService.js).
const EXPORT_MODES = {
  gisements: [
    {
      mode: "articles",
      title: "📄 1 ligne par article",
      desc: "NART, désignation, GENCOD, groupe, GISM1 à GISM5 et PLACE. Tous les articles.",
    },
    {
      mode: "distinct",
      title: "🗂️ Gisements distincts",
      desc: "Codes de gisement (GISM1..5) dédupliqués + libellé + nb d'articles + niveaux.",
    },
    {
      mode: "parNiveau",
      title: "📑 Distinct par niveau (5 onglets)",
      desc: "Un onglet par niveau (GISM1…GISM5) : codes distincts + libellé + nb d'articles.",
    },
  ],
  groupes: [
    {
      mode: "articles",
      title: "📄 1 ligne par article",
      desc: "NART, désignation, GENCOD, GROUPE et son libellé. Tous les articles.",
    },
    {
      mode: "distinct",
      title: "🗂️ Groupes distincts",
      desc: "Codes GROUPE dédupliqués + libellé + nb d'articles.",
    },
  ],
};

const NIVEAUX = [1, 2, 3, 4, 5];

// Menu déroulant recherchable à sélection multiple ({ code, count }).
const SearchableMultiSelect = ({ items, selected, onToggle, loading, placeholder }) => {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);

  useEffect(() => {
    const onClickOutside = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const filtered = (items || []).filter((g) =>
    g.code.toLowerCase().includes(search.trim().toLowerCase()),
  );

  return (
    <div className="expg-ms" ref={boxRef}>
      <div className="expg-ms-control" onClick={() => setOpen(true)}>
        {selected.length === 0 && !search && (
          <span className="expg-ms-placeholder">{placeholder}</span>
        )}
        {selected.map((code) => (
          <span key={code} className="expg-ms-chip">
            {code}
            <button
              type="button"
              className="expg-ms-chip-x"
              onClick={(e) => {
                e.stopPropagation();
                onToggle(code);
              }}
              aria-label={`Retirer ${code}`}
            >
              <HiX />
            </button>
          </span>
        ))}
        <input
          className="expg-ms-search"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder={selected.length ? "Ajouter…" : ""}
        />
      </div>

      {open && (
        <div className="expg-ms-menu">
          {loading ? (
            <div className="expg-ms-empty">Chargement…</div>
          ) : filtered.length === 0 ? (
            <div className="expg-ms-empty">
              {search ? "Aucun résultat" : "Aucun code disponible"}
            </div>
          ) : (
            filtered.map((g) => {
              const checked = selected.includes(g.code);
              return (
                <button
                  type="button"
                  key={g.code}
                  className={`expg-ms-option ${checked ? "checked" : ""}`}
                  onClick={() => onToggle(g.code)}
                >
                  <span className="expg-ms-check">{checked ? "✓" : ""}</span>
                  <span className="expg-ms-code">{g.code}</span>
                  <span className="expg-ms-count">
                    {g.count} article{g.count > 1 ? "s" : ""}
                  </span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
};

const AdminExportGisementsScreen = () => {
  const { data: entreprises, isLoading: loadingEntreprises } =
    useGetMyEntreprisesQuery();

  const globalEntrepriseId = useSelector(selectGlobalEntrepriseId);
  const selectedEntreprise = globalEntrepriseId || "";
  const entrepriseData = entreprises?.find((e) => e._id === selectedEntreprise);
  const nomDossierDBF = entrepriseData?.nomDossierDBF;

  const [dimension, setDimension] = useState("gisements"); // "gisements" | "groupes"
  const [sortie, setSortie] = useState("excel"); // "excel" | "etiquettes"
  const [mode, setMode] = useState("articles"); // Excel
  const [niveau, setNiveau] = useState(1); // Étiquettes gisements : GISM1..5
  const [codeType, setCodeType] = useState("barcode"); // "barcode" | "qr"
  const [selectedCodes, setSelectedCodes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [info, setInfo] = useState(null);
  const [error, setError] = useState("");

  const estGroupes = dimension === "groupes";

  // Codes pour le sélecteur d'étiquettes : par niveau (gisements) ou GROUPE.
  const { data: gismData, isFetching: loadingGism } = useGetGismLevelQuery(
    { nomDossierDBF, niveau },
    { skip: !nomDossierDBF || sortie !== "etiquettes" || estGroupes },
  );
  const { data: groupeData, isFetching: loadingGroupe } = useGetGroupesQuery(
    nomDossierDBF,
    { skip: !nomDossierDBF || sortie !== "etiquettes" || !estGroupes },
  );

  const codesItems = estGroupes ? groupeData?.groupes : gismData?.gisements;
  const loadingCodes = estGroupes ? loadingGroupe : loadingGism;

  // Changement de dimension -> réinitialise mode + sélection.
  useEffect(() => {
    setMode("articles");
    setSelectedCodes([]);
  }, [dimension]);

  // Changement société / niveau -> réinitialise la sélection de codes.
  useEffect(() => {
    setSelectedCodes([]);
  }, [nomDossierDBF, niveau]);

  const toggleCode = (code) => {
    setSelectedCodes((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code],
    );
  };

  const filenameFromHeaders = (res, fallback) => {
    const cd = res.headers.get("Content-Disposition") || "";
    const m = cd.match(/filename="?([^"]+)"?/i);
    return m ? m[1] : fallback;
  };

  const telechargerBlob = async (res, fallbackName) => {
    const filename = filenameFromHeaders(res, fallbackName);
    const blob = await res.blob();
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 60000);
  };

  const erreurReponse = async (res, base) => {
    let msg = `${base} (${res.status})`;
    try {
      const j = await res.json();
      if (j?.message) msg = j.message;
    } catch {
      /* non-JSON */
    }
    return new Error(msg);
  };

  // ── Export Excel ───────────────────────────────────────────────────────────
  const exporterExcel = async () => {
    setError("");
    setInfo(null);
    if (!nomDossierDBF) return setError("Sélectionnez une société dans l'en-tête.");

    setLoading(true);
    try {
      const res = await fetch(
        `${BASE_URL}/api/articles/${nomDossierDBF}/export-gisements?mode=${mode}&dimension=${dimension}`,
        { method: "GET", credentials: "include" },
      );
      if (!res.ok) throw await erreurReponse(res, "Export échoué");

      const lignes = res.headers.get("X-Lignes");
      const total = res.headers.get("X-Articles-Total");
      await telechargerBlob(res, `${dimension}_${mode}.xlsx`);

      const nom = estGroupes ? "groupe(s)" : "gisement(s)";
      setInfo(
        mode === "articles"
          ? `${lignes ?? "?"} article(s) exporté(s).`
          : `${lignes ?? "?"} ${nom} exporté(s) sur ${total ?? "?"} article(s).`,
      );
    } catch (e) {
      setError(e.message || "Impossible de générer l'export.");
    } finally {
      setLoading(false);
    }
  };

  // ── Génération d'étiquettes PDF ──────────────────────────────────────────────
  const genererEtiquettes = async () => {
    setError("");
    setInfo(null);
    if (!nomDossierDBF) return setError("Sélectionnez une société dans l'en-tête.");

    setLoading(true);
    try {
      const body = { dimension, codes: selectedCodes, codeType };
      if (!estGroupes) body.niveau = niveau;

      const res = await fetch(
        `${BASE_URL}/api/articles/${nomDossierDBF}/gisement-etiquettes`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) throw await erreurReponse(res, "Génération échouée");

      const nb = res.headers.get("X-Etiquettes");
      await telechargerBlob(res, `etiquettes_${dimension}.pdf`);
      setInfo(`${nb ?? "?"} étiquette(s) générée(s) au format A8.`);
    } catch (e) {
      setError(e.message || "Impossible de générer les étiquettes.");
    } finally {
      setLoading(false);
    }
  };

  if (loadingEntreprises) {
    return (
      <div className="expg-screen">
        <div className="expg-placeholder">Chargement des entreprises…</div>
      </div>
    );
  }

  if (!entreprises || entreprises.length === 0) {
    return (
      <div className="expg-screen">
        <div className="expg-placeholder">
          Vous n'avez accès à aucune entreprise.
        </div>
      </div>
    );
  }

  const nbCodes = codesItems?.length ?? 0;
  const libLabel = estGroupes ? "GROUPE" : `GISM${niveau}`;

  return (
    <div className="expg-screen">
      <div className="expg-header">
        <h1>
          <HiDownload /> Gisements & Groupes — Export & Étiquettes
        </h1>
        <p>
          Exportez en Excel, ou générez des étiquettes A8 (libellé en gras +
          code-barres ou QR) à coller à l'entrée des rayons / du dock. Le libellé
          provient du fichier de config (non bloquant s'il est absent).
        </p>
      </div>

      {!selectedEntreprise && (
        <div className="expg-card">
          <p className="expg-hint">
            <HiOfficeBuilding /> Sélectionnez une société dans l'en-tête pour
            continuer.
          </p>
        </div>
      )}

      {/* Dimension : Gisements / Groupes */}
      <div className="expg-card">
        <label className="expg-label">Dimension</label>
        <div className="expg-niveaux">
          <button
            type="button"
            className={`expg-niveau-btn ${!estGroupes ? "active" : ""}`}
            onClick={() => setDimension("gisements")}
          >
            📍 Gisements (GISM1-5)
          </button>
          <button
            type="button"
            className={`expg-niveau-btn ${estGroupes ? "active" : ""}`}
            onClick={() => setDimension("groupes")}
          >
            🗃️ Groupes (familles)
          </button>
        </div>
      </div>

      {/* Choix de la sortie */}
      <div className="expg-card">
        <div className="expg-tabs">
          <button
            type="button"
            className={`expg-tab ${sortie === "excel" ? "active" : ""}`}
            onClick={() => setSortie("excel")}
          >
            <HiDownload /> Fichier Excel
          </button>
          <button
            type="button"
            className={`expg-tab ${sortie === "etiquettes" ? "active" : ""}`}
            onClick={() => setSortie("etiquettes")}
          >
            <HiTag /> Étiquettes A8 (PDF)
          </button>
        </div>
      </div>

      {sortie === "excel" ? (
        <>
          <div className="expg-card">
            <label className="expg-label">Format d'export</label>
            <div className="expg-types">
              {EXPORT_MODES[dimension].map((m) => (
                <button
                  type="button"
                  key={m.mode}
                  className={`expg-type-card ${mode === m.mode ? "selected" : ""}`}
                  onClick={() => setMode(m.mode)}
                >
                  <span className="expg-type-title">{m.title}</span>
                  <span className="expg-type-desc">{m.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {error && <div className="expg-error">{error}</div>}
          {info && <div className="expg-info">{info}</div>}

          <div className="expg-actions">
            <button
              type="button"
              className="expg-generate"
              onClick={exporterExcel}
              disabled={loading || !nomDossierDBF}
            >
              {loading ? "Génération…" : "⬇️ Exporter en Excel"}
            </button>
          </div>
        </>
      ) : (
        <>
          {!estGroupes && (
            <div className="expg-card">
              <label className="expg-label">Niveau de gisement</label>
              <div className="expg-niveaux">
                {NIVEAUX.map((n) => (
                  <button
                    type="button"
                    key={n}
                    className={`expg-niveau-btn ${niveau === n ? "active" : ""}`}
                    onClick={() => setNiveau(n)}
                  >
                    GISM{n}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="expg-card">
            <label className="expg-label">Type de code</label>
            <div className="expg-niveaux">
              <button
                type="button"
                className={`expg-niveau-btn ${codeType === "barcode" ? "active" : ""}`}
                onClick={() => setCodeType("barcode")}
              >
                ▐▍▐ Code-barres (Code128)
              </button>
              <button
                type="button"
                className={`expg-niveau-btn ${codeType === "qr" ? "active" : ""}`}
                onClick={() => setCodeType("qr")}
              >
                ▣ QR code
              </button>
            </div>
          </div>

          <div className="expg-card">
            <label className="expg-label">
              {estGroupes ? "Groupe(s)" : `Gisement(s) — GISM${niveau}`}
              {nbCodes ? ` (${nbCodes} disponible(s))` : ""}
            </label>
            <SearchableMultiSelect
              key={`sel-${nomDossierDBF || ""}-${dimension}-${niveau}`}
              items={codesItems}
              selected={selectedCodes}
              onToggle={toggleCode}
              loading={loadingCodes}
              placeholder={`Rechercher et sélectionner un ou plusieurs ${estGroupes ? "groupes" : "gisements"}…`}
            />
            <span className="expg-hint-inline">
              {selectedCodes.length > 0
                ? `${selectedCodes.length} sélectionné(s) → 1 étiquette chacun.`
                : `Aucune sélection : TOUTES les étiquettes ${estGroupes ? "des groupes" : `du niveau ${libLabel}`} seront générées.`}
            </span>
          </div>

          {error && <div className="expg-error">{error}</div>}
          {info && <div className="expg-info">{info}</div>}

          <div className="expg-actions">
            <button
              type="button"
              className="expg-generate"
              onClick={genererEtiquettes}
              disabled={loading || !nomDossierDBF}
            >
              {loading ? "Génération…" : "🏷️ Générer les étiquettes (A8)"}
            </button>
          </div>
        </>
      )}
    </div>
  );
};

export default AdminExportGisementsScreen;
