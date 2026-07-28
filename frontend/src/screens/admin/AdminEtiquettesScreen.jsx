import React, { useEffect, useRef, useState } from "react";
import {
  HiTag,
  HiOfficeBuilding,
  HiDocumentText,
  HiPencilAlt,
  HiUpload,
  HiTruck,
  HiLocationMarker,
  HiCollection,
  HiX,
  HiBookmark,
  HiSave,
  HiTrash,
} from "react-icons/hi";
import { useSelector } from "react-redux";
import { useGetMyEntreprisesQuery } from "../../slices/entrepriseApiSlice";
import { selectGlobalEntrepriseId } from "../../slices/entrepriseGlobalSlice";
import {
  useGetGism1Query,
  useGetGroupesQuery,
} from "../../slices/articleApiSlice";
import {
  useGetEtiquetteTemplatesQuery,
  useCreateEtiquetteTemplateMutation,
  useDeleteEtiquetteTemplateMutation,
} from "../../slices/etiquetteTemplateApiSlice";
import { BASE_URL } from "../../constants";
import CustomEtiquetteDesigner from "../../components/Admin/CustomEtiquetteDesigner";
import "./AdminEtiquettesScreen.css";

// Types d'étiquettes (clés alignées avec le backend etiquetteService.js)
const LABEL_TYPES = [
  {
    type: "standard",
    title: "🏷️ Standard",
    desc: "Petite étiquette rayonnage (5 × 4 cm, plusieurs par page).",
  },
  {
    type: "standard_sans_prix",
    title: "🏷️ Standard sans prix",
    desc: "Même format que Standard (5 × 4 cm, plusieurs par page), mais sans le prix.",
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
  {
    type: "inventaire",
    title: "🔢 Inventaire",
    desc: "NART et désignation en gros + grande case « Quantité » à remplir au stylo (A4 / demi A4).",
  },
  {
    type: "custom",
    title: "🎨 Personnalisée",
    desc: "Vous choisissez la taille (cm/px), écrivez et placez votre texte. Plusieurs par feuille A4 si ça rentre.",
  },
];

/**
 * Menu déroulant recherchable à sélection multiple ({ code, count }).
 * Réutilisé pour les gisements (GISM1) et les groupes/familles (GROUPE).
 */
const SearchableMultiSelect = ({
  items,
  selected,
  onToggle,
  loading,
  placeholder,
}) => {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filtered = (items || []).filter((g) =>
    g.code.toLowerCase().includes(search.trim().toLowerCase()),
  );

  return (
    <div className="etiq-gism1" ref={boxRef}>
      <div className="etiq-gism1-control" onClick={() => setOpen(true)}>
        {selected.length === 0 && !search && (
          <span className="etiq-gism1-placeholder">{placeholder}</span>
        )}
        {selected.map((code) => (
          <span key={code} className="etiq-gism1-chip">
            {code}
            <button
              type="button"
              className="etiq-gism1-chip-x"
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
          className="etiq-gism1-search"
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
        <div className="etiq-gism1-menu">
          {loading ? (
            <div className="etiq-gism1-empty">Chargement</div>
          ) : filtered.length === 0 ? (
            <div className="etiq-gism1-empty">
              {search ? "Aucun résultat correspondant" : "Aucune valeur disponible"}
            </div>
          ) : (
            filtered.map((g) => {
              const checked = selected.includes(g.code);
              return (
                <button
                  type="button"
                  key={g.code}
                  className={`etiq-gism1-option ${checked ? "checked" : ""}`}
                  onClick={() => onToggle(g.code)}
                >
                  <span className="etiq-gism1-check">{checked ? "✓" : ""}</span>
                  <span className="etiq-gism1-code">{g.code}</span>
                  <span className="etiq-gism1-count">
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

const AdminEtiquettesScreen = () => {
  const { data: entreprises, isLoading: loadingEntreprises } =
    useGetMyEntreprisesQuery();

  // Société active : lue depuis la sélection GLOBALE (Header).
  const globalEntrepriseId = useSelector(selectGlobalEntrepriseId);
  const selectedEntreprise = globalEntrepriseId || "";
  const [mode, setMode] = useState("proforma"); // proforma | commande | nart | gism1
  const [numfact, setNumfact] = useState("");
  const [numcde, setNumcde] = useState("");
  const [nartText, setNartText] = useState("");
  const [selectedGism1, setSelectedGism1] = useState([]); // liste de codes GISM1
  const [selectedGroupe, setSelectedGroupe] = useState([]); // liste de codes GROUPE
  const [type, setType] = useState("standard");
  const [format, setFormat] = useState("a4"); // a4 | demi (types pleine page)
  const [customLayout, setCustomLayout] = useState(null); // layout du designer custom
  const [loading, setLoading] = useState(false);
  const [info, setInfo] = useState(null);
  const [error, setError] = useState("");
  const [csvCount, setCsvCount] = useState(0);
  const fileInputRef = useRef(null);

  // Templates d'étiquettes personnalisées (partagés par société).
  const [designerKey, setDesignerKey] = useState(0); // remonte le designer au chargement
  const [templateInitial, setTemplateInitial] = useState(null);
  const [templateName, setTemplateName] = useState("");
  const [tplMsg, setTplMsg] = useState(null);

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

  const entrepriseData = entreprises?.find((e) => e._id === selectedEntreprise);
  const nomDossierDBF = entrepriseData?.nomDossierDBF;

  // Listes GISM1 / GROUPE de l'entreprise (chargées à la demande, cache 5 min)
  const { data: gism1Data, isLoading: loadingGism1 } = useGetGism1Query(
    nomDossierDBF,
    { skip: !nomDossierDBF || mode !== "gism1" },
  );
  const { data: groupeData, isLoading: loadingGroupe } = useGetGroupesQuery(
    nomDossierDBF,
    { skip: !nomDossierDBF || mode !== "groupe" },
  );

  // Templates de la société (visibles/utilisables par tous les users y ayant accès).
  const { data: templates = [] } = useGetEtiquetteTemplatesQuery(nomDossierDBF, {
    skip: !nomDossierDBF,
  });
  const [createTemplate, { isLoading: savingTpl }] =
    useCreateEtiquetteTemplateMutation();
  const [deleteTemplate] = useDeleteEtiquetteTemplateMutation();

  const saveTemplate = async () => {
    setTplMsg(null);
    if (!nomDossierDBF) return setTplMsg({ type: "err", text: "Sélectionnez une société." });
    if (!templateName.trim()) return setTplMsg({ type: "err", text: "Donnez un nom au template." });
    if (!customLayout || !(customLayout.elements || []).length)
      return setTplMsg({ type: "err", text: "Ajoutez au moins un élément avant d'enregistrer." });
    try {
      await createTemplate({
        nomDossierDBF,
        nom: templateName.trim(),
        dataMode: mode !== "aucun",
        config: {
          widthPx: customLayout.widthPx,
          heightPx: customLayout.heightPx,
          copies: customLayout.copies,
          elements: customLayout.elements,
        },
      }).unwrap();
      setTemplateName("");
      setTplMsg({ type: "ok", text: "Template enregistré (visible par toute la société)." });
    } catch (e) {
      setTplMsg({ type: "err", text: e?.data?.message || e.message });
    }
  };

  const loadTemplate = (tpl) => {
    const cfg = tpl.config || {};
    setType("custom");
    setMode(tpl.dataMode ? (mode === "aucun" ? "nart" : mode) : "aucun");
    setTemplateInitial({
      unit: "px",
      width: cfg.widthPx,
      height: cfg.heightPx,
      copies: cfg.copies || 1,
      elements: cfg.elements || [],
    });
    setDesignerKey((k) => k + 1); // force le remontage du designer avec `initial`
    setTplMsg({ type: "ok", text: `Template « ${tpl.nom} » chargé.` });
  };

  const removeTemplate = async (tpl) => {
    if (!window.confirm(`Supprimer le template « ${tpl.nom} » ?`)) return;
    try {
      await deleteTemplate({ nomDossierDBF, id: tpl._id }).unwrap();
    } catch (e) {
      alert(e?.data?.message || "Suppression impossible");
    }
  };

  // Réinitialise les sélections si on change d'entreprise
  useEffect(() => {
    setSelectedGism1([]);
    setSelectedGroupe([]);
  }, [nomDossierDBF]);

  const toggleGism1 = (code) => {
    setSelectedGism1((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code],
    );
  };

  const toggleGroupe = (code) => {
    setSelectedGroupe((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code],
    );
  };

  // Valide le mode « source article » courant et renvoie les champs à envoyer.
  const buildArticleSource = () => {
    if (mode === "proforma") {
      if (!numfact.trim())
        return { ok: false, error: "Saisissez un numéro de proforma." };
      return { ok: true, fields: { numfact: numfact.trim() } };
    }
    if (mode === "commande") {
      if (!numcde.trim())
        return { ok: false, error: "Saisissez un numéro de commande." };
      return { ok: true, fields: { numcde: numcde.trim() } };
    }
    if (mode === "nart") {
      const narts = nartText
        .split(/[\n,;]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      if (narts.length === 0)
        return { ok: false, error: "Saisissez au moins un NART." };
      return { ok: true, fields: { narts } };
    }
    if (mode === "gism1") {
      if (selectedGism1.length === 0)
        return { ok: false, error: "Sélectionnez au moins un gisement (GISM1)." };
      return { ok: true, fields: { gism1: selectedGism1 } };
    }
    if (mode === "groupe") {
      if (selectedGroupe.length === 0)
        return { ok: false, error: "Sélectionnez au moins un groupe (GROUPE)." };
      return { ok: true, fields: { groupe: selectedGroupe } };
    }
    return { ok: false, error: "Choisissez une source d'articles." };
  };

  const genererEtiquettes = async () => {
    setError("");
    setInfo(null);

    if (!nomDossierDBF) {
      setError("Sélectionnez une entreprise.");
      return;
    }

    const customBody =
      type === "custom"
        ? {
            type: "custom",
            layout: {
              widthPx: customLayout?.widthPx,
              heightPx: customLayout?.heightPx,
              border: true,
              elements: customLayout?.elements || [],
            },
          }
        : null;

    let body;
    if (type === "custom" && mode === "aucun") {
      if (!customLayout || !(customLayout.elements || []).length) {
        setError("Ajoutez au moins un élément à l'étiquette personnalisée.");
        return;
      }
      body = { ...customBody, copies: Math.max(1, Number(customLayout.copies) || 1) };
    } else {
      // Source article (proforma / commande / nart / gism1 / groupe).
      const src = buildArticleSource();
      if (!src.ok) {
        setError(src.error);
        return;
      }
      if (type === "custom") {
        if (!customLayout || !(customLayout.elements || []).length) {
          setError("Ajoutez au moins un élément à l'étiquette personnalisée.");
          return;
        }
        body = { ...customBody, mode, ...src.fields };
      } else {
        body = { type, mode, ...src.fields, format };
      }
    }

    setLoading(true);
    try {
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

      let note;
      if (type === "custom") {
        note =
          trouves && Number(trouves) > 0
            ? `PDF généré (${trouves} étiquette(s) depuis les articles).`
            : `PDF généré (${body.copies || "?"} étiquette(s) personnalisée(s)).`;
      } else {
        note = `${trouves || "?"} étiquette(s) générée(s).`;
        if (introuvables && Number(introuvables) > 0) {
          note += ` ${introuvables} NART introuvable(s) sur ${total} ignoré(s).`;
        }
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
    <div className={`etiq-screen ${type === "custom" ? "etiq-screen--wide" : ""}`}>
      <div className="etiq-header">
        <h1>
          <HiTag /> Générateur d'étiquettes
        </h1>
        <p>
          Générez vos étiquettes PDF (code-barres EAN-13) depuis une proforma,
          une commande, une liste de NART, un gisement (GISM1) ou un groupe
          (GROUPE).
        </p>
      </div>

      {/* Société : choisie globalement dans l'en-tête */}
      {!selectedEntreprise && (
        <div className="etiq-card">
          <p className="etiq-hint">
            <HiOfficeBuilding /> Sélectionnez une société dans l'en-tête pour
            générer des étiquettes.
          </p>
        </div>
      )}

      {/* Source des articles (le type « custom » ajoute « Texte seul »). */}
      <div className="etiq-card">
        <div className="etiq-mode-tabs">
          {type === "custom" && (
            <button
              type="button"
              className={`etiq-mode-btn ${mode === "aucun" ? "active" : ""}`}
              onClick={() => setMode("aucun")}
            >
              <HiPencilAlt /> Texte seul
            </button>
          )}
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
          <button
            type="button"
            className={`etiq-mode-btn ${mode === "gism1" ? "active" : ""}`}
            onClick={() => setMode("gism1")}
          >
            <HiLocationMarker /> Par gisement (GISM1)
          </button>
          <button
            type="button"
            className={`etiq-mode-btn ${mode === "groupe" ? "active" : ""}`}
            onClick={() => setMode("groupe")}
          >
            <HiCollection /> Par groupe (GROUPE)
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

        {mode === "gism1" && (
          <div className="etiq-field">
            <label className="etiq-label">Gisement(s) GISM1</label>
            <SearchableMultiSelect
              key={`gism1-${nomDossierDBF || ""}`}
              items={gism1Data?.gism1}
              selected={selectedGism1}
              onToggle={toggleGism1}
              loading={loadingGism1}
              placeholder="Rechercher et sélectionner un ou plusieurs gisements…"
            />
            <span className="etiq-hint">
              {selectedGism1.length > 0
                ? `${selectedGism1.length} gisement(s) sélectionné(s). Toutes les étiquettes des articles rangés dans ce(s) gisement(s) seront générées.`
                : "Toutes les étiquettes des articles rangés dans le(s) gisement(s) sélectionné(s) seront générées."}
            </span>
          </div>
        )}

        {mode === "groupe" && (
          <div className="etiq-field">
            <label className="etiq-label">Groupe(s) / Famille(s)</label>
            <SearchableMultiSelect
              key={`groupe-${nomDossierDBF || ""}`}
              items={groupeData?.groupes}
              selected={selectedGroupe}
              onToggle={toggleGroupe}
              loading={loadingGroupe}
              placeholder="Rechercher et sélectionner un ou plusieurs groupes…"
            />
            <span className="etiq-hint">
              {selectedGroupe.length > 0
                ? `${selectedGroupe.length} groupe(s) sélectionné(s). Toutes les étiquettes des articles de ce(s) groupe(s) seront générées.`
                : "Toutes les étiquettes des articles du/des groupe(s) sélectionné(s) seront générées."}
            </span>
          </div>
        )}

        {type === "custom" && mode === "aucun" && (
          <span className="etiq-hint">
            Mode « texte seul » : l'étiquette ne dépend d'aucun article. Choisissez
            une source ci-dessus pour insérer des champs article + code-barres.
          </span>
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
              onClick={() => {
                setType(lt.type);
                // Custom démarre en « texte seul » ; sortir de custom rétablit une source.
                if (lt.type === "custom") setMode("aucun");
                else if (mode === "aucun") setMode("nart");
              }}
            >
              <span className="etiq-type-title">{lt.title}</span>
              <span className="etiq-type-desc">{lt.desc}</span>
            </button>
          ))}
        </div>

        {type !== "standard" &&
          type !== "standard_sans_prix" &&
          type !== "custom" && (
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

      {/* Designer d'étiquette personnalisée */}
      {type === "custom" && (
        <div className="etiq-card">
          <label className="etiq-label">Conception de l'étiquette</label>
          <CustomEtiquetteDesigner
            key={designerKey}
            initial={templateInitial}
            dataMode={mode !== "aucun"}
            onChange={setCustomLayout}
          />
        </div>
      )}

      {/* Templates de la société (enregistrer / réutiliser) */}
      {type === "custom" && (
        <div className="etiq-card">
          <label className="etiq-label">
            <HiBookmark /> Mes templates de la société
          </label>
          <span className="etiq-hint">
            Enregistrez ce design pour le réutiliser plus tard. Tous les utilisateurs
            ayant accès à cette société et au module étiquettes le retrouveront ici.
          </span>

          {tplMsg && (
            <div className={tplMsg.type === "ok" ? "etiq-info" : "etiq-error"}>
              {tplMsg.text}
            </div>
          )}

          <div className="etiq-tpl-save">
            <input
              type="text"
              className="etiq-input"
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              placeholder="Nom du template (ex. Étiquette rayon promo)"
            />
            <button
              type="button"
              className="etiq-tpl-savebtn"
              onClick={saveTemplate}
              disabled={savingTpl}
            >
              <HiSave /> {savingTpl ? "Enregistrement…" : "Enregistrer ce design"}
            </button>
          </div>

          {templates.length === 0 ? (
            <div className="etiq-hint">Aucun template pour cette société pour l'instant.</div>
          ) : (
            <div className="etiq-tpl-list">
              {templates.map((tpl) => (
                <div key={tpl._id} className="etiq-tpl-item">
                  <div className="etiq-tpl-info">
                    <span className="etiq-tpl-name">{tpl.nom}</span>
                    <span className="etiq-tpl-meta">
                      {tpl.dataMode ? "Avec données article" : "Texte seul"}
                      {tpl.user?.prenom || tpl.user?.nom
                        ? ` · par ${[tpl.user.prenom, tpl.user.nom].filter(Boolean).join(" ")}`
                        : ""}
                    </span>
                  </div>
                  <div className="etiq-tpl-actions">
                    <button type="button" className="etiq-tpl-use" onClick={() => loadTemplate(tpl)}>
                      Utiliser
                    </button>
                    <button type="button" className="etiq-tpl-del" onClick={() => removeTemplate(tpl)} title="Supprimer">
                      <HiTrash />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

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