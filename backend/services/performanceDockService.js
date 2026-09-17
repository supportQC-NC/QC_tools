// backend/services/performanceDockService.js
// -----------------------------------------------------------------------------
// Performance Dock — mesure la performance du RÉAPPRO MAGASIN : combien
// d'ARTICLES ont été réapprovisionnés chaque jour.
//
// ⚠️ Vocabulaire : une ligne de l'onglet DONNEES = UN article à
// réapprovisionner. On ne parle donc jamais de « lignes » à l'écran ni dans
// l'export — l'unité métier, celle que le dock compte, est l'article.
//
// Source : reapro_mag_qc_yyyy-mm-dd.xlsx, onglet DONNEES, un article retenu
// quand sa colonne GISEMENT n'est ni vide ni « STOP ».
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

// 0 = dimanche, comme Date#getDay() — on suit la convention JS pour éviter les
// décalages d'indice entre le filtre de l'écran et celui du serveur.
const JOURS_SEMAINE = [
  "dimanche",
  "lundi",
  "mardi",
  "mercredi",
  "jeudi",
  "vendredi",
  "samedi",
];
const ORDRE_SEMAINE = [1, 2, 3, 4, 5, 6, 0]; // lundi → dimanche

// Les dates viennent du NOM du fichier (yyyy-mm-dd) : on construit une date
// locale, jamais `new Date("2026-09-17")` qui serait interprétée en UTC et
// pourrait reculer d'un jour selon le fuseau du serveur.
const enDate = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
};

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

  /** Compte les articles à réapprovisionner (GISEMENT ≠ vide et ≠ STOP). */
  async compterArticles(cheminFichier) {
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

  // ---------------------------------------------------------------------------
  // Lecture brute du dossier (cache) — une entrée par fichier, donc par journée.
  // ---------------------------------------------------------------------------
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
      };
    }

    const fichiers = fs
      .readdirSync(dir)
      .filter((f) => FILE_RE.test(f))
      .sort();

    const rows = [];
    const ignores = []; // fichiers écartés + POURQUOI (sinon la courbe ment en silence)
    for (const nom of fichiers) {
      let articles = -1;
      let raison = "onglet DONNEES ou colonne GISEMENT absent";
      try {
        articles = await this.compterArticles(path.join(dir, nom));
      } catch (e) {
        articles = -1;
        raison = e.message;
      }
      if (articles >= 0) rows.push({ date: this.extraireDate(nom), articles });
      else ignores.push({ fichier: nom, raison });
    }
    if (ignores.length) {
      console.warn(
        `[performance-dock] ${ignores.length} fichier(s) ignoré(s) :`,
        ignores.map((i) => `${i.fichier} (${i.raison})`).join(", "),
      );
    }

    return {
      dossier: dir,
      dossierExiste: true,
      candidats,
      ignores,
      message: rows.length
        ? ""
        : `Aucun fichier reapro_mag_qc_*.xlsx trouvé dans ${dir}.`,
      generatedAt: new Date().toISOString(),
      rows,
    };
  }

  /** Lecture brute des classeurs, mise en cache (TTL). */
  async getBrut() {
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

  // ---------------------------------------------------------------------------
  // Critères utilisateur
  //
  // La moyenne « historique » (toutes les journées disponibles) reste la valeur
  // par défaut : c'est le repère que l'équipe connaît, on ne le déplace pas dans
  // son dos. Les critères ne la remplacent QUE si l'utilisateur bascule
  // `baseMoyenne` sur « selection » — sinon on filtre l'affichage sans bouger
  // l'étalon, ce qui permet de zoomer sur une semaine tout en la comparant au
  // rythme habituel.
  // ---------------------------------------------------------------------------
  normaliserCriteres(q = {}) {
    const iso = (v) => {
      const s = String(v || "").trim();
      return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
    };
    const nombre = (v) => {
      if (v === undefined || v === null || String(v).trim() === "") return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    const bool = (v) => v === true || v === "1" || v === "true";

    // jours=1,2,3 (0 = dimanche). Vide, absent ou complet = aucun filtre.
    let jours = String(q.jours ?? "")
      .split(",")
      .map((v) => parseInt(v, 10))
      .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
    jours = [...new Set(jours)].sort((a, b) => a - b);
    if (!jours.length || jours.length === 7) jours = null;

    let debut = iso(q.debut);
    let fin = iso(q.fin);
    if (debut && fin && debut > fin) [debut, fin] = [fin, debut];

    return {
      debut,
      fin,
      jours,
      exclureZero: bool(q.exclureZero),
      min: nombre(q.min),
      max: nombre(q.max),
      baseMoyenne: q.baseMoyenne === "selection" ? "selection" : "globale",
    };
  }

  /** Pourquoi une journée est écartée — chaîne vide si elle est retenue. */
  motifExclusion(row, criteres) {
    const d = enDate(row.date);
    if (criteres.debut && row.date < criteres.debut) return "hors période";
    if (criteres.fin && row.date > criteres.fin) return "hors période";
    if (criteres.jours && d && !criteres.jours.includes(d.getDay())) {
      return `jour de semaine écarté (${JOURS_SEMAINE[d.getDay()]})`;
    }
    if (criteres.exclureZero && row.articles === 0) return "journée sans activité";
    if (criteres.min !== null && row.articles < criteres.min) {
      return `sous le seuil bas (< ${criteres.min})`;
    }
    if (criteres.max !== null && row.articles > criteres.max) {
      return `au-dessus du seuil haut (> ${criteres.max})`;
    }
    return "";
  }

  /** Statistiques d'un jeu de journées. */
  static statistiques(rows) {
    const valeurs = rows.map((r) => r.articles).sort((a, b) => a - b);
    const nbJours = valeurs.length;
    const total = valeurs.reduce((s, v) => s + v, 0);
    const moyenne = nbJours ? total / nbJours : 0;
    // Médiane : sur un mois de dock, deux journées à l'arrêt suffisent à tirer la
    // moyenne vers le bas — la médiane dit si c'est le rythme ou un accident.
    const mediane = !nbJours
      ? 0
      : nbJours % 2
        ? valeurs[(nbJours - 1) / 2]
        : (valeurs[nbJours / 2 - 1] + valeurs[nbJours / 2]) / 2;
    return {
      nbJours,
      total,
      moyenne,
      moyenneArrondie: Math.round(moyenne),
      mediane: Math.round(mediane),
      max: nbJours ? valeurs[nbJours - 1] : 0,
      min: nbJours ? valeurs[0] : 0,
    };
  }

  /**
   * Rapport filtré : mêmes données brutes, recalculées selon les critères.
   * La lecture des classeurs étant cachée, ce recalcul est quasi gratuit — c'est
   * pourquoi il vit ici et non dans l'écran : le classeur Excel et l'écran
   * partagent ainsi le MÊME calcul, ils ne peuvent pas diverger.
   */
  async getReport(query = {}) {
    const brut = await this.getBrut();
    const criteres = this.normaliserCriteres(query);
    const toutes = brut.rows || [];

    const retenues = [];
    const ecartees = [];
    toutes.forEach((r) => {
      const motif = this.motifExclusion(r, criteres);
      if (motif) ecartees.push({ ...r, motif });
      else retenues.push(r);
    });

    const statsGlobales = PerformanceDockService.statistiques(toutes);
    const stats = PerformanceDockService.statistiques(retenues);
    const moyenne =
      criteres.baseMoyenne === "selection" ? stats.moyenne : statsGlobales.moyenne;

    // Écart et rang sont relatifs à la moyenne RETENUE : c'est elle l'étalon.
    const parVolume = [...retenues].sort((a, b) => b.articles - a.articles);
    const rangs = new Map(parVolume.map((r, i) => [r.date, i + 1]));
    let cumul = 0;
    const rows = retenues.map((r) => {
      cumul += r.articles;
      const d = enDate(r.date);
      return {
        ...r,
        jourSemaine: d ? d.getDay() : null,
        jourSemaineLabel: d ? JOURS_SEMAINE[d.getDay()] : "",
        ecart: Math.round(r.articles - moyenne),
        pct: moyenne ? ((r.articles - moyenne) / moyenne) * 100 : 0,
        cumul,
        rang: rangs.get(r.date) || null,
      };
    });

    // Répartition par jour de semaine : dit quel jour porte la charge du dock.
    // Ordonnée du lundi au dimanche — l'ordre de lecture d'une semaine de
    // travail, pas celui des indices de Date#getDay().
    const parJourSemaine = ORDRE_SEMAINE.map((jour) => {
      const label = JOURS_SEMAINE[jour];
      const lignes = rows.filter((r) => r.jourSemaine === jour);
      const total = lignes.reduce((s, r) => s + r.articles, 0);
      const moy = lignes.length ? total / lignes.length : 0;
      return {
        jour,
        label,
        nbJours: lignes.length,
        total,
        moyenne: moy,
        moyenneArrondie: Math.round(moy),
        ecart: Math.round(moy - moyenne),
      };
    }).filter((j) => j.nbJours > 0);

    const dates = toutes.map((r) => r.date).sort();

    return {
      dossier: brut.dossier,
      dossierExiste: brut.dossierExiste,
      candidats: brut.candidats,
      sondages: brut.sondages,
      ignores: brut.ignores,
      message: brut.message,
      generatedAt: brut.generatedAt,
      criteres,
      bornes: { premiere: dates[0] || "", derniere: dates[dates.length - 1] || "" },
      rows,
      ecartees,
      parJourSemaine,
      stats,
      statsGlobales,
      moyenne,
      moyenneArrondie: Math.round(moyenne),
      baseMoyenneLabel:
        criteres.baseMoyenne === "selection"
          ? "journées retenues par les critères"
          : "toutes les journées disponibles",
    };
  }

  invalidate() {
    this.cache = null;
  }
}

const performanceDockService = new PerformanceDockService();
export default performanceDockService;
export { JOURS_SEMAINE };
