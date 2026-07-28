// backend/services/mailRenderService.js
//
// Transforme un DESIGN par blocs (émis par le designer front) en HTML d'email
// COMPATIBLE clients mail (tables imbriquées + styles INLINE) + une alternative
// TEXTE brut (bon pour la délivrabilité / anti-spam).
//
// Blocs : heading | text | image | button | divider | spacer.
// Options communes : bg (fond du bloc), padTop, padBottom, padX.
// Réglages : { bg (page), cardBg (contenu), contentWidth, fontFamily }.

const esc = (s) =>
  String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const nl2br = (s) => esc(s).replace(/\r?\n/g, "<br/>");

const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

const absUrl = (src, baseUrl) => {
  const s = String(src || "").trim();
  if (!s) return "";
  if (/^https?:\/\//i.test(s) || /^data:/i.test(s)) return s;
  const base = String(baseUrl || "").replace(/\/+$/, "");
  return base + (s.startsWith("/") ? s : `/${s}`);
};

const alignToMargin = (align) =>
  align === "center" ? "0 auto" : align === "right" ? "0 0 0 auto" : "0";

// Plateformes sociales : abréviation + couleur de marque (badge rond).
export const SOCIAL = {
  facebook: { abbr: "f", bg: "#1877F2", label: "Facebook" },
  instagram: { abbr: "IG", bg: "#E4405F", label: "Instagram" },
  linkedin: { abbr: "in", bg: "#0A66C2", label: "LinkedIn" },
  twitter: { abbr: "X", bg: "#000000", label: "X / Twitter" },
  youtube: { abbr: "▶", bg: "#FF0000", label: "YouTube" },
  whatsapp: { abbr: "wa", bg: "#25D366", label: "WhatsApp" },
  tiktok: { abbr: "tk", bg: "#010101", label: "TikTok" },
  website: { abbr: "web", bg: "#4F46E5", label: "Site web" },
};

const renderColumns = (b, baseUrl) => {
  const cols = Math.min(Math.max(num(b.cols, 2), 1), 3);
  const gap = num(b.gap, 16);
  const items = (Array.isArray(b.items) ? b.items : []).slice(0, cols);
  const w = Math.floor(100 / cols);
  const cells = items
    .map((it) => {
      const al = it.align || "left";
      const parts = [];
      if (it.img)
        parts.push(
          `<img src="${esc(absUrl(it.img, baseUrl))}" alt="" style="width:100%;max-width:100%;height:auto;display:block;border-radius:${num(
            it.radius,
            0,
          )}px;margin-bottom:8px;" />`,
        );
      if (it.title)
        parts.push(
          `<div style="font-size:${num(it.titleSize, 18)}px;font-weight:700;color:${esc(
            it.titleColor || "#111111",
          )};text-align:${al};margin-bottom:6px;line-height:1.3;">${nl2br(it.title)}</div>`,
        );
      if (it.text)
        parts.push(
          `<div style="font-size:${num(it.textSize, 14)}px;color:${esc(
            it.textColor || "#444444",
          )};text-align:${al};line-height:1.55;">${nl2br(it.text)}</div>`,
        );
      if (it.btnLabel)
        parts.push(
          `<div style="text-align:${al};margin-top:10px;"><a href="${esc(
            it.btnLink || "#",
          )}" target="_blank" style="display:inline-block;background:${esc(
            it.btnBg || "#2f7bef",
          )};color:${esc(
            it.btnColor || "#ffffff",
          )};padding:9px 18px;border-radius:6px;text-decoration:none;font-size:13px;font-weight:600;">${esc(
            it.btnLabel,
          )}</a></div>`,
        );
      return `<td valign="top" width="${w}%" style="padding:0 ${Math.round(
        gap / 2,
      )}px;">${parts.join("")}</td>`;
    })
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${cells}</tr></table>`;
};

const renderImageText = (b, baseUrl) => {
  const side = b.imgSide === "right" ? "right" : "left";
  const iw = Math.min(Math.max(num(b.imgWidth, 40), 20), 80);
  const tw = 100 - iw;
  const valign = b.valign === "middle" ? "middle" : "top";
  const gap = num(b.gap, 16);
  const al = b.align || "left";
  const imgHtml = b.img
    ? `<img src="${esc(absUrl(b.img, baseUrl))}" alt="${esc(
        b.alt || "",
      )}" style="width:100%;max-width:100%;height:auto;display:block;border-radius:${num(
        b.radius,
        0,
      )}px;" />`
    : "";
  const parts = [];
  if (b.title)
    parts.push(
      `<div style="font-size:${num(b.titleSize, 18)}px;font-weight:700;color:${esc(
        b.titleColor || "#111111",
      )};text-align:${al};margin-bottom:6px;line-height:1.3;">${nl2br(b.title)}</div>`,
    );
  if (b.text)
    parts.push(
      `<div style="font-size:${num(b.textSize, 14)}px;color:${esc(
        b.textColor || "#444444",
      )};text-align:${al};line-height:1.55;">${nl2br(b.text)}</div>`,
    );
  if (b.btnLabel)
    parts.push(
      `<div style="text-align:${al};margin-top:10px;"><a href="${esc(
        b.btnLink || "#",
      )}" target="_blank" style="display:inline-block;background:${esc(
        b.btnBg || "#2f7bef",
      )};color:${esc(
        b.btnColor || "#ffffff",
      )};padding:9px 18px;border-radius:6px;text-decoration:none;font-size:13px;font-weight:600;">${esc(
        b.btnLabel,
      )}</a></div>`,
    );
  const imgCell = `<td valign="${valign}" width="${iw}%">${imgHtml}</td>`;
  const spacer = `<td width="${gap}" style="width:${gap}px;font-size:1px;line-height:1px;">&nbsp;</td>`;
  const textCell = `<td valign="${valign}" width="${tw}%">${parts.join("")}</td>`;
  const cells =
    side === "right"
      ? `${textCell}${spacer}${imgCell}`
      : `${imgCell}${spacer}${textCell}`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${cells}</tr></table>`;
};

const renderSocial = (b) => {
  const align = b.align || "center";
  const size = num(b.size, 38);
  const links = (Array.isArray(b.links) ? b.links : []).filter((l) => l && l.url);
  if (!links.length) return "";
  const badges = links
    .map((l) => {
      const p = SOCIAL[l.platform] || SOCIAL.website;
      return `<a href="${esc(l.url)}" target="_blank" style="display:inline-block;width:${size}px;height:${size}px;line-height:${size}px;text-align:center;background:${
        p.bg
      };color:#ffffff;border-radius:50%;font-weight:700;font-size:${Math.round(
        size * 0.42,
      )}px;text-decoration:none;margin:0 4px;font-family:Arial,Helvetica,sans-serif;">${
        p.abbr
      }</a>`;
    })
    .join("");
  return `<div style="text-align:${align};">${badges}</div>`;
};

const renderBlock = (b, baseUrl) => {
  const align = b.align || "left";
  switch (b.kind) {
    case "heading":
      return `<h1 style="margin:0;font-family:inherit;font-size:${num(
        b.fontSize,
        24,
      )}px;line-height:${b.lineHeight || 1.25};font-weight:${
        b.bold === false ? 400 : 700
      };color:${esc(b.color || "#111111")};text-align:${align};">${nl2br(
        b.text,
      )}</h1>`;
    case "text":
      return `<div style="font-size:${num(b.fontSize, 15)}px;line-height:${
        b.lineHeight || 1.55
      };font-weight:${b.bold ? 700 : 400};color:${esc(
        b.color || "#333333",
      )};text-align:${align};">${nl2br(b.text)}</div>`;
    case "image": {
      const src = absUrl(b.src, baseUrl);
      if (!src) return "";
      const radius = num(b.radius, 0);
      const widthCss = b.fullWidth
        ? "width:100%;"
        : `width:${Math.min(num(b.width, 300), 680)}px;max-width:100%;`;
      const img = `<img src="${esc(src)}" alt="${esc(
        b.alt || "",
      )}" style="display:block;border:0;outline:none;${widthCss}height:auto;border-radius:${radius}px;margin:${alignToMargin(
        align,
      )};" />`;
      return b.link
        ? `<a href="${esc(b.link)}" target="_blank">${img}</a>`
        : img;
    }
    case "button": {
      const wrap = align === "center" ? "center" : align === "right" ? "right" : "left";
      const block = b.fullWidth ? "display:block;text-align:center;" : "display:inline-block;";
      return `<div style="text-align:${wrap};"><a href="${esc(
        b.link || "#",
      )}" target="_blank" style="${block}background:${esc(
        b.bg || "#2f7bef",
      )};color:${esc(b.color || "#ffffff")};padding:${num(b.padY, 12)}px ${num(
        b.padX,
        26,
      )}px;border-radius:${num(b.radius, 6)}px;text-decoration:none;font-weight:600;font-size:${num(
        b.fontSize,
        15,
      )}px;">${esc(b.label || "Bouton")}</a></div>`;
    }
    case "divider": {
      const w = b.widthPct ? `${Math.min(num(b.widthPct, 100), 100)}%` : "100%";
      const mAlign = align === "center" ? "0 auto" : align === "right" ? "0 0 0 auto" : "0";
      return `<hr style="border:0;border-top:${num(b.thickness, 1)}px solid ${esc(
        b.color || "#e2e2e2",
      )};width:${w};margin:${mAlign};" />`;
    }
    case "spacer":
      return `<div style="height:${num(b.height, 16)}px;line-height:${num(
        b.height,
        16,
      )}px;font-size:1px;">&nbsp;</div>`;
    case "columns":
      return renderColumns(b, baseUrl);
    case "imagetext":
      return renderImageText(b, baseUrl);
    case "social":
      return renderSocial(b);
    case "list": {
      const tag = b.ordered ? "ol" : "ul";
      const listStyle = b.ordered ? "decimal" : "disc";
      const items = (Array.isArray(b.items) ? b.items : []).filter((x) =>
        String(x).trim(),
      );
      if (!items.length) return "";
      return `<${tag} style="margin:0;padding:0 0 0 22px;list-style-type:${listStyle};list-style-position:outside;font-size:${num(
        b.fontSize,
        15,
      )}px;color:${esc(b.color || "#333333")};text-align:${
        b.align || "left"
      };line-height:1.6;">${items
        .map(
          (i) =>
            `<li style="margin-bottom:4px;display:list-item;list-style-type:${listStyle};">${nl2br(
              i,
            )}</li>`,
        )
        .join("")}</${tag}>`;
    }
    case "html":
      // Bloc HTML libre (outil interne) — inséré tel quel.
      return String(b.code || "");
    default:
      return "";
  }
};

const cellStyle = (b) => {
  const pt = num(b.padTop, 8);
  const pb = num(b.padBottom, 8);
  const px = num(b.padX, 28);
  let s = `padding:${pt}px ${px}px ${pb}px ${px}px;`;
  if (b.bg) s += `background:${esc(b.bg)};`;
  return s;
};

export const renderCampaign = (design = {}, { baseUrl = "" } = {}) => {
  const settings = design.settings || {};
  const bg = settings.bg || "#f2f4f7";
  const cardBg = settings.cardBg || "#ffffff";
  const width = Math.min(Math.max(num(settings.contentWidth, 600), 320), 700);
  const font =
    settings.fontFamily ||
    "-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif";
  const blocks = Array.isArray(design.blocks) ? design.blocks : [];

  const rows = blocks
    .map((b) => `<tr><td style="${cellStyle(b)}">${renderBlock(b, baseUrl)}</td></tr>`)
    .join("");

  const html = `<!DOCTYPE html>
<html lang="fr"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta http-equiv="X-UA-Compatible" content="IE=edge"/>
</head>
<body style="margin:0;padding:0;background:${bg};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${bg};">
  <tr><td align="center" style="padding:24px 12px;">
    <table role="presentation" width="${width}" cellpadding="0" cellspacing="0" style="width:${width}px;max-width:100%;background:${cardBg};border-radius:10px;overflow:hidden;font-family:${font};color:#333;">
      ${rows}
    </table>
  </td></tr>
</table>
</body></html>`;

  const text = blocks
    .map((b) => {
      if (b.kind === "heading" || b.kind === "text") return String(b.text || "");
      if (b.kind === "button") return `${b.label || "Lien"} : ${b.link || ""}`;
      if (b.kind === "image" && b.link) return b.link;
      if (b.kind === "divider") return "----------";
      if (b.kind === "list")
        return (Array.isArray(b.items) ? b.items : [])
          .filter((x) => String(x).trim())
          .map((x) => `- ${x}`)
          .join("\n");
      if (b.kind === "columns")
        return (Array.isArray(b.items) ? b.items : [])
          .map((it) =>
            [it.title, it.text, it.btnLink].filter(Boolean).join(" — "),
          )
          .filter(Boolean)
          .join("\n");
      if (b.kind === "imagetext")
        return [b.title, b.text, b.btnLink].filter(Boolean).join("\n");
      if (b.kind === "social")
        return (Array.isArray(b.links) ? b.links : [])
          .filter((l) => l && l.url)
          .map((l) => l.url)
          .join("\n");
      return "";
    })
    .filter((s) => s.trim())
    .join("\n\n");

  return { html, text };
};

export default { renderCampaign };
