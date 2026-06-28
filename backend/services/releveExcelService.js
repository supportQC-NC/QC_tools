// backend/services/releveExcelService.js
import ExcelJS from "exceljs";

/**
 * Génère un fichier Excel pour un relevé de prix
 * @param {Object} releve - Le relevé avec les données populées
 * @returns {Buffer} - Le buffer du fichier Excel
 */
export const genererExcelReleve = async (releve) => {
  const workbook = new ExcelJS.Workbook();

  // Propriétés du document
  workbook.creator = "Krysto - Module Relevé Prix";
  workbook.created = new Date();
  workbook.modified = new Date();

  // Créer la feuille principale
  const worksheet = workbook.addWorksheet("Relevé de Prix", {
    properties: { tabColor: { argb: "FF0066CC" } },
  });

  // ==========================================
  // EN-TÊTE DU DOCUMENT
  // ==========================================

  // Titre principal
  worksheet.mergeCells("A1:H1");
  const titleCell = worksheet.getCell("A1");
  titleCell.value = "RELEVÉ DE PRIX CONCURRENTIEL";
  titleCell.font = { bold: true, size: 16, color: { argb: "FFFFFFFF" } };
  titleCell.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF0066CC" },
  };
  titleCell.alignment = { horizontal: "center", vertical: "middle" };
  worksheet.getRow(1).height = 30;

  // Informations du relevé
  const dateReleve = new Date(releve.createdAt).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const infoRows = [
    ["Entreprise:", releve.entreprise?.nomComplet || releve.nomDossierDBF],
    ["Concurrent:", releve.concurrent?.nom || "N/A"],
    ["Adresse concurrent:", releve.concurrent?.adresse || "N/A"],
    ["Ville:", releve.concurrent?.ville || "N/A"],
    ["Date du relevé:", dateReleve],
    [
      "Opérateur:",
      releve.user ? `${releve.user.prenom} ${releve.user.nom}` : "N/A",
    ],
    ["Nombre d'articles:", releve.totalArticles],
  ];

  let currentRow = 3;
  infoRows.forEach((row) => {
    worksheet.getCell(`A${currentRow}`).value = row[0];
    worksheet.getCell(`A${currentRow}`).font = { bold: true };
    worksheet.mergeCells(`B${currentRow}:D${currentRow}`);
    worksheet.getCell(`B${currentRow}`).value = row[1];
    currentRow++;
  });

  // ==========================================
  // STATISTIQUES
  // ==========================================

  currentRow += 1;
  worksheet.mergeCells(`A${currentRow}:H${currentRow}`);
  const statsTitle = worksheet.getCell(`A${currentRow}`);
  statsTitle.value = "STATISTIQUES";
  statsTitle.font = { bold: true, size: 12, color: { argb: "FFFFFFFF" } };
  statsTitle.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF666666" },
  };
  statsTitle.alignment = { horizontal: "center" };
  worksheet.getRow(currentRow).height = 22;

  currentRow++;
  const stats = releve.stats || {
    moinsCherChezNous: 0,
    plusCherChezNous: 0,
    memePrix: 0,
    diffMoyennePourcent: 0,
  };

  const statsRows = [
    ["Articles moins chers chez nous:", stats.moinsCherChezNous],
    ["Articles plus chers chez nous:", stats.plusCherChezNous],
    ["Articles au même prix:", stats.memePrix],
    ["Différence moyenne:", `${stats.diffMoyennePourcent}%`],
  ];

  statsRows.forEach((row) => {
    worksheet.getCell(`A${currentRow}`).value = row[0];
    worksheet.getCell(`A${currentRow}`).font = { bold: true };
    worksheet.getCell(`B${currentRow}`).value = row[1];
    worksheet.getCell(`B${currentRow}`).alignment = { horizontal: "center" };
    currentRow++;
  });

  // ==========================================
  // TABLEAU DES DONNÉES
  // ==========================================

  currentRow += 1;

  // Définir les colonnes
  const headerRow = currentRow;
  const headers = [
    { header: "GENCOD", key: "gencod", width: 18 },
    { header: "NART", key: "nart", width: 10 },
    { header: "DÉSIGNATION", key: "designation", width: 40 },
    { header: "GROUPE", key: "groupe", width: 10 },
    { header: "NOTRE PRIX TTC", key: "pvtettc", width: 15 },
    { header: "PRIX RELEVÉ", key: "prixReleve", width: 15 },
    { header: "DIFFÉRENCE", key: "difference", width: 12 },
    { header: "DIFF %", key: "pourcentageDiff", width: 10 },
  ];

  // Appliquer les headers
  headers.forEach((col, index) => {
    const cell = worksheet.getCell(headerRow, index + 1);
    cell.value = col.header;
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF333333" },
    };
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.border = {
      top: { style: "thin" },
      left: { style: "thin" },
      bottom: { style: "thin" },
      right: { style: "thin" },
    };
    worksheet.getColumn(index + 1).width = col.width;
  });

  worksheet.getRow(headerRow).height = 25;

  // Ajouter les données
  currentRow++;
  releve.lignes.forEach((ligne, index) => {
    const row = worksheet.getRow(currentRow);

    // Recalculer la différence et le pourcentage correctement
    const difference = ligne.pvtettc - ligne.prixReleve;
    const pourcentageDiff =
      ligne.pvtettc > 0 ? ((difference / ligne.pvtettc) * 100).toFixed(2) : 0;

    // Données
    row.getCell(1).value = ligne.gencod;
    row.getCell(2).value = ligne.nart;
    row.getCell(3).value = ligne.designation;
    row.getCell(4).value = ligne.groupe;
    row.getCell(5).value = ligne.pvtettc;
    row.getCell(5).numFmt = "#,##0";
    row.getCell(6).value = ligne.prixReleve;
    row.getCell(6).numFmt = "#,##0";
    row.getCell(7).value = difference;
    row.getCell(7).numFmt = "#,##0";
    // Afficher le pourcentage comme texte pour éviter la double multiplication
    row.getCell(8).value = `${pourcentageDiff}%`;
    row.getCell(8).alignment = { horizontal: "right" };

    // Couleur conditionnelle pour la différence
    const diffCell = row.getCell(7);
    const diffPercentCell = row.getCell(8);

    if (difference > 0) {
      // Notre prix plus élevé = concurrent moins cher (rouge pour nous)
      diffCell.font = { color: { argb: "FFCC0000" } };
      diffPercentCell.font = { color: { argb: "FFCC0000" } };
    } else if (difference < 0) {
      // Notre prix plus bas = nous sommes moins chers (vert pour nous)
      diffCell.font = { color: { argb: "FF006600" } };
      diffPercentCell.font = { color: { argb: "FF006600" } };
    }

    // Bordures et alternance de couleur
    for (let col = 1; col <= 8; col++) {
      const cell = row.getCell(col);
      cell.border = {
        top: { style: "thin", color: { argb: "FFCCCCCC" } },
        left: { style: "thin", color: { argb: "FFCCCCCC" } },
        bottom: { style: "thin", color: { argb: "FFCCCCCC" } },
        right: { style: "thin", color: { argb: "FFCCCCCC" } },
      };

      if (index % 2 === 0) {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFF5F5F5" },
        };
      }
    }

    currentRow++;
  });

  // ==========================================
  // LÉGENDE
  // ==========================================

  currentRow += 2;
  worksheet.mergeCells(`A${currentRow}:H${currentRow}`);
  const legendTitle = worksheet.getCell(`A${currentRow}`);
  legendTitle.value = "LÉGENDE";
  legendTitle.font = { bold: true, size: 10 };

  currentRow++;
  worksheet.getCell(`A${currentRow}`).value =
    "• Différence positive (rouge) = Notre prix est plus élevé que le concurrent";
  worksheet.getCell(`A${currentRow}`).font = {
    size: 9,
    color: { argb: "FFCC0000" },
  };

  currentRow++;
  worksheet.getCell(`A${currentRow}`).value =
    "• Différence négative (vert) = Notre prix est plus bas que le concurrent";
  worksheet.getCell(`A${currentRow}`).font = {
    size: 9,
    color: { argb: "FF006600" },
  };

  // ==========================================
  // PIED DE PAGE
  // ==========================================

  currentRow += 2;
  worksheet.mergeCells(`A${currentRow}:H${currentRow}`);
  const footerCell = worksheet.getCell(`A${currentRow}`);
  footerCell.value = `Document généré le ${new Date().toLocaleDateString("fr-FR")} à ${new Date().toLocaleTimeString("fr-FR")} - support QC`;
  footerCell.font = { italic: true, size: 8, color: { argb: "FF999999" } };
  footerCell.alignment = { horizontal: "center" };

  // ==========================================
  // CONFIGURATION DE L'IMPRESSION
  // ==========================================

  worksheet.pageSetup = {
    orientation: "landscape",
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    margins: {
      left: 0.5,
      right: 0.5,
      top: 0.75,
      bottom: 0.75,
      header: 0.3,
      footer: 0.3,
    },
  };

  // Geler les lignes d'en-tête du tableau
  worksheet.views = [
    {
      state: "frozen",
      xSplit: 0,
      ySplit: headerRow,
      topLeftCell: `A${headerRow + 1}`,
      activeCell: `A${headerRow + 1}`,
    },
  ];

  // Générer le buffer
  const buffer = await workbook.xlsx.writeBuffer();

  return buffer;
};

export default { genererExcelReleve };
