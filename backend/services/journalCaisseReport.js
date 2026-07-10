// backend/services/journalCaisseReport.js
//
// Générateur DÉDIÉ du Journal de Caisse — reproduit fidèlement les exports de
// l'écran AdminJournalCaisseScreen :
//   • Excel (ExcelJS) : 3 onglets « Factures du Jour », « Factures Debit »
//     (si présent), « Détails des Factures ».
//   • PDF (pdfkit)    : titre + un tableau par moyen de paiement (en-tête gris,
//     lignes beige, grille) avec total, puis section « Avoirs ».
//
// Retourne { attachments: [{ buffer, filename }, …] } (2 fichiers).

import ExcelJS from "exceljs";

const JOURS_FR = [
  "Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi",
];
const MOIS_FR = [
  "janvier", "février", "mars", "avril", "mai", "juin",
  "juillet", "août", "septembre", "octobre", "novembre", "décembre",
];

const r0 = (n) => Math.round(Number(n) || 0);
const fF = (n) => `${r0(n).toLocaleString("fr-FR")} F`;

function dateLongueFr(dateStr) {
  const [y, m, d] = String(dateStr).split("-").map((x) => parseInt(x, 10));
  const dt = new Date(y, m - 1, d);
  return `${JOURS_FR[dt.getDay()]} ${dt.getDate()} ${MOIS_FR[dt.getMonth()]} ${dt.getFullYear()}`;
}

// ─────────────────────────── Excel (ExcelJS) ───────────────────────────
async function buildExcel(data) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "QC Tools";

  const enTetes = [
    "Pointage", "NUMFACT", "DATFACT", "MONTANT", "MONTAXES",
    "TIERS", "NOM", "moyen_payment",
  ];
  const ligne = (f) => [
    "☐", f.numfact, f.date, r0(f.montant), r0(f.montaxes), f.tiers, f.nom, f.moyen,
  ];

  const toutes = (data.groupes || []).flatMap((g) => g.factures);

  const ws1 = wb.addWorksheet("Factures du Jour");
  ws1.addRow(enTetes);
  toutes.forEach((f) => ws1.addRow(ligne(f)));
  ws1.getRow(1).font = { bold: true };

  const debit = toutes
    .filter((f) => f.moyen === "Debit")
    .sort((a, b) => String(a.nom).localeCompare(String(b.nom)));
  if (debit.length > 0) {
    const ws2 = wb.addWorksheet("Factures Debit");
    ws2.addRow(enTetes);
    debit.forEach((f) => ws2.addRow(ligne(f)));
    ws2.getRow(1).font = { bold: true };
  }

  const ws3 = wb.addWorksheet("Détails des Factures");
  ws3.addRow(["NUMFACT", "NART", "DESIGN", "DTVA", "CLIENT", "NOM_CLIENT"]);
  (data.details || []).forEach((d) =>
    ws3.addRow([d.numfact, d.nart, d.design, d.dtva, d.client, d.nomClient]),
  );
  ws3.getRow(1).font = { bold: true };

  return wb.xlsx.writeBuffer();
}

// ─────────────────────────── PDF (pdfkit) ───────────────────────────
async function buildPdf(data, trig) {
  const mod = await import("pdfkit").catch(() => {
    throw new Error("Module 'pdfkit' introuvable. Lancez : npm i pdfkit (backend).");
  });
  const PDFDocument = mod.default;

  const doc = new PDFDocument({ size: "A4", margin: 40 });
  const chunks = [];
  doc.on("data", (c) => chunks.push(c));
  const done = new Promise((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));

  const pageW = doc.page.width;
  const pageH = doc.page.height;
  const left = 40;
  const tableW = pageW - left - 40;

  doc
    .font("Helvetica-Bold")
    .fontSize(16)
    .fillColor("#000")
    .text(`${trig} - Journal de caisse du ${dateLongueFr(data.date)}.`, left, 40, {
      width: tableW,
      align: "center",
    });
  let y = 84;

  const ensure = (space) => {
    if (y + space > pageH - 40) {
      doc.addPage();
      y = 40;
    }
  };

  const rowH = 16;

  function drawTable(head, rows, widths) {
    const colX = [];
    let x = left;
    widths.forEach((w) => {
      colX.push(x);
      x += w;
    });

    // En-tête (gris)
    ensure(rowH);
    doc.rect(left, y, tableW, rowH).fill("#808080");
    doc.fillColor("#F5F5F5").font("Helvetica-Bold").fontSize(8);
    head.forEach((h, i) =>
      doc.text(String(h), colX[i] + 2, y + 4, {
        width: widths[i] - 4,
        align: "center",
        height: rowH - 4,
        ellipsis: true,
        lineBreak: false,
      }),
    );
    doc.strokeColor("#000").lineWidth(0.5).rect(left, y, tableW, rowH).stroke();
    y += rowH;

    // Corps (beige)
    doc.font("Helvetica").fontSize(8);
    rows.forEach((rw) => {
      ensure(rowH);
      doc.rect(left, y, tableW, rowH).fill("#F5F5DC");
      doc.fillColor("#000");
      rw.forEach((c, i) =>
        doc.text(String(c ?? ""), colX[i] + 2, y + 4, {
          width: widths[i] - 4,
          align: "center",
          height: rowH - 4,
          ellipsis: true,
          lineBreak: false,
        }),
      );
      doc.strokeColor("#000").lineWidth(0.5).rect(left, y, tableW, rowH).stroke();
      colX.forEach((cx, i) => {
        if (i > 0) doc.moveTo(cx, y).lineTo(cx, y + rowH).stroke();
      });
      y += rowH;
    });
  }

  function section(titre, head, rows, totalLabel, total, widths) {
    ensure(40);
    doc.fillColor("#000").font("Helvetica-Bold").fontSize(12).text(titre, left, y);
    y += 16;
    drawTable(head, rows, widths);
    y += 6;
    ensure(20);
    doc
      .font("Helvetica")
      .fontSize(10)
      .fillColor("#000")
      .text(`${totalLabel} : ${fF(total)}`, left, y);
    y += 28;
  }

  const wMoyen = [0.15, 0.1, 0.14, 0.15, 0.13, 0.13, 0.2].map((p) => p * tableW);
  (data.groupes || []).forEach((g) => {
    section(
      g.moyen,
      ["N° facture", "Heure", "Tiers", "Montant", "Moyen", "N° CH", "Client"],
      g.factures.map((f) => [
        f.numfact, f.heure || "", f.tiers, fF(f.montant), f.moyen, f.numCheque || "", f.nom,
      ]),
      "Total MONTANT",
      g.total,
      wMoyen,
    );
  });

  const wAvoir = [0.17, 0.11, 0.16, 0.17, 0.15, 0.24].map((p) => p * tableW);
  section(
    "Avoirs",
    ["N° facture", "Heure", "Tiers", "Montant", "N° CH", "Client"],
    (data.avoirs || []).map((f) => [
      f.numfact, f.heure || "", f.tiers, fF(f.montant), f.numCheque || "", f.nom,
    ]),
    "Total MONTANT Avoirs",
    data.totalAvoirs,
    wAvoir,
  );

  doc.end();
  return done;
}

// ─────────────────────────── Entrée ───────────────────────────
export async function generateJournalCaisse(entreprise, data, now = new Date()) {
  const trig = entreprise.trigramme || entreprise.nomDossierDBF;
  const base = `journal_caisse_${entreprise.nomDossierDBF}_${data.date}`;

  const [xlsx, pdf] = await Promise.all([buildExcel(data), buildPdf(data, trig)]);

  return {
    attachments: [
      { buffer: xlsx, filename: `${base}.xlsx` },
      { buffer: pdf, filename: `${base}.pdf` },
    ],
  };
}

export default generateJournalCaisse;