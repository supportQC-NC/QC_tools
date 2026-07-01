// backend/services/performanceDockService.js
// -----------------------------------------------------------------------------
// Performance Dock — compte, par jour, les "lignes valides" des fichiers
// reapro_mag_qc_yyyy-mm-dd.xlsx (onglet DONNEES, colonne GISEMENT ≠ vide / STOP).
// Port de moyenne_reapro.py (version simple : barres/jour + moyenne).
//
// Dossier source (Ubuntu) : /home/supportserv/Bureau/doc_temp/reapro_mag
// Surchargable via la variable d'env REAPRO_MAG_DIR.
// -----------------------------------------------------------------------------

import fs from "fs";
import path from "path";
import ExcelJS from "exceljs";

const DEFAULT_DIR = "/home/supportserv/Bureau/doc_temp/reapro_mag";
const FILE_RE = /^reapro_mag_qc_\d{4}-\d{2}-\d{2}\.xlsx$/i;
const DATE_RE = /(\d{4}-\d{2}-\d{2})/;
const ONGLET = "DONNEES";
const COLONNE = "GISEMENT";
const VALEUR_EXCLUE = "STOP";

class PerformanceDockService {
  constructor() {
    this.cache = null; // { data, builtAt }
    this.cacheTTL = 10 * 60 * 1000;
    this.lock = null;
  }

  getDir() {
    return process.env.REAPRO_MAG_DIR || DEFAULT_DIR;
  }

  cellText(cell) {
    if (!cell) return "";
    // ExcelJS : .text donne la valeur formatée ; fallback sur .value
    let v = cell.text != null ? cell.text : cell.value;
    if (v == null) return "";
    if (typeof v === "object") {
      if (v.result != null) v = v.result; // formule
      else if (v.text != null) v = v.text; // hyperlink
      else if (Array.isArray(v.richText))
        v = v.richText.map((t) => t.text).join("");
      else v = String(v);
    }
    return String(v).trim();
  }

  extraireDate(nom) {
    const m = nom.match(DATE_RE);
    return m ? m[1] : nom;
  }

  /** Compte les lignes valides (GISEMENT ≠ vide et ≠ STOP) d'un fichier. */
  async compterLignesValides(cheminFichier) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(cheminFichier);

    // Onglet DONNEES (insensible à la casse)
    let ws = wb.getWorksheet(ONGLET);
    if (!ws) {
      ws = wb.worksheets.find(
        (s) => String(s.name || "").trim().toUpperCase() === ONGLET,
      );
    }
    if (!ws) return -1;

    // Localiser la colonne GISEMENT dans la 1ʳᵉ ligne (en-têtes)
    const headerRow = ws.getRow(1);
    let gisCol = null;
    headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      if (
        gisCol == null &&
        this.cellText(cell).toUpperCase() === COLONNE.toUpperCase()
      ) {
        gisCol = colNumber;
      }
    });
    if (gisCol == null) return -1;

    let compteur = 0;
    const last = ws.rowCount;
    for (let r = 2; r <= last; r += 1) {
      const val = this.cellText(ws.getRow(r).getCell(gisCol));
      if (!val) continue;
      if (val.toUpperCase() === VALEUR_EXCLUE.toUpperCase()) continue;
      compteur += 1;
    }
    return compteur;
  }

  async build() {
    const dir = this.getDir();
    if (!fs.existsSync(dir)) {
      return {
        dossier: dir,
        dossierExiste: false,
        message: `Dossier introuvable sur le serveur : ${dir}`,
        generatedAt: new Date().toISOString(),
        rows: [],
        stats: { nbFichiers: 0, total: 0, moyenne: 0, moyenneArrondie: 0, max: 0, min: 0 },
      };
    }

    const fichiers = fs
      .readdirSync(dir)
      .filter((f) => FILE_RE.test(f))
      .sort();

    const rows = [];
    for (const nom of fichiers) {
      let count = -1;
      try {
        count = await this.compterLignesValides(path.join(dir, nom));
      } catch (e) {
        count = -1; // fichier illisible : on l'ignore
      }
      if (count >= 0) rows.push({ date: this.extraireDate(nom), count });
    }

    const valeurs = rows.map((r) => r.count);
    const nbFichiers = rows.length;
    const total = valeurs.reduce((s, v) => s + v, 0);
    const moyenne = nbFichiers ? total / nbFichiers : 0;

    return {
      dossier: dir,
      dossierExiste: true,
      message: nbFichiers
        ? ""
        : "Aucun fichier reapro_mag_qc_*.xlsx trouvé dans le dossier.",
      generatedAt: new Date().toISOString(),
      rows,
      stats: {
        nbFichiers,
        total,
        moyenne,
        moyenneArrondie: Math.round(moyenne),
        max: nbFichiers ? Math.max(...valeurs) : 0,
        min: nbFichiers ? Math.min(...valeurs) : 0,
      },
    };
  }

  async getReport() {
    if (this.cache && Date.now() - this.cache.builtAt < this.cacheTTL) {
      return this.cache.data;
    }
    if (this.lock) return this.lock;

    this.lock = (async () => {
      try {
        const data = await this.build();
        this.cache = { data, builtAt: Date.now() };
        this.lock = null;
        return data;
      } catch (err) {
        this.lock = null;
        throw err;
      }
    })();
    return this.lock;
  }

  invalidate() {
    this.cache = null;
  }
}

const performanceDockService = new PerformanceDockService();
export default performanceDockService;