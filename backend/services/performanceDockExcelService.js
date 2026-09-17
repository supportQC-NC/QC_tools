// backend/services/performanceDockExcelService.js
// -----------------------------------------------------------------------------
// Export Excel de la Performance Dock (réappro magasin).
//
// L'export d'origine était produit côté navigateur avec SheetJS : trois colonnes
// brutes, aucune mise en forme (l'édition communautaire de SheetJS ne sait pas
// écrire de style). On le génère donc ici, avec ExcelJS, pour obtenir un
// classeur présentable tel quel : bandeaux, cartes d'indicateurs, barres de
// données dans la colonne des volumes, mise en page prête à imprimer.
//
// ⚠️ Le calcul n'est PAS refait ici : le service reçoit le rapport déjà filtré
// par `performanceDockService.getReport()`. Écran et classeur affichent donc
// exactement les mêmes chiffres, y compris quand l'utilisateur a redéfini la
// base de la moyenne.
//
// Unité métier : l'ARTICLE à réapprovisionner (une ligne de l'onglet DONNEES du
// fichier reapro_mag = un article). Jamais « ligne » dans les libellés.
//
// ⚠️ Feuille Synthèse : positions écrites en dur (curseur explicite) et pas
// `addRow`. ExcelJS ne compte pas les lignes vides dans `rowCount` : enchaîner
// addRow après un espaceur décalait silencieusement tout le bloc.
// -----------------------------------------------------------------------------
import ExcelJS from "exceljs";

const ENTIER = "#,##0";
const SIGNE = "+#,##0;-#,##0;0";
const PCT = '+0.0" %";-0.0" %";0" %"';

// Palette : une teinte porteuse (le bleu du module) + le couple vert/rouge pour
// le signe de l'écart. ARGB sur 8 chiffres, comme partout ailleurs.
// ⚠️ On mesure une CHARGE (articles à réapprovisionner) : au-dessus de la
// moyenne = ROUGE, en-dessous = VERT. Même convention que l'écran.
const BLEU = "FF3987E5";
const BLEU_FONCE = "FF1B4F91";
const BLEU_PALE = "FFEAF2FC";
const OR = "FF9A7B12";
const OR_PALE = "FFFDF6E0";
const VERT = "FF0B7A0B";
const ROUGE = "FFC0392B";
const GRIS = "FF6B7280";
const ZEBRE = "FFF7F9FC";
const BORDURE = "FFDDE3EA";

const JOURS = [
  "dimanche",
  "lundi",
  "mardi",
  "mercredi",
  "jeudi",
  "vendredi",
  "samedi",
];

const frDate = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso || "");
};

const jourDe = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
  return m ? JOURS[new Date(+m[1], +m[2] - 1, +m[3]).getDay()] : "";
};

const cap = (s) => (s ? String(s).charAt(0).toUpperCase() + String(s).slice(1) : "");

const col = (n) => String.fromCharCode(64 + n); // 1 -> A
const bordureBasse = { bottom: { style: "thin", color: { argb: BORDURE } } };

const remplir = (cell, argb) => {
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb } };
};

/** Bandeau titre + sous-titre (lignes 1 et 2), sur toute la largeur. */
const bandeau = (ws, titre, sousTitre, derniereColonne) => {
  ws.mergeCells(`A1:${derniereColonne}1`);
  const t = ws.getCell("A1");
  t.value = titre;
  t.font = { bold: true, size: 15, color: { argb: "FFFFFFFF" } };
  remplir(t, BLEU_FONCE);
  t.alignment = { horizontal: "left", vertical: "middle", indent: 1 };
  ws.getRow(1).height = 30;

  ws.mergeCells(`A2:${derniereColonne}2`);
  const s = ws.getCell("A2");
  s.value = sousTitre;
  s.font = { size: 10, color: { argb: "FFFFFFFF" } };
  remplir(s, BLEU);
  s.alignment = { horizontal: "left", vertical: "middle", indent: 1, wrapText: false };
  ws.getRow(2).height = 20;
};

/** En-têtes de tableau posés sur une ligne précise. */
const entetesAt = (ws, ligne, valeurs) => {
  const row = ws.getRow(ligne);
  valeurs.forEach((v, i) => {
    const c = row.getCell(i + 1);
    c.value = v;
    c.font = { bold: true, size: 10, color: { argb: "FFFFFFFF" } };
    remplir(c, BLEU_FONCE);
    c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  });
  row.height = 26;
  row.commit();
  return row;
};

/** Titre de section à l'intérieur d'une feuille. */
const sectionAt = (ws, ligne, texte, derniereColonne) => {
  ws.mergeCells(`A${ligne}:${derniereColonne}${ligne}`);
  const c = ws.getCell(`A${ligne}`);
  c.value = texte;
  c.font = { bold: true, size: 11, color: { argb: BLEU_FONCE } };
  c.alignment = { vertical: "middle", indent: 1 };
  c.border = { bottom: { style: "medium", color: { argb: BLEU } } };
  ws.getRow(ligne).height = 22;
};

/**
 * Carte d'indicateur : deux colonnes fusionnées sur deux lignes — le chiffre en
 * grand, son libellé dessous. C'est ce qui donne au classeur l'allure de
 * l'écran plutôt que celle d'un export brut.
 */
const carte = (ws, colDebut, ligne, valeur, libelle, couleur) => {
  const a = col(colDebut);
  const b = col(colDebut + 1);
  ws.mergeCells(`${a}${ligne}:${b}${ligne}`);
  ws.mergeCells(`${a}${ligne + 1}:${b}${ligne + 1}`);

  const v = ws.getCell(`${a}${ligne}`);
  v.value = valeur;
  if (typeof valeur === "number") v.numFmt = ENTIER;
  v.font = { bold: true, size: 20, color: { argb: couleur } };
  v.alignment = { horizontal: "center", vertical: "middle" };
  remplir(v, BLEU_PALE);

  const l = ws.getCell(`${a}${ligne + 1}`);
  l.value = libelle;
  l.font = { size: 9, color: { argb: GRIS } };
  l.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  remplir(l, BLEU_PALE);

  ws.getRow(ligne).height = 32;
  ws.getRow(ligne + 1).height = 24;
};

/** Résumé lisible des critères — ce qui a été retenu, et ce qui ne l'a pas été. */
const libellesCriteres = (rapport) => {
  const c = rapport.criteres || {};
  const b = rapport.bornes || {};
  return [
    [
      "Période analysée",
      c.debut || c.fin
        ? `du ${frDate(c.debut || b.premiere)} au ${frDate(c.fin || b.derniere)}`
        : `toutes les journées disponibles (${frDate(b.premiere)} → ${frDate(b.derniere)})`,
    ],
    [
      "Jours de la semaine retenus",
      c.jours && c.jours.length ? c.jours.map((j) => cap(JOURS[j])).join(", ") : "tous",
    ],
    [
      "Journées sans activité",
      c.exclureZero ? "exclues du calcul" : "conservées",
    ],
    [
      "Seuil bas",
      c.min === null || c.min === undefined
        ? "aucun"
        : `journées sous ${c.min} articles exclues`,
    ],
    [
      "Seuil haut",
      c.max === null || c.max === undefined
        ? "aucun"
        : `journées au-dessus de ${c.max} articles exclues`,
    ],
    [
      "Base de la moyenne",
      c.baseMoyenne === "selection"
        ? "journées retenues par les critères ci-dessus"
        : "toutes les journées disponibles (moyenne de référence)",
    ],
    [
      "Journées écartées",
      `${(rapport.ecartees || []).length} — détail dans l'onglet « Journées écartées »`,
    ],
  ];
};

// ─────────────────────────────────────────────────────────────────────────────
// Feuille 1 — Synthèse
// ─────────────────────────────────────────────────────────────────────────────
const feuilleSynthese = (wb, rapport, periodeLabel) => {
  const ws = wb.addWorksheet("Synthèse", {
    properties: { tabColor: { argb: BLEU_FONCE } },
    views: [{ showGridLines: false }],
  });
  ws.columns = Array.from({ length: 6 }, () => ({ width: 20 }));

  bandeau(
    ws,
    "Performance réappro magasin — articles réapprovisionnés par jour",
    periodeLabel,
    "F",
  );

  const stats = rapport.stats || {};
  const globales = rapport.statsGlobales || {};
  const surSelection = rapport.criteres?.baseMoyenne === "selection";

  // ── Cartes d'indicateurs : 2 rangées de 3 ──
  const l1 = 4;
  carte(
    ws,
    1,
    l1,
    rapport.moyenneArrondie || 0,
    surSelection
      ? "Moyenne / jour (journées retenues)"
      : "Moyenne / jour (référence, toutes journées)",
    OR,
  );
  carte(ws, 3, l1, stats.mediane || 0, "Médiane / jour", BLEU_FONCE);
  carte(ws, 5, l1, stats.total || 0, "Total d'articles réapprovisionnés", BLEU_FONCE);

  ws.getRow(l1 + 2).height = 6; // espaceur
  const l2 = l1 + 3;
  carte(ws, 1, l2, stats.max || 0, "Journée la plus chargée", ROUGE);
  carte(ws, 3, l2, stats.min || 0, "Journée la plus légère", VERT);
  carte(ws, 5, l2, stats.nbJours || 0, "Journées retenues", BLEU_FONCE);

  // Rappel de l'autre moyenne : sans lui, on ne sait plus à quoi la sélection
  // est comparée.
  const lRappel = l2 + 3;
  ws.mergeCells(`A${lRappel}:F${lRappel}`);
  const rappel = ws.getCell(`A${lRappel}`);
  rappel.value = surSelection
    ? `Moyenne de référence (toutes les journées disponibles) : ${Math.round(
        globales.moyenne || 0,
      ).toLocaleString("fr-FR")} articles / jour sur ${globales.nbJours || 0} journées.`
    : `Moyenne des seules journées retenues : ${Math.round(
        stats.moyenne || 0,
      ).toLocaleString("fr-FR")} articles / jour — affichée pour information, elle ne sert pas d'étalon ici.`;
  rappel.font = { italic: true, size: 9, color: { argb: GRIS } };
  rappel.alignment = { indent: 1, vertical: "middle" };
  remplir(rappel, OR_PALE);
  ws.getRow(lRappel).height = 20;

  // ── Rythme par jour de la semaine ──
  const lSection = lRappel + 2;
  sectionAt(ws, lSection, "Rythme par jour de la semaine", "F");
  entetesAt(ws, lSection + 1, [
    "Jour",
    "Journées",
    "Total articles",
    "Moyenne / jour",
    "Écart vs moyenne",
    "% vs moyenne",
  ]);

  const debutJS = lSection + 2;
  const parJour = rapport.parJourSemaine || [];
  parJour.forEach((j, i) => {
    const row = ws.getRow(debutJS + i);
    row.values = [
      cap(j.label),
      j.nbJours,
      j.total,
      j.moyenneArrondie,
      j.ecart,
      rapport.moyenne ? (j.ecart / rapport.moyenne) * 100 : 0,
    ];
    row.getCell(2).numFmt = ENTIER;
    row.getCell(3).numFmt = ENTIER;
    row.getCell(4).numFmt = ENTIER;
    row.getCell(5).numFmt = SIGNE;
    row.getCell(6).numFmt = PCT;
    const couleur = j.ecart >= 0 ? ROUGE : VERT;
    row.getCell(5).font = { bold: true, color: { argb: couleur } };
    row.getCell(6).font = { color: { argb: couleur } };
    row.eachCell((c) => {
      c.border = bordureBasse;
      if (i % 2) remplir(c, ZEBRE);
    });
    row.commit();
  });
  const finJS = debutJS + Math.max(parJour.length, 1) - 1;
  if (parJour.length) {
    ws.addConditionalFormatting({
      ref: `D${debutJS}:D${finJS}`,
      rules: [
        {
          type: "dataBar",
          cfvo: [{ type: "num", value: 0 }, { type: "max" }],
          color: { argb: BLEU },
        },
      ],
    });
  }

  // ── Critères ──
  const lCriteres = finJS + 2;
  sectionAt(ws, lCriteres, "Critères retenus", "F");
  libellesCriteres(rapport).forEach(([label, valeur], i) => {
    const n = lCriteres + 1 + i;
    ws.mergeCells(`B${n}:F${n}`);
    const a = ws.getCell(`A${n}`);
    a.value = label;
    a.font = { bold: true, size: 10 };
    a.border = bordureBasse;
    const b = ws.getCell(`B${n}`);
    b.value = valeur;
    b.alignment = { wrapText: true, vertical: "middle" };
    b.border = bordureBasse;
    ws.getRow(n).height = 18;
  });

  const lNote = lCriteres + libellesCriteres(rapport).length + 2;
  ws.mergeCells(`A${lNote}:F${lNote}`);
  const note = ws.getCell(`A${lNote}`);
  note.value =
    "Un article = une ligne de l'onglet DONNEES du fichier reapro_mag dont le GISEMENT n'est ni vide ni « STOP ».";
  note.font = { italic: true, size: 9, color: { argb: GRIS } };

  ws.pageSetup = {
    orientation: "portrait",
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 },
  };
  return ws;
};

// ─────────────────────────────────────────────────────────────────────────────
// Feuille 2 — Détail par jour
// ─────────────────────────────────────────────────────────────────────────────
const feuilleDetail = (wb, rapport, periodeLabel) => {
  const ws = wb.addWorksheet("Détail par jour", {
    properties: { tabColor: { argb: BLEU } },
    views: [{ state: "frozen", ySplit: 3, showGridLines: false }],
  });
  ws.columns = [
    { width: 14 },
    { width: 13 },
    { width: 18 },
    { width: 18 },
    { width: 15 },
    { width: 9 },
    { width: 16 },
  ];

  bandeau(ws, "Détail journalier — articles réapprovisionnés", periodeLabel, "G");
  entetesAt(ws, 3, [
    "Date",
    "Jour",
    "Articles réappro.",
    "Écart vs moyenne",
    "% vs moyenne",
    "Rang",
    "Cumul articles",
  ]);

  const premiere = 4;
  const lignes = rapport.rows || [];
  lignes.forEach((r, i) => {
    const row = ws.getRow(premiere + i);
    row.values = [
      frDate(r.date),
      cap(r.jourSemaineLabel || jourDe(r.date)),
      r.articles,
      r.ecart,
      r.pct,
      r.rang,
      r.cumul,
    ];
    row.getCell(3).numFmt = ENTIER;
    row.getCell(4).numFmt = SIGNE;
    row.getCell(5).numFmt = PCT;
    row.getCell(6).numFmt = ENTIER;
    row.getCell(7).numFmt = ENTIER;
    const couleur = r.ecart >= 0 ? ROUGE : VERT;
    row.getCell(4).font = { bold: true, color: { argb: couleur } };
    row.getCell(5).font = { color: { argb: couleur } };
    row.eachCell((c) => {
      c.border = bordureBasse;
      if (i % 2) remplir(c, ZEBRE);
    });
    row.height = 17;
    row.commit();
  });

  if (lignes.length) {
    const derniere = premiere + lignes.length - 1;
    // Barres de données : la colonne des volumes se lit d'un coup d'œil, sans
    // graphique — ExcelJS ne sait pas en écrire.
    ws.addConditionalFormatting({
      ref: `C${premiere}:C${derniere}`,
      rules: [
        {
          type: "dataBar",
          cfvo: [{ type: "num", value: 0 }, { type: "max" }],
          color: { argb: BLEU },
        },
      ],
    });
    ws.autoFilter = { from: "A3", to: `G${derniere}` };

    const lTotal = derniere + 1;
    const total = ws.getRow(lTotal);
    total.values = [
      "Total",
      `${rapport.stats?.nbJours || 0} journées`,
      rapport.stats?.total || 0,
    ];
    total.eachCell((c) => {
      c.font = { bold: true, color: { argb: "FFFFFFFF" } };
      remplir(c, BLEU_FONCE);
    });
    total.getCell(3).numFmt = ENTIER;
    total.height = 20;
    total.commit();

    const moy = ws.getRow(lTotal + 1);
    moy.values = [
      "Moyenne retenue",
      rapport.baseMoyenneLabel || "",
      rapport.moyenneArrondie || 0,
    ];
    moy.eachCell((c) => {
      c.font = { bold: true, color: { argb: OR } };
      remplir(c, OR_PALE);
    });
    moy.getCell(3).numFmt = ENTIER;
    moy.height = 20;
    moy.commit();
  }

  ws.pageSetup = {
    orientation: "portrait",
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    printTitlesRow: "3:3",
    margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 },
  };
  return ws;
};

// ─────────────────────────────────────────────────────────────────────────────
// Feuille 3 — Journées écartées (transparence : aucun filtrage silencieux)
// ─────────────────────────────────────────────────────────────────────────────
const feuilleEcartees = (wb, rapport, periodeLabel) => {
  const ws = wb.addWorksheet("Journées écartées", {
    properties: { tabColor: { argb: GRIS } },
    views: [{ state: "frozen", ySplit: 3, showGridLines: false }],
  });
  ws.columns = [{ width: 14 }, { width: 13 }, { width: 18 }, { width: 46 }];

  bandeau(ws, "Journées exclues du calcul par les critères", periodeLabel, "D");
  entetesAt(ws, 3, ["Date", "Jour", "Articles réappro.", "Motif d'exclusion"]);

  const ecartees = rapport.ecartees || [];
  if (!ecartees.length) {
    ws.mergeCells("A4:D4");
    const c = ws.getCell("A4");
    c.value =
      "Aucune journée écartée : le calcul porte sur tout l'historique disponible.";
    c.font = { italic: true, color: { argb: GRIS } };
    return ws;
  }

  ecartees.forEach((r, i) => {
    const row = ws.getRow(4 + i);
    row.values = [frDate(r.date), cap(jourDe(r.date)), r.articles, r.motif];
    row.getCell(3).numFmt = ENTIER;
    row.eachCell((c) => {
      c.border = bordureBasse;
      if (i % 2) remplir(c, ZEBRE);
    });
    row.commit();
  });
  ws.autoFilter = { from: "A3", to: `D${3 + ecartees.length}` };
  return ws;
};

/**
 * Construit le classeur à partir d'un rapport DÉJÀ filtré.
 * @param {object} rapport sortie de performanceDockService.getReport()
 * @returns {Promise<Buffer>}
 */
export const genererExcelPerformanceDock = async (rapport) => {
  const wb = new ExcelJS.Workbook();
  wb.creator = "QC Tools — Performance réappro magasin";
  wb.created = new Date();

  const c = rapport.criteres || {};
  const b = rapport.bornes || {};
  const periode =
    c.debut || c.fin
      ? `Période : ${frDate(c.debut || b.premiere)} → ${frDate(c.fin || b.derniere)}`
      : `Historique complet : ${frDate(b.premiere)} → ${frDate(b.derniere)}`;
  const periodeLabel =
    `${periode} · ${rapport.stats?.nbJours || 0} journées retenues · ` +
    `moyenne calculée sur ${rapport.baseMoyenneLabel || "toutes les journées disponibles"} · ` +
    `édité le ${new Date().toLocaleDateString("fr-FR")}`;

  feuilleSynthese(wb, rapport, periodeLabel);
  feuilleDetail(wb, rapport, periodeLabel);
  feuilleEcartees(wb, rapport, periodeLabel);

  return wb.xlsx.writeBuffer();
};

export default { genererExcelPerformanceDock };
