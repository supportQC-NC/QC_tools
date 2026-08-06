// backend/services/rapportTgcService.js
//
// Module « Rapports TGC mensuels » — déclaration fiscale TGC (Taxe Générale sur
// la Consommation, Nouvelle-Calédonie). Portage de QC_master_report
// (procRapportTgc : add_RapportTGCMensuel_Totaux / _Detail / rqAlerteTGCFacture).
// Multi-sociétés.
//
// ⚠️ PERFORMANCE : facture.dbf (≈ 391 Mo) + detail.dbf (≈ 1,17 Go) sont ÉNORMES.
// On NE charge JAMAIS un fichier entier : lecture EN STREAMING par lots
// (dbf.readRecords(2000)), on ne conserve que les factures du mois + les
// agrégats. Résultat mis en cache par (société, année, mois) TTL 10 min.
//
// FORMULE (fidèle à l'Access) :
//   ht = QTE * (PVTE - PVTE*POURC/100)  ; signé : TYPFACT='F' -> +ht, 'A' -> -ht.
//   DTVA (taux) null/absent -> 0.
//   Totaux par taux : base = Σ ht ; tgc = Σ (ht * DTVA/100).
import path from "path";
import fs from "fs";
import { DBFFile } from "dbffile";

const BATCH = 2000;
const TTL_MS = 10 * 60 * 1000;

// NART exclus des totaux/détail (frais divers, cf. Access).
const NART_EXCLUS = new Set(["000099", "000203", "000201", "000200"]);

const cache = new Map(); // `${dossier}::${year}-${month}` -> { data, loadedAt, sig }

// ─────────────────────────── Helpers ────────────────────────────────────────
const safeTrim = (v) => (v == null ? "" : String(v)).trim();
const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};
const statSafe = (p) => {
  try {
    return fs.statSync(p);
  } catch {
    return null;
  }
};

// year/month d'une valeur DATFACT (objet Date des .dbf, ou "YYYYMMDD").
const ymOf = (v) => {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return { y: v.getFullYear(), m: v.getMonth() + 1 };
  }
  const s = (v == null ? "" : String(v)).replace(/\D/g, "");
  if (s.length >= 6) return { y: Number(s.slice(0, 4)), m: Number(s.slice(4, 6)) };
  return { y: 0, m: 0 };
};

const frDate = (v) => {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    const d = String(v.getDate()).padStart(2, "0");
    const m = String(v.getMonth() + 1).padStart(2, "0");
    return `${d}/${m}/${v.getFullYear()}`;
  }
  const s = (v == null ? "" : String(v)).replace(/\D/g, "");
  return s.length >= 8 ? `${s.slice(6, 8)}/${s.slice(4, 6)}/${s.slice(0, 4)}` : "";
};

// Mois précédent (défaut de déclaration).
export const previousMonth = () => {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
};

/**
 * Calcule le rapport TGC d'une société pour un mois.
 * @param {Object} entreprise
 * @param {{year:number, month:number}} periode
 */
export const getRapportTgc = async (entreprise, { year, month }) => {
  const dossier = entreprise.nomDossierDBF;
  const base = path.join(entreprise.cheminBase, dossier);
  const factPath = path.join(base, "facture.dbf");
  const detPath = path.join(base, "detail.dbf");

  const stF = statSafe(factPath);
  const stD = statSafe(detPath);
  if (!stF) throw new Error(`Fichier facture.dbf non trouvé: ${factPath}`);
  if (!stD) throw new Error(`Fichier detail.dbf non trouvé: ${detPath}`);

  const sig = `${stF.mtime.getTime()}:${stF.size}:${stD.mtime.getTime()}:${stD.size}`;
  const key = `${dossier}::${year}-${month}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.loadedAt < TTL_MS && cached.sig === sig) {
    return cached.data;
  }

  const t0 = Date.now();

  // ── Phase 1 : factures du mois (TYPFACT F/A, TIERS<9905). ──
  const factDbf = await DBFFile.open(factPath, { readMode: "loose" });
  const factByNum = new Map(); // NUMFACT -> entête
  let batch;
  let scannedF = 0;
  while ((batch = await factDbf.readRecords(BATCH)).length > 0) {
    scannedF += batch.length;
    for (const f of batch) {
      const typ = safeTrim(f.TYPFACT).toUpperCase();
      if (typ !== "F" && typ !== "A") continue;
      const tiers = num(f.TIERS);
      if (!(tiers < 9905)) continue;
      const { y, m } = ymOf(f.DATFACT);
      if (y !== year || m !== month) continue;
      const numfact = safeTrim(f.NUMFACT);
      if (!numfact) continue;
      factByNum.set(numfact, {
        typfact: typ,
        datfact: f.DATFACT,
        tiers,
        nom: safeTrim(f.NOM),
        montant: num(f.MONTANT),
        montaxes: num(f.MONTAXES),
        factnblg: num(f.FACTNBLG),
        boncde: safeTrim(f.BONCDE),
      });
    }
  }

  // ── Phase 2 : lignes de détail des factures retenues. ──
  const detDbf = await DBFFile.open(detPath, { readMode: "loose" });
  const totMap = new Map(); // dtva -> { base, tgc }
  const detMap = new Map(); // `${numfact}::${dtva}` -> ligne détail
  const alertes = [];
  let scannedD = 0;
  while ((batch = await detDbf.readRecords(BATCH)).length > 0) {
    scannedD += batch.length;
    for (const d of batch) {
      const numfact = safeTrim(d.NUMFACT);
      const head = factByNum.get(numfact);
      if (!head) continue;

      const nart = safeTrim(d.NART);
      const pvte = num(d.PVTE);
      const qte = num(d.QTE);
      const pourc = num(d.POURC);
      const dtva = num(d.DTVA); // null/absent -> 0
      const sign = head.typfact === "F" ? 1 : -1;
      const ht = sign * qte * (pvte - (pvte * pourc) / 100);

      // Alerte : taux 0 sur un article réel qui devrait être taxé.
      if (dtva === 0 && pvte > 0 && nart > "001000") {
        alertes.push({
          numfact,
          datfact: frDate(head.datfact),
          nart,
          pvte,
          tiers: head.tiers,
          nom: head.nom,
        });
      }

      // Totaux / détail : NART longueur 6, non exclu, QTE non nulle.
      if (qte === 0) continue;
      if (nart.length !== 6) continue;
      if (NART_EXCLUS.has(nart)) continue;

      const t = totMap.get(dtva) || { base: 0, tgc: 0 };
      t.base += ht;
      t.tgc += (ht * dtva) / 100;
      totMap.set(dtva, t);

      const dk = `${numfact}::${dtva}`;
      let row = detMap.get(dk);
      if (!row) {
        row = {
          numfact,
          tiers: head.tiers,
          nom: head.nom,
          datfact: frDate(head.datfact),
          typfact: head.typfact,
          dtva,
          base: 0,
          tgc: 0,
          montant: head.montant,
          montaxes: head.montaxes,
          boncde: head.boncde,
        };
        detMap.set(dk, row);
      }
      row.base += ht;
      row.tgc += (ht * dtva) / 100;
    }
  }

  // ── Mise en forme (arrondis à l'entier — XPF sans décimale). ──
  const r0 = (n) => Math.round(n);
  const totaux = [...totMap.entries()]
    .map(([dtva, v]) => ({ dtva, base: r0(v.base), tgc: r0(v.tgc) }))
    .sort((a, b) => a.dtva - b.dtva);
  const grandTotal = {
    base: r0([...totMap.values()].reduce((s, v) => s + v.base, 0)),
    tgc: r0([...totMap.values()].reduce((s, v) => s + v.tgc, 0)),
  };
  const detail = [...detMap.values()]
    .filter((r) => r0(r.base) !== 0)
    .map((r) => ({ ...r, base: r0(r.base), tgc: r0(r.tgc) }))
    .sort((a, b) => a.numfact.localeCompare(b.numfact) || a.dtva - b.dtva);

  const data = {
    year,
    month,
    nbFactures: factByNum.size,
    totaux,
    grandTotal,
    detail,
    alertes,
  };

  cache.set(key, { data, loadedAt: Date.now(), sig });
  console.log(
    `[RapportTGC] ${dossier} ${year}-${String(month).padStart(2, "0")}: ${factByNum.size} factures, ${totaux.length} taux, ${detail.length} lignes détail, ${alertes.length} alerte(s) (scan ${scannedF}+${scannedD} en ${Date.now() - t0}ms)`,
  );
  return data;
};

export default { getRapportTgc, previousMonth };
