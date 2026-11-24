// backend/models/InventaireBilanModel.js
//
// BILAN DE CLÔTURE d'un inventaire par zones (axe validé par le client le
// 23/11/2026). À l'origine la réinitialisation purgeait collectes et
// LigneBipage ; depuis le 24/11/2026 elles sont CONSERVÉES par session
// (module Localisation inventaire) — le bilan garde tout son sens : c'est la
// SYNTHÈSE figée et valorisée au moment de la clôture (le stock théorique,
// lui, continue de bouger, et l'annulation d'inventaire supprime toujours
// tout). Le bilan FIGE donc, en Mongo, la synthèse complète au
// moment de la clôture : progression, agents et temps, écarts valorisés par
// zone et par emplacement, top anomalies, zones recomptées. Les fichiers
// Excel/PDF sont REGÉNÉRÉS à la demande depuis ce document (pas besoin du
// partage ni du FTP pour les relire), et une copie part sur le miroir FTP de
// l'inventaire au moment de la génération.
//
// C'est AUSSI la matière de la comparaison inter-inventaires : `ecarts.zones`
// garde le détail par zone (code + emplacement) de chaque inventaire, ce qui
// permet de repérer les rayons chroniquement faux d'un inventaire à l'autre.
//
// Un bilan par session (index unique) : le regénérer ÉCRASE le précédent —
// c'est voulu, le bilan décrit l'état de la session, pas un historique de
// générations.

import mongoose from "mongoose";

const agentBilanSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    nom: { type: String, default: "" },
    email: { type: String, default: "" },
    nbZones: { type: Number, default: 0 },
    phases: {
      papillonnage: { type: Number, default: 0 },
      bipage: { type: Number, default: 0 },
      controle: { type: Number, default: 0 },
    },
    totalPhases: { type: Number, default: 0 },
    totalArticles: { type: Number, default: 0 },
    totalQuantite: { type: Number, default: 0 },
    tempsActifMs: { type: Number, default: 0 },
    tempsBrutMs: { type: Number, default: 0 },
  },
  { _id: false },
);

const zoneEcartBilanSchema = new mongoose.Schema(
  {
    zoneCode: { type: String, default: "" },
    zoneType: { type: String, default: "" },
    zoneLibelle: { type: String, default: "" },
    totalArticles: { type: Number, default: 0 },
    nbEcarts: { type: Number, default: 0 },
    totalEcart: { type: Number, default: 0 },
    totalEcartXpf: { type: Number, default: 0 },
    ecartMoinsXpf: { type: Number, default: 0 },
    ecartPlusXpf: { type: Number, default: 0 },
    ecartAbsXpf: { type: Number, default: 0 },
  },
  { _id: false },
);

const anomalieBilanSchema = new mongoose.Schema(
  {
    nart: { type: String, default: "" },
    gencod: { type: String, default: "" },
    designation: { type: String, default: "" },
    zoneCode: { type: String, default: "" },
    zoneType: { type: String, default: "" },
    qteBipee: { type: Number, default: 0 },
    stockTheorique: { type: Number, default: 0 },
    ecart: { type: Number, default: 0 },
    ecartXpf: { type: Number, default: 0 },
  },
  { _id: false },
);

const inventaireBilanSchema = new mongoose.Schema(
  {
    entreprise: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Entreprise",
      required: true,
      index: true,
    },
    // Un seul bilan par session : regénérer écrase (upsert).
    session: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "InventaireZoneSession",
      required: true,
      unique: true,
    },
    sessionNom: { type: String, default: "" },
    dossierSlug: { type: String, default: "" },
    dossierFtp: { type: String, default: "" },

    // `auto` = généré par la réinitialisation (filet avant purge), par
    // opposition à une clôture demandée depuis l'écran Bilans.
    genereAt: { type: Date, default: Date.now },
    generePar: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    auto: { type: Boolean, default: false },

    // Bornes de l'inventaire : création de la session → génération du bilan.
    debutAt: { type: Date, default: null },
    finAt: { type: Date, default: null },

    progression: {
      totalZones: { type: Number, default: 0 },
      zonesNeutralisees: { type: Number, default: 0 },
      completes: { type: Number, default: 0 },
      entamees: { type: Number, default: 0 },
      vierges: { type: Number, default: 0 },
      pct: { type: Number, default: 0 },
      parPhase: {
        papillonnage: { type: Number, default: 0 },
        bipage: { type: Number, default: 0 },
        controle: { type: Number, default: 0 },
      },
    },

    comptage: {
      nbCollectes: { type: Number, default: 0 },
      nbComplements: { type: Number, default: 0 },
      nbAnnulees: { type: Number, default: 0 },
      totalArticles: { type: Number, default: 0 },
      totalQuantite: { type: Number, default: 0 },
      tempsActifMs: { type: Number, default: 0 },
      tempsBrutMs: { type: Number, default: 0 },
    },

    agents: [agentBilanSchema],

    ecarts: {
      totaux: {
        totalZones: { type: Number, default: 0 },
        totalArticles: { type: Number, default: 0 },
        nbEcarts: { type: Number, default: 0 },
        totalEcart: { type: Number, default: 0 },
        totalEcartXpf: { type: Number, default: 0 },
        ecartMoinsXpf: { type: Number, default: 0 },
        ecartPlusXpf: { type: Number, default: 0 },
        ecartAbsXpf: { type: Number, default: 0 },
      },
      // Agrégat par emplacement (MAGASIN / DOCK / …) : la lecture direction.
      parEmplacement: [
        new mongoose.Schema(
          {
            emplacement: { type: String, default: "" },
            nbZones: { type: Number, default: 0 },
            totalArticles: { type: Number, default: 0 },
            nbEcarts: { type: Number, default: 0 },
            totalEcartXpf: { type: Number, default: 0 },
            ecartMoinsXpf: { type: Number, default: 0 },
            ecartPlusXpf: { type: Number, default: 0 },
            ecartAbsXpf: { type: Number, default: 0 },
          },
          { _id: false },
        ),
      ],
      // Détail par zone — la matière de la comparaison inter-inventaires.
      zones: [zoneEcartBilanSchema],
      // Les lignes les plus coûteuses (|écart XPF|), toutes zones confondues.
      topAnomalies: [anomalieBilanSchema],
    },

    // Zones passées par « Recommencer la zone » : un recomptage a eu lieu.
    zonesRecomptees: [
      new mongoose.Schema(
        {
          zoneCode: { type: String, default: "" },
          zoneType: { type: String, default: "" },
          nbCollectesAnnulees: { type: Number, default: 0 },
        },
        { _id: false },
      ),
    ],
  },
  { timestamps: true },
);

inventaireBilanSchema.index({ entreprise: 1, genereAt: -1 });

const InventaireBilan = mongoose.model("InventaireBilan", inventaireBilanSchema);

export default InventaireBilan;
