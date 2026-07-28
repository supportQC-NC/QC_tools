// src/components/Admin/MailBlockDesigner.jsx
//
// Éditeur d'email PAR BLOCS de niveau « Mailchimp » (aucun CSS à écrire) :
//  - glisser-déposer pour réordonner les blocs ;
//  - aperçu Ordinateur / Mobile ;
//  - édition INLINE du texte directement dans l'aperçu (WYSIWYG) ;
//  - blocs riches : titre, texte, image, bouton, colonnes, réseaux sociaux,
//    liste à puces, séparateur, espace, HTML libre ;
//  - couleur de fond + espacements PAR bloc ;
//  - couleurs primaire/secondaire de la société en un clic ;
//  - variables de personnalisation {{nom}} / {{email}} ;
//  - modèles de départ.
// Émet { blocks, settings } au parent via onChange.
import React, { useEffect, useRef, useState } from "react";
import {
  HiPlus,
  HiTrash,
  HiChevronUp,
  HiChevronDown,
  HiViewBoards,
  HiPhotograph,
  HiCursorClick,
  HiMinus,
  HiDuplicate,
  HiViewGrid,
  HiShare,
  HiCode,
  HiMenuAlt2,
  HiTemplate,
  HiDeviceMobile,
  HiDesktopComputer,
} from "react-icons/hi";
import { useUploadMailImageMutation } from "../../slices/mailingApiSlice";
import "./MailBlockDesigner.css";

let _seq = 0;
const nid = () => `b-${Date.now()}-${_seq++}`;

// Réseaux sociaux : abréviation + couleur de marque (badge rond).
const SOCIAL = {
  facebook: { abbr: "f", bg: "#1877F2", label: "Facebook" },
  instagram: { abbr: "IG", bg: "#E4405F", label: "Instagram" },
  linkedin: { abbr: "in", bg: "#0A66C2", label: "LinkedIn" },
  twitter: { abbr: "X", bg: "#000000", label: "X / Twitter" },
  youtube: { abbr: "▶", bg: "#FF0000", label: "YouTube" },
  whatsapp: { abbr: "wa", bg: "#25D366", label: "WhatsApp" },
  tiktok: { abbr: "tk", bg: "#010101", label: "TikTok" },
  website: { abbr: "web", bg: "#4F46E5", label: "Site web" },
};

// Options communes à TOUS les blocs (fond + espacements).
const COMMON = { bg: "", padTop: 8, padBottom: 8, padX: 28 };

const colItem = (title, text) => ({
  img: "", title, titleColor: "#111111", titleSize: 18,
  text, textColor: "#444444", textSize: 14,
  btnLabel: "", btnLink: "https://", btnBg: "#2f7bef", btnColor: "#ffffff",
  align: "left", radius: 0,
});

const DEFAULTS = {
  heading: { text: "Votre titre", fontSize: 26, color: "#111111", align: "center", bold: true, lineHeight: 1.25 },
  text: { text: "Votre texte ici.\nÉcrivez librement.", fontSize: 15, color: "#333333", align: "left", bold: false, lineHeight: 1.55 },
  image: { src: "", width: 320, fullWidth: false, align: "center", link: "", alt: "", radius: 0 },
  button: { label: "En savoir plus", link: "https://", bg: "#2f7bef", color: "#ffffff", fontSize: 15, align: "center", radius: 6, padY: 12, padX: 26, fullWidth: false },
  divider: { color: "#e2e2e2", thickness: 1, widthPct: 100, align: "center" },
  spacer: { height: 20 },
  columns: { cols: 2, gap: 16, items: [colItem("Colonne 1", "Décrivez votre offre ici."), colItem("Colonne 2", "Décrivez votre offre ici."), colItem("Colonne 3", "Décrivez votre offre ici.")] },
  imagetext: { img: "", imgSide: "left", imgWidth: 40, gap: 16, valign: "top", radius: 0, alt: "", title: "Titre à côté de l'image", titleColor: "#111111", titleSize: 18, text: "Écrivez votre texte juste à côté de l'image.", textColor: "#444444", textSize: 14, btnLabel: "", btnLink: "https://", btnBg: "#2f7bef", btnColor: "#ffffff", align: "left" },
  social: { links: [{ platform: "facebook", url: "" }, { platform: "instagram", url: "" }], size: 38, align: "center" },
  list: { items: ["Premier point", "Deuxième point", "Troisième point"], ordered: false, fontSize: 15, color: "#333333", align: "left" },
  html: { code: '<p style="font-size:14px;color:#333;">Votre HTML personnalisé ici…</p>' },
};

const KIND_LABEL = {
  heading: "Titre", text: "Texte", image: "Image", button: "Bouton",
  divider: "Séparateur", spacer: "Espace", columns: "Colonnes",
  imagetext: "Image + texte",
  social: "Réseaux sociaux", list: "Liste à puces", html: "HTML libre",
};

const SWATCHES = [
  "#111111", "#444444", "#ffffff", "#f2f4f7",
  "#2f7bef", "#0ea5e9", "#10b981", "#22c55e",
  "#f59e0b", "#ef4444", "#ec4899", "#8b5cf6",
];

const FONTS = [
  { label: "Système", value: "-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif" },
  { label: "Arial", value: "Arial,Helvetica,sans-serif" },
  { label: "Verdana", value: "Verdana,Geneva,sans-serif" },
  { label: "Trebuchet", value: "'Trebuchet MS',sans-serif" },
  { label: "Georgia (serif)", value: "Georgia,'Times New Roman',serif" },
  { label: "Times (serif)", value: "'Times New Roman',Times,serif" },
  { label: "Courier (mono)", value: "'Courier New',monospace" },
];

const MERGE_TAGS = [
  { tag: "{{nom}}", label: "Nom du client" },
  { tag: "{{email}}", label: "Email" },
  { tag: "{{nom|Cher client}}", label: "Nom (repli)" },
];

const int = (v, d) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : d;
};

// ── Modèles de départ (utilisent les couleurs de marque si dispo) ──
const templates = (brand) => {
  const p = brand?.primary || "#2f7bef";
  const s = brand?.secondary || "#10b981";
  return [
    {
      name: "Vierge",
      make: () => ({
        blocks: [{ kind: "heading", ...DEFAULTS.heading }],
        settings: null,
      }),
    },
    {
      name: "Newsletter",
      make: () => ({
        blocks: [
          { ...COMMON, kind: "heading", ...DEFAULTS.heading, text: "Les nouveautés du mois", color: p },
          { ...COMMON, kind: "text", ...DEFAULTS.text, text: "Bonjour {{nom|cher client}},\n\nVoici notre sélection du moment." },
          { ...COMMON, kind: "image", ...DEFAULTS.image, fullWidth: true },
          { ...COMMON, kind: "columns", ...DEFAULTS.columns, cols: 2 },
          { ...COMMON, kind: "button", ...DEFAULTS.button, label: "Voir le catalogue", bg: p },
          { ...COMMON, kind: "divider", ...DEFAULTS.divider },
          { ...COMMON, kind: "social", ...DEFAULTS.social },
          { ...COMMON, kind: "text", ...DEFAULTS.text, text: "Quincaillerie · Nouvelle-Calédonie", fontSize: 12, color: "#888888", align: "center" },
        ],
        settings: null,
      }),
    },
    {
      name: "Promotion",
      make: () => ({
        blocks: [
          { ...COMMON, kind: "heading", bg: p, padTop: 30, padBottom: 30, text: "OFFRE SPÉCIALE -20%", fontSize: 30, color: "#ffffff", align: "center", bold: true, lineHeight: 1.2 },
          { ...COMMON, kind: "text", ...DEFAULTS.text, text: "Profitez de -20% sur tout le rayon, jusqu'à dimanche.", align: "center", fontSize: 17 },
          { ...COMMON, kind: "button", ...DEFAULTS.button, label: "J'en profite", bg: s, fullWidth: false },
          { ...COMMON, kind: "spacer", height: 10 },
          { ...COMMON, kind: "social", ...DEFAULTS.social },
        ],
        settings: null,
      }),
    },
    {
      name: "Annonce",
      make: () => ({
        blocks: [
          { ...COMMON, kind: "heading", ...DEFAULTS.heading, text: "Une information importante", color: p },
          { ...COMMON, kind: "text", ...DEFAULTS.text, text: "Bonjour {{nom}},\n\nNous souhaitons vous informer que…" },
          { ...COMMON, kind: "divider", ...DEFAULTS.divider },
          { ...COMMON, kind: "button", ...DEFAULTS.button, label: "En savoir plus", bg: p },
        ],
        settings: null,
      }),
    },
  ];
};

// ── Champ couleur avec swatches (marque + palette) ──
const ColorField = ({ label, value, onChange, brand, allowNone }) => {
  const norm = (c) => String(c || "").toLowerCase();
  return (
    <div className="mbd-colorfield">
      {label && <div className="mbd-lbl">{label}</div>}
      <div className="mbd-swatches">
        {allowNone && (
          <button type="button" className={`mbd-sw mbd-sw-none ${!value ? "on" : ""}`} title="Aucun (transparent)" onClick={() => onChange("")} />
        )}
        {brand?.primary && (
          <button type="button" className={`mbd-sw mbd-sw-brand ${norm(value) === norm(brand.primary) ? "on" : ""}`} style={{ background: brand.primary }} title="Couleur primaire de la société" onClick={() => onChange(brand.primary)} />
        )}
        {brand?.secondary && (
          <button type="button" className={`mbd-sw mbd-sw-brand ${norm(value) === norm(brand.secondary) ? "on" : ""}`} style={{ background: brand.secondary }} title="Couleur secondaire de la société" onClick={() => onChange(brand.secondary)} />
        )}
        {SWATCHES.map((c) => (
          <button type="button" key={c} className={`mbd-sw ${norm(value) === norm(c) ? "on" : ""}`} style={{ background: c }} title={c} onClick={() => onChange(c)} />
        ))}
        <input type="color" className="mbd-sw-input" value={value && /^#[0-9a-f]{6}$/i.test(value) ? value : "#ffffff"} onChange={(e) => onChange(e.target.value)} title="Couleur personnalisée" />
      </div>
    </div>
  );
};

const AlignPicker = ({ align, onChange }) => (
  <div className="mbd-align">
    {["left", "center", "right"].map((a) => (
      <button key={a} type="button" className={align === a ? "on" : ""} onClick={() => onChange(a)}>
        {a === "left" ? "⬅" : a === "center" ? "⬌" : "➡"}
      </button>
    ))}
  </div>
);

const NumField = ({ label, value, min, onChange, suffix }) => (
  <label>
    {label}
    <span className="mbd-numwrap">
      <input type="number" min={min} value={value} onChange={(e) => onChange(int(e.target.value, min ?? 0))} />
      {suffix && <em>{suffix}</em>}
    </span>
  </label>
);

// Édition INLINE (contentEditable non-contrôlé : commit au blur, sync par ref).
const EditableText = ({ value, onCommit, style, className }) => {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current && ref.current.innerText !== (value ?? "")) {
      ref.current.innerText = value ?? "";
    }
  }, [value]);
  return (
    <div
      ref={ref}
      className={className}
      style={style}
      contentEditable
      suppressContentEditableWarning
      onBlur={(e) => onCommit(e.currentTarget.innerText)}
    />
  );
};

const MailBlockDesigner = ({ value, onChange, brand }) => {
  const [blocks, setBlocks] = useState(
    value?.blocks?.length
      ? value.blocks.map((b) => ({ id: nid(), ...COMMON, ...b }))
      : [{ id: nid(), kind: "heading", ...COMMON, ...DEFAULTS.heading }],
  );
  const [settings, setSettings] = useState({
    bg: "#f2f4f7", cardBg: "#ffffff", contentWidth: 600, fontFamily: FONTS[0].value,
    ...(value?.settings || {}),
  });
  const [selectedId, setSelectedId] = useState(null);
  const [activeCol, setActiveCol] = useState(0);
  const [device, setDevice] = useState("desktop");
  const [dragId, setDragId] = useState(null);
  const [showTpl, setShowTpl] = useState(false);
  const [uploadImage, { isLoading: uploading }] = useUploadMailImageMutation();

  const fileRef = useRef(null);
  const pendingImg = useRef(null); // { id } bloc image  OU  { id, col } colonne

  const selected = blocks.find((b) => b.id === selectedId) || null;

  useEffect(() => {
    onChange?.({ blocks: blocks.map(({ id, ...b }) => b), settings });
  }, [blocks, settings, onChange]);

  const add = (kind) => {
    const b = { id: nid(), kind, ...COMMON, ...structuredCloneSafe(DEFAULTS[kind]) };
    setBlocks((prev) => [...prev, b]);
    setSelectedId(b.id);
    setActiveCol(0);
  };
  const updateSel = (patch) =>
    setBlocks((prev) => prev.map((b) => (b.id === selectedId ? { ...b, ...patch } : b)));
  const updateColItem = (idx, patch) =>
    setBlocks((prev) =>
      prev.map((b) => {
        if (b.id !== selectedId) return b;
        const items = (b.items || []).map((it, i) => (i === idx ? { ...it, ...patch } : it));
        return { ...b, items };
      }),
    );
  const removeBlock = (id) => {
    setBlocks((prev) => prev.filter((b) => b.id !== id));
    if (selectedId === id) setSelectedId(null);
  };
  const duplicate = (id) =>
    setBlocks((prev) => {
      const i = prev.findIndex((b) => b.id === id);
      if (i < 0) return prev;
      const copy = { ...structuredCloneSafe(prev[i]), id: nid() };
      const out = [...prev];
      out.splice(i + 1, 0, copy);
      return out;
    });
  const move = (id, dir) =>
    setBlocks((prev) => {
      const i = prev.findIndex((b) => b.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const copy = [...prev];
      [copy[i], copy[j]] = [copy[j], copy[i]];
      return copy;
    });
  const dropOn = (targetId) => {
    setBlocks((prev) => {
      if (!dragId || dragId === targetId) return prev;
      const from = prev.findIndex((b) => b.id === dragId);
      const to = prev.findIndex((b) => b.id === targetId);
      if (from < 0 || to < 0) return prev;
      const copy = [...prev];
      const [m] = copy.splice(from, 1);
      copy.splice(to, 0, m);
      return copy;
    });
    setDragId(null);
  };

  const applyTemplate = (tpl) => {
    const { blocks: bl, settings: st } = tpl.make(brand);
    setBlocks(bl.map((b) => ({ id: nid(), ...COMMON, ...b })));
    if (st) setSettings((s) => ({ ...s, ...st }));
    setSelectedId(null);
    setShowTpl(false);
  };

  const openImagePicker = (target) => {
    pendingImg.current = target;
    fileRef.current?.click();
  };
  const onPickImage = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    const target = pendingImg.current;
    pendingImg.current = null;
    if (!file || !target) return;
    try {
      const res = await uploadImage(file).unwrap();
      if (target.col != null) {
        setBlocks((prev) =>
          prev.map((b) => {
            if (b.id !== target.id) return b;
            const items = (b.items || []).map((it, i) => (i === target.col ? { ...it, img: res.url } : it));
            return { ...b, items };
          }),
        );
      } else {
        const field = target.field || "src";
        setBlocks((prev) => prev.map((b) => (b.id === target.id ? { ...b, [field]: res.url } : b)));
      }
    } catch {
      alert("Envoi de l'image impossible (formats image, max 5 Mo).");
    }
  };

  const socialUrl = (b, p) => (b.links || []).find((l) => l.platform === p)?.url || "";
  const setSocial = (p, url) => {
    const links = [...(selected.links || [])];
    const i = links.findIndex((l) => l.platform === p);
    if (i >= 0) links[i] = { platform: p, url };
    else links.push({ platform: p, url });
    updateSel({ links });
  };

  const insertTag = (tag) => {
    if (!selected) return;
    updateSel({ text: `${selected.text || ""}${selected.text ? " " : ""}${tag}` });
  };

  const wrapStyle = (b) => ({
    paddingTop: b.padTop ?? 8,
    paddingBottom: b.padBottom ?? 8,
    paddingLeft: b.padX ?? 28,
    paddingRight: b.padX ?? 28,
    background: b.bg || "transparent",
  });

  // ── Rendu d'un bloc dans l'aperçu ──
  const renderBlock = (b) => {
    const align = b.align || "left";
    if (b.kind === "heading")
      return (
        <EditableText
          value={b.text}
          onCommit={(t) => setBlocks((prev) => prev.map((x) => (x.id === b.id ? { ...x, text: t } : x)))}
          style={{ fontSize: b.fontSize, color: b.color, textAlign: align, fontWeight: b.bold === false ? 400 : 700, lineHeight: b.lineHeight || 1.25, whiteSpace: "pre-wrap", outline: "none" }}
        />
      );
    if (b.kind === "text")
      return (
        <EditableText
          value={b.text}
          onCommit={(t) => setBlocks((prev) => prev.map((x) => (x.id === b.id ? { ...x, text: t } : x)))}
          style={{ fontSize: b.fontSize, color: b.color, textAlign: align, fontWeight: b.bold ? 700 : 400, lineHeight: b.lineHeight || 1.55, whiteSpace: "pre-wrap", outline: "none" }}
        />
      );
    if (b.kind === "image")
      return b.src ? (
        <div style={{ textAlign: align }}>
          <img src={b.src} alt={b.alt || ""} style={{ maxWidth: "100%", width: b.fullWidth ? "100%" : b.width, borderRadius: b.radius || 0, display: "inline-block" }} />
        </div>
      ) : (
        <div className="mbd-imgph" onClick={(e) => { e.stopPropagation(); setSelectedId(b.id); openImagePicker({ id: b.id }); }}>
          <HiPhotograph size={22} />
          <span>{uploading ? "Envoi…" : "Cliquez pour choisir une image"}</span>
        </div>
      );
    if (b.kind === "button") {
      const btn = { display: b.fullWidth ? "block" : "inline-block", background: b.bg, color: b.color, padding: `${b.padY ?? 12}px ${b.padX ?? 26}px`, borderRadius: b.radius ?? 6, fontWeight: 600, fontSize: b.fontSize, textAlign: "center" };
      return (
        <div style={{ textAlign: align }}>
          <span style={btn}>{b.label}</span>
        </div>
      );
    }
    if (b.kind === "divider")
      return (
        <div style={{ textAlign: align }}>
          <hr style={{ border: 0, borderTop: `${b.thickness}px solid ${b.color}`, width: `${b.widthPct ?? 100}%`, margin: align === "center" ? "0 auto" : align === "right" ? "0 0 0 auto" : 0 }} />
        </div>
      );
    if (b.kind === "spacer") return <div style={{ height: b.height }} />;
    if (b.kind === "columns") {
      const cols = Math.min(Math.max(b.cols || 2, 1), 3);
      const items = (b.items || []).slice(0, cols);
      return (
        <div style={{ display: "flex", gap: b.gap ?? 16 }}>
          {items.map((it, i) => (
            <div key={i} style={{ flex: 1, minWidth: 0, textAlign: it.align || "left" }}>
              {it.img ? (
                <img src={it.img} alt="" style={{ width: "100%", borderRadius: it.radius || 0, marginBottom: 8, display: "block" }} />
              ) : (
                <div className="mbd-imgph mbd-imgph-sm" onClick={(e) => { e.stopPropagation(); setSelectedId(b.id); setActiveCol(i); openImagePicker({ id: b.id, col: i }); }}>
                  <HiPhotograph size={16} />
                </div>
              )}
              {it.title && <div style={{ fontSize: it.titleSize || 18, fontWeight: 700, color: it.titleColor || "#111", marginBottom: 6, whiteSpace: "pre-wrap" }}>{it.title}</div>}
              {it.text && <div style={{ fontSize: it.textSize || 14, color: it.textColor || "#444", lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{it.text}</div>}
              {it.btnLabel && (
                <div style={{ marginTop: 10 }}>
                  <span style={{ display: "inline-block", background: it.btnBg || "#2f7bef", color: it.btnColor || "#fff", padding: "9px 18px", borderRadius: 6, fontSize: 13, fontWeight: 600 }}>{it.btnLabel}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      );
    }
    if (b.kind === "imagetext") {
      const side = b.imgSide === "right" ? "right" : "left";
      const iw = Math.min(Math.max(b.imgWidth || 40, 20), 80);
      const imgEl = b.img ? (
        <img src={b.img} alt={b.alt || ""} style={{ width: "100%", borderRadius: b.radius || 0, display: "block" }} />
      ) : (
        <div className="mbd-imgph mbd-imgph-sm" onClick={(e) => { e.stopPropagation(); setSelectedId(b.id); openImagePicker({ id: b.id, field: "img" }); }}>
          <HiPhotograph size={16} />
        </div>
      );
      return (
        <div style={{ display: "flex", gap: b.gap ?? 16, alignItems: b.valign === "middle" ? "center" : "flex-start", flexDirection: side === "right" ? "row-reverse" : "row" }}>
          <div style={{ flex: `0 0 ${iw}%`, maxWidth: `${iw}%` }}>{imgEl}</div>
          <div style={{ flex: 1, minWidth: 0, textAlign: b.align || "left" }}>
            {b.title && <div style={{ fontSize: b.titleSize || 18, fontWeight: 700, color: b.titleColor || "#111", marginBottom: 6, whiteSpace: "pre-wrap" }}>{b.title}</div>}
            {b.text && <div style={{ fontSize: b.textSize || 14, color: b.textColor || "#444", lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{b.text}</div>}
            {b.btnLabel && (
              <div style={{ marginTop: 10 }}>
                <span style={{ display: "inline-block", background: b.btnBg || "#2f7bef", color: b.btnColor || "#fff", padding: "9px 18px", borderRadius: 6, fontSize: 13, fontWeight: 600 }}>{b.btnLabel}</span>
              </div>
            )}
          </div>
        </div>
      );
    }
    if (b.kind === "social") {
      const size = b.size || 38;
      const links = (b.links || []).filter((l) => l.url);
      return (
        <div style={{ textAlign: b.align || "center" }}>
          {links.length ? (
            links.map((l, i) => {
              const p = SOCIAL[l.platform] || SOCIAL.website;
              return (
                <span key={i} style={{ display: "inline-block", width: size, height: size, lineHeight: `${size}px`, textAlign: "center", background: p.bg, color: "#fff", borderRadius: "50%", fontWeight: 700, fontSize: Math.round(size * 0.42), margin: "0 4px", fontFamily: "Arial,sans-serif" }}>{p.abbr}</span>
              );
            })
          ) : (
            <span className="mbd-ph-inline">Ajoutez vos liens sociaux dans le panneau →</span>
          )}
        </div>
      );
    }
    if (b.kind === "list") {
      const items = (b.items || []).filter((x) => String(x).trim());
      const Tag = b.ordered ? "ol" : "ul";
      const lst = b.ordered ? "decimal" : "disc";
      return (
        <Tag style={{ margin: 0, padding: "0 0 0 22px", listStyleType: lst, listStylePosition: "outside", fontSize: b.fontSize, color: b.color, textAlign: b.align || "left", lineHeight: 1.6 }}>
          {items.map((it, i) => <li key={i} style={{ marginBottom: 4, display: "list-item", listStyleType: lst }}>{it}</li>)}
        </Tag>
      );
    }
    if (b.kind === "html")
      return <div className="mbd-html" dangerouslySetInnerHTML={{ __html: b.code || "" }} />;
    return null;
  };

  const previewWidth = device === "mobile" ? 380 : settings.contentWidth;

  return (
    <div className="mbd">
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={onPickImage} />

      {/* Barre d'outils : palette + modèles + device */}
      <div className="mbd-toolbar">
        <div className="mbd-palette">
          <button type="button" onClick={() => add("heading")}><HiPlus /> Titre</button>
          <button type="button" onClick={() => add("text")}><HiViewBoards /> Texte</button>
          <button type="button" onClick={() => add("image")}><HiPhotograph /> Image</button>
          <button type="button" onClick={() => add("button")}><HiCursorClick /> Bouton</button>
          <button type="button" onClick={() => add("columns")}><HiViewGrid /> Colonnes</button>
          <button type="button" onClick={() => add("imagetext")}><HiPhotograph /> Image + texte</button>
          <button type="button" onClick={() => add("social")}><HiShare /> Social</button>
          <button type="button" onClick={() => add("list")}><HiMenuAlt2 /> Liste</button>
          <button type="button" onClick={() => add("divider")}><HiMinus /> Séparateur</button>
          <button type="button" onClick={() => add("spacer")}>⇳ Espace</button>
          <button type="button" onClick={() => add("html")}><HiCode /> HTML</button>
        </div>
        <div className="mbd-toolbar-right">
          <div className="mbd-tpl">
            <button type="button" className="mbd-tpl-btn" onClick={() => setShowTpl((v) => !v)}><HiTemplate /> Modèles</button>
            {showTpl && (
              <div className="mbd-tpl-menu">
                {templates(brand).map((t) => (
                  <button type="button" key={t.name} onClick={() => applyTemplate(t)}>{t.name}</button>
                ))}
              </div>
            )}
          </div>
          <div className="mbd-device">
            <button type="button" className={device === "desktop" ? "on" : ""} onClick={() => setDevice("desktop")} title="Ordinateur"><HiDesktopComputer /></button>
            <button type="button" className={device === "mobile" ? "on" : ""} onClick={() => setDevice("mobile")} title="Mobile"><HiDeviceMobile /></button>
          </div>
        </div>
      </div>

      <div className="mbd-main">
        {/* Aperçu */}
        <div className="mbd-preview" style={{ background: settings.bg }}>
          <div className={`mbd-card ${device === "mobile" ? "mbd-card--mobile" : ""}`} style={{ width: previewWidth, maxWidth: "100%", background: settings.cardBg || "#fff", fontFamily: settings.fontFamily || undefined }}>
            {blocks.map((b) => (
              <div
                key={b.id}
                className={`mbd-block ${selectedId === b.id ? "sel" : ""} ${dragId === b.id ? "dragging" : ""}`}
                style={wrapStyle(b)}
                onClick={() => { setSelectedId(b.id); setActiveCol(0); }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); dropOn(b.id); }}
              >
                {selectedId === b.id && (
                  <div className="mbd-block-tools" onClick={(e) => e.stopPropagation()}>
                    <span className="mbd-drag" draggable onDragStart={(e) => { e.stopPropagation(); setDragId(b.id); }} onDragEnd={() => setDragId(null)} title="Glisser pour déplacer">⠿</span>
                    <button type="button" onClick={() => move(b.id, -1)} title="Monter"><HiChevronUp /></button>
                    <button type="button" onClick={() => move(b.id, 1)} title="Descendre"><HiChevronDown /></button>
                    <button type="button" onClick={() => duplicate(b.id)} title="Dupliquer"><HiDuplicate /></button>
                    <button type="button" onClick={() => removeBlock(b.id)} title="Supprimer"><HiTrash /></button>
                  </div>
                )}
                {renderBlock(b)}
              </div>
            ))}
            {blocks.length === 0 && <div className="mbd-card-empty">Ajoutez des blocs depuis la palette ci-dessus, ou choisissez un modèle.</div>}
          </div>
        </div>

        {/* Panneau */}
        <div className="mbd-panel">
          {selected ? (
            <>
              <div className="mbd-panel-title">{KIND_LABEL[selected.kind]}</div>

              {(selected.kind === "heading" || selected.kind === "text") && (
                <>
                  <textarea className="mbd-input" rows={selected.kind === "text" ? 4 : 2} value={selected.text} onChange={(e) => updateSel({ text: e.target.value })} />
                  <div className="mbd-tags">
                    {MERGE_TAGS.map((t) => (
                      <button type="button" key={t.tag} className="mbd-tag" title={t.label} onClick={() => insertTag(t.tag)}>{t.tag}</button>
                    ))}
                  </div>
                  <div className="mbd-row">
                    <NumField label="Taille" min={8} value={selected.fontSize} onChange={(v) => updateSel({ fontSize: v })} suffix="px" />
                    <NumField label="Interligne ×10" min={8} value={Math.round((selected.lineHeight || 1.4) * 10)} onChange={(v) => updateSel({ lineHeight: v / 10 })} />
                    <label className="mbd-check"><input type="checkbox" checked={!!selected.bold} onChange={(e) => updateSel({ bold: e.target.checked })} /> Gras</label>
                  </div>
                  <ColorField label="Couleur du texte" value={selected.color} onChange={(c) => updateSel({ color: c })} brand={brand} />
                  <AlignPicker align={selected.align} onChange={(a) => updateSel({ align: a })} />
                </>
              )}

              {selected.kind === "image" && (
                <>
                  <button type="button" className="mbd-btn" onClick={() => openImagePicker({ id: selected.id })} disabled={uploading}>
                    {uploading ? "Envoi…" : selected.src ? "Changer l'image" : "Choisir une image"}
                  </button>
                  {selected.src && <div className="mbd-imgprev"><img src={selected.src} alt="" /></div>}
                  <label className="mbd-lbl">Ou URL d'image</label>
                  <input className="mbd-input" value={selected.src} onChange={(e) => updateSel({ src: e.target.value })} placeholder="https://…" />
                  <div className="mbd-row">
                    <NumField label="Largeur" min={40} value={selected.width} onChange={(v) => updateSel({ width: v })} suffix="px" />
                    <NumField label="Arrondi" min={0} value={selected.radius} onChange={(v) => updateSel({ radius: v })} suffix="px" />
                    <label className="mbd-check"><input type="checkbox" checked={!!selected.fullWidth} onChange={(e) => updateSel({ fullWidth: e.target.checked })} /> Pleine largeur</label>
                  </div>
                  <label className="mbd-lbl">Texte alternatif</label>
                  <input className="mbd-input" value={selected.alt} onChange={(e) => updateSel({ alt: e.target.value })} placeholder="Description de l'image" />
                  <label className="mbd-lbl">Lien au clic (optionnel)</label>
                  <input className="mbd-input" value={selected.link} onChange={(e) => updateSel({ link: e.target.value })} placeholder="https://…" />
                  <AlignPicker align={selected.align} onChange={(a) => updateSel({ align: a })} />
                </>
              )}

              {selected.kind === "button" && (
                <>
                  <label className="mbd-lbl">Libellé</label>
                  <input className="mbd-input" value={selected.label} onChange={(e) => updateSel({ label: e.target.value })} />
                  <label className="mbd-lbl">Lien</label>
                  <input className="mbd-input" value={selected.link} onChange={(e) => updateSel({ link: e.target.value })} placeholder="https://…" />
                  <ColorField label="Fond du bouton" value={selected.bg} onChange={(c) => updateSel({ bg: c })} brand={brand} />
                  <ColorField label="Couleur du texte" value={selected.color} onChange={(c) => updateSel({ color: c })} brand={brand} />
                  <div className="mbd-row">
                    <NumField label="Taille texte" min={10} value={selected.fontSize} onChange={(v) => updateSel({ fontSize: v })} suffix="px" />
                    <NumField label="Arrondi" min={0} value={selected.radius} onChange={(v) => updateSel({ radius: v })} suffix="px" />
                  </div>
                  <div className="mbd-row">
                    <NumField label="Padding V" min={0} value={selected.padY} onChange={(v) => updateSel({ padY: v })} suffix="px" />
                    <NumField label="Padding H" min={0} value={selected.padX} onChange={(v) => updateSel({ padX: v })} suffix="px" />
                    <label className="mbd-check"><input type="checkbox" checked={!!selected.fullWidth} onChange={(e) => updateSel({ fullWidth: e.target.checked })} /> Pleine largeur</label>
                  </div>
                  <AlignPicker align={selected.align} onChange={(a) => updateSel({ align: a })} />
                </>
              )}

              {selected.kind === "columns" && (
                <>
                  <div className="mbd-row">
                    <label>Colonnes
                      <select className="mbd-select mbd-select-sm" value={selected.cols} onChange={(e) => updateSel({ cols: int(e.target.value, 2) })}>
                        <option value={2}>2</option>
                        <option value={3}>3</option>
                      </select>
                    </label>
                    <NumField label="Écart" min={0} value={selected.gap} onChange={(v) => updateSel({ gap: v })} suffix="px" />
                  </div>
                  <div className="mbd-coltabs">
                    {Array.from({ length: Math.min(selected.cols || 2, 3) }).map((_, i) => (
                      <button type="button" key={i} className={activeCol === i ? "on" : ""} onClick={() => setActiveCol(i)}>Col {i + 1}</button>
                    ))}
                  </div>
                  {(() => {
                    const i = Math.min(activeCol, (selected.cols || 2) - 1);
                    const it = (selected.items || [])[i] || {};
                    return (
                      <>
                        <button type="button" className="mbd-btn" onClick={() => openImagePicker({ id: selected.id, col: i })} disabled={uploading}>
                          {uploading ? "Envoi…" : it.img ? "Changer l'image" : "Image de la colonne"}
                        </button>
                        {it.img && <div className="mbd-imgprev"><img src={it.img} alt="" /></div>}
                        <label className="mbd-lbl">Titre</label>
                        <input className="mbd-input" value={it.title || ""} onChange={(e) => updateColItem(i, { title: e.target.value })} />
                        <label className="mbd-lbl">Texte</label>
                        <textarea className="mbd-input" rows={3} value={it.text || ""} onChange={(e) => updateColItem(i, { text: e.target.value })} />
                        <div className="mbd-row">
                          <ColorField label="Titre" value={it.titleColor} onChange={(c) => updateColItem(i, { titleColor: c })} brand={brand} />
                          <ColorField label="Texte" value={it.textColor} onChange={(c) => updateColItem(i, { textColor: c })} brand={brand} />
                        </div>
                        <label className="mbd-lbl">Bouton (laisser vide = aucun)</label>
                        <input className="mbd-input" value={it.btnLabel || ""} onChange={(e) => updateColItem(i, { btnLabel: e.target.value })} placeholder="Libellé du bouton" />
                        <input className="mbd-input" value={it.btnLink || ""} onChange={(e) => updateColItem(i, { btnLink: e.target.value })} placeholder="https://…" />
                        <ColorField label="Fond du bouton" value={it.btnBg} onChange={(c) => updateColItem(i, { btnBg: c })} brand={brand} />
                        <AlignPicker align={it.align} onChange={(a) => updateColItem(i, { align: a })} />
                      </>
                    );
                  })()}
                </>
              )}

              {selected.kind === "imagetext" && (
                <>
                  <button type="button" className="mbd-btn" onClick={() => openImagePicker({ id: selected.id, field: "img" })} disabled={uploading}>
                    {uploading ? "Envoi…" : selected.img ? "Changer l'image" : "Choisir une image"}
                  </button>
                  {selected.img && <div className="mbd-imgprev"><img src={selected.img} alt="" /></div>}
                  <label className="mbd-lbl">Position de l'image</label>
                  <div className="mbd-align">
                    <button type="button" className={selected.imgSide !== "right" ? "on" : ""} onClick={() => updateSel({ imgSide: "left" })}>⬅ Gauche</button>
                    <button type="button" className={selected.imgSide === "right" ? "on" : ""} onClick={() => updateSel({ imgSide: "right" })}>Droite ➡</button>
                  </div>
                  <div className="mbd-row">
                    <NumField label="Largeur image" min={20} value={selected.imgWidth} onChange={(v) => updateSel({ imgWidth: Math.min(Math.max(v, 20), 80) })} suffix="%" />
                    <NumField label="Écart" min={0} value={selected.gap} onChange={(v) => updateSel({ gap: v })} suffix="px" />
                    <NumField label="Arrondi" min={0} value={selected.radius} onChange={(v) => updateSel({ radius: v })} suffix="px" />
                  </div>
                  <label className="mbd-lbl">Alignement vertical</label>
                  <div className="mbd-align">
                    <button type="button" className={selected.valign !== "middle" ? "on" : ""} onClick={() => updateSel({ valign: "top" })}>Haut</button>
                    <button type="button" className={selected.valign === "middle" ? "on" : ""} onClick={() => updateSel({ valign: "middle" })}>Milieu</button>
                  </div>
                  <label className="mbd-lbl">Titre</label>
                  <input className="mbd-input" value={selected.title || ""} onChange={(e) => updateSel({ title: e.target.value })} />
                  <label className="mbd-lbl">Texte</label>
                  <textarea className="mbd-input" rows={3} value={selected.text || ""} onChange={(e) => updateSel({ text: e.target.value })} />
                  <div className="mbd-row">
                    <ColorField label="Titre" value={selected.titleColor} onChange={(c) => updateSel({ titleColor: c })} brand={brand} />
                    <ColorField label="Texte" value={selected.textColor} onChange={(c) => updateSel({ textColor: c })} brand={brand} />
                  </div>
                  <label className="mbd-lbl">Bouton (laisser vide = aucun)</label>
                  <input className="mbd-input" value={selected.btnLabel || ""} onChange={(e) => updateSel({ btnLabel: e.target.value })} placeholder="Libellé du bouton" />
                  <input className="mbd-input" value={selected.btnLink || ""} onChange={(e) => updateSel({ btnLink: e.target.value })} placeholder="https://…" />
                  <ColorField label="Fond du bouton" value={selected.btnBg} onChange={(c) => updateSel({ btnBg: c })} brand={brand} />
                  <AlignPicker align={selected.align} onChange={(a) => updateSel({ align: a })} />
                </>
              )}

              {selected.kind === "social" && (
                <>
                  <div className="mbd-social-list">
                    {Object.entries(SOCIAL).map(([key, p]) => (
                      <div className="mbd-social-row" key={key}>
                        <span className="mbd-social-badge" style={{ background: p.bg }}>{p.abbr}</span>
                        <input className="mbd-input" style={{ margin: 0 }} value={socialUrl(selected, key)} onChange={(e) => setSocial(key, e.target.value)} placeholder={`Lien ${p.label}`} />
                      </div>
                    ))}
                  </div>
                  <div className="mbd-row">
                    <NumField label="Taille" min={20} value={selected.size} onChange={(v) => updateSel({ size: v })} suffix="px" />
                  </div>
                  <AlignPicker align={selected.align} onChange={(a) => updateSel({ align: a })} />
                </>
              )}

              {selected.kind === "list" && (
                <>
                  <label className="mbd-lbl">Un élément par ligne</label>
                  <textarea className="mbd-input" rows={5} value={(selected.items || []).join("\n")} onChange={(e) => updateSel({ items: e.target.value.split("\n") })} />
                  <div className="mbd-row">
                    <NumField label="Taille" min={10} value={selected.fontSize} onChange={(v) => updateSel({ fontSize: v })} suffix="px" />
                    <label className="mbd-check"><input type="checkbox" checked={!!selected.ordered} onChange={(e) => updateSel({ ordered: e.target.checked })} /> Numérotée</label>
                  </div>
                  <ColorField label="Couleur" value={selected.color} onChange={(c) => updateSel({ color: c })} brand={brand} />
                  <AlignPicker align={selected.align} onChange={(a) => updateSel({ align: a })} />
                </>
              )}

              {selected.kind === "divider" && (
                <>
                  <div className="mbd-row">
                    <NumField label="Épaisseur" min={1} value={selected.thickness} onChange={(v) => updateSel({ thickness: v })} suffix="px" />
                    <NumField label="Largeur" min={10} value={selected.widthPct} onChange={(v) => updateSel({ widthPct: Math.min(v, 100) })} suffix="%" />
                  </div>
                  <ColorField label="Couleur" value={selected.color} onChange={(c) => updateSel({ color: c })} brand={brand} />
                  <AlignPicker align={selected.align} onChange={(a) => updateSel({ align: a })} />
                </>
              )}

              {selected.kind === "spacer" && (
                <div className="mbd-row">
                  <NumField label="Hauteur" min={2} value={selected.height} onChange={(v) => updateSel({ height: v })} suffix="px" />
                </div>
              )}

              {selected.kind === "html" && (
                <>
                  <label className="mbd-lbl">Code HTML (email-safe : styles inline)</label>
                  <textarea className="mbd-input mbd-code" rows={8} value={selected.code} onChange={(e) => updateSel({ code: e.target.value })} />
                </>
              )}

              {/* Options communes : fond + espacements */}
              <div className="mbd-subsection">
                <div className="mbd-sub-title">Fond & espacements du bloc</div>
                <ColorField label="Couleur de fond du bloc" value={selected.bg} onChange={(c) => updateSel({ bg: c })} brand={brand} allowNone />
                <div className="mbd-row">
                  <NumField label="Marge haut" min={0} value={selected.padTop} onChange={(v) => updateSel({ padTop: v })} suffix="px" />
                  <NumField label="Marge bas" min={0} value={selected.padBottom} onChange={(v) => updateSel({ padBottom: v })} suffix="px" />
                  <NumField label="Marge côtés" min={0} value={selected.padX} onChange={(v) => updateSel({ padX: v })} suffix="px" />
                </div>
              </div>
            </>
          ) : (
            <div className="mbd-empty">Ajoutez un bloc puis cliquez dessus pour l'éditer. Astuce : cliquez sur un titre/texte dans l'aperçu pour l'écrire directement.</div>
          )}

          <div className="mbd-settings">
            <div className="mbd-panel-title">Réglages généraux</div>
            <ColorField label="Fond de la page" value={settings.bg} onChange={(c) => setSettings((s) => ({ ...s, bg: c }))} brand={brand} />
            <ColorField label="Fond du contenu (carte)" value={settings.cardBg} onChange={(c) => setSettings((s) => ({ ...s, cardBg: c }))} brand={brand} />
            <div className="mbd-row">
              <NumField label="Largeur contenu" min={320} value={settings.contentWidth} onChange={(v) => setSettings((s) => ({ ...s, contentWidth: Math.min(Math.max(v, 320), 700) }))} suffix="px" />
            </div>
            <label className="mbd-lbl">Police</label>
            <select className="mbd-select" value={settings.fontFamily} onChange={(e) => setSettings((s) => ({ ...s, fontFamily: e.target.value }))}>
              {FONTS.map((f) => <option key={f.label} value={f.value}>{f.label}</option>)}
            </select>
          </div>
        </div>
      </div>
    </div>
  );
};

// structuredClone n'est pas garanti partout : repli JSON pour cloner les défauts.
function structuredCloneSafe(obj) {
  try {
    return typeof structuredClone === "function" ? structuredClone(obj) : JSON.parse(JSON.stringify(obj));
  } catch {
    return JSON.parse(JSON.stringify(obj));
  }
}

export default MailBlockDesigner;
