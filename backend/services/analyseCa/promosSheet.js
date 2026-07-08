// backend/services/analyseCa/promosSheet.js
//
// Onglets "Promos" (#C55A11) et "Detail_Promos" (#F4B183) — transcription
// fidèle de analyse_ca_promos.py (version active).
//
// Source : details EXTERNES N + référentiel articles (champs promo PVPROMO,
// DATE_DEBUT_PROMO, DATE_FIN_PROMO, DESIGN).
//  - articles en promo = PVPROMO > 0 ET dates début/fin valides.
//  - pour chaque mois : articles dont la fenêtre promo chevauche le mois ;
//    ventes de ces articles DANS [début, fin] ET dont la promo se termine ≤ 61
//    jours après la date de vente (jours_restants ≤ 61).
//  - indicateurs mensuels : CA, marge, % marge, % CA promo/total, taux de
//    transfo, panier moyen, nb articles catalogue, nb unités, Top 3 par CA.
//  - Onglet Promos = tableau TRANSPOSÉ (1 colonne / mois + Total), le mois de
//    coupure (mois précédent) mis en avant en doré.
//  - Onglet Detail_Promos = article par article pour le mois de coupure.

const MOIS_FR = {
  1: "Janvier", 2: "Février", 3: "Mars", 4: "Avril", 5: "Mai", 6: "Juin",
  7: "Juillet", 8: "Août", 9: "Septembre", 10: "Octobre", 11: "Novembre", 12: "Décembre",
};

// Palette
const C_HDR_DARK = "1F4E79", C_HDR_MID = "2E75B6", C_HDR_LBL = "4472C4",
  C_CA_PAIR = "FFFFFF", C_CA_IMPAIR = "F8F8F8", C_MARGE = "FFF9C4",
  C_PCT = "E6D7FF", C_NB = "FFE4CC", C_TOP_NOM = "D6E8FA", C_TOP_CA = "E2EFDA",
  C_TOP_QTE = "FFF2CC", C_SEP = "BDD7EE", C_RATIO = "FCE4D6",
  C_HIGHLIGHT = "FFD700", C_HL_BG = "FFFDE7";
const T_DARK = "FFFFFF", T_MARGE = "E65100", T_PCT = "4A148C", T_NB = "CC5500",
  T_TOP = "1F4E79", T_CA = "000000", T_RATIO = "7B3F00", T_HL = "7B3F00";

const r0 = (n) => Math.round(n);
const r1 = (n) => Math.round(n * 10) / 10;

function parseDateFr(s) {
  if (typeof s !== "string" || !/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return null;
  return new Date(+s.slice(6, 10), +s.slice(3, 5) - 1, +s.slice(0, 2));
}
// Date promo (DBF Date, ou chaîne DD/MM/YYYY ou YYYY-MM-DD)
function parseDatePromo(v) {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v;
  if (typeof v === "string") {
    const s = v.trim();
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return parseDateFr(s);
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
      const d = new Date(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
      return Number.isNaN(d.getTime()) ? null : d;
    }
  }
  return null;
}
const jours = (a, b) => Math.round((a - b) / 86400000);
const dateStr = (d) => {
  const p = (x) => String(x).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
};

// Prépare les lignes de détail enrichies (date, mois, CA, coût, design)
function prepDetails(details, articleByNart) {
  const out = [];
  for (const l of details) {
    const d = parseDateFr(l.date_facture);
    const art = articleByNart.get(String(l.NART).toUpperCase());
    out.push({
      NART: l.NART,
      QTE: l.QTE,
      NUMFACT: l.NUMFACT,
      ca: l.QTE * l.PVTE * (1 - l.POURC / 100),
      cout: l.QTE * l.PREV,
      date: d,
      mois: d ? d.getMonth() + 1 : null,
      design: art ? art.DESIGN : "",
    });
  }
  return out;
}

// Articles en promo valides -> Map NART(upper) -> {debut, fin, design}
function articlesPromo(articles) {
  const map = new Map();
  for (const a of articles) {
    if (!(a.PVPROMO > 0)) continue;
    const debut = parseDatePromo(a.DATE_DEBUT_PROMO);
    const fin = parseDatePromo(a.DATE_FIN_PROMO);
    if (!debut || !fin) continue;
    map.set(String(a.NART).trim().toUpperCase(), {
      NART: String(a.NART).trim(), debut, fin, design: a.DESIGN || "",
    });
  }
  return map;
}

// Ventes promo d'un mois (fenêtre exacte + jours_restants ≤ 61)
function ventesPromoMois(detailsMois, artPromoMois) {
  const out = [];
  for (const l of detailsMois) {
    const ap = artPromoMois.get(String(l.NART).toUpperCase());
    if (!ap || !l.date) continue;
    if (l.date < ap.debut || l.date > ap.fin) continue;
    if (jours(ap.fin, l.date) > 61) continue;
    out.push({ ...l, debut: ap.debut, fin: ap.fin, design: ap.design || l.design });
  }
  return out;
}

// Articles promo dont la fenêtre chevauche [debutMois, finMois]
function artPromoDuMois(promo, debutMois, finMois) {
  const map = new Map();
  for (const ap of promo.values()) {
    if (ap.debut <= finMois && ap.fin >= debutMois) {
      map.set(ap.NART.toUpperCase(), ap);
    }
  }
  return map;
}

function calculerParMois(detailsEnr, promo, anneeN) {
  // CA total par mois
  const caTotalMois = {};
  for (const l of detailsEnr) {
    if (l.mois) caTotalMois[l.mois] = (caTotalMois[l.mois] || 0) + l.ca;
  }

  const resultats = [];
  for (let m = 1; m <= 12; m++) {
    const debutMois = new Date(anneeN, m - 1, 1);
    const finMois = m < 12 ? new Date(anneeN, m, 0) : new Date(anneeN, 11, 31);
    const artPromoMois = artPromoDuMois(promo, debutMois, finMois);
    const nbArtPromo = artPromoMois.size;

    const vide = {
      mois_num: m, nb_art_promo: nbArtPromo, nb_art_vendus: 0,
      ca_promo: 0, marge_promo: 0, taux_marge: 0, pct_ca_total: 0,
      taux_transfo: 0, panier_moyen: 0,
      top1_nom: "—", top1_ca: 0, top1_qte: 0,
      top2_nom: "—", top2_ca: 0, top2_qte: 0,
      top3_nom: "—", top3_ca: 0, top3_qte: 0,
    };

    const detMois = detailsEnr.filter((l) => l.mois === m);
    if (detMois.length === 0 || nbArtPromo === 0) { resultats.push(vide); continue; }

    const detPromo = ventesPromoMois(detMois, artPromoMois);
    if (detPromo.length === 0) { resultats.push(vide); continue; }

    const ca = detPromo.reduce((s, l) => s + l.ca, 0);
    const marge = ca - detPromo.reduce((s, l) => s + l.cout, 0);
    const taux = ca !== 0 ? r1((marge / ca) * 100) : 0;
    const caTotalM = caTotalMois[m] || 0;
    const pctCa = caTotalM !== 0 ? r1((ca / caTotalM) * 100) : 0;
    const nartVendus = new Set(detPromo.map((l) => l.NART)).size;
    const tauxTransfo = nbArtPromo !== 0 ? r1((nartVendus / nbArtPromo) * 100) : 0;
    const nbUnites = detPromo.reduce((s, l) => s + l.QTE, 0);
    const nbFactPromo = new Set(detPromo.map((l) => l.NUMFACT)).size;
    const panier = nbFactPromo !== 0 ? r0(ca / nbFactPromo) : 0;

    // Top 3 par CA (agrégat par NART)
    const parNart = new Map();
    for (const l of detPromo) {
      if (!parNart.has(l.NART)) {
        parNart.set(l.NART, { ca: 0, qte: 0, design: l.design });
      }
      const a = parNart.get(l.NART);
      a.ca += l.ca;
      a.qte += l.QTE;
    }
    const agg = [...parNart.entries()]
      .map(([nart, a]) => ({
        label: (a.design ? String(a.design) : nart).slice(0, 40),
        ca: a.ca, qte: a.qte,
      }))
      .sort((x, y) => y.ca - x.ca);
    const top = (i, f, def) => (agg.length > i ? agg[i][f] : def);

    resultats.push({
      mois_num: m, nb_art_promo: nbArtPromo, nb_art_vendus: nbUnites,
      ca_promo: r0(ca), marge_promo: r0(marge), taux_marge: taux,
      pct_ca_total: pctCa, taux_transfo: tauxTransfo, panier_moyen: panier,
      top1_nom: top(0, "label", "—"), top1_ca: top(0, "ca", 0), top1_qte: top(0, "qte", 0),
      top2_nom: top(1, "label", "—"), top2_ca: top(1, "ca", 0), top2_qte: top(1, "qte", 0),
      top3_nom: top(2, "label", "—"), top3_ca: top(2, "ca", 0), top3_qte: top(2, "qte", 0),
    });
  }
  return resultats;
}

function calculerDetailMois(detailsEnr, promo, moisPrec, anneePrec) {
  const debutMois = new Date(anneePrec, moisPrec - 1, 1);
  const finMois = moisPrec < 12 ? new Date(anneePrec, moisPrec, 0) : new Date(anneePrec, 11, 31);
  const artPromoMois = artPromoDuMois(promo, debutMois, finMois);
  if (artPromoMois.size === 0) return [];

  const detMois = detailsEnr.filter((l) => l.mois === moisPrec);
  if (detMois.length === 0) return [];
  const detPromo = ventesPromoMois(detMois, artPromoMois);
  if (detPromo.length === 0) return [];

  const parNart = new Map();
  for (const l of detPromo) {
    if (!parNart.has(l.NART)) {
      parNart.set(l.NART, {
        ca: 0, cout: 0, qte: 0, factures: new Set(),
        debut: l.debut, fin: l.fin, design: l.design,
      });
    }
    const a = parNart.get(l.NART);
    a.ca += l.ca;
    a.cout += l.cout;
    a.qte += l.QTE;
    a.factures.add(l.NUMFACT);
  }

  const rows = [...parNart.entries()].map(([nart, a]) => {
    const marge = a.ca - a.cout;
    return {
      NART: nart,
      DESIGN: a.design || nart,
      debut_str: a.debut ? dateStr(a.debut) : "",
      fin_str: a.fin ? dateStr(a.fin) : "",
      ca: a.ca,
      marge,
      taux_marge: a.ca !== 0 ? r1((marge / a.ca) * 100) : 0,
      qte: a.qte,
      nb_fact: a.factures.size,
    };
  });
  rows.sort((x, y) => y.ca - x.ca);
  return rows;
}

// ── Écriture des feuilles ────────────────────────────────────────────────────
const fillOf = (hex) => ({ type: "pattern", pattern: "solid", fgColor: { argb: `FF${hex}` } });
const fontOf = (bold, size, color) => ({ bold: !!bold, size, color: { argb: `FF${color}` }, name: "Calibri" });
const bord = (color = "D3D3D3", style = "thin") => ({
  left: { style, color: { argb: `FF${color}` } },
  right: { style, color: { argb: `FF${color}` } },
  top: { style, color: { argb: `FF${color}` } },
  bottom: { style, color: { argb: `FF${color}` } },
});
const bordThick = (color = "B8860B") => ({
  left: { style: "medium", color: { argb: `FF${color}` } },
  right: { style: "medium", color: { argb: `FF${color}` } },
  top: { style: "thin", color: { argb: "FFD3D3D3" } },
  bottom: { style: "thin", color: { argb: "FFD3D3D3" } },
});

function ecrireOngletPromos(workbook, df, anneeN, moisPrec) {
  const ws = workbook.addWorksheet("Promos", {
    properties: { tabColor: { argb: "FFC55A11" } },
    views: [{ state: "frozen", xSplit: 1, ySplit: 2 }], // freeze B3
  });
  const NB = 14; // 1 + 12 + total
  const valM = (m, champ) => {
    const r = df.find((x) => x.mois_num === m);
    return r ? Number(r[champ]) : 0;
  };
  const strM = (m, champ) => {
    const r = df.find((x) => x.mois_num === m);
    return r ? String(r[champ]) : "—";
  };

  // Titre
  ws.mergeCells(1, 1, 1, NB);
  const t = ws.getCell(1, 1);
  t.value = `SUIVI DES PROMOTIONS  —  Année ${anneeN}`;
  t.font = fontOf(true, 14, T_DARK);
  t.fill = fillOf(C_HDR_DARK);
  t.alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(1).height = 34;

  // En-têtes mois (row 2)
  const c0 = ws.getCell(2, 1);
  c0.fill = fillOf(C_HDR_DARK);
  c0.border = bord("FFFFFF");
  for (let i = 0; i < 12; i++) {
    const m = i + 1;
    const c = ws.getCell(2, 2 + i);
    c.value = MOIS_FR[m];
    c.alignment = { horizontal: "center", vertical: "middle" };
    c.border = bord("FFFFFF");
    if (m === moisPrec) { c.font = fontOf(true, 10, T_HL); c.fill = fillOf(C_HIGHLIGHT); }
    else { c.font = fontOf(true, 10, T_DARK); c.fill = fillOf(C_HDR_MID); }
  }
  const ct = ws.getCell(2, 14);
  ct.value = "TOTAL";
  ct.font = fontOf(true, 10, T_DARK);
  ct.fill = fillOf(C_HDR_DARK);
  ct.alignment = { horizontal: "center", vertical: "middle" };
  ct.border = bord("FFFFFF");
  ws.getRow(2).height = 22;

  const writeRow = (rowIdx, label, valeurs, total, fmt, bgCol, txtCol, txtTot = "FFFFFF", hauteur = 20, lblBg = C_HDR_LBL) => {
    const cl = ws.getCell(rowIdx, 1);
    cl.value = "  " + label;
    cl.font = fontOf(true, 10, T_DARK);
    cl.fill = fillOf(lblBg);
    cl.alignment = { horizontal: "left", vertical: "middle" };
    cl.border = bord("FFFFFF");
    ws.getRow(rowIdx).height = hauteur;
    for (let i = 0; i < 12; i++) {
      const m = i + 1;
      const c = ws.getCell(rowIdx, 2 + i);
      c.numFmt = fmt;
      c.alignment = { horizontal: "right", vertical: "middle" };
      if (m === moisPrec) {
        c.fill = fillOf(C_HL_BG); c.font = fontOf(true, 9, txtCol); c.border = bordThick();
      } else {
        const bg = bgCol || (i % 2 === 0 ? C_CA_PAIR : C_CA_IMPAIR);
        c.fill = fillOf(bg); c.font = fontOf(false, 9, txtCol); c.border = bord();
      }
      c.value = valeurs[i];
    }
    const ctt = ws.getCell(rowIdx, 14);
    ctt.value = total;
    ctt.font = fontOf(true, 10, txtTot);
    ctt.fill = fillOf(C_HDR_DARK);
    ctt.alignment = { horizontal: "right", vertical: "middle" };
    ctt.border = bord("FFFFFF");
    ctt.numFmt = fmt;
  };

  const writeTextRow = (rowIdx, label, valeurs, bgCol, txtCol, hauteur = 22, lblBg = C_HDR_LBL) => {
    const cl = ws.getCell(rowIdx, 1);
    cl.value = "  " + label;
    cl.font = fontOf(true, 9, T_DARK);
    cl.fill = fillOf(lblBg);
    cl.alignment = { horizontal: "left", vertical: "middle" };
    cl.border = bord("FFFFFF");
    ws.getRow(rowIdx).height = hauteur;
    for (let i = 0; i < 12; i++) {
      const m = i + 1;
      const c = ws.getCell(rowIdx, 2 + i);
      c.alignment = { horizontal: "left", vertical: "middle", wrapText: true };
      if (m === moisPrec) {
        c.fill = fillOf(C_HL_BG); c.font = fontOf(true, 9, txtCol); c.border = bordThick();
      } else {
        c.fill = fillOf(bgCol); c.font = fontOf(false, 9, txtCol); c.border = bord();
      }
      c.value = valeurs[i];
    }
    const ctt = ws.getCell(rowIdx, 14);
    ctt.fill = fillOf(C_HDR_DARK);
    ctt.border = bord("FFFFFF");
  };

  const sepRow = (rowIdx, titre) => {
    ws.mergeCells(rowIdx, 1, rowIdx, NB);
    const c = ws.getCell(rowIdx, 1);
    c.value = "  " + titre;
    c.font = fontOf(true, 9, C_HDR_DARK);
    c.fill = fillOf(C_SEP);
    c.alignment = { horizontal: "left", vertical: "middle" };
    c.border = bord("FFFFFF");
    ws.getRow(rowIdx).height = 16;
  };

  const mois = Array.from({ length: 12 }, (_, i) => i + 1);
  let row = 3;

  sepRow(row, "▌ INDICATEURS DE PERFORMANCE PROMO"); row += 1;

  const vca = mois.map((m) => valM(m, "ca_promo"));
  const caTot = vca.reduce((s, v) => s + v, 0);
  writeRow(row, "CA réalisé promo (XPF)", vca, caTot, "#,##0", null, T_CA); row += 1;

  const vmg = mois.map((m) => valM(m, "marge_promo"));
  const mgTot = vmg.reduce((s, v) => s + v, 0);
  writeRow(row, "Marge promo (XPF)", vmg, mgTot, "#,##0", C_MARGE, T_MARGE); row += 1;

  const vtm = mois.map((m) => valM(m, "taux_marge"));
  const tmTot = caTot ? r1((mgTot / caTot) * 100) : 0;
  writeRow(row, "% Marge promo", vtm, tmTot, '0.0"%"', C_PCT, T_PCT); row += 1;

  const vpct = mois.map((m) => valM(m, "pct_ca_total"));
  writeRow(row, "% CA promo / CA total du mois", vpct, 0, '0.0"%"', C_RATIO, T_RATIO); row += 1;
  ws.getCell(row - 1, 14).value = "—";

  const vtt = mois.map((m) => valM(m, "taux_transfo"));
  writeRow(row, "Taux de transfo (réfs vendues / réfs promo)", vtt, 0, '0.0"%"', C_RATIO, T_RATIO); row += 1;
  ws.getCell(row - 1, 14).value = "—";

  const vpm = mois.map((m) => valM(m, "panier_moyen"));
  const pmNonZero = vpm.filter((v) => v > 0);
  const pmTot = pmNonZero.length ? r0(pmNonZero.reduce((s, v) => s + v, 0) / pmNonZero.length) : 0;
  writeRow(row, "Panier moyen promo (XPF)", vpm, pmTot, "#,##0", C_RATIO, T_RATIO); row += 1;

  sepRow(row, "▌ VOLUMES"); row += 1;

  const vnp = mois.map((m) => Math.trunc(valM(m, "nb_art_promo")));
  writeRow(row, "Nb articles en promo (catalogue)", vnp, vnp.reduce((s, v) => s + v, 0), "#,##0", C_NB, T_NB); row += 1;

  const vnv = mois.map((m) => valM(m, "nb_art_vendus"));
  writeRow(row, "Nb unités vendues en promo", vnv, vnv.reduce((s, v) => s + v, 0), "#,##0.0", C_NB, T_NB); row += 1;

  sepRow(row, "▌ TOP 3 ARTICLES PROMO PAR MOIS  (classés par CA décroissant)"); row += 1;

  const tops = [
    ["top1_nom", "top1_ca", "top1_qte", "#1  Article", "#1  CA (XPF)", "#1  Qté vendue"],
    ["top2_nom", "top2_ca", "top2_qte", "#2  Article", "#2  CA (XPF)", "#2  Qté vendue"],
    ["top3_nom", "top3_ca", "top3_qte", "#3  Article", "#3  CA (XPF)", "#3  Qté vendue"],
  ];
  for (const [nomF, caF, qteF, lblN, lblCa, lblQte] of tops) {
    writeTextRow(row, lblN, mois.map((m) => strM(m, nomF)), C_TOP_NOM, T_TOP, 24); row += 1;
    const vtca = mois.map((m) => valM(m, caF));
    writeRow(row, lblCa, vtca, vtca.reduce((s, v) => s + v, 0), "#,##0", C_TOP_CA, T_TOP); row += 1;
    const vtqte = mois.map((m) => valM(m, qteF));
    writeRow(row, lblQte, vtqte, vtqte.reduce((s, v) => s + v, 0), "#,##0.0", C_TOP_QTE, T_TOP); row += 1;
  }

  ws.getColumn(1).width = 36;
  for (let i = 0; i < 13; i++) ws.getColumn(2 + i).width = 16;

  return ws;
}

function ecrireOngletDetail(workbook, dfDetail, moisPrec, anneePrec) {
  const ws = workbook.addWorksheet("Detail_Promos", {
    properties: { tabColor: { argb: "FFF4B183" } },
    views: [{ state: "frozen", xSplit: 0, ySplit: 2 }], // freeze A3
  });
  const nomMois = MOIS_FR[moisPrec] || String(moisPrec);
  const NB = 9;

  ws.mergeCells(1, 1, 1, NB);
  const t = ws.getCell(1, 1);
  t.value = `DÉTAIL DES ARTICLES EN PROMOTION  —  ${nomMois} ${anneePrec}`;
  t.font = fontOf(true, 14, T_DARK);
  t.fill = fillOf("C55A11");
  t.alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(1).height = 34;

  if (!dfDetail || dfDetail.length === 0) {
    ws.mergeCells(2, 1, 2, NB);
    const c = ws.getCell(2, 1);
    c.value = `Aucune vente en promotion identifiée pour ${nomMois} ${anneePrec}`;
    c.font = fontOf(false, 11, "7F7F7F");
    c.alignment = { horizontal: "center", vertical: "middle" };
    const largeurs = [14, 42, 13, 13, 16, 16, 10, 12, 12];
    largeurs.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
    return ws;
  }

  const entetes = [
    "N° Article", "Désignation", "Début promo", "Fin promo",
    "CA (XPF)", "Marge (XPF)", "% Marge", "Qté vendue", "Nb factures",
  ];
  entetes.forEach((h, i) => {
    const c = ws.getCell(2, i + 1);
    c.value = h;
    c.font = fontOf(true, 10, T_DARK);
    c.fill = fillOf(C_HDR_DARK);
    c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    c.border = bord("FFFFFF");
  });
  ws.getRow(2).height = 28;

  const champs = ["NART", "DESIGN", "debut_str", "fin_str", "ca", "marge", "taux_marge", "qte", "nb_fact"];
  const formats = { ca: "#,##0", marge: "#,##0", taux_marge: '0.0"%"', qte: "#,##0.0", nb_fact: "#,##0" };
  const aligns = {
    NART: "center", DESIGN: "left", debut_str: "center", fin_str: "center",
    ca: "right", marge: "right", taux_marge: "right", qte: "right", nb_fact: "center",
  };

  dfDetail.forEach((ligne, i) => {
    const rowIdx = 3 + i;
    const isPair = rowIdx % 2 === 0;
    const bgBase = isPair ? "F2F2F2" : "FFFFFF";
    const margeVal = Number(ligne.marge || 0);
    champs.forEach((champ, ci) => {
      const c = ws.getCell(rowIdx, ci + 1);
      c.value = ligne[champ];
      c.border = bord();
      c.alignment = { horizontal: aligns[champ] || "center", vertical: "middle", wrapText: champ === "DESIGN" };
      if (formats[champ]) {
        c.numFmt = formats[champ];
        if (champ === "marge") {
          c.fill = fillOf(margeVal >= 0 ? "E2EFDA" : "FFCCCC");
          c.font = fontOf(true, 9, margeVal >= 0 ? "1F4E79" : "C00000");
        } else if (champ === "taux_marge") {
          c.fill = fillOf(margeVal >= 0 ? "E2EFDA" : "FFCCCC");
          c.font = fontOf(false, 9, margeVal >= 0 ? "1F4E79" : "C00000");
        } else if (champ === "ca") {
          c.fill = fillOf("EBF4FA");
          c.font = fontOf(true, 9, T_CA);
        } else {
          c.fill = fillOf(bgBase);
          c.font = fontOf(false, 9, T_CA);
        }
      } else {
        c.fill = fillOf(bgBase);
        c.font = fontOf(false, 9, champ === "DESIGN" ? "1F1F1F" : T_CA);
      }
    });
    ws.getRow(rowIdx).height = 18;
  });

  const lastDataRow = 2 + dfDetail.length;
  const totalRow = lastDataRow + 2;

  ws.mergeCells(lastDataRow + 1, 1, lastDataRow + 1, NB);
  const sep = ws.getCell(lastDataRow + 1, 1);
  sep.fill = fillOf(C_SEP);
  sep.border = bord("FFFFFF");
  ws.getRow(lastDataRow + 1).height = 6;

  const caT = dfDetail.reduce((s, r) => s + r.ca, 0);
  const mgT = dfDetail.reduce((s, r) => s + r.marge, 0);
  const qteT = dfDetail.reduce((s, r) => s + r.qte, 0);
  const tmT = caT ? r1((mgT / caT) * 100) : 0;
  const labelsTotal = ["", "TOTAL", "", "", caT, mgT, tmT, qteT, ""];
  const fmtsTotal = ["", "", "", "", "#,##0", "#,##0", '0.0"%"', "#,##0.0", ""];
  labelsTotal.forEach((val, ci) => {
    const c = ws.getCell(totalRow, ci + 1);
    c.value = val;
    c.fill = fillOf(C_HDR_DARK);
    c.font = fontOf(true, 10, T_DARK);
    c.alignment = { horizontal: ci + 1 > 4 ? "right" : "center", vertical: "middle" };
    c.border = bord("FFFFFF");
    if (fmtsTotal[ci]) c.numFmt = fmtsTotal[ci];
  });
  ws.getRow(totalRow).height = 22;

  const largeurs = [14, 42, 13, 13, 16, 16, 10, 12, 12];
  largeurs.forEach((w, i) => { ws.getColumn(i + 1).width = w; });

  return ws;
}

/**
 * Ajoute les onglets Promos puis Detail_Promos au classeur.
 * @param {ExcelJS.Workbook} workbook
 * @param {object} ctx - { datasets }
 */
export function buildPromosSheets(workbook, ctx) {
  const { datasets } = ctx;
  const anneeN = datasets.periode.anneeN;
  const moisPrec = datasets.periode.mois; // mois de coupure choisi
  const anneePrec = anneeN;

  const detailsEnr = prepDetails(datasets.detailsN, datasets.articleByNart);
  const promo = articlesPromo(datasets.articles);

  const parMois = calculerParMois(detailsEnr, promo, anneeN);
  const detail = calculerDetailMois(detailsEnr, promo, moisPrec, anneePrec);

  ecrireOngletPromos(workbook, parMois, anneeN, moisPrec);
  ecrireOngletDetail(workbook, detail, moisPrec, anneePrec);

  return { parMois, detail };
}

export default buildPromosSheets;