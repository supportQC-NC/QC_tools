// backend/services/ecartsZonesService.js
//
// ÉCARTS DE STOCK PAR ZONE d'un inventaire — extrait de `getRecapZones`
// (inventaireCollecteController) pour être partagé avec le BILAN DE CLÔTURE :
// le récap à l'écran et le bilan archivé doivent raconter exactement les mêmes
// chiffres, donc un seul calcul.
//
// Écart = quantité bipée − stock théorique (ΣS1..S5 du cache articles),
// valorisé au prix d'achat. Les collectes ANNULÉES (« Recommencer la zone »)
// sont exclues ; les lignes IMPORTÉES (proforma ERP / Excel) sont ajoutées
// depuis LigneBipage — sans elles, une zone comptée sans collecteur
// n'apparaîtrait pas du tout (constaté en prod, 30/10/2026).

import InventaireCollecte from "../models/InventaireCollecteModel.js";
import LigneBipage from "../models/LigneBipageModel.js";
import articleCacheService from "./articleService.js";

/**
 * Calcule les écarts par zone d'une session (ou des collectes hors session si
 * `session` est null — même convention que le récap).
 *
 * @returns {Promise<{zones: Array, totaux: Object}>} `zones[]` porte les
 *          lignes détaillées ET les totaux par zone (voir le récap) ; `totaux`
 *          est l'agrégat global.
 */
export const calculerEcartsZones = async (entreprise, session) => {
  // Collectes de la session. Si aucune session, on prend les collectes non
  // rattachées à une session archivée (sécurité : on borne par session si elle
  // existe).
  const filtreCollecte = { entreprise: entreprise._id };
  filtreCollecte.session = session ? session._id : null;
  // ⚠️ Les collectes ANNULÉES par « Recommencer la zone » sont exclues : leur
  // comptage a été jeté (fiche et lignes bipées supprimées), le garder ici
  // doublait les quantités dès que la zone était re-bipée.
  filtreCollecte.annulee = { $ne: true };

  const collectes = await InventaireCollecte.find(filtreCollecte).sort({
    zoneCode: 1,
    updatedAt: 1,
  });

  // Pré-charge le cache article (lecture O(1) ensuite). Tolérant aux erreurs.
  try {
    await articleCacheService.preload(entreprise);
  } catch (e) {
    // on continue : findByNart rechargera au besoin
  }

  // Infos article (stock S1..S5, prix d'achat PACHAT, fournisseur FOURN)
  // via NART puis repli GENCOD.
  const getInfosArticle = async (nart, gencod) => {
    let record = null;
    if (nart && String(nart).trim()) {
      record = await articleCacheService.findByNart(
        entreprise,
        String(nart).trim(),
      );
    }
    if (!record && gencod && String(gencod).trim()) {
      record = await articleCacheService.findByCode(
        entreprise,
        String(gencod).trim(),
      );
    }
    if (!record) {
      return { stock: 0, prixAchat: 0, fourn: "", trouve: false };
    }
    return {
      stock: articleCacheService.calculateStockTotal(record),
      prixAchat: parseFloat(record.PACHAT) || 0,
      fourn: (record.FOURN ? String(record.FOURN) : "").trim(),
      trouve: true,
    };
  };

  // Regroupement par zone
  const zonesMap = new Map();

  for (const collecte of collectes) {
    const code = collecte.zoneCode || "(sans zone)";
    const type = String(collecte.zoneType || "").trim();
    // ⚠️ Clé sur le COUPLE code + emplacement. Regrouper sur le seul code
    // fusionnait les deux zones d'un même code — chez QC, 53 codes existent à
    // la fois en MAGASIN et au DOCK — et les écarts des deux emplacements se
    // retrouvaient additionnés sous une zone unique, étiquetée avec le premier
    // emplacement rencontré.
    const cle = `${code}|${type}`;
    if (!zonesMap.has(cle)) {
      zonesMap.set(cle, {
        zoneCode: code,
        zoneLibelle: collecte.zoneLibelle || "",
        zoneType: type,
        lignes: [],
      });
    }
    const zoneEntry = zonesMap.get(cle);

    for (const ligne of collecte.lignes) {
      const { stock, prixAchat, fourn, trouve } = await getInfosArticle(
        ligne.nart,
        ligne.gencod,
      );
      const qteBipee = parseFloat(ligne.quantite) || 0;
      const ecart = qteBipee - stock;
      const ecartXpf = ecart * prixAchat;

      // Cumul si le même article (nart) revient dans la même zone
      const existante = zoneEntry.lignes.find(
        (l) => l.nart === ligne.nart && l.gencod === (ligne.gencod || ""),
      );
      if (existante) {
        existante.qteBipee += qteBipee;
        existante.ecart = existante.qteBipee - existante.stockTheorique;
        existante.ecartXpf = existante.ecart * existante.prixAchat;
      } else {
        zoneEntry.lignes.push({
          nart: ligne.nart,
          gencod: ligne.gencod || "",
          designation: ligne.designation || "",
          qteBipee,
          stockTheorique: stock,
          ecart,
          prixAchat,
          ecartXpf,
          fourn,
          articleTrouve: trouve,
          isRenvoi: !!ligne.isRenvoi,
          isUnknown: !!ligne.isUnknown,
        });
      }
    }
  }

  // ── Lignes IMPORTÉES (proforma ERP / fichier Excel) ─────────────────────
  // Un comptage peut arriver SANS collecteur : import d'une proforma ou d'un
  // Excel depuis l'écran Progression. Ces lignes n'existent que dans
  // LigneBipage. Les lignes des .DAT du collecteur sont EXCLUES : elles sont
  // déjà portées par les collectes ci-dessus. Les lignes historiques sans
  // champ `source` (avant le 09/09/2026) sont reconnues par leur référence
  // d'import (« proforma … », « excel … », « deduction … ») — un nom de
  // fichier .DAT ne commence jamais ainsi.
  if (session) {
    const lignesImport = await LigneBipage.find({
      session: session._id,
      $or: [
        { source: { $in: ["proforma", "excel"] } },
        {
          source: { $in: [null, ""] },
          datFileName: { $regex: /^(?:deduction |excel |proforma )/ },
        },
      ],
    })
      .select("zoneCode zoneType nart gencod eanArticle designation qteScan found")
      .lean();

    // Libellés : les LigneBipage n'en portent pas, le snapshot de session oui.
    const libelles = new Map(
      (session.zones || []).map((z) => [
        `${z.code}|${String(z.type || "").trim()}`,
        z.libelle || "",
      ]),
    );

    for (const ligne of lignesImport) {
      const code = ligne.zoneCode || "(sans zone)";
      const type = String(ligne.zoneType || "").trim();
      const cle = `${code}|${type}`;
      if (!zonesMap.has(cle)) {
        zonesMap.set(cle, {
          zoneCode: code,
          zoneLibelle: libelles.get(cle) || "",
          zoneType: type,
          lignes: [],
        });
      }
      const zoneEntry = zonesMap.get(cle);

      const nart = String(ligne.nart || "").trim();
      const gencod = String(ligne.gencod || "").trim();
      const { stock, prixAchat, fourn, trouve } = await getInfosArticle(
        nart,
        gencod || ligne.eanArticle,
      );
      // Les déductions sont stockées en négatif : le cumul donne le NET.
      const qteBipee = parseFloat(ligne.qteScan) || 0;

      const existante = zoneEntry.lignes.find(
        (l) => String(l.nart || "").trim() === nart && (l.gencod || "") === gencod,
      );
      if (existante) {
        existante.qteBipee += qteBipee;
        existante.ecart = existante.qteBipee - existante.stockTheorique;
        existante.ecartXpf = existante.ecart * existante.prixAchat;
      } else {
        zoneEntry.lignes.push({
          nart,
          gencod,
          designation: ligne.designation || "",
          qteBipee,
          stockTheorique: stock,
          ecart: qteBipee - stock,
          prixAchat,
          ecartXpf: (qteBipee - stock) * prixAchat,
          fourn,
          articleTrouve: trouve,
          isRenvoi: false,
          isUnknown: !ligne.found,
        });
      }
    }
  }

  // Mise en forme + totaux par zone
  const zones = Array.from(zonesMap.values()).map((z) => {
    const totalQteBipee = z.lignes.reduce((s, l) => s + l.qteBipee, 0);
    const totalStockTheorique = z.lignes.reduce(
      (s, l) => s + l.stockTheorique,
      0,
    );
    const totalEcart = z.lignes.reduce((s, l) => s + l.ecart, 0);
    const totalEcartXpf = z.lignes.reduce((s, l) => s + l.ecartXpf, 0);
    const nbEcarts = z.lignes.filter((l) => l.ecart !== 0).length;

    // ── Manquants et excédents SÉPARÉS ──────────────────────────────────
    // Le net seul induit en erreur : une zone peut afficher −325 unités et
    // +46 460 F parce qu'un article cher en excédent écrase des articles bon
    // marché manquants. Les deux sens séparés rendent la composition lisible.
    // ⚠️ Le total en UNITÉS n'a de toute façon pas de sens physique : il
    // additionne des masques et des gants. Seule la valorisation s'additionne
    // légitimement d'un article à l'autre.
    const ecartMoinsUnites = z.lignes
      .filter((l) => l.ecart < 0)
      .reduce((s, l) => s + l.ecart, 0);
    const ecartPlusUnites = z.lignes
      .filter((l) => l.ecart > 0)
      .reduce((s, l) => s + l.ecart, 0);
    const ecartMoinsXpf = z.lignes
      .filter((l) => l.ecartXpf < 0)
      .reduce((s, l) => s + l.ecartXpf, 0);
    const ecartPlusXpf = z.lignes
      .filter((l) => l.ecartXpf > 0)
      .reduce((s, l) => s + l.ecartXpf, 0);

    return {
      ...z,
      totalArticles: z.lignes.length,
      totalQteBipee,
      totalStockTheorique,
      totalEcart,
      totalEcartXpf,
      nbEcarts,
      ecartMoinsUnites,
      ecartPlusUnites,
      ecartMoinsXpf,
      ecartPlusXpf,
      // Ampleur TOTALE du désordre = Σ|écart| par ligne. C'est elle qui dit
      // « cette zone pose problème » : une zone à −100 000 F et +100 000 F a
      // un net nul mais n'est pas saine pour autant.
      ecartAbsUnites: Math.abs(ecartMoinsUnites) + ecartPlusUnites,
      ecartAbsXpf: Math.abs(ecartMoinsXpf) + ecartPlusXpf,
    };
  });

  const totaux = zones.reduce(
    (acc, z) => {
      acc.totalArticles += z.totalArticles;
      acc.totalQteBipee += z.totalQteBipee;
      acc.totalStockTheorique += z.totalStockTheorique;
      acc.totalEcart += z.totalEcart;
      acc.totalEcartXpf += z.totalEcartXpf;
      acc.nbEcarts += z.nbEcarts;
      acc.ecartMoinsXpf += z.ecartMoinsXpf;
      acc.ecartPlusXpf += z.ecartPlusXpf;
      acc.ecartAbsXpf += z.ecartAbsXpf;
      return acc;
    },
    {
      totalZones: zones.length,
      totalArticles: 0,
      totalQteBipee: 0,
      totalStockTheorique: 0,
      totalEcart: 0,
      totalEcartXpf: 0,
      nbEcarts: 0,
      ecartMoinsXpf: 0,
      ecartPlusXpf: 0,
      ecartAbsXpf: 0,
    },
  );

  return { zones, totaux };
};

export default { calculerEcartsZones };
