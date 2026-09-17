// backend/services/performanceDockService.js
// -----------------------------------------------------------------------------
// Performance Dock — compte, par jour, les "lignes valides" des fichiers
// reapro_mag_qc_yyyy-mm-dd.xlsx (onglet DONNEES, colonne GISEMENT ≠ vide / STOP).
// Port de moyenne_reapro.py (version simple : barres/jour + moyenne).
//
// Dossier source : le dossier `doc_temp/reapro_mag` du partage Rcommun.
// ⚠️ Il N'EST PAS au même endroit selon la machine qui exécute le backend :
//   - poste Ubuntu local  : /home/supportserv/Bureau/doc_temp/reapro_mag
//   - poste Windows (dev) : \\192.168.0.250\Rcommun\doc_temp\reapro_mag
//   - VPS de production   : <racine du montage Rcommun>/doc_temp/reapro_mag,
//                           soit /mnt/rcommun/doc_temp/reapro_mag quand
//                           RCOMMON_STOCK_ROOT=/mnt/rcommun/STOCK.
// Coder le chemin Ubuntu en dur faisait échouer le module en production
// (« Dossier introuvable ») alors que le dossier existait bien… sur une autre
// machine. On essaie donc les candidats dans l'ordre et on renvoie le détail de
// ce qui a été tenté, pour que l'écran dise POURQUOI (introuvable vs droits).
// Surcharge explicite : REAPRO_MAG_DIR dans le .env du serveur.
// -----------------------------------------------------------------------------

import fs from "fs";
import path from "path";
// ⚠️ SheetJS et pas ExcelJS : ces classeurs contiennent un onglet « Graphique »
// avec un graphe incorporé, sur lequel le lecteur d'ExcelJS 4.4 plante
// (« Cannot read properties of undefined (reading 'anchors') »). Le service
// avalait l'erreur et ne gardait qu'un fichier sur douze — courbe muette.
import XLSX from "xlsx";

const DEFAULT_DIR = "/home/supportserv/Bureau/doc_temp/reapro_mag";
const DEFAULT_DIR_UNC = "\\\\192.168.0.250\\Rcommun\\doc_temp\\reapro_mag";
const SOUS_DOSSIER = ["doc_temp", "reapro_mag"];
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

  /** Chemins à essayer, dans l'ordre : le premier lisible gagne. */
  candidats() {
    const liste = [];
    const ajouter = (chemin, origine) => {
      const v = String(chemin || "").trim();
      if (v && !liste.some((c) => c.chemin === v)) liste.push({ chemin: v, origine });
    };

    ajouter(process.env.REAPRO_MAG_DIR, "REAPRO_MAG_DIR");

    // Prod VPS : RCOMMON_STOCK_ROOT pointe sur .../STOCK, doc_temp en est le
    // frère — on remonte d'un cran sous la racine du partage monté.
    const stockRoot = String(process.env.RCOMMON_STOCK_ROOT || "").replace(
      /[\\/]+$/,
      "",
    );
    if (stockRoot) {
      ajouter(
        path.posix.join(path.posix.dirname(stockRoot), ...SOUS_DOSSIER),
        "RCOMMON_STOCK_ROOT (racine du partage)",
      );
      // Si le montage ne porte QUE le dossier STOCK, doc_temp doit alors y être
      // recopié : on essaie aussi les deux dispositions possibles sous STOCK.
      ajouter(
        path.posix.join(stockRoot, ...SOUS_DOSSIER),
        "RCOMMON_STOCK_ROOT/doc_temp",
      );
      ajouter(
        path.posix.join(stockRoot, SOUS_DOSSIER[1]),
        "RCOMMON_STOCK_ROOT/reapro_mag",
      );
    }

    ajouter(DEFAULT_DIR, "poste Ubuntu local");
    ajouter(DEFAULT_DIR_UNC, "partage UNC (dev Windows)");
    return liste;
  }

  /**
   * Remonte jusqu'au premier ancêtre existant d'un chemin et liste son contenu.
   * Sans ça, « introuvable » ne dit pas OÙ ça casse : le montage est-il absent,
   * ou est-ce seulement le dernier dossier qui manque ?
   */
  sonder(chemin) {
    const p = chemin.includes("\\") ? path.win32 : path.posix;
    let courant = chemin;
    for (let i = 0; i < 8; i += 1) {
      const parent = p.dirname(courant);
      if (!parent || parent === courant) break;
      // On ne remonte jamais jusqu'à la racine : lister « / » ou « C:\ » ne dit
      // rien d'utile et déverse tout le système dans la réponse.
      if (parent === p.parse(parent).root) break;
      courant = parent;
      try {
        if (!fs.statSync(courant).isDirectory()) continue;
        const entrees = fs
          .readdirSync(courant, { withFileTypes: true })
          .slice(0, 40)
          .map((e) => (e.isDirectory() ? `${e.name}/` : e.name));
        return { ancetre: courant, entrees };
      } catch (e) {
        if (e.code === "EACCES" || e.code === "EPERM") {
          return { ancetre: courant, entrees: [], erreur: e.code };
        }
        // ENOENT : on continue de remonter
      }
    }
    return null;
  }

  /** Dossier lisible ? Distingue ENOENT (absent) de EACCES (droits). */
  verifierDossier(chemin) {
    try {
      if (!fs.statSync(chemin).isDirectory()) {
        return { ok: false, etat: "existe mais n'est pas un dossier" };
      }
      fs.accessSync(chemin, fs.constants.R_OK | fs.constants.X_OK);
      return { ok: true, etat: "lisible" };
    } catch (e) {
      const code = e.code || "";
      if (code === "ENOENT") return { ok: false, etat: "introuvable" };
      if (code === "EACCES" || code === "EPERM") {
        return { ok: false, etat: `droits insuffisants (${code})` };
      }
      return { ok: false, etat: code || e.message };
    }
  }

  /** Résout le dossier source : { dir, candidats: [{chemin, origine, etat}] }. */
  resoudreDossier() {
    const candidats = this.candidats().map((c) => ({
      ...c,
      ...this.verifierDossier(c.chemin),
    }));
    const retenu = candidats.find((c) => c.ok);
    return { dir: retenu ? retenu.chemin : null, candidats };
  }

  getDir() {
    return this.resoudreDossier().dir || process.env.REAPRO_MAG_DIR || DEFAULT_DIR;
  }

  cellText(v) {
    return v == null ? "" : String(v).trim();
  }

  extraireDate(nom) {
    const m = nom.match(DATE_RE);
    return m ? m[1] : nom;
  }

  /** Compte les lignes valides (GISEMENT ≠ vide et ≠ STOP) d'un fichier. */
  async compterLignesValides(cheminFichier) {
    // Styles/formules/HTML désactivés : on ne veut que des valeurs texte.
    const wb = XLSX.readFile(cheminFichier, {
      cellFormula: false,
      cellHTML: false,
      cellStyles: false,
    });

    // Onglet DONNEES (insensible à la casse : « Donnees » dans certains fichiers)
    const nomOnglet = (wb.SheetNames || []).find(
      (n) => String(n || "").trim().toUpperCase() === ONGLET,
    );
    const ws = nomOnglet ? wb.Sheets[nomOnglet] : null;
    if (!ws) return -1;

    const lignes = XLSX.utils.sheet_to_json(ws, {
      header: 1,
      raw: false,
      defval: "",
    });
    if (!lignes.length) return -1;

    // Localiser la colonne GISEMENT dans la 1ʳᵉ ligne (en-têtes)
    const entetes = lignes[0] || [];
    const gisCol = entetes.findIndex(
      (c) => this.cellText(c).toUpperCase() === COLONNE.toUpperCase(),
    );
    if (gisCol < 0) return -1;

    let compteur = 0;
    for (let r = 1; r < lignes.length; r += 1) {
      const val = this.cellText((lignes[r] || [])[gisCol]);
      if (!val) continue;
      if (val.toUpperCase() === VALEUR_EXCLUE.toUpperCase()) continue;
      compteur += 1;
    }
    return compteur;
  }

  async build() {
    const { dir, candidats } = this.resoudreDossier();
    if (!dir) {
      const detail = candidats
        .map((c) => `${c.chemin} (${c.origine}) → ${c.etat}`)
        .join(" ; ");
      // Sondage : ce que le serveur voit vraiment autour des chemins tentés.
      const sondages = [];
      for (const c of candidats) {
        const s = this.sonder(c.chemin);
        if (s && !sondages.some((x) => x.ancetre === s.ancetre)) sondages.push(s);
      }
      return {
        dossier: candidats[0]?.chemin || DEFAULT_DIR,
        dossierExiste: false,
        candidats,
        sondages,
        message:
          "Dossier reapro_mag inaccessible depuis le serveur. Chemins essayés : " +
          detail +
          ". Définir REAPRO_MAG_DIR dans le .env du serveur (en production : le " +
          "dossier doc_temp/reapro_mag du partage Rcommun monté) puis redémarrer.",
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
    const ignores = []; // fichiers écartés + POURQUOI (sinon la courbe ment en silence)
    for (const nom of fichiers) {
      let count = -1;
      let raison = "onglet DONNEES ou colonne GISEMENT absent";
      try {
        count = await this.compterLignesValides(path.join(dir, nom));
      } catch (e) {
        count = -1;
        raison = e.message;
      }
      if (count >= 0) rows.push({ date: this.extraireDate(nom), count });
      else ignores.push({ fichier: nom, raison });
    }
    if (ignores.length) {
      console.warn(
        `[performance-dock] ${ignores.length} fichier(s) ignoré(s) :`,
        ignores.map((i) => `${i.fichier} (${i.raison})`).join(", "),
      );
    }

    const valeurs = rows.map((r) => r.count);
    const nbFichiers = rows.length;
    const total = valeurs.reduce((s, v) => s + v, 0);
    const moyenne = nbFichiers ? total / nbFichiers : 0;

    return {
      dossier: dir,
      dossierExiste: true,
      candidats,
      ignores,
      message: nbFichiers
        ? ""
        : `Aucun fichier reapro_mag_qc_*.xlsx trouvé dans ${dir}.`,
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