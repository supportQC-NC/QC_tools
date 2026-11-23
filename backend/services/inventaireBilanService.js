// backend/services/inventaireBilanService.js
//
// BILAN DE CLÔTURE d'un inventaire par zones : construit la synthèse complète
// d'une session (progression, agents et temps, écarts valorisés, anomalies,
// zones recomptées), la FIGE en Mongo (InventaireBilan, un par session) et en
// pousse une copie Excel + PDF sur le miroir FTP de l'inventaire.
//
// POURQUOI : la réinitialisation purge collectes, LigneBipage et suivi bipage
// — sans bilan figé AVANT la purge, l'histoire de l'inventaire disparaît.
// D'où le crochet dans `initInventaireZone` (bilan automatique best-effort de
// la session qu'on archive) en plus de la clôture manuelle depuis l'écran
// Bilans.
//
// Les chiffres viennent des MÊMES calculs que les écrans :
//   - écarts    → `ecartsZonesService.calculerEcartsZones` (le récap par zone)
//   - temps     → `inventaireTempsService.calculerTempsBipage` (suivi bipage)
//   - phases    → `session.zones[].<phase>` (la progression)
// pour qu'un bilan archivé raconte exactement ce que les écrans montraient.

import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import InventaireBilan from "../models/InventaireBilanModel.js";
import InventaireCollecte from "../models/InventaireCollecteModel.js";
import User from "../models/UserModel.js";
import { calculerEcartsZones } from "./ecartsZonesService.js";
import { calculerTempsBipage } from "./inventaireTempsService.js";
import {
  deposerFichierInventaireFtp,
  miroirInventaireActif,
} from "./inventaireFtpService.js";

const PHASES = ["papillonnage", "bipage", "controle"];
const PHASE_LABELS = {
  papillonnage: "Papillonnage",
  // « Bipage », pas « Comptage » : même vocabulaire que les écrans du module.
  bipage: "Bipage",
  controle: "Contrôle",
};
const TOP_ANOMALIES = 50;

const nomComplet = (u) =>
  u ? `${u.prenom || ""} ${u.nom || ""}`.trim() || u.email || "" : "";

// ── Formats d'affichage (Excel/PDF) ──────────────────────────────────────────
const fmtXpf = (v) => {
  const n = Math.round(Number(v) || 0);
  const signe = n > 0 ? "+" : "";
  return `${signe}${n.toLocaleString("fr-FR")} F`;
};
const fmtInt = (v) => Math.round(Number(v) || 0).toLocaleString("fr-FR");
const fmtQte = (v) =>
  Number(v || 0).toLocaleString("fr-FR", { maximumFractionDigits: 3 });
const fmtDuree = (ms) => {
  if (!ms || ms <= 0) return "—";
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const reste = min % 60;
  if (h < 24) return reste ? `${h} h ${reste} min` : `${h} h`;
  return `${Math.floor(h / 24)} j ${h % 24} h`;
};
const fmtDate = (d) =>
  d
    ? new Date(d).toLocaleString("fr-FR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

// ===========================================
// CONSTRUCTION DU BILAN
// ===========================================

/**
 * Construit l'objet bilan d'une session (sans rien écrire).
 * ⚠️ À appeler AVANT toute purge : il lit les collectes et LigneBipage.
 */
export const construireBilan = async (
  entreprise,
  session,
  { user = null, auto = false } = {},
) => {
  // ── Progression (mêmes règles que computeProgress : neutralisées exclues) ──
  const toutes = session.zones || [];
  const actives = toutes.filter((z) => !z.neutralisee);
  const parPhase = { papillonnage: 0, bipage: 0, controle: 0 };
  let completes = 0;
  let entamees = 0;
  for (const z of actives) {
    let n = 0;
    for (const ph of PHASES) {
      if (z[ph]?.fait) {
        parPhase[ph] += 1;
        n += 1;
      }
    }
    if (n === PHASES.length) completes += 1;
    else if (n > 0) entamees += 1;
  }
  const totalPhases = actives.length * PHASES.length;
  const faites = parPhase.papillonnage + parPhase.bipage + parPhase.controle;

  // ── Collectes : comptage, temps, agents, zones recomptées ────────────────
  const collectes = await InventaireCollecte.find({
    entreprise: entreprise._id,
    session: session._id,
  })
    .populate("user", "nom prenom email")
    .lean();

  const comptage = {
    nbCollectes: 0,
    nbComplements: 0,
    nbAnnulees: 0,
    totalArticles: 0,
    totalQuantite: 0,
    tempsActifMs: 0,
    tempsBrutMs: 0,
  };
  const parAgent = new Map();
  const agentEntry = (id, nom, email) => {
    const cle = id ? String(id) : "?";
    if (!parAgent.has(cle)) {
      parAgent.set(cle, {
        user: id || null,
        nom: nom || "(inconnu)",
        email: email || "",
        nbZones: 0,
        phases: { papillonnage: 0, bipage: 0, controle: 0 },
        totalPhases: 0,
        totalArticles: 0,
        totalQuantite: 0,
        tempsActifMs: 0,
        tempsBrutMs: 0,
      });
    }
    const a = parAgent.get(cle);
    if (nom && a.nom === "(inconnu)") a.nom = nom;
    if (email && !a.email) a.email = email;
    return a;
  };
  const recomptees = new Map();

  for (const c of collectes) {
    if (c.annulee) {
      comptage.nbAnnulees += 1;
      const cle = `${c.zoneCode}|${String(c.zoneType || "").trim()}`;
      const r = recomptees.get(cle) || {
        zoneCode: c.zoneCode,
        zoneType: String(c.zoneType || "").trim(),
        nbCollectesAnnulees: 0,
      };
      r.nbCollectesAnnulees += 1;
      recomptees.set(cle, r);
      continue;
    }
    const temps = calculerTempsBipage(c);
    comptage.nbCollectes += 1;
    if (c.estComplement) comptage.nbComplements += 1;
    comptage.totalArticles += c.totalArticles || 0;
    comptage.totalQuantite += c.totalQuantite || 0;
    comptage.tempsActifMs += temps.tempsActifMs;
    comptage.tempsBrutMs += temps.tempsBrutMs;

    const a = agentEntry(c.user?._id, nomComplet(c.user), c.user?.email);
    a.nbZones += 1;
    a.totalArticles += c.totalArticles || 0;
    a.totalQuantite += c.totalQuantite || 0;
    a.tempsActifMs += temps.tempsActifMs;
    a.tempsBrutMs += temps.tempsBrutMs;
  }

  // Phases créditées par les coupons (`zone[phase].by`) — des agents peuvent
  // n'exister que là (coupons rapportés sans jamais toucher au collecteur).
  const idsPhases = new Set();
  for (const z of toutes) {
    for (const ph of PHASES) {
      if (z[ph]?.fait && z[ph].by) idsPhases.add(String(z[ph].by));
    }
  }
  const noms = new Map();
  if (idsPhases.size) {
    const users = await User.find({ _id: { $in: [...idsPhases] } })
      .select("nom prenom email")
      .lean();
    users.forEach((u) => noms.set(String(u._id), u));
  }
  for (const z of toutes) {
    for (const ph of PHASES) {
      const p = z[ph];
      if (!p?.fait || !p.by) continue;
      const u = noms.get(String(p.by));
      const a = agentEntry(p.by, nomComplet(u), u?.email);
      a.phases[ph] += 1;
      a.totalPhases += 1;
    }
  }

  const agents = [...parAgent.values()].sort(
    (x, y) =>
      y.nbZones + y.totalPhases - (x.nbZones + x.totalPhases) ||
      x.nom.localeCompare(y.nom),
  );

  // ── Écarts : le MÊME calcul que le récap par zone ────────────────────────
  const { zones: zonesEcarts, totaux: totauxEcarts } = await calculerEcartsZones(
    entreprise,
    session,
  );

  // Top anomalies : les lignes les plus coûteuses, toutes zones confondues.
  const topAnomalies = zonesEcarts
    .flatMap((z) =>
      z.lignes
        .filter((l) => l.ecartXpf !== 0)
        .map((l) => ({
          nart: String(l.nart || ""),
          gencod: l.gencod || "",
          designation: l.designation || "",
          zoneCode: z.zoneCode,
          zoneType: z.zoneType,
          qteBipee: l.qteBipee,
          stockTheorique: l.stockTheorique,
          ecart: l.ecart,
          ecartXpf: l.ecartXpf,
        })),
    )
    .sort((a, b) => Math.abs(b.ecartXpf) - Math.abs(a.ecartXpf))
    .slice(0, TOP_ANOMALIES);

  // Agrégat par emplacement.
  const parEmplacement = new Map();
  for (const z of zonesEcarts) {
    const cle = z.zoneType || "—";
    const e = parEmplacement.get(cle) || {
      emplacement: cle,
      nbZones: 0,
      totalArticles: 0,
      nbEcarts: 0,
      totalEcartXpf: 0,
      ecartMoinsXpf: 0,
      ecartPlusXpf: 0,
      ecartAbsXpf: 0,
    };
    e.nbZones += 1;
    e.totalArticles += z.totalArticles;
    e.nbEcarts += z.nbEcarts;
    e.totalEcartXpf += z.totalEcartXpf;
    e.ecartMoinsXpf += z.ecartMoinsXpf;
    e.ecartPlusXpf += z.ecartPlusXpf;
    e.ecartAbsXpf += z.ecartAbsXpf;
    parEmplacement.set(cle, e);
  }

  return {
    entreprise: entreprise._id,
    session: session._id,
    sessionNom: session.nom || "",
    dossierSlug: session.dossierSlug || "",
    dossierFtp: session.dossierFtp || "",
    genereAt: new Date(),
    generePar: user?._id || null,
    auto,
    debutAt: session.createdAt || null,
    finAt: new Date(),
    progression: {
      totalZones: actives.length,
      zonesNeutralisees: toutes.length - actives.length,
      completes,
      entamees,
      vierges: actives.length - completes - entamees,
      pct: totalPhases ? Math.round((faites / totalPhases) * 100) : 0,
      parPhase,
    },
    comptage,
    agents,
    ecarts: {
      totaux: {
        totalZones: totauxEcarts.totalZones,
        totalArticles: totauxEcarts.totalArticles,
        nbEcarts: totauxEcarts.nbEcarts,
        totalEcart: totauxEcarts.totalEcart,
        totalEcartXpf: totauxEcarts.totalEcartXpf,
        ecartMoinsXpf: totauxEcarts.ecartMoinsXpf,
        ecartPlusXpf: totauxEcarts.ecartPlusXpf,
        ecartAbsXpf: totauxEcarts.ecartAbsXpf,
      },
      parEmplacement: [...parEmplacement.values()].sort(
        (a, b) => b.ecartAbsXpf - a.ecartAbsXpf,
      ),
      // Les lignes détaillées ne sont PAS stockées (des dizaines de milliers
      // chez QC) : seuls les totaux par zone + le top anomalies.
      zones: zonesEcarts
        .map(({ lignes, ...z }) => ({
          zoneCode: z.zoneCode,
          zoneType: z.zoneType,
          zoneLibelle: z.zoneLibelle,
          totalArticles: z.totalArticles,
          nbEcarts: z.nbEcarts,
          totalEcart: z.totalEcart,
          totalEcartXpf: z.totalEcartXpf,
          ecartMoinsXpf: z.ecartMoinsXpf,
          ecartPlusXpf: z.ecartPlusXpf,
          ecartAbsXpf: z.ecartAbsXpf,
        }))
        .sort((a, b) => b.ecartAbsXpf - a.ecartAbsXpf),
      topAnomalies,
    },
    zonesRecomptees: [...recomptees.values()],
  };
};

// ===========================================
// EXCEL
// ===========================================

/** Classeur du bilan : Synthèse / Écarts par zone / Agents / Top anomalies. */
export const genererExcelBilan = (bilan, entreprise) => {
  const wb = new ExcelJS.Workbook();
  const gras = { bold: true };

  // ── Synthèse ──
  const ws = wb.addWorksheet("Synthèse");
  ws.columns = [{ width: 38 }, { width: 28 }];
  const ligne = (a, b, style) => {
    const r = ws.addRow([a, b]);
    if (style) r.font = style;
    return r;
  };
  ligne(`Bilan d'inventaire — ${entreprise.trigramme || ""}`, "", {
    bold: true,
    size: 14,
  });
  ligne("Inventaire", bilan.sessionNom);
  ligne("Début", fmtDate(bilan.debutAt));
  ligne("Clôture du bilan", fmtDate(bilan.finAt));
  ligne("");
  ligne("Progression", "", gras);
  ligne("Zones (hors neutralisées)", fmtInt(bilan.progression.totalZones));
  ligne("Zones complètes", fmtInt(bilan.progression.completes));
  ligne("Zones entamées", fmtInt(bilan.progression.entamees));
  ligne("Zones pas commencées", fmtInt(bilan.progression.vierges));
  ligne("Zones neutralisées", fmtInt(bilan.progression.zonesNeutralisees));
  ligne("Avancement global", `${bilan.progression.pct} %`);
  for (const ph of PHASES) {
    ligne(
      `Phase ${PHASE_LABELS[ph]}`,
      `${fmtInt(bilan.progression.parPhase[ph])} / ${fmtInt(bilan.progression.totalZones)}`,
    );
  }
  ligne("");
  ligne("Comptage", "", gras);
  ligne("Collectes déposées (collecteur)", fmtInt(bilan.comptage.nbCollectes));
  ligne("dont compléments (re-bipage)", fmtInt(bilan.comptage.nbComplements));
  ligne("Collectes annulées (Recommencer)", fmtInt(bilan.comptage.nbAnnulees));
  ligne("Articles comptés", fmtInt(bilan.comptage.totalArticles));
  ligne("Unités comptées", fmtQte(bilan.comptage.totalQuantite));
  ligne("Temps effectif cumulé", fmtDuree(bilan.comptage.tempsActifMs));
  ligne("Temps brut cumulé", fmtDuree(bilan.comptage.tempsBrutMs));
  ligne("");
  ligne("Écarts", "", gras);
  ligne("Zones avec comptage", fmtInt(bilan.ecarts.totaux.totalZones));
  ligne("Articles en écart", fmtInt(bilan.ecarts.totaux.nbEcarts));
  ligne("Écart net valorisé", fmtXpf(bilan.ecarts.totaux.totalEcartXpf));
  ligne("Manquants valorisés", fmtXpf(bilan.ecarts.totaux.ecartMoinsXpf));
  ligne("Excédents valorisés", fmtXpf(bilan.ecarts.totaux.ecartPlusXpf));
  ligne("Ampleur totale (Σ|écart|)", fmtXpf(bilan.ecarts.totaux.ecartAbsXpf));
  for (const e of bilan.ecarts.parEmplacement) {
    ligne(
      `— ${e.emplacement}`,
      `${fmtXpf(e.totalEcartXpf)} net · ${fmtXpf(e.ecartAbsXpf)} en ampleur (${fmtInt(e.nbZones)} zones)`,
    );
  }
  if (bilan.zonesRecomptees?.length) {
    ligne("");
    ligne("Zones recomptées", String(bilan.zonesRecomptees.length), gras);
    for (const r of bilan.zonesRecomptees) {
      ligne(
        `— ${r.zoneCode}${r.zoneType ? ` (${r.zoneType})` : ""}`,
        `${fmtInt(r.nbCollectesAnnulees)} comptage(s) jeté(s)`,
      );
    }
  }

  // ── Écarts par zone ──
  const wz = wb.addWorksheet("Écarts par zone");
  wz.columns = [
    { header: "Zone", key: "zoneCode", width: 12 },
    { header: "Emplacement", key: "zoneType", width: 14 },
    { header: "Libellé", key: "zoneLibelle", width: 32 },
    { header: "Articles", key: "totalArticles", width: 10 },
    { header: "En écart", key: "nbEcarts", width: 10 },
    { header: "Écart (unités)", key: "totalEcart", width: 14 },
    { header: "Écart net (XPF)", key: "totalEcartXpf", width: 16 },
    { header: "Manquants (XPF)", key: "ecartMoinsXpf", width: 16 },
    { header: "Excédents (XPF)", key: "ecartPlusXpf", width: 16 },
    { header: "Ampleur (XPF)", key: "ecartAbsXpf", width: 16 },
  ];
  wz.getRow(1).font = gras;
  for (const z of bilan.ecarts.zones) {
    wz.addRow({
      ...z,
      totalEcart: Math.round(z.totalEcart * 1000) / 1000,
      totalEcartXpf: Math.round(z.totalEcartXpf),
      ecartMoinsXpf: Math.round(z.ecartMoinsXpf),
      ecartPlusXpf: Math.round(z.ecartPlusXpf),
      ecartAbsXpf: Math.round(z.ecartAbsXpf),
    });
  }
  wz.views = [{ state: "frozen", ySplit: 1 }];
  wz.autoFilter = { from: "A1", to: "J1" };

  // ── Agents ──
  const wa = wb.addWorksheet("Agents");
  wa.columns = [
    { header: "Agent", key: "nom", width: 28 },
    { header: "E-mail", key: "email", width: 28 },
    { header: "Zones bipées", key: "nbZones", width: 13 },
    { header: "Papillonnage", key: "pap", width: 13 },
    { header: "Comptage", key: "bip", width: 11 },
    { header: "Contrôle", key: "ctl", width: 11 },
    { header: "Articles", key: "totalArticles", width: 10 },
    { header: "Unités", key: "totalQuantite", width: 12 },
    { header: "Temps effectif", key: "actif", width: 15 },
    { header: "Temps brut", key: "brut", width: 13 },
  ];
  wa.getRow(1).font = gras;
  for (const a of bilan.agents) {
    wa.addRow({
      nom: a.nom,
      email: a.email,
      nbZones: a.nbZones,
      pap: a.phases.papillonnage,
      bip: a.phases.bipage,
      ctl: a.phases.controle,
      totalArticles: a.totalArticles,
      totalQuantite: Math.round(a.totalQuantite * 1000) / 1000,
      actif: fmtDuree(a.tempsActifMs),
      brut: fmtDuree(a.tempsBrutMs),
    });
  }
  wa.views = [{ state: "frozen", ySplit: 1 }];

  // ── Top anomalies ──
  const wt = wb.addWorksheet("Top anomalies");
  wt.columns = [
    { header: "NART", key: "nart", width: 10 },
    { header: "GENCOD", key: "gencod", width: 15 },
    { header: "Désignation", key: "designation", width: 38 },
    { header: "Zone", key: "zoneCode", width: 10 },
    { header: "Emplacement", key: "zoneType", width: 13 },
    { header: "Compté", key: "qteBipee", width: 10 },
    { header: "Stock théorique", key: "stockTheorique", width: 15 },
    { header: "Écart", key: "ecart", width: 10 },
    { header: "Écart (XPF)", key: "ecartXpf", width: 14 },
  ];
  wt.getRow(1).font = gras;
  for (const t of bilan.ecarts.topAnomalies) {
    wt.addRow({ ...t, ecartXpf: Math.round(t.ecartXpf) });
  }
  wt.views = [{ state: "frozen", ySplit: 1 }];

  return wb;
};

// ===========================================
// PDF (synthèse A4 portrait)
// ===========================================

/** PDF de synthèse du bilan. Résout en Buffer. */
export const genererPdfBilan = (bilan, entreprise) =>
  new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 46 });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const titre = (t) => {
      doc.moveDown(0.8);
      doc.font("Helvetica-Bold").fontSize(12).text(t);
      doc.moveDown(0.3);
      doc.font("Helvetica").fontSize(9.5);
    };
    const kv = (k, v) => {
      doc
        .font("Helvetica")
        .fontSize(9.5)
        .text(`${k} : `, { continued: true })
        .font("Helvetica-Bold")
        .text(String(v));
      doc.font("Helvetica");
    };

    doc
      .font("Helvetica-Bold")
      .fontSize(16)
      .text(`Bilan d'inventaire — ${entreprise.trigramme || ""}`);
    doc
      .font("Helvetica")
      .fontSize(10)
      .text(bilan.sessionNom || "", { paragraphGap: 2 })
      .fontSize(9)
      .fillColor("#555555")
      .text(
        `Du ${fmtDate(bilan.debutAt)} au ${fmtDate(bilan.finAt)} · bilan généré le ${fmtDate(bilan.genereAt)}`,
      )
      .fillColor("#000000");

    titre("Progression");
    kv(
      "Zones complètes",
      `${fmtInt(bilan.progression.completes)} / ${fmtInt(bilan.progression.totalZones)} (${bilan.progression.pct} %)`,
    );
    kv(
      "Entamées / pas commencées / neutralisées",
      `${fmtInt(bilan.progression.entamees)} / ${fmtInt(bilan.progression.vierges)} / ${fmtInt(bilan.progression.zonesNeutralisees)}`,
    );
    kv(
      "Phases",
      PHASES.map(
        (ph) => `${PHASE_LABELS[ph]} ${fmtInt(bilan.progression.parPhase[ph])}`,
      ).join(" · "),
    );

    titre("Comptage");
    kv(
      "Collectes déposées",
      `${fmtInt(bilan.comptage.nbCollectes)} (dont ${fmtInt(bilan.comptage.nbComplements)} compléments, ${fmtInt(bilan.comptage.nbAnnulees)} annulées)`,
    );
    kv(
      "Articles / unités",
      `${fmtInt(bilan.comptage.totalArticles)} / ${fmtQte(bilan.comptage.totalQuantite)}`,
    );
    kv(
      "Temps effectif / brut",
      `${fmtDuree(bilan.comptage.tempsActifMs)} / ${fmtDuree(bilan.comptage.tempsBrutMs)}`,
    );

    titre("Écarts valorisés");
    kv("Écart net", fmtXpf(bilan.ecarts.totaux.totalEcartXpf));
    kv(
      "Manquants / excédents",
      `${fmtXpf(bilan.ecarts.totaux.ecartMoinsXpf)} / ${fmtXpf(bilan.ecarts.totaux.ecartPlusXpf)}`,
    );
    kv("Ampleur totale (Σ|écart|)", fmtXpf(bilan.ecarts.totaux.ecartAbsXpf));
    kv(
      "Articles en écart",
      `${fmtInt(bilan.ecarts.totaux.nbEcarts)} sur ${fmtInt(bilan.ecarts.totaux.totalArticles)} comptés`,
    );
    for (const e of bilan.ecarts.parEmplacement) {
      kv(
        `  ${e.emplacement}`,
        `${fmtXpf(e.totalEcartXpf)} net · ampleur ${fmtXpf(e.ecartAbsXpf)} (${fmtInt(e.nbZones)} zones)`,
      );
    }

    titre("Zones les plus en écart (ampleur)");
    for (const z of bilan.ecarts.zones.slice(0, 12)) {
      doc.text(
        `${z.zoneCode}${z.zoneType ? ` · ${z.zoneType}` : ""}  —  net ${fmtXpf(z.totalEcartXpf)}, ampleur ${fmtXpf(z.ecartAbsXpf)} (${fmtInt(z.nbEcarts)} articles en écart)`,
      );
    }

    titre("Agents");
    for (const a of bilan.agents.slice(0, 15)) {
      doc.text(
        `${a.nom}  —  ${fmtInt(a.nbZones)} zone(s) bipée(s), coupons ${fmtInt(a.totalPhases)}, ${fmtInt(a.totalArticles)} articles, temps effectif ${fmtDuree(a.tempsActifMs)}`,
      );
    }
    if (bilan.agents.length > 15) {
      doc
        .fillColor("#555555")
        .text(`+ ${bilan.agents.length - 15} autre(s) agent(s) — voir l'Excel.`)
        .fillColor("#000000");
    }

    if (bilan.zonesRecomptees?.length) {
      titre("Zones recomptées (« Recommencer la zone »)");
      doc.text(
        bilan.zonesRecomptees
          .map(
            (r) => `${r.zoneCode}${r.zoneType ? ` (${r.zoneType})` : ""}`,
          )
          .join(" · "),
      );
    }

    doc.end();
  });

// ===========================================
// ARCHIVAGE
// ===========================================

/**
 * Construit le bilan, le FIGE en Mongo (upsert par session) et pousse Excel +
 * PDF sur le miroir FTP de l'inventaire (sous-dossier `bilan/`, best-effort).
 * @returns le document InventaireBilan enregistré.
 */
export const archiverBilan = async (
  entreprise,
  session,
  { user = null, auto = false } = {},
) => {
  const bilan = await construireBilan(entreprise, session, { user, auto });

  const doc = await InventaireBilan.findOneAndUpdate(
    { session: session._id },
    { $set: bilan },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  // Copie FTP best-effort : le bilan Mongo est la référence (les fichiers se
  // regénèrent depuis lui à la demande) — un FTP injoignable ne bloque rien.
  const slug = session.dossierSlug || session.nom;
  if (slug && entreprise.trigramme && miroirInventaireActif(entreprise)) {
    try {
      const wb = genererExcelBilan(bilan, entreprise);
      const bufXlsx = Buffer.from(await wb.xlsx.writeBuffer());
      const bufPdf = await genererPdfBilan(bilan, entreprise);
      await deposerFichierInventaireFtp(
        entreprise.trigramme,
        slug,
        "bilan",
        `bilan_inventaire_${entreprise.trigramme}.xlsx`,
        bufXlsx,
      );
      await deposerFichierInventaireFtp(
        entreprise.trigramme,
        slug,
        "bilan",
        `bilan_inventaire_${entreprise.trigramme}.pdf`,
        bufPdf,
      );
    } catch (err) {
      console.error(`[Bilan inventaire] copie FTP échouée : ${err.message}`);
    }
  }

  return doc;
};

export default { construireBilan, genererExcelBilan, genererPdfBilan, archiverBilan };
