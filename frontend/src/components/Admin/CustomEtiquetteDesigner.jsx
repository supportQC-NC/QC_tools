// src/components/Admin/CustomEtiquetteDesigner.jsx
//
// Designer d'étiquette PERSONNALISÉE. L'utilisateur choisit la taille (cm/px) et
// place librement des éléments : texte libre, CHAMP article (rempli à la
// génération), trait, rectangle, logo, code-barres EAN-13. Centrage H/V.
// Émet un layout normalisé (px) au parent via onChange.
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  HiPlus,
  HiTrash,
  HiMinus,
  HiStop,
  HiPhotograph,
  HiViewList,
  HiQrcode,
} from "react-icons/hi";
import "./CustomEtiquetteDesigner.css";

const CM_TO_PX = 96 / 2.54;
const PX_TO_PT = 72 / 96;
const A4_W = 595.28;
const A4_H = 841.89;
const MARGIN = 14;
const GAP = 8;

// Champs article disponibles (mêmes données que les autres étiquettes).
const FIELDS = [
  { key: "ref", label: "Référence (NART)", maxLen: 6 },
  { key: "design", label: "Désignation", maxLen: 50 },
  { key: "prix", label: "Prix TTC" },
  { key: "prixPromo", label: "Prix promo" },
  { key: "contenance", label: "Prix / unité" },
  { key: "gencod", label: "Code GENCOD" },
  { key: "datesPromo", label: "Dates promo" },
];

// ── Images importées par l'utilisateur ──────────────────────────────────────
// Le PDF final est produit par pdfkit, qui n'embarque QUE du PNG et du JPEG.
// Une image est donc redimensionnée puis ré-encodée dans l'un des deux avant
// d'entrer dans le modèle — c'est aussi ce qui garde le template léger : il est
// stocké tel quel en base (champ `config`), une photo d'appareil de 4 Mo y
// tiendrait mal et gonflerait chaque impression.
const IMAGE_MAX_PX = 1200; // côté le plus long après redimensionnement
const IMAGE_TYPES = "image/png,image/jpeg";

// Redimensionne si besoin et renvoie { src, wNat, hNat } (data URL).
const preparerImage = (file) =>
  new Promise((resolve, reject) => {
    const lecteur = new FileReader();
    lecteur.onerror = () => reject(new Error("Fichier illisible."));
    lecteur.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Image illisible."));
      img.onload = () => {
        const ratio = Math.min(
          1,
          IMAGE_MAX_PX / Math.max(img.naturalWidth, img.naturalHeight),
        );
        if (ratio === 1 && file.size <= 400 * 1024) {
          // Petite image : on la garde telle quelle, sans ré-encodage (pas de
          // perte de qualité inutile sur un logo PNG à fond transparent).
          resolve({
            src: lecteur.result,
            wNat: img.naturalWidth,
            hNat: img.naturalHeight,
          });
          return;
        }
        const c = document.createElement("canvas");
        c.width = Math.round(img.naturalWidth * ratio);
        c.height = Math.round(img.naturalHeight * ratio);
        const ctx = c.getContext("2d");
        // La transparence du PNG est conservée ; un JPEG est ré-encodé en JPEG.
        const png = file.type === "image/png";
        if (!png) {
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, c.width, c.height);
        }
        ctx.drawImage(img, 0, 0, c.width, c.height);
        resolve({
          src: png ? c.toDataURL("image/png") : c.toDataURL("image/jpeg", 0.9),
          wNat: c.width,
          hNat: c.height,
        });
      };
      img.src = lecteur.result;
    };
    lecteur.readAsDataURL(file);
  });

// Longueurs MAX réelles des champs → l'aperçu affiche un texte d'exemple de cette
// longueur pour aider à dimensionner/positionner l'élément (le PDF final utilise
// toujours la vraie valeur de l'article). NART = 6 car., désignation = 50 car.
const SAMPLE_TEXT = "Désignation article exemple de longueur maximale possible ici";

// Coupe un texte en lignes de `width` caractères max (mots préservés, mots trop
// longs coupés) — MÊME logique que `wrapText` du backend, pour un aperçu fidèle.
const wrapPreview = (text, width) => {
  const w = Number(width) || 0;
  if (w <= 0) return String(text);
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = "";
  for (const wd of words) {
    if (!cur) cur = wd;
    else if ((cur + " " + wd).length <= w) cur += " " + wd;
    else { lines.push(cur); cur = wd; }
    while (cur.length > w) { lines.push(cur.slice(0, w)); cur = cur.slice(w); }
  }
  if (cur) lines.push(cur);
  return lines.join("\n");
};

let _seq = 0;
const nextId = () => `el-${Date.now()}-${_seq++}`;

// `fields` : liste des champs plaçables. Par défaut les champs article ci-dessus ;
// en mode « import Excel » le parent fournit les colonnes détectées (Colonne 1…N).
const CustomEtiquetteDesigner = ({
  dataMode = false,
  fields = FIELDS,
  onChange,
  initial,
}) => {
  const fieldOf = (key) => fields.find((f) => f.key === key);
  const fieldLabel = (key) => fieldOf(key)?.label || key;
  const fieldMax = (key) => fieldOf(key)?.maxLen || 0;
  // Libellé d'option : les champs à longueur connue (NART/désignation) sont mis
  // entre {} avec leur nombre de caractères max → plus lisible pour l'utilisateur.
  const optionLabel = (f) =>
    f.maxLen ? `{${f.label}} — ${f.maxLen} car.` : f.label;
  // Texte d'aperçu d'un champ : échantillon à la longueur MAX si connue, sinon
  // le libellé entre accolades (colonnes importées, prix, code, dates…).
  // Si `wrap` est défini sur l'élément, l'échantillon est coupé en plusieurs lignes.
  const fieldSample = (el) => {
    const key = el.field;
    const len = fieldMax(key);
    const wrap = Number(el.wrap) || 0;
    if (!len) return wrap ? wrapPreview(`{${fieldLabel(key)}}`, wrap) : `{${fieldLabel(key)}}`;
    const base = key === "ref" ? "123456789012" : SAMPLE_TEXT;
    const sample = base.slice(0, len);
    // Avec retour à la ligne : on montre le texte coupé ; sinon padding à la
    // largeur max (trailing spaces) pour visualiser l'encombrement maximal.
    return wrap ? wrapPreview(sample, wrap) : sample.padEnd(len, key === "ref" ? "0" : " ");
  };
  // `initial` (optionnel) amorce l'état depuis un template chargé. Comme il n'est
  // lu qu'au montage, le parent REMONTE le designer (via key) au chargement.
  const [unit, setUnit] = useState(initial?.unit || "cm");
  const [width, setWidth] = useState(initial?.width ?? 9);
  const [height, setHeight] = useState(initial?.height ?? 5);
  const [copies, setCopies] = useState(initial?.copies ?? 1);
  const [elements, setElements] = useState(
    initial?.elements?.length
      ? initial.elements.map((el) => ({ id: el.id || nextId(), ...el }))
      : [
          { id: nextId(), kind: "text", text: "Mon étiquette", x: 12, y: 12, fontSize: 22, bold: true, color: "#000000" },
        ],
  );
  const [selectedId, setSelectedId] = useState(null);
  // Import d'image : le champ fichier est caché, déclenché par le bouton, et
  // sert aussi bien à AJOUTER qu'à REMPLACER l'image de l'élément sélectionné.
  const fichierRef = useRef(null);
  const [remplaceId, setRemplaceId] = useState(null);
  const [imgMsg, setImgMsg] = useState("");
  const labelRef = useRef(null);
  const stageRef = useRef(null);
  const [stageW, setStageW] = useState(480); // largeur utile de l'aperçu (mesurée)

  // Mesure la largeur réelle du stage → l'étiquette est toujours mise à l'échelle
  // pour tenir dedans (jamais coupée), même en 20 cm.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return undefined;
    const update = () => setStageW(Math.max(80, el.clientWidth - 48));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const widthPx = Math.max(20, (unit === "cm" ? width * CM_TO_PX : width) || 20);
  const heightPx = Math.max(20, (unit === "cm" ? height * CM_TO_PX : height) || 20);

  const perPage = useMemo(() => {
    const wpt = widthPx * PX_TO_PT;
    const hpt = heightPx * PX_TO_PT;
    const cols = Math.max(1, Math.floor((A4_W - 2 * MARGIN + GAP) / (wpt + GAP)));
    const rows = Math.max(1, Math.floor((A4_H - 2 * MARGIN + GAP) / (hpt + GAP)));
    return cols * rows;
  }, [widthPx, heightPx]);

  const scale = Math.max(0.05, Math.min(stageW / widthPx, 440 / heightPx, 2.5));
  const selected = elements.find((e) => e.id === selectedId) || null;

  useEffect(() => {
    onChange?.({
      widthPx: Math.round(widthPx),
      heightPx: Math.round(heightPx),
      copies: Math.max(1, Math.floor(Number(copies) || 1)),
      elements: elements.map((e) => ({ ...e, id: undefined })),
    });
  }, [widthPx, heightPx, copies, elements, onChange]);

  const add = (el) => {
    const withId = { id: nextId(), x: 10, y: 10, ...el };
    setElements((prev) => [...prev, withId]);
    setSelectedId(withId.id);
  };
  const addText = () =>
    add({ kind: "text", text: "Texte", fontSize: 18, bold: false, color: "#000000" });
  const addField = (key) =>
    add({ kind: "field", field: key, fontSize: 18, bold: false, color: "#000000" });
  const addLine = () =>
    add({ kind: "line", length: 100, thickness: 2, orientation: "h", color: "#000000" });
  const addRect = () =>
    add({ kind: "rect", w: 120, h: 60, lineWidth: 2, color: "#000000", fill: false, fillColor: "#dddddd" });
  const addLogo = () => add({ kind: "logo", w: 90, h: 60 });

  // Ouvre le sélecteur de fichier. `pourId` non nul = remplacer l'image d'un
  // élément existant plutôt qu'en créer un.
  const ouvrirImport = (pourId = null) => {
    setRemplaceId(pourId);
    setImgMsg("");
    if (fichierRef.current) {
      fichierRef.current.value = "";
      fichierRef.current.click();
    }
  };

  const onFichierImage = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // ⚠️ pdfkit n'embarque pas de PDF dans une page : le dire franchement
    // plutôt que de laisser l'utilisateur poser une image qui ne sortira pas.
    if (file.type === "application/pdf") {
      setImgMsg(
        "Le PDF ne peut pas être posé tel quel sur une étiquette. Exportez la page en PNG ou en JPEG, puis réimportez-la.",
      );
      return;
    }
    if (!["image/png", "image/jpeg"].includes(file.type)) {
      setImgMsg("Formats acceptés : PNG et JPEG.");
      return;
    }
    try {
      const { src, wNat, hNat } = await preparerImage(file);
      // Taille de départ : 120 px de large, hauteur au prorata — l'utilisateur
      // ajuste ensuite, le ratio est conservé par défaut.
      const w = 120;
      const h = Math.max(10, Math.round((hNat / wNat) * w));
      if (remplaceId) {
        setElements((prev) =>
          prev.map((el) =>
            el.id === remplaceId ? { ...el, src, ratio: wNat / hNat } : el,
          ),
        );
      } else {
        add({ kind: "image", src, w, h, ratio: wNat / hNat, garderRatio: true });
      }
      setImgMsg("");
    } catch (err) {
      setImgMsg(err.message || "Import impossible.");
    } finally {
      setRemplaceId(null);
    }
  };
  const addBarcode = () => add({ kind: "barcode", w: 120, h: 50 });

  const updateSel = (patch) =>
    setElements((prev) => prev.map((e) => (e.id === selectedId ? { ...e, ...patch } : e)));
  const removeSel = () => {
    setElements((prev) => prev.filter((e) => e.id !== selectedId));
    setSelectedId(null);
  };

  // Taille (px non mis à l'échelle) d'un élément, pour le centrage.
  const elSize = (el) => {
    if (el.kind === "line")
      return el.orientation === "v"
        ? { w: el.thickness || 1, h: el.length || 0 }
        : { w: el.length || 0, h: el.thickness || 1 };
    if (
      el.kind === "rect" ||
      el.kind === "logo" ||
      el.kind === "barcode" ||
      el.kind === "image"
    )
      return { w: el.w || 0, h: el.h || 0 };
    // text / field : mesuré dans le DOM
    const node = labelRef.current?.querySelector(`[data-id="${el.id}"]`);
    if (node) {
      const r = node.getBoundingClientRect();
      return { w: r.width / scale, h: r.height / scale };
    }
    return { w: 0, h: 0 };
  };
  const centerH = () => {
    if (!selected) return;
    updateSel({ x: Math.max(0, Math.round((widthPx - elSize(selected).w) / 2)) });
  };
  const centerV = () => {
    if (!selected) return;
    updateSel({ y: Math.max(0, Math.round((heightPx - elSize(selected).h) / 2)) });
  };

  // Déplacement souris.
  const dragRef = useRef(null);
  useEffect(() => {
    const onMove = (e) => {
      const d = dragRef.current;
      if (!d) return;
      const nx = Math.max(0, Math.min(Math.round(d.x0 + (e.clientX - d.sx) / d.scale), d.maxX));
      const ny = Math.max(0, Math.min(Math.round(d.y0 + (e.clientY - d.sy) / d.scale), d.maxY));
      setElements((prev) => prev.map((el) => (el.id === d.id ? { ...el, x: nx, y: ny } : el)));
    };
    const onUp = () => {
      dragRef.current = null;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);
  const onElMouseDown = (e, el) => {
    e.preventDefault();
    setSelectedId(el.id);
    dragRef.current = { id: el.id, sx: e.clientX, sy: e.clientY, x0: el.x, y0: el.y, scale, maxX: widthPx - 4, maxY: heightPx - 4 };
  };

  // Rendu d'un élément dans l'aperçu.
  const renderEl = (el) => {
    const base = { left: el.x * scale, top: el.y * scale };
    let inner = null;
    let extra = {};
    if (el.kind === "text" || el.kind === "field") {
      extra = { fontSize: (el.fontSize || 16) * scale, fontWeight: el.bold ? 700 : 400, color: el.color };
      inner = el.kind === "text" ? el.text || " " : fieldSample(el);
    } else if (el.kind === "line") {
      const w = (el.orientation === "v" ? el.thickness : el.length) * scale;
      const h = (el.orientation === "v" ? el.length : el.thickness) * scale;
      extra = { width: Math.max(1, w), height: Math.max(1, h), background: el.color };
    } else if (el.kind === "rect") {
      extra = {
        width: el.w * scale,
        height: el.h * scale,
        border: `${Math.max(1, el.lineWidth * scale)}px solid ${el.color}`,
        background: el.fill ? el.fillColor : "transparent",
      };
    } else if (el.kind === "logo") {
      extra = { width: el.w * scale, height: el.h * scale };
      inner = <span className="ced-ph">LOGO</span>;
    } else if (el.kind === "image") {
      extra = { width: el.w * scale, height: el.h * scale };
      inner = el.src ? (
        <img
          src={el.src}
          alt=""
          className="ced-img"
          draggable={false}
          // L'aperçu doit montrer ce que le PDF imprimera : l'image est
          // ÉTIRÉE dans le cadre, exactement comme `drawImage` côté serveur.
          style={{ width: "100%", height: "100%" }}
        />
      ) : (
        <span className="ced-ph">IMAGE</span>
      );
    } else if (el.kind === "barcode") {
      extra = { width: el.w * scale, height: el.h * scale };
      inner = <span className="ced-ph">▮▯▮▯ code-barres</span>;
    }
    return (
      <div
        key={el.id}
        data-id={el.id}
        className={`ced-el ced-el--${el.kind} ${selectedId === el.id ? "sel" : ""}`}
        style={{ ...base, ...extra }}
        onMouseDown={(e) => {
          e.stopPropagation();
          onElMouseDown(e, el);
        }}
      >
        {inner}
      </div>
    );
  };

  const isTextLike = selected && (selected.kind === "text" || selected.kind === "field");

  return (
    <div className="ced">
      {/* Barre d'outils : dimensions + exemplaires */}
      <div className="ced-toolbar">
        <div className="ced-field">
          <label>Largeur</label>
          <input type="number" min="0.5" step="0.1" value={width} onChange={(e) => setWidth(parseFloat(e.target.value) || 0)} />
        </div>
        <div className="ced-field">
          <label>Hauteur</label>
          <input type="number" min="0.5" step="0.1" value={height} onChange={(e) => setHeight(parseFloat(e.target.value) || 0)} />
        </div>
        <div className="ced-field">
          <label>Unité</label>
          <div className="ced-unit">
            <button type="button" className={unit === "cm" ? "on" : ""} onClick={() => setUnit("cm")}>cm</button>
            <button type="button" className={unit === "px" ? "on" : ""} onClick={() => setUnit("px")}>px</button>
          </div>
        </div>
        {!dataMode && (
          <>
            <div className="ced-field">
              <label>Exemplaires</label>
              <input type="number" min="1" value={copies} onChange={(e) => setCopies(parseInt(e.target.value, 10) || 1)} />
            </div>
            <button type="button" className="ced-fill" onClick={() => setCopies(perPage)} title="Remplir une feuille A4">
              Remplir 1 A4 ({perPage})
            </button>
          </>
        )}
        {dataMode && (
          <span className="ced-datahint">1 étiquette par article · {perPage} / feuille A4</span>
        )}
      </div>

      {/* Palette d'ajout */}
      <div className="ced-palette">
        <button type="button" onClick={addText}><HiPlus /> Texte</button>
        {dataMode && (
          <div className="ced-fieldadd">
            <HiViewList />
            <select
              value=""
              onChange={(e) => {
                if (e.target.value) addField(e.target.value);
                e.target.value = "";
              }}
            >
              <option value="">Champ à insérer…</option>
              {fields.map((f) => (
                <option key={f.key} value={f.key}>{optionLabel(f)}</option>
              ))}
            </select>
          </div>
        )}
        <button type="button" onClick={addLine}><HiMinus /> Trait</button>
        <button type="button" onClick={addRect}><HiStop /> Rectangle</button>
        <button type="button" onClick={addLogo}><HiPhotograph /> Logo</button>
        {/* Image libre : l'utilisateur pose SON visuel (PNG/JPEG), en plus du
            logo de la société. */}
        <button type="button" onClick={() => ouvrirImport(null)}>
          <HiPhotograph /> Image
        </button>
        <input
          ref={fichierRef}
          type="file"
          accept={`${IMAGE_TYPES},application/pdf`}
          style={{ display: "none" }}
          onChange={onFichierImage}
        />
        {dataMode && (
          <button type="button" onClick={addBarcode}><HiQrcode /> Code-barres</button>
        )}
      </div>

      {imgMsg && <div className="ced-msg">{imgMsg}</div>}

      <div className="ced-main">
        {/* Aperçu / scène */}
        <div className="ced-stage" ref={stageRef}>
          <div
            ref={labelRef}
            className="ced-label"
            style={{ width: widthPx * scale, height: heightPx * scale }}
            onMouseDown={() => setSelectedId(null)}
          >
            {elements.map(renderEl)}
          </div>
          <div className="ced-stage-info">
            {Math.round(widthPx)} × {Math.round(heightPx)} px
            {unit === "cm" ? ` (${width} × ${height} cm)` : ""} · {perPage} / feuille A4
          </div>
        </div>

        {/* Panneau de l'élément sélectionné */}
        <div className="ced-panel">
          {selected ? (
            <>
              <div className="ced-panel-head">
                <span>
                  {selected.kind === "text" && "Texte"}
                  {selected.kind === "field" && `Champ : ${fieldLabel(selected.field)}`}
                  {selected.kind === "line" && "Trait"}
                  {selected.kind === "rect" && "Rectangle"}
                  {selected.kind === "logo" && "Logo"}
                  {selected.kind === "image" && "Image"}
                  {selected.kind === "barcode" && "Code-barres"}
                </span>
                <button type="button" className="ced-del" onClick={removeSel}><HiTrash /></button>
              </div>

              {selected.kind === "text" && (
                <>
                  <label className="ced-plabel">Texte</label>
                  <textarea
                    className="ced-ptext"
                    rows={2}
                    value={selected.text}
                    onChange={(e) => updateSel({ text: e.target.value })}
                    placeholder="Votre texte (Entrée = nouvelle ligne)"
                  />
                </>
              )}
              {selected.kind === "field" && (
                <>
                  <label className="ced-plabel">Champ à afficher</label>
                  <select className="ced-pselect" value={selected.field} onChange={(e) => updateSel({ field: e.target.value })}>
                    {fields.map((f) => (
                      <option key={f.key} value={f.key}>{optionLabel(f)}</option>
                    ))}
                  </select>
                  <label className="ced-plabel">Retour à la ligne tous les (caractères)</label>
                  <input
                    type="number"
                    className="ced-pselect"
                    min="0"
                    value={selected.wrap || 0}
                    onChange={(e) => updateSel({ wrap: Math.max(0, parseInt(e.target.value, 10) || 0) })}
                    placeholder="0 = une seule ligne"
                  />
                  <span className="ced-phint">
                    0 = pas de retour (une seule ligne). Sinon le texte passe à la
                    ligne après ce nombre de caractères (une ou plusieurs lignes).
                  </span>
                </>
              )}

              {isTextLike && (
                <div className="ced-prow">
                  <div className="ced-field">
                    <label>Taille (px)</label>
                    <input type="number" min="6" value={selected.fontSize} onChange={(e) => updateSel({ fontSize: parseInt(e.target.value, 10) || 6 })} />
                  </div>
                  <div className="ced-field">
                    <label>Couleur</label>
                    <input type="color" value={selected.color} onChange={(e) => updateSel({ color: e.target.value })} />
                  </div>
                  <label className="ced-check">
                    <input type="checkbox" checked={selected.bold} onChange={(e) => updateSel({ bold: e.target.checked })} /> Gras
                  </label>
                </div>
              )}

              {selected.kind === "line" && (
                <div className="ced-prow">
                  <div className="ced-field">
                    <label>Longueur (px)</label>
                    <input type="number" min="1" value={selected.length} onChange={(e) => updateSel({ length: parseInt(e.target.value, 10) || 1 })} />
                  </div>
                  <div className="ced-field">
                    <label>Épaisseur</label>
                    <input type="number" min="1" value={selected.thickness} onChange={(e) => updateSel({ thickness: parseInt(e.target.value, 10) || 1 })} />
                  </div>
                  <div className="ced-field">
                    <label>Sens</label>
                    <div className="ced-unit">
                      <button type="button" className={selected.orientation === "h" ? "on" : ""} onClick={() => updateSel({ orientation: "h" })}>—</button>
                      <button type="button" className={selected.orientation === "v" ? "on" : ""} onClick={() => updateSel({ orientation: "v" })}>|</button>
                    </div>
                  </div>
                  <div className="ced-field">
                    <label>Couleur</label>
                    <input type="color" value={selected.color} onChange={(e) => updateSel({ color: e.target.value })} />
                  </div>
                </div>
              )}

              {selected.kind === "rect" && (
                <>
                  <div className="ced-prow">
                    <div className="ced-field">
                      <label>Largeur (px)</label>
                      <input type="number" min="2" value={selected.w} onChange={(e) => updateSel({ w: parseInt(e.target.value, 10) || 2 })} />
                    </div>
                    <div className="ced-field">
                      <label>Hauteur (px)</label>
                      <input type="number" min="2" value={selected.h} onChange={(e) => updateSel({ h: parseInt(e.target.value, 10) || 2 })} />
                    </div>
                    <div className="ced-field">
                      <label>Bordure</label>
                      <input type="number" min="0" value={selected.lineWidth} onChange={(e) => updateSel({ lineWidth: parseInt(e.target.value, 10) || 0 })} />
                    </div>
                  </div>
                  <div className="ced-prow">
                    <div className="ced-field">
                      <label>Couleur trait</label>
                      <input type="color" value={selected.color} onChange={(e) => updateSel({ color: e.target.value })} />
                    </div>
                    <label className="ced-check">
                      <input type="checkbox" checked={selected.fill} onChange={(e) => updateSel({ fill: e.target.checked })} /> Rempli
                    </label>
                    {selected.fill && (
                      <div className="ced-field">
                        <label>Remplissage</label>
                        <input type="color" value={selected.fillColor} onChange={(e) => updateSel({ fillColor: e.target.value })} />
                      </div>
                    )}
                  </div>
                </>
              )}

              {selected.kind === "barcode" && (
                <>
                  <label className="ced-plabel">Source du code (EAN-13)</label>
                  <select
                    className="ced-pselect"
                    value={selected.field || ""}
                    onChange={(e) => updateSel({ field: e.target.value })}
                  >
                    <option value="">Code GENCOD de l'article</option>
                    {fields.map((f) => (
                      <option key={f.key} value={f.key}>{f.label}</option>
                    ))}
                  </select>
                </>
              )}

              {(selected.kind === "logo" ||
                selected.kind === "barcode" ||
                selected.kind === "image") && (
                <div className="ced-prow">
                  <div className="ced-field">
                    <label>Largeur (px)</label>
                    <input
                      type="number"
                      min="10"
                      value={selected.w}
                      onChange={(e) => {
                        const w = parseInt(e.target.value, 10) || 10;
                        // Une image importée garde ses proportions par défaut :
                        // une photo étirée sur une étiquette se voit tout de
                        // suite, et personne ne pense à recalculer la hauteur.
                        const lie =
                          selected.kind === "image" &&
                          selected.garderRatio &&
                          selected.ratio;
                        updateSel(
                          lie
                            ? { w, h: Math.max(10, Math.round(w / selected.ratio)) }
                            : { w },
                        );
                      }}
                    />
                  </div>
                  <div className="ced-field">
                    <label>Hauteur (px)</label>
                    <input
                      type="number"
                      min="10"
                      value={selected.h}
                      onChange={(e) => {
                        const h = parseInt(e.target.value, 10) || 10;
                        const lie =
                          selected.kind === "image" &&
                          selected.garderRatio &&
                          selected.ratio;
                        updateSel(
                          lie
                            ? { h, w: Math.max(10, Math.round(h * selected.ratio)) }
                            : { h },
                        );
                      }}
                    />
                  </div>
                </div>
              )}

              {selected.kind === "image" && (
                <>
                  <label className="ced-check">
                    <input
                      type="checkbox"
                      checked={!!selected.garderRatio}
                      onChange={(e) => updateSel({ garderRatio: e.target.checked })}
                    />
                    <span>Conserver les proportions</span>
                  </label>
                  <div className="ced-center">
                    <button type="button" onClick={() => ouvrirImport(selected.id)}>
                      Remplacer l'image
                    </button>
                    {selected.ratio && (
                      <button
                        type="button"
                        onClick={() =>
                          updateSel({
                            h: Math.max(10, Math.round(selected.w / selected.ratio)),
                          })
                        }
                        title="Recalculer la hauteur d'après la largeur"
                      >
                        Rétablir le ratio
                      </button>
                    )}
                  </div>
                </>
              )}

              {/* Position + centrage */}
              <div className="ced-prow">
                <div className="ced-field">
                  <label>X (px)</label>
                  <input type="number" value={Math.round(selected.x)} onChange={(e) => updateSel({ x: parseInt(e.target.value, 10) || 0 })} />
                </div>
                <div className="ced-field">
                  <label>Y (px)</label>
                  <input type="number" value={Math.round(selected.y)} onChange={(e) => updateSel({ y: parseInt(e.target.value, 10) || 0 })} />
                </div>
              </div>
              <div className="ced-center">
                <button type="button" onClick={centerH}>Centrer ↔</button>
                <button type="button" onClick={centerV}>Centrer ↕</button>
              </div>
            </>
          ) : (
            <div className="ced-panel-empty">
              Ajoutez un élément avec la palette ci-dessus, puis cliquez dessus
              pour l'éditer. Glissez-le pour le placer.
              {selected === null && dataMode && (
                <p>
                  Les <b>champs article</b> et le <b>code-barres</b> se remplissent
                  automatiquement pour chaque article de votre liste.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default CustomEtiquetteDesigner;
