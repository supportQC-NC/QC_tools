// backend/services/nouveautesCatalogService.js
//
// Construit le HTML email du catalogue des nouveautés (styles inline, email-safe).
// Une carte par fournisseur, table produits (Désignation, Réf = NART interne,
// Gencod, Prix TTC, Stock). Colonnes à largeur FIXE (alignées d'une section à
// l'autre) et couleur de titre contrastée automatiquement.

const esc = (v) =>
  String(v == null ? "" : v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const fmtPrix = (v) => {
  const n = Math.trunc(Number(v) || 0);
  if (n <= 0) return "—";
  return `${n.toLocaleString("fr-FR").replace(/[\s,]/g, " ")} XPF`;
};

// Luminance d'une couleur hex "#RRGGBB" -> choix texte noir/blanc.
const textColorOn = (hex) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || "").trim());
  if (!m) return "#111111";
  const int = parseInt(m[1], 16);
  const r = (int >> 16) & 255;
  const g = (int >> 8) & 255;
  const b = int & 255;
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  return lum > 150 ? "#111111" : "#ffffff";
};

// Largeurs de colonnes FIXES (identiques pour toutes les sections).
const COLS = [
  { w: "40%", align: "left", pad: "left" },   // Désignation
  { w: "14%", align: "left" },                // Réf (NART)
  { w: "18%", align: "left" },                // Gencod
  { w: "16%", align: "right" },               // Prix TTC
  { w: "12%", align: "right", pad: "right" }, // Stock
];

const colgroup = () =>
  `<colgroup>${COLS.map((c) => `<col style="width:${c.w};">`).join("")}</colgroup>`;

const th = (label, c) =>
  `<th align="${c.align}" style="padding:8px ${c.pad === "right" ? "14px" : "12px"} 8px ${c.pad === "left" ? "14px" : "12px"};font-size:11px;font-weight:700;letter-spacing:.04em;color:#8a8f98;text-transform:uppercase;border-bottom:2px solid #ececf0;">${label}</th>`;

export const buildCatalogHtml = ({ entreprise, groupes, periodeLabel }) => {
  const societe = esc(entreprise?.nomComplet || entreprise?.nom || "");
  const primaire = entreprise?.couleurPrimaire || "#4F46E5";
  const headText = textColorOn(primaire);
  const headSub = headText === "#111111" ? "rgba(0,0,0,.62)" : "rgba(255,255,255,.85)";
  const total = (groupes || []).reduce((s, g) => s + g.articles.length, 0);

  const sections = (groupes || [])
    .map((g) => {
      const rows = g.articles
        .map((a, i) => {
          const bg = i % 2 === 0 ? "#ffffff" : "#fafafb";
          const td = (val, c, extra = "") =>
            `<td align="${c.align}" style="padding:9px ${c.pad === "right" ? "14px" : "12px"} 9px ${c.pad === "left" ? "14px" : "12px"};font-size:13px;color:#2a2d33;border-bottom:1px solid #f0f0f3;${extra}">${val}</td>`;
          return `<tr style="background:${bg};">
        ${td(esc(a.design), COLS[0], "font-weight:600;color:#1a1c20;")}
        ${td(esc(a.nart) || "—", COLS[1], "font-family:Menlo,Consolas,monospace;color:#555;")}
        ${td(esc(a.gencod) || "—", COLS[2], "font-family:Menlo,Consolas,monospace;color:#777;font-size:12px;")}
        ${td(esc(fmtPrix(a.pvtettc)), COLS[3], "font-weight:700;color:#111;white-space:nowrap;")}
        ${td(`<span style="display:inline-block;min-width:26px;padding:2px 8px;border-radius:10px;background:#eaf7ee;color:#1f8a4c;font-size:12px;font-weight:700;">${esc(Math.trunc(a.stock))}</span>`, COLS[4])}
      </tr>`;
        })
        .join("");
      return `
    <div style="margin:0 0 18px;border:1px solid #ececf0;border-radius:12px;overflow:hidden;box-shadow:0 1px 2px rgba(0,0,0,.04);">
      <div style="padding:11px 14px;background:#f7f7fa;border-bottom:1px solid #ececf0;">
        <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${esc(primaire)};vertical-align:middle;margin-right:8px;"></span>
        <span style="font-size:14px;font-weight:800;color:#1a1c20;vertical-align:middle;">${esc(g.nom)}</span>
        <span style="font-size:12px;color:#9a9ea6;margin-left:6px;">· ${g.articles.length} produit${g.articles.length > 1 ? "s" : ""}</span>
      </div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;table-layout:fixed;background:#fff;">
        ${colgroup()}
        <thead><tr>${th("Désignation", COLS[0])}${th("Réf.", COLS[1])}${th("Gencod", COLS[2])}${th("Prix TTC", COLS[3])}${th("Stock", COLS[4])}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
    })
    .join("");

  const body = total
    ? sections
    : `<p style="color:#777;font-style:italic;">Aucune nouveauté sur cette période.</p>`;

  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#eef0f4;">
  <div style="max-width:760px;margin:0 auto;padding:22px;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;">
    <div style="background:${esc(primaire)};padding:22px 24px;border-radius:14px 14px 0 0;">
      <div style="font-size:22px;font-weight:800;color:${headText};">🆕 Nos nouveautés</div>
      <div style="font-size:13px;color:${headSub};margin-top:3px;">${societe}${periodeLabel ? " — " + esc(periodeLabel) : ""}</div>
    </div>
    <div style="background:#fff;padding:24px;border-radius:0 0 14px 14px;box-shadow:0 4px 20px rgba(0,0,0,.06);">
      <p style="font-size:14px;color:#333;margin:0 0 20px;line-height:1.5;">Bonjour,<br>Découvrez nos <strong style="color:${esc(primaire)};">${total}</strong> nouveaux produits disponibles en stock :</p>
      ${body}
      <p style="font-size:12px;color:#9a9ea6;margin:22px 0 0;border-top:1px solid #eee;padding-top:14px;line-height:1.5;">
        Cet email vous est envoyé par <strong>${societe}</strong>. Prix TTC indicatifs, sous réserve de disponibilité.
      </p>
    </div>
  </div>
</body></html>`;
};

export default { buildCatalogHtml };
