// backend/models/ReapproSnapshotModel.js
//
// PHOTO QUOTIDIENNE DU RÉAPPRO MAGASIN — une ligne par société et par jour.
//
// Mesure : combien d'articles n'ont RIEN en rayon (S1 = 0) alors qu'il reste du
// stock dans un autre dépôt (S2..S5 > 0). Ce sont les articles qu'il y a
// physiquement quelque chose à descendre. La règle est celle de
// `bipageSelectionService.estAReapprovisionner`, partagée avec la liste
// « rayon vide » de l'écran Listes de réappro pour que les deux ne se
// contredisent jamais.
//
// ⚠️ Pourquoi une collection et pas un calcul à la volée : la fiche article ne
// porte que l'état du JOUR (S1..S5 sont écrasés à chaque mouvement). Sans photo
// quotidienne il n'y a aucun historique possible — on ne pourrait jamais dire
// si la situation s'améliore. C'est le seul moyen d'obtenir une série, et ça
// remplace la lecture à la volée des classeurs reapro_mag du partage Rcommun
// (lente, mono-société, et inaccessible depuis le VPS de production).
//
// Aucune écriture DBF : l'ERP reste en lecture seule, on ne fait que le lire.
import mongoose from "mongoose";

// Ventilation par fournisseur : c'est là que se voit la concentration. Chez QC
// une poignée de fournisseurs porte l'essentiel de la liste (KAPRIOL, INGCO,
// FESTOOL…), ce qui oriente l'action bien mieux qu'un total.
const fournisseurSchema = new mongoose.Schema(
  {
    code: String,
    nom: String,
    nb: Number, // articles à réapprovisionner
    ventes: Number, // Σ des ventes 12 mois de ces articles
  },
  { _id: false },
);

// Tranches de VENTES (Σ|V1..V12|, la formule du réappro local).
//
// ⚠️ C'est le point qui change la lecture de l'indicateur : un article à
// réapprovisionner qui ne se vend jamais n'a pas le même poids qu'un article
// qui part toutes les semaines. Sans cette ventilation, 2 000 articles « à
// réappro » ne disent pas si le magasin perd des ventes ou traîne du stock mort.
//
// Bornes choisies pour être lisibles en rythme, pas en valeur absolue :
//   aucune  : 0        — ne s'est pas vendu de l'année
//   faible  : 1 à 11   — moins d'une vente par mois
//   moyenne : 12 à 51  — de une par mois à une par semaine
//   forte   : >= 52    — au moins une vente par semaine
const tranchesSchema = new mongoose.Schema(
  {
    aucune: { type: Number, default: 0 },
    faible: { type: Number, default: 0 },
    moyenne: { type: Number, default: 0 },
    forte: { type: Number, default: 0 },
  },
  { _id: false },
);

const reapproSnapshotSchema = new mongoose.Schema(
  {
    entreprise: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Entreprise",
      required: true,
    },
    // Dupliqué depuis l'entreprise : les routes sont scopées par
    // `:nomDossierDBF`, l'avoir ici évite un peuplement pour chaque lecture.
    nomDossierDBF: { type: String, required: true },

    // Jour du relevé, "yyyy-mm-dd" en heure LOCALE (Pacific/Noumea). Le relevé
    // est pris à 18:00, après la fermeture : le point porte donc l'état de FIN
    // de la journée qu'il date, une fois le réappro du jour fait.
    // ⚠️ Une chaîne et pas une Date : la journée d'inventaire est une notion
    // locale, un Date serait relu en UTC et pourrait reculer d'un jour selon le
    // fuseau du serveur — le VPS de production n'est pas à Nouméa.
    date: { type: String, required: true },

    // ---- Le chiffre de l'écran ----
    total: { type: Number, required: true }, // articles à réapprovisionner
    ventesTotal: { type: Number, default: 0 }, // Σ ventes 12 mois de ces articles
    tranches: { type: tranchesSchema, default: () => ({}) },
    parFournisseur: { type: [fournisseurSchema], default: [] },

    // ---- Contexte, pour ne pas lire le total hors de son échelle ----
    // `sansStock` : rayon vide ET rien en réserve. Ce n'est PAS du réappro
    // (il n'y a rien à descendre) mais un problème d'achat — compté à part
    // justement pour ne pas être reproché au dock. Chez QC : ~290 articles/jour.
    sansStock: { type: Number, default: 0 },
    // `sansGisement` : compté DANS le total (il y a bien du stock à descendre)
    // mais isolé parce que l'opérateur ne sait pas où le ranger. C'est autant un
    // travail à faire qu'un défaut de fiche article à corriger. Chez QC : ~550
    // articles/jour, que l'ancien comptage écartait purement et simplement.
    sansGisement: { type: Number, default: 0 },
    articlesCatalogue: { type: Number, default: 0 }, // références lues ce jour-là

    // "dbf"  : relevé pris par le planificateur sur la fiche article du jour ;
    // "xlsx" : journée rétro-calculée depuis les classeurs reapro_mag archivés,
    //          avec la MÊME règle (voir performanceReapproService.backfill).
    source: { type: String, enum: ["dbf", "xlsx"], default: "dbf" },

    dureeMs: Number,
  },
  { timestamps: true },
);

// Une seule photo par société et par jour : un second passage met à jour.
reapproSnapshotSchema.index({ entreprise: 1, date: 1 }, { unique: true });
// Lecture de la série : toujours une société sur une plage de dates.
reapproSnapshotSchema.index({ nomDossierDBF: 1, date: 1 });

const ReapproSnapshot = mongoose.model("ReapproSnapshot", reapproSnapshotSchema);

export default ReapproSnapshot;
