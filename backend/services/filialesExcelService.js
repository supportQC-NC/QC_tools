// filialesExcelService.js
// -----------------------------------------------------------------------------
// Export Excel de l'Analyse Filiales.
//
// ⚠️ PORTAGE FIDÈLE de `generate_excel()` du script Python de référence
// (`analyse_filiale/main.py`). Le fichier produit ici doit être interchangeable
// avec celui du script : même feuille, même mise en page, mêmes couleurs, mêmes
// formats de nombre. Les valeurs de style ci-dessous ont été relues dans un
// fichier de référence (`Analyse_Filiales_QC_20260819_1017.xlsx`) — ne pas les
// « améliorer » sans comparer à nouveau.
//
// Mise en page (couplage décrit dans ALGORITHME.md §8.2) :
//   ligne 1 : bandeaux fusionnés par entité — 1-10 la mère, 11-12 RESEAU, puis
//             6 colonnes par filiale à partir de la 13e ;
//   ligne 2 : en-têtes de colonne, filtrables ;
//   ligne 3+ : les données, fond alterné.
//
// ⚠️ Le bandeau porte le CODE de la filiale (HD, SIT) alors que l'en-tête porte
// son LIBELLÉ (WELDOM, SITEC) : c'est le comportement du script, vérifié dans le
// fichier de référence.
//
// L'écriture passe par le writer en flux d'ExcelJS : le réseau QC produit
// ~101 000 lignes × 36 colonnes, soit 3,6 M de cellules — un classeur monté
// entièrement en mémoire y laisserait le processus.
// -----------------------------------------------------------------------------

import ExcelJS from "exceljs";
import { ENTITY_COLORS } from "./filialesService.js";

const FONT_NAME = "Calibri";
const WHITE = "FFFFFF";

// Colonne ORIGINE : [fond, couleur du texte]. La valeur peut combiner plusieurs
// passes (« NART+GENCODE-HORS ») ; on colore selon la passe la plus notable,
// d'où l'ordre — « GENCODE-HORS » est testé AVANT « GENCODE », qui en est un
// préfixe.
const ORIGINE_STYLES = [
  ["GENCODE-HORS", ["F8CBAD", "833C00"]], // rattrapé hors périmètre réseau
  ["GENCODE", ["FCE4D6", "974706"]], // rattrapé dans le périmètre
  ["NART", ["EDEDED", "3F3F3F"]], // rapprochement habituel, discret
];

// Couleurs de fond assez sombres pour exiger un texte blanc.
const FONDS_SOMBRES = new Set(["4472C4", "ED7D31", "FF0000", "7030A0", "00B0F0"]);

// Largeur de colonne par mot-clé, PREMIER trouvé gagne — l'ordre compte.
const LARGEURS = [
  ["NART", 14],
  ["DESIGN", 30],
  ["NOM", 24],
  ["STOCK", 10],
  ["PVTE", 13],
  ["VTE", 12],
  ["CA", 15],
  ["FILTRE", 14],
  ["ORIGINE", 24],
  ["COMMANDE", 14],
];

const FMT_XPF = '#,##0\\ "XPF"';
const FMT_QTE = "#,##0";
const FMT_PCT = "0%";

// openpyxl écrit les couleurs en ARGB 8 chiffres avec un octet alpha nul
// (« 001F7A3C »). On produit la même écriture : ExcelJS attend 8 chiffres, et
// s'en écarter donnerait un XML que le fichier de référence n'a pas.
const argb = (hex) => `00${hex}`;

const fill = (hex) => ({
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: argb(hex) },
});

const bordure = () => {
  const s = { style: "thin", color: { argb: argb("BFBFBF") } };
  return { left: s, right: s, top: s, bottom: s };
};

const policeEntete = (hex, size = 10) => ({
  name: FONT_NAME,
  bold: true,
  size,
  color: { argb: argb(FONDS_SOMBRES.has(hex) ? WHITE : "000000") },
});

const centre = (wrap = false) => ({
  horizontal: "center",
  vertical: "middle",
  wrapText: wrap,
});

/** Couleur d'un en-tête de colonne (_entity_color du script). */
const couleurEntete = (header) => {
  const h = header.toUpperCase();
  if (h.includes("FILTRE") || h.includes("RESEAU") || h === "ORIGINE") {
    return ENTITY_COLORS.RESEAU;
  }
  // ⚠️ Quirk conservé du script : seules les filiales de DQ sont reconnues ici,
  // toutes les autres colonnes retombent sur le bleu DQ. Le fichier de
  // référence du réseau QC a bien « NART MQ » en 4472C4.
  const suffixes = ["VKP", "PB", "LB", "BB", "QK"];
  const trouve = suffixes.find((e) => h.endsWith(e));
  return trouve ? ENTITY_COLORS[trouve] : ENTITY_COLORS.DQ;
};

const styleOrigine = (valeur) => {
  if (!valeur) return null;
  const trouve = ORIGINE_STYLES.find(([cle]) => valeur.includes(cle));
  return trouve ? trouve[1] : null;
};

const largeur = (header) => {
  const h = header.toUpperCase();
  const trouve = LARGEURS.find(([k]) => h.includes(k));
  return trouve ? trouve[1] : 12;
};

/**
 * Colonnes du rapport, dans l'ordre imposé par le script : 12 fixes puis 6 par
 * filiale. `champ` dit où lire la valeur dans une ligne consolidée.
 */
export function construireColonnes(data) {
  const m = data.mere;
  const cols = [
    { header: "GISEMENT", champ: (r) => r.GISEMENT },
    { header: `NART ${m}`, champ: (r) => r.nart },
    { header: `DESIGN ${m}`, champ: (r) => r.design },
    { header: "NOM FOUR", champ: (r) => r.nomFour },
    { header: `STOCK ${m}`, champ: (r) => r.stock },
    { header: `PVTE ${m}`, champ: (r) => r.pvte },
    { header: `VTE AN ${m}`, champ: (r) => r.vteAn },
    { header: `CA AN ${m}`, champ: (r) => r.caAn },
    { header: "VTE HORS RESEAU", champ: (r) => r.vteHorsReseau },
    { header: "% RESEAU", champ: (r) => r.pctReseau },
    { header: "FILTRE RESEAU", champ: (r) => r.filtre },
    { header: "ORIGINE", champ: (r) => r.origine },
  ];
  data.filiales.forEach((f) => {
    const l = f.label;
    const cell = (r) => r.filiales && r.filiales[l];
    cols.push(
      { header: `NART ${l}`, champ: (r) => cell(r)?.NART ?? null },
      { header: `STOCK ${l}`, champ: (r) => cell(r)?.STOCK ?? null },
      { header: `PVTE ${l}`, champ: (r) => cell(r)?.PVTE ?? null },
      { header: `VTE AN ${l}`, champ: (r) => cell(r)?.VTE_AN ?? null },
      { header: `CA AN ${l}`, champ: (r) => cell(r)?.CA_AN ?? null },
      { header: `EN COMMANDE ${l}`, champ: (r) => cell(r)?.EN_COMMANDE ?? null },
    );
  });
  return cols;
}

/** Nom de fichier du script : Analyse_Filiales_<MERE>_<AAAAMMJJ>_<HHMM>.xlsx */
export function nomFichier(mere, date = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  const h = `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}`;
  const mn = `${p(date.getHours())}${p(date.getMinutes())}`;
  return `Analyse_Filiales_${mere}_${h}_${mn}.xlsx`;
}

/**
 * Écrit le classeur directement dans la réponse HTTP.
 *
 * @param {object} data  sortie de `filialesService.getReseau()`
 * @param {object} res   réponse Express, en-têtes déjà posés par l'appelant
 */
export async function ecrireClasseur(data, res) {
  const colonnes = construireColonnes(data);
  const headers = colonnes.map((c) => c.header);
  const nbCols = headers.length;

  // Filet de sécurité du script : le layout attend 12 colonnes fixes + 6 par
  // filiale. Un décalage ici décalerait tous les bandeaux de la ligne 1.
  const attendu = 12 + 6 * data.filiales.length;
  if (nbCols !== attendu) {
    console.warn(
      `[Filiales] Layout incohérent : ${nbCols} colonnes pour ${data.filiales.length} filiales (attendu ${attendu}).`,
    );
  }

  const wb = new ExcelJS.stream.xlsx.WorkbookWriter({
    stream: res,
    useStyles: true,
    useSharedStrings: false,
  });
  const ws = wb.addWorksheet("Analyse Filiales", {
    views: [{ state: "frozen", xSplit: 2, ySplit: 2 }],
  });
  ws.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: nbCols } };
  ws.columns = headers.map((h) => ({ width: largeur(h) }));

  // ---- Ligne 1 : bandeaux par entité ---------------------------------------
  const groupes = [
    [1, 10, data.mere, ENTITY_COLORS[data.mere] || "4472C4"],
    [11, 12, "RESEAU", ENTITY_COLORS.RESEAU],
  ];
  let debut = 13;
  data.filiales.forEach((f) => {
    // ⚠️ Le bandeau porte le CODE, pas le libellé (cf. en-tête de fichier).
    groupes.push([debut, debut + 5, f.code, ENTITY_COLORS[f.code] || "70AD47"]);
    debut += 6;
  });

  const r1 = ws.getRow(1);
  groupes.forEach(([cs, ce, libelle, couleur]) => {
    for (let c = cs; c <= ce; c += 1) {
      const cell = r1.getCell(c);
      cell.fill = fill(couleur);
      cell.border = bordure();
    }
    const cell = r1.getCell(cs);
    cell.value = libelle;
    cell.font = policeEntete(couleur, 11);
    cell.alignment = centre();
    if (ce > cs) ws.mergeCells(1, cs, 1, ce);
  });
  r1.height = 24;
  r1.commit();

  // ---- Ligne 2 : en-têtes ---------------------------------------------------
  const r2 = ws.getRow(2);
  headers.forEach((header, i) => {
    const couleur =
      header === "VTE HORS RESEAU" || header === "% RESEAU"
        ? "5B9BD5"
        : couleurEntete(header);
    const cell = r2.getCell(i + 1);
    cell.value = header;
    cell.font = policeEntete(couleur);
    cell.fill = fill(couleur);
    cell.alignment = centre(true);
    cell.border = bordure();
  });
  r2.height = 32;
  r2.commit();

  // ---- Lignes de données ----------------------------------------------------
  const fondPair = fill("F2F2F2");
  const fondImpair = fill(WHITE);
  const fondReseau = fill("BDD7EE");
  const policeData = { name: FONT_NAME, size: 9 };

  // Format de nombre par en-tête, calculé une fois : le faire par cellule
  // coûterait 3,6 M de tests de sous-chaîne.
  const formats = headers.map((h) => {
    if (h.includes("PVTE") || h.includes("CA AN")) return FMT_XPF;
    if (
      h.includes("VTE AN") ||
      h.includes("STOCK") ||
      h.includes("VTE HORS") ||
      h.includes("EN COMMANDE")
    ) {
      return FMT_QTE;
    }
    if (h.includes("% RESEAU")) return FMT_PCT;
    return null;
  });
  const estReseau = headers.map(
    (h) => h.includes("VTE HORS RESEAU") || h.includes("% RESEAU"),
  );
  const estFiltre = headers.map((h) => h.toUpperCase().includes("FILTRE"));
  const estOrigine = headers.map((h) => h === "ORIGINE");

  let numLigne = 3;
  for (const ligne of data.rows) {
    const row = ws.getRow(numLigne);
    const fond = numLigne % 2 === 0 ? fondPair : fondImpair;

    for (let i = 0; i < nbCols; i += 1) {
      let v = colonnes[i].champ(ligne);
      if (v === undefined || (typeof v === "number" && !Number.isFinite(v))) {
        v = null;
      }
      const cell = row.getCell(i + 1);
      cell.value = v;
      cell.border = bordure();
      cell.alignment = centre();
      cell.font = policeData;
      cell.fill = fond;
      if (formats[i]) cell.numFmt = formats[i];
      if (estReseau[i]) cell.fill = fondReseau;

      if (estFiltre[i]) {
        if (v === "O") {
          cell.fill = fill("C6EFCE");
          cell.font = { name: FONT_NAME, size: 9, bold: true, color: { argb: argb("375623") } };
        } else if (v === "N") {
          cell.fill = fill("FFCCCC");
          cell.font = { name: FONT_NAME, size: 9, bold: true, color: { argb: argb("9C0006") } };
        }
      } else if (estOrigine[i]) {
        // Les rattrapages GENCODE ressortent : ce sont eux que l'on vient
        // vérifier dans le fichier.
        const style = styleOrigine(v);
        if (style) {
          cell.fill = fill(style[0]);
          cell.font = { name: FONT_NAME, size: 9, bold: true, color: { argb: argb(style[1]) } };
        }
      }
    }
    row.commit();
    numLigne += 1;
  }

  await ws.commit();
  await wb.commit();
}

export default { construireColonnes, nomFichier, ecrireClasseur };
