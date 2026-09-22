// backend/services/gisementsComptageExcelService.js
//
// Export Excel « gisements et nombre d'articles » : une ligne par gisement, le
// nombre d'articles qui y sont rangés, et le libellé du rayon.
//
// C'est le compagnon des panneaux QR de gisement du générateur d'étiquettes :
// même source (les codes GISM1/GISM2 réellement portés par les fiches article),
// même lecture du dictionnaire des rayons pour le libellé, même découpage par
// emplacement — MAGASIN (GISM1) et DOCK (GISM2) partent sur DEUX FEUILLES
// distinctes, jamais mélangés : chez QC 53 codes existent aux deux
// emplacements, 34 avec un libellé différent.
//
// ⚠️ Les articles SANS gisement ne figurent pas : ils n'ont pas de ligne où
// aller. Le total d'articles rappelé dans le titre est donc la somme des
// gisements listés, pas le catalogue entier.
import ExcelJS from "exceljs";

// L'entête de la 1re colonne CITE le champ DBF (« … (GISM1) ») : c'est ce qui
// permet à envoyerClasseur de retirer la colonne pour un utilisateur dont
// `champsDbf` interdit ce champ. Ne pas retirer la parenthèse.
const COLONNES = [
  { h: (champ) => `Gisement (${champ})`, k: "code", w: 18 },
  { h: () => "Nombre d'articles", k: "count", w: 18, num: true },
  { h: () => "Libellé du rayon", k: "libelle", w: 42 },
];

const fmtInt = (n) => Number(n || 0);

// Séparateur de milliers = ESPACE ORDINAIRE, pas une espace fine insécable :
// celle-ci ressort en caractère parasite dans certains tableurs.
const fmtMilliers = (n) =>
  String(fmtInt(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");

/**
 * Construit le classeur de comptage.
 *
 * @param {object} p
 * @param {string} p.trigramme  trigramme de la société (titre + nom de fichier)
 * @param {Array<{emplacement:string,champ:string,lignes:Array<{code:string,count:number,libelle:string}>}>} p.sections
 *   une feuille par entrée, dans l'ordre donné.
 * @returns {ExcelJS.Workbook}
 */
export const construireClasseurComptageGisements = ({ trigramme, sections }) => {
  const wb = new ExcelJS.Workbook();
  wb.creator = "QC Tools - Gisements";
  wb.created = new Date();

  for (const sec of sections) {
    const entetes = COLONNES.map((c) => c.h(sec.champ));
    const ws = wb.addWorksheet(`${sec.emplacement} (${sec.champ})`, {
      properties: { tabColor: { argb: "FF2563EB" } },
    });
    const lastCol = String.fromCharCode(64 + COLONNES.length); // A..C

    const nbArticles = (sec.lignes || []).reduce(
      (s, l) => s + fmtInt(l.count),
      0,
    );

    // Titre (ligne 1). ⚠️ SURTOUT PAS de mergeCells ici : une cellule fusionnée
    // ne déborde pas sur ses voisines, et Excel n'ajuste pas la hauteur d'une
    // fusion — le titre était donc tronqué. On laisse les trois cellules
    // distinctes : le texte est dans A1 et DÉBORDE visuellement sur B1/C1, qui
    // restent vides de contenu (le fond bleu ne bloque pas le débordement).
    //
    // Bonus : sans fusion, le retrait d'une colonne par le masque « champ par
    // champ » (envoyerClasseur -> spliceColumns) ne casse aucune plage fusionnée.
    //
    // La ligne ne porte qu'UNE cellule texte : envoyerClasseur, qui cherche la
    // première ligne à au moins deux cellules texte, prend bien la ligne 2
    // comme ligne d'entêtes.
    const titre = ws.getCell("A1");
    // Titre court À DESSEIN : au-delà d'une soixantaine de caractères il
    // dépasse la largeur des trois colonnes et s'étale sur les colonnes vides
    // à droite, hors du bandeau bleu.
    titre.value =
      `${sec.emplacement} (${sec.champ}) · ${trigramme} · ` +
      `${(sec.lignes || []).length} gisements · ${fmtMilliers(nbArticles)} articles rangés`;
    titre.font = { bold: true, size: 12, color: { argb: "FFFFFFFF" } };
    titre.alignment = { horizontal: "left", vertical: "middle", indent: 1 };
    for (let col = 1; col <= COLONNES.length; col++) {
      ws.getRow(1).getCell(col).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF1D4ED8" },
      };
    }
    ws.getRow(1).height = 24;

    const ligneEntetes = ws.addRow(entetes);
    ligneEntetes.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF2563EB" },
      };
      cell.alignment = { horizontal: "center", vertical: "middle" };
    });
    ligneEntetes.height = 20;

    if (!sec.lignes || sec.lignes.length === 0) {
      // Pas de fusion ici non plus : le texte déborde sur les colonnes vides
      // et aucune plage fusionnée ne gêne le masque « champ par champ ».
      const r = ws.addRow([`Aucun gisement ${sec.champ} renseigné.`]);
      r.getCell(1).font = { italic: true, color: { argb: "FF999999" } };
    } else {
      for (const l of sec.lignes) {
        const r = ws.addRow([l.code, fmtInt(l.count), l.libelle || ""]);
        r.getCell(2).numFmt = "#,##0";
      }
    }

    COLONNES.forEach((c, i) => {
      ws.getColumn(i + 1).width = c.w;
    });
    ws.views = [{ state: "frozen", ySplit: 2 }];
    ws.autoFilter = { from: "A2", to: `${lastCol}2` };
  }

  return wb;
};

export default { construireClasseurComptageGisements };
