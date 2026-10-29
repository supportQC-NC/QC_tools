// backend/services/statsCommerciauxExportService.js
//
// EXPORT du PORTEFEUILLE CLIENTS de l'écran Stats commerciaux (demande client
// du 29/10/2026) : la sélection de commerciaux affichée à l'écran se télécharge
//   - en EXCEL : feuille « Synthèse » (KPI + top/progressions/baisses/
//     nouveaux/perdus) + feuille « Clients » (liste complète) ;
//   - en PDF A4 PAYSAGE : page de synthèse avec GRAPHIQUES redessinés en
//     pdfkit (barres Top 15 N vs N-1), pages d'analyses, puis le tableau des
//     clients (plafonné — la liste complète vit dans l'Excel).
//
// Les analyses reproduisent CELLES DE L'ÉCRAN (même règles que
// AdminStatsCommerciauxScreen) : top 15 par CA, Δ CA vs N-1, nouveaux
// (CA N > 0 et N-1 = 0), perdus (l'inverse), Pareto 80 %.

import ExcelJS from "exceljs";

const fmtNbFr = (n, dec = 0) =>
  typeof n === "number" && Number.isFinite(n)
    ? new Intl.NumberFormat("fr-FR", { maximumFractionDigits: dec })
        .format(n)
        .replace(/ /g, " ")
    : "—";
const fmtPct1 = (n) =>
  typeof n === "number" && Number.isFinite(n)
    ? `${n.toFixed(1).replace(".", ",")} %`
    : "—";

/** Libellé lisible de la sélection ("Toute la société", "CAMELIA + HUBERT"…). */
export const libelleSelection = (selection) => {
  const noms = String(selection || "GLOBAL")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!noms.length || noms.includes("GLOBAL")) return "Toute la société";
  if (noms.includes("HORS_MAGASIN")) return "Tous les commerciaux sauf MAGASIN";
  return noms.join(" + ");
};

/** Analyses du portefeuille — mêmes règles que l'écran. */
export const analyserPortefeuille = (clients) => {
  const totaux = clients.reduce(
    (t, c) => {
      t.caN += c.caN;
      t.caN1 += c.caN1;
      t.margeN += c.margeN;
      t.margeN1 += c.margeN1;
      t.nbFactures += c.nbFactures;
      if (c.caN !== 0) t.actifs += 1;
      return t;
    },
    { caN: 0, caN1: 0, margeN: 0, margeN1: 0, nbFactures: 0, actifs: 0 },
  );
  totaux.evolCaPct = totaux.caN1
    ? Math.round(((totaux.caN - totaux.caN1) / Math.abs(totaux.caN1)) * 1000) / 10
    : null;
  totaux.tauxMargeN = totaux.caN
    ? Math.round((totaux.margeN / totaux.caN) * 1000) / 10
    : null;

  const actifs = clients.filter((c) => c.caN > 0); // déjà triés CA desc
  const topClients = actifs.slice(0, 15);

  const avecDelta = clients
    .map((c) => ({ ...c, delta: c.caN - c.caN1 }))
    .filter((c) => c.delta !== 0);
  const progressions = [...avecDelta]
    .filter((c) => c.delta > 0)
    .sort((a, b) => b.delta - a.delta)
    .slice(0, 10);
  const baisses = [...avecDelta]
    .filter((c) => c.delta < 0)
    .sort((a, b) => a.delta - b.delta)
    .slice(0, 10);

  const nouveaux = clients
    .filter((c) => c.caN > 0 && c.caN1 === 0)
    .sort((a, b) => b.caN - a.caN);
  const perdus = clients
    .filter((c) => c.caN === 0 && c.caN1 > 0)
    .sort((a, b) => b.caN1 - a.caN1);

  const caTotal = actifs.reduce((s, c) => s + c.caN, 0);
  let cumul = 0;
  let clients80 = 0;
  for (let i = 0; i < actifs.length; i++) {
    cumul += actifs[i].caN;
    if (caTotal && cumul >= caTotal * 0.8) {
      clients80 = i + 1;
      break;
    }
  }

  return { totaux, actifs, topClients, progressions, baisses, nouveaux, perdus, clients80 };
};

// ---------------------------------------------------------------------------
// EXCEL
// ---------------------------------------------------------------------------

const COLS_CLIENTS = [
  { header: "Tiers", key: "tiers", width: 8 },
  { header: "Client", key: "nom", width: 32 },
  { header: "Catégorie", key: "categorie", width: 16 },
  { header: "Profession", key: "profession", width: 20 },
  { header: "Commercial", key: "commercial", width: 12 },
  { header: "Remise (%)", key: "remisePct", width: 10 },
  { header: "CA N (XPF)", key: "caN", width: 14 },
  { header: "CA N-1 (XPF)", key: "caN1", width: 14 },
  { header: "Évol. CA (%)", key: "evolCaPct", width: 11 },
  { header: "Marge N (XPF)", key: "margeN", width: 14 },
  { header: "Taux marge (%)", key: "tauxMargeN", width: 12 },
  { header: "% réalisé", key: "pctRealisePct", width: 10 },
  { header: "Restant (XPF)", key: "restant", width: 14 },
  { header: "Factures N", key: "nbFactures", width: 10 },
  { header: "Factures N-1", key: "nbFacturesN1", width: 11 },
  { header: "Contribution (%)", key: "contributionPct", width: 13 },
];

export const genererExcelPortefeuille = ({ source, selection, clients, analyses }) => {
  const wb = new ExcelJS.Workbook();
  const gras = { bold: true };
  const titreStyle = { bold: true, size: 13 };

  // ── Feuille Synthèse ──
  const s = wb.addWorksheet("Synthèse");
  s.getCell("A1").value = `Portefeuille clients — ${source.label}`;
  s.getCell("A1").font = titreStyle;
  s.getCell("A2").value = `Sélection : ${libelleSelection(selection)} · généré le ${new Date().toLocaleString("fr-FR")}`;
  s.getCell("A2").font = { size: 9, color: { argb: "FF666666" } };

  const { totaux, topClients, progressions, baisses, nouveaux, perdus, clients80, actifs } =
    analyses;

  let r = 4;
  const kpi = (label, valeur) => {
    s.getCell(r, 1).value = label;
    s.getCell(r, 1).font = gras;
    s.getCell(r, 2).value = valeur;
    r += 1;
  };
  kpi("CA N (XPF)", totaux.caN);
  kpi("CA N-1 (XPF)", totaux.caN1);
  kpi("Évolution CA", fmtPct1(totaux.evolCaPct));
  kpi("Marge N (XPF)", totaux.margeN);
  kpi("Taux de marge", fmtPct1(totaux.tauxMargeN));
  kpi("Clients", clients.length);
  kpi("Clients actifs", totaux.actifs);
  kpi("Nouveaux clients", nouveaux.length);
  kpi("Clients perdus", perdus.length);
  kpi(
    "Concentration (Pareto)",
    clients80
      ? `${clients80} clients (${actifs.length ? Math.round((clients80 / actifs.length) * 100) : 0} % des actifs) font 80 % du CA`
      : "—",
  );

  const bloc = (titre, lignes, colonnes) => {
    r += 1;
    s.getCell(r, 1).value = titre;
    s.getCell(r, 1).font = gras;
    r += 1;
    colonnes.forEach((c, i) => {
      const cell = s.getCell(r, i + 1);
      cell.value = c.header;
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF333333" } };
    });
    r += 1;
    for (const l of lignes) {
      colonnes.forEach((c, i) => {
        const cell = s.getCell(r, i + 1);
        cell.value = l[c.key];
        if (c.numFmt) cell.numFmt = c.numFmt;
      });
      r += 1;
    }
  };

  const colsTop = [
    { header: "Client", key: "nom" },
    { header: "CA N (XPF)", key: "caN", numFmt: "#,##0" },
    { header: "CA N-1 (XPF)", key: "caN1", numFmt: "#,##0" },
  ];
  bloc("Top 15 clients (CA N)", topClients, colsTop);
  bloc(
    "Plus fortes progressions (Δ CA)",
    progressions,
    [
      { header: "Client", key: "nom" },
      { header: "Δ CA (XPF)", key: "delta", numFmt: "#,##0" },
    ],
  );
  bloc(
    "Plus fortes baisses (Δ CA)",
    baisses,
    [
      { header: "Client", key: "nom" },
      { header: "Δ CA (XPF)", key: "delta", numFmt: "#,##0" },
    ],
  );
  bloc("Nouveaux clients", nouveaux.slice(0, 30), colsTop);
  bloc(
    "Clients perdus",
    perdus.slice(0, 30),
    [
      { header: "Client", key: "nom" },
      { header: "CA N-1 (XPF)", key: "caN1", numFmt: "#,##0" },
    ],
  );
  s.getColumn(1).width = 42;
  s.getColumn(2).width = 18;
  s.getColumn(3).width = 16;

  // ── Feuille Clients (liste complète) ──
  const ws = wb.addWorksheet("Clients");
  ws.columns = COLS_CLIENTS;
  ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF333333" } };
  for (const c of clients) ws.addRow(c);
  ["caN", "caN1", "margeN", "restant"].forEach((k) => {
    ws.getColumn(k).numFmt = "#,##0";
  });
  ["evolCaPct", "tauxMargeN", "pctRealisePct", "contributionPct", "remisePct"].forEach(
    (k) => {
      ws.getColumn(k).numFmt = "#,##0.0";
    },
  );
  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.autoFilter = { from: "A1", to: `P1` };

  return wb;
};

// ---------------------------------------------------------------------------
// PDF (A4 paysage, pdfkit) — graphiques redessinés + tableaux
// ---------------------------------------------------------------------------

const GRIS = "#555555";
const BLEU = "#2d6fb8";
const GRIS_BARRE = "#9aa7bd";
const VERT = "#067d06";
const ROUGE = "#c00000";

export const genererPdfPortefeuille = async (
  { source, selection, clients, analyses },
  res,
) => {
  const mod = await import("pdfkit");
  const PDFDocument = mod.default;
  const marge = 36;
  const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: marge });
  doc.pipe(res);

  const largeur = doc.page.width - 2 * marge; // ~770 pt
  const { totaux, topClients, progressions, baisses, nouveaux, perdus, clients80, actifs } =
    analyses;

  const entete = (titre) => {
    doc
      .font("Helvetica-Bold")
      .fontSize(14)
      .fillColor("#000")
      .text(`Portefeuille clients — ${source.label}`, marge, marge, {
        width: largeur,
      });
    doc
      .font("Helvetica")
      .fontSize(9)
      .fillColor(GRIS)
      .text(
        `${libelleSelection(selection)} · généré le ${new Date().toLocaleString("fr-FR")}`,
      );
    if (titre) {
      doc.moveDown(0.4);
      doc.font("Helvetica-Bold").fontSize(11).fillColor("#000").text(titre);
    }
    doc.moveDown(0.5);
  };

  // ── Page 1 : KPI + Top 15 (barres N vs N-1) ──
  entete();
  let y = doc.y;
  const kpis = [
    ["CA N", `${fmtNbFr(totaux.caN)} XPF`],
    ["Évol. vs N-1", fmtPct1(totaux.evolCaPct)],
    ["Marge N", `${fmtNbFr(totaux.margeN)} XPF`],
    ["Taux de marge", fmtPct1(totaux.tauxMargeN)],
    ["Clients actifs", `${fmtNbFr(totaux.actifs)} / ${fmtNbFr(clients.length)}`],
    // « - » ASCII : U+2212 n'existe pas en Helvetica WinAnsi (sortait un « " »).
    ["Nouveaux / perdus", `+${nouveaux.length} / -${perdus.length}`],
  ];
  const wBox = largeur / kpis.length;
  kpis.forEach(([label, val], i) => {
    const x = marge + i * wBox;
    doc.rect(x, y, wBox - 6, 42).lineWidth(0.6).stroke("#bbbbbb");
    doc.font("Helvetica").fontSize(7.5).fillColor(GRIS).text(label.toUpperCase(), x + 6, y + 6, { width: wBox - 18, lineBreak: false });
    doc.font("Helvetica-Bold").fontSize(11).fillColor("#000").text(val, x + 6, y + 20, { width: wBox - 18, lineBreak: false });
  });
  y += 56;

  doc.font("Helvetica-Bold").fontSize(10).fillColor("#000").text("Top 15 clients — CA N (bleu) vs CA N-1 (gris)", marge, y);
  y += 16;
  const maxCa = Math.max(1, ...topClients.map((c) => Math.max(c.caN, c.caN1)));
  const wNom = 190;
  const wVal = 78;
  const wBarres = largeur - wNom - wVal - 12;
  const hLigne = Math.min(24, Math.floor((doc.page.height - marge - y - 30) / Math.max(1, topClients.length)));
  for (const c of topClients) {
    doc.font("Helvetica").fontSize(8).fillColor("#000")
      .text(String(c.nom || c.tiers).slice(0, 42), marge, y + 2, { width: wNom - 6, lineBreak: false });
    const x0 = marge + wNom;
    doc.rect(x0, y + 1, Math.max(1, (c.caN / maxCa) * wBarres), 8).fill(BLEU);
    doc.rect(x0, y + 10, Math.max(1, (c.caN1 / maxCa) * wBarres), 5).fill(GRIS_BARRE);
    doc.font("Helvetica").fontSize(8).fillColor("#000")
      .text(`${fmtNbFr(c.caN)}`, x0 + wBarres + 6, y + 2, { width: wVal, lineBreak: false });
    y += hLigne;
  }
  doc.font("Helvetica-Oblique").fontSize(8.5).fillColor(GRIS).text(
    clients80
      ? `Concentration : ${fmtNbFr(clients80)} client(s) — ${actifs.length ? Math.round((clients80 / actifs.length) * 100) : 0} % du portefeuille actif — font 80 % du CA.`
      : "",
    marge,
    y + 6,
  );

  // ── Page 2 : progressions / baisses / nouveaux / perdus ──
  doc.addPage({ size: "A4", layout: "landscape", margin: marge });
  entete("Mouvements du portefeuille");
  // « écart CA » plutôt que « Δ CA » : le Δ grec n'est pas encodable en
  // Helvetica WinAnsi (sortait « 9B4 » dans le PDF).
  const colonnes = [
    { titre: "Plus fortes progressions (écart CA)", lignes: progressions, val: (c) => `+${fmtNbFr(c.delta)}`, couleur: VERT },
    { titre: "Plus fortes baisses (écart CA)", lignes: baisses, val: (c) => fmtNbFr(c.delta), couleur: ROUGE },
    { titre: `Nouveaux clients (${nouveaux.length})`, lignes: nouveaux.slice(0, 10), val: (c) => fmtNbFr(c.caN), couleur: VERT },
    { titre: `Clients perdus (${perdus.length})`, lignes: perdus.slice(0, 10), val: (c) => fmtNbFr(c.caN1), couleur: ROUGE },
  ];
  const wCol = largeur / 4;
  const yCols = doc.y;
  colonnes.forEach((col, i) => {
    const x = marge + i * wCol;
    let yy = yCols;
    doc.font("Helvetica-Bold").fontSize(9).fillColor("#000").text(col.titre, x, yy, { width: wCol - 10 });
    yy = doc.y + 4;
    if (!col.lignes.length) {
      doc.font("Helvetica").fontSize(8).fillColor(GRIS).text("—", x, yy);
    }
    for (const c of col.lignes) {
      // 22 caractères max : au-delà, pdfkit replie sur la ligne suivante et
      // écrase la ligne d'en dessous (constaté sur « HENRY MANUEL CHARPENTE »).
      doc.font("Helvetica").fontSize(8).fillColor("#000")
        .text(String(c.nom || c.tiers).slice(0, 22), x, yy, { width: wCol - 70, lineBreak: false, ellipsis: false });
      doc.font("Helvetica-Bold").fontSize(8).fillColor(col.couleur)
        .text(col.val(c), x + wCol - 72, yy, { width: 62, align: "right", lineBreak: false });
      yy += 13;
    }
  });

  // ── Pages tableau (plafonné : liste complète dans l'Excel) ──
  const MAX_LIGNES_PDF = 400;
  const aImprimer = clients.slice(0, MAX_LIGNES_PDF);
  const COLS = [
    { label: "TIERS", w: 44, align: "left", v: (c) => c.tiers },
    { label: "CLIENT", w: 200, align: "left", v: (c) => c.nom },
    { label: "CATÉGORIE", w: 86, align: "left", v: (c) => c.categorie },
    { label: "COMMERCIAL", w: 70, align: "left", v: (c) => c.commercial },
    { label: "CA N", w: 76, align: "right", v: (c) => fmtNbFr(c.caN) },
    { label: "CA N-1", w: 76, align: "right", v: (c) => fmtNbFr(c.caN1) },
    { label: "ÉVOL.", w: 52, align: "right", v: (c) => fmtPct1(c.evolCaPct) },
    { label: "MARGE N", w: 72, align: "right", v: (c) => fmtNbFr(c.margeN) },
    { label: "TAUX", w: 46, align: "right", v: (c) => fmtPct1(c.tauxMargeN) },
    { label: "FACT. N", w: 48, align: "right", v: (c) => fmtNbFr(c.nbFactures) },
  ];
  const hRow = 14;
  let premiere = true;
  let yT = 0;
  const enTeteTableau = () => {
    doc.addPage({ size: "A4", layout: "landscape", margin: marge });
    entete(
      premiere
        ? `Clients (${fmtNbFr(clients.length)}${clients.length > MAX_LIGNES_PDF ? ` — ${MAX_LIGNES_PDF} premiers imprimés, liste complète dans l'export Excel` : ""})`
        : "Clients (suite)",
    );
    premiere = false;
    yT = doc.y;
    let x = marge;
    doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#000");
    for (const c of COLS) {
      doc.text(c.label, x + 2, yT, { width: c.w - 4, align: c.align, lineBreak: false });
      x += c.w;
    }
    yT += 12;
    doc.moveTo(marge, yT).lineTo(marge + COLS.reduce((s2, c) => s2 + c.w, 0), yT).lineWidth(0.7).stroke("#333");
    yT += 2;
  };
  enTeteTableau();
  for (const c of aImprimer) {
    if (yT + hRow > doc.page.height - marge) enTeteTableau();
    let x = marge;
    doc.font("Helvetica").fontSize(7.5).fillColor("#000");
    for (const col of COLS) {
      const brut = col.v(c);
      doc.text(String(brut ?? "").slice(0, 60), x + 2, yT, { width: col.w - 4, align: col.align, lineBreak: false });
      x += col.w;
    }
    yT += hRow;
  }

  doc.end();
};

export default {
  libelleSelection,
  analyserPortefeuille,
  genererExcelPortefeuille,
  genererPdfPortefeuille,
};
