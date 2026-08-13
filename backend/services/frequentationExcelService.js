// backend/services/frequentationExcelService.js
//
// Export Excel de l'analyse de fréquentation (exceljs) :
//   Synthèse · Par tranche horaire · Par jour de semaine · Carte de chaleur · Par jour.
import ExcelJS from "exceljs";

const ENTIER = "#,##0";
const DECIMAL = "#,##0.0";
const BLEU = "FF2563EB";
const BLEU_FONCE = "FF1D4ED8";

const styleHeader = (row, argb = BLEU) => {
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  });
  row.height = 22;
};

const titre = (ws, texte, span) => {
  ws.mergeCells(`A1:${span}1`);
  ws.getCell("A1").value = texte;
  ws.getCell("A1").font = { bold: true, size: 14, color: { argb: "FFFFFFFF" } };
  ws.getCell("A1").fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: BLEU_FONCE },
  };
  ws.getCell("A1").alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(1).height = 26;
};

const frDate = (iso) => {
  if (!iso) return "";
  const [y, m, d] = String(iso).split("-");
  return `${d}/${m}/${y}`;
};

export const genererExcelFrequentation = async ({ data, nomSociete }) => {
  const wb = new ExcelJS.Workbook();
  wb.creator = "QC Tools - Fréquentation magasin";
  wb.created = new Date();

  const periodeLabel = `du ${frDate(data.periode.du)} au ${frDate(
    data.periode.au,
  )} (pas ${data.periode.pas} min)`;

  // ── Feuille 1 : Synthèse ──
  const wsS = wb.addWorksheet("Synthèse", {
    properties: { tabColor: { argb: BLEU } },
  });
  titre(wsS, `Fréquentation magasin — ${nomSociete || ""} — ${periodeLabel}`, "B");
  styleHeader(wsS.addRow(["Indicateur", "Valeur"]));
  const k = data.kpi;
  const lignes = [
    ["Factures éditées (passages)", k.nbFactures],
    ["Avoirs sur la période", k.nbAvoirs],
    ["Chiffre d'affaires (XPF)", k.caTotal],
    ["Panier moyen (XPF)", k.panierMoyen],
    ["Jours d'ouverture", k.nbJoursOuverts],
    ["Moyenne de tickets par jour ouvert", k.moyenneParJourOuvert],
    ["Amplitude de fréquentation", k.amplitude],
    ["Heure de pointe", `${k.heurePointe} (${k.heurePointeNb} tickets)`],
    ["Jour de semaine le plus fréquenté", k.jourSemainePointe],
    ["Journée la plus fréquentée", `${frDate(k.jourPointe)} (${k.jourPointeNb})`],
    ["Factures sans heure exploitable", k.sansHeure],
    [`Écartées : comptes internes (TIERS > ${k.tiersMax})`, k.comptesInternes],
  ];
  lignes.forEach(([label, valeur]) => {
    const r = wsS.addRow([label, valeur]);
    if (typeof valeur === "number") r.getCell(2).numFmt = ENTIER;
  });
  wsS.columns = [{ width: 38 }, { width: 26 }];

  // ── Feuille 2 : Par tranche horaire ──
  const wsH = wb.addWorksheet("Par tranche horaire");
  titre(wsH, `Fréquentation par tranche horaire — ${periodeLabel}`, "E");
  styleHeader(
    wsH.addRow(["Tranche", "Tickets", "% du total", "CA (XPF)", "Panier moyen"]),
  );
  data.tranches.forEach((t) => {
    const r = wsH.addRow([t.label, t.nb, t.part, t.ca, t.panierMoyen]);
    r.getCell(2).numFmt = ENTIER;
    r.getCell(3).numFmt = DECIMAL;
    r.getCell(4).numFmt = ENTIER;
    r.getCell(5).numFmt = ENTIER;
  });
  wsH.columns = [
    { width: 12 },
    { width: 12 },
    { width: 12 },
    { width: 16 },
    { width: 16 },
  ];
  wsH.views = [{ state: "frozen", ySplit: 2 }];

  // ── Feuille 3 : Par jour de semaine ──
  const wsJ = wb.addWorksheet("Par jour de semaine");
  titre(wsJ, `Fréquentation par jour de semaine — ${periodeLabel}`, "F");
  styleHeader(
    wsJ.addRow([
      "Jour",
      "Tickets",
      "Jours ouverts",
      "Moyenne / jour",
      "CA (XPF)",
      "Panier moyen",
    ]),
  );
  data.joursSemaine.forEach((j) => {
    const r = wsJ.addRow([
      j.label,
      j.nb,
      j.nbJoursOuverts,
      j.moyenneParJour,
      j.ca,
      j.panierMoyen,
    ]);
    r.getCell(2).numFmt = ENTIER;
    r.getCell(4).numFmt = DECIMAL;
    r.getCell(5).numFmt = ENTIER;
    r.getCell(6).numFmt = ENTIER;
  });
  wsJ.columns = [
    { width: 14 },
    { width: 12 },
    { width: 14 },
    { width: 14 },
    { width: 16 },
    { width: 14 },
  ];

  // ── Feuille 4 : Carte de chaleur (jours en lignes, tranches en colonnes) ──
  const wsC = wb.addWorksheet("Carte de chaleur");
  const tranches = data.tranches.map((t) => t.label);
  titre(
    wsC,
    `Tickets par jour de semaine et tranche horaire — ${periodeLabel}`,
    String.fromCharCode(65 + Math.min(tranches.length, 25)),
  );
  styleHeader(wsC.addRow(["Jour", ...tranches]));
  const parJourTranche = new Map();
  data.heat.forEach((h) => parJourTranche.set(`${h.jourLabel}::${h.tranche}`, h.nb));
  data.joursSemaine.forEach((j) => {
    const r = wsC.addRow([
      j.label,
      ...tranches.map((t) => parJourTranche.get(`${j.label}::${t}`) ?? 0),
    ]);
    for (let i = 2; i <= tranches.length + 1; i += 1) r.getCell(i).numFmt = ENTIER;
  });
  wsC.columns = [{ width: 14 }, ...tranches.map(() => ({ width: 8 }))];
  wsC.views = [{ state: "frozen", xSplit: 1, ySplit: 2 }];

  // ── Feuille 5 : Par jour ──
  const wsD = wb.addWorksheet("Par jour");
  titre(wsD, `Fréquentation jour par jour — ${periodeLabel}`, "E");
  styleHeader(
    wsD.addRow(["Date", "Jour", "Tickets", "CA (XPF)", "Panier moyen"]),
  );
  data.jours.forEach((j) => {
    const r = wsD.addRow([frDate(j.date), j.jourSemaine, j.nb, j.ca, j.panierMoyen]);
    r.getCell(3).numFmt = ENTIER;
    r.getCell(4).numFmt = ENTIER;
    r.getCell(5).numFmt = ENTIER;
  });
  wsD.columns = [
    { width: 14 },
    { width: 14 },
    { width: 12 },
    { width: 16 },
    { width: 14 },
  ];
  wsD.views = [{ state: "frozen", ySplit: 2 }];

  return wb.xlsx.writeBuffer();
};

export default { genererExcelFrequentation };
