// backend/services/journalCaisseService.js
//
// JOURNAL DE CAISSE — transcription fidèle du script Python journal_caisse_qc.py
//
// Pour UN JOUR donné :
//   - factures TYPFACT ∈ {F, A} du jour (facture.dbf, déjà en cache)
//   - moyen de paiement = champ CHEQUE :
//       * commence par "CH"/"Ch"  -> "Chèque" + extraction du N° de chèque
//         (regex /CH(.*)/i, comme le script)
//       * vide / null             -> "Non spécifié"
//       * sinon                   -> valeur brute (ex. "Debit")
//   - nom client : jointure clients.dbf par TIERS (nettoyé numérique),
//     sinon "Client inconnu"
//   - avoirs (TYPFACT = A) : montant × (-1), tableau séparé (comme le script)
//   - regroupement par moyen de paiement avec total par moyen
//   - détails : lignes detail.dbf des factures du jour, en EXCLUANT uniquement
//     les NART contenant "!" (le script garde les NART vides), jointure client
//     par CLIENT -> NOM_CLIENT
//
// IMPORTANT : le cache facture ne conserve que l'année en cours et l'année
// précédente -> un jour antérieur ne remontera rien (le front l'indique).

import factureCacheService from "./factureCacheService.js";
import clientCacheService from "./clientCacheService.js";

class JournalCaisseService {
  num(v) {
    if (v === null || v === undefined || v === "") return 0;
    const n = typeof v === "number" ? v : parseFloat(String(v).replace(",", "."));
    return Number.isFinite(n) ? n : 0;
  }

  safeTrim(v) {
    if (v === null || v === undefined) return "";
    return String(v).trim();
  }

  // Nettoyage numérique d'une clé TIERS/CLIENT (comme pd.to_numeric -> int -> str)
  cleanTiers(v) {
    const n = parseInt(String(v ?? "").trim(), 10);
    return Number.isFinite(n) ? String(n) : this.safeTrim(v);
  }

  // "YYYY-MM-DD" -> Date locale à minuit
  parseInputDate(v) {
    if (!v || typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
    const d = new Date(
      parseInt(v.slice(0, 4), 10),
      parseInt(v.slice(5, 7), 10) - 1,
      parseInt(v.slice(8, 10), 10),
    );
    return Number.isNaN(d.getTime()) ? null : d;
  }

  memeJour(a, b) {
    return (
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate()
    );
  }

  // Analyse du champ CHEQUE -> { moyen, numCheque } (logique du script)
  parseMoyen(chequeRaw) {
    const val = this.safeTrim(chequeRaw);
    if (!val) return { moyen: "Non spécifié", numCheque: null };
    // N° de chèque : regex (?i)CH(.*) comme le script
    const m = val.match(/CH(.*)/i);
    const numCheque = m ? this.safeTrim(m[1]) || null : null;
    // Libellé "chèque" si préfixe CH/Ch (comme x.startswith(('CH','Ch')))
    if (val.startsWith("CH") || val.startsWith("Ch")) {
      return { moyen: "Chèque", numCheque };
    }
    return { moyen: val, numCheque: null };
  }

  formatDateFr(d) {
    const p = (n) => String(n).padStart(2, "0");
    return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
  }

  /**
   * @param {object} entreprise
   * @param {string} dateStr - "YYYY-MM-DD" (jour du journal)
   */
  async getJournal(entreprise, dateStr) {
    const jour = this.parseInputDate(dateStr);
    if (!jour) {
      throw new Error("Date invalide (format attendu : YYYY-MM-DD).");
    }

    const [cache, clientCache] = await Promise.all([
      factureCacheService.getFactures(entreprise),
      clientCacheService.getClients(entreprise),
    ]);

    // Résolution TIERS -> NOM (jointure clients.dbf du script)
    const nomByTiers = (tiersRaw) => {
      const key = this.cleanTiers(tiersRaw);
      const idx = clientCache.indexByTiers.get(key);
      if (idx === undefined) return "Client inconnu";
      const nom = this.safeTrim(clientCache.records[idx]?.NOM);
      return nom || "Client inconnu";
    };

    // ---- Factures F + A du jour ----
    const rows = [];
    for (const f of cache.factureRecords) {
      const typ = this.safeTrim(f.TYPFACT).toUpperCase();
      if (typ !== "F" && typ !== "A") continue;

      const d = factureCacheService.parseDate(f.DATFACT);
      if (!d || !this.memeJour(d, jour)) continue;

      const { moyen, numCheque } = this.parseMoyen(f.CHEQUE);
      const tiers = this.cleanTiers(f.TIERS);

      rows.push({
        numfact: this.safeTrim(f.NUMFACT),
        typfact: typ,
        date: this.formatDateFr(d),
        heure: this.safeTrim(f.HEURE),
        tiers,
        nom: nomByTiers(f.TIERS),
        montant: this.num(f.MONTANT),
        montaxes: this.num(f.MONTAXES),
        moyen,
        numCheque,
      });
    }

    // ---- Regroupement par moyen de paiement (F + A, montants tels quels,
    //      comme le df_dict du script) ----
    const groupesMap = new Map();
    for (const r of rows) {
      if (!groupesMap.has(r.moyen)) {
        groupesMap.set(r.moyen, { moyen: r.moyen, factures: [], total: 0, nb: 0 });
      }
      const g = groupesMap.get(r.moyen);
      g.factures.push(r);
      g.total += r.montant;
      g.nb += 1;
    }
    const groupes = [...groupesMap.values()].sort((a, b) => b.total - a.total);

    // ---- Avoirs : TYPFACT=A, montant × (-1) (comme le script) ----
    const avoirs = rows
      .filter((r) => r.typfact === "A")
      .map((r) => ({ ...r, montant: r.montant * -1 }));
    const totalAvoirs = avoirs.reduce((s, r) => s + r.montant, 0);

    // ---- Détails : lignes des factures du jour, hors NART contenant "!" ----
    const details = [];
    for (const r of rows) {
      const lignes = cache.detailByNumfact.get(r.numfact) || [];
      for (const l of lignes) {
        const nart = this.safeTrim(l.NART);
        if (nart.includes("!")) continue; // seul filtre du script
        details.push({
          numfact: r.numfact,
          nart,
          design: this.safeTrim(l.DESIGN),
          dtva: this.num(l.DTVA),
          client: this.cleanTiers(l.CLIENT),
          nomClient: nomByTiers(l.CLIENT),
        });
      }
    }

    // ---- KPI ----
    const facturesF = rows.filter((r) => r.typfact === "F");
    const montantTotalF = facturesF.reduce((s, r) => s + r.montant, 0);

    return {
      nomDossierDBF: entreprise.nomDossierDBF,
      date: dateStr,
      dateFr: this.formatDateFr(jour),
      generatedAt: new Date().toISOString(),
      totaux: {
        nbFactures: facturesF.length,
        nbAvoirs: avoirs.length,
        nbTotal: rows.length,
        montantTotal: montantTotalF,
        montantAvoirs: totalAvoirs,
        montantNet: montantTotalF + totalAvoirs,
        nbMoyens: groupes.length,
      },
      groupes,
      avoirs,
      totalAvoirs,
      details,
    };
  }
}

const journalCaisseService = new JournalCaisseService();
export default journalCaisseService;