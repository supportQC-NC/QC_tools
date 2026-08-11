// backend/models/UserDashboardLayoutModel.js
//
// Tableau de bord PERSONNEL d'un utilisateur : un document par utilisateur.
// Même esprit que UserMenuLayout (« Organiser mon menu ») : tant que
// `useCustom` est faux, l'écran affiche la disposition par défaut déduite des
// droits ; dès que l'utilisateur compose son tableau, on sert `blocs`.
//
// Deux natures de blocs :
//   - type "widget" : un widget du catalogue, identifié par `source`
//     (cf. backend/config/dashboardCatalogue.js) ;
//   - type "kpi"    : une tuile chiffrée composée par l'utilisateur
//     (dataset + mesure + filtres), évaluée par dashboardKpiService.
//
// Les droits ne sont JAMAIS stockés ici : ils sont revérifiés à chaque lecture
// (un bloc dont l'utilisateur a perdu le module disparaît de son écran).
import mongoose from "mongoose";

const filtreSchema = new mongoose.Schema(
  {
    champ: { type: String, required: true },
    operateur: { type: String, required: true },
    valeur: { type: String, default: "" },
  },
  { _id: false },
);

const blocSchema = new mongoose.Schema(
  {
    // Identifiant stable du bloc dans la disposition (généré côté client).
    id: { type: String, required: true },
    type: {
      type: String,
      enum: ["widget", "kpi", "graphique", "tableau"],
      required: true,
    },
    // Ancienne largeur en trois crans. Conservée pour les dispositions
    // enregistrées avant la grille : elle sert à déduire `w` à la reprise.
    taille: {
      type: String,
      enum: ["tiers", "moitie", "pleine"],
      default: "tiers",
    },
    // Grille 12 colonnes : largeur en colonnes, hauteur en unités de 90 px.
    w: { type: Number, default: 4, min: 1, max: 12 },
    h: { type: Number, default: 3, min: 1, max: 12 },

    // ── type "widget" ────────────────────────────────────────────────────────
    source: { type: String, default: "" },

    // ── type "kpi" ───────────────────────────────────────────────────────────
    titre: { type: String, default: "" },
    dataset: { type: String, default: "" },

    // Croisement facultatif avec une seconde source. Les champs rapportés sont
    // ensuite adressables sous « <dataset>.<champ> » dans les mesures, les
    // regroupements et les filtres.
    // Rapprochement de type « jointure gauche » : une ligne sans correspondance
    // est CONSERVÉE, ses champs rapportés restent vides.
    jointure: {
      type: new mongoose.Schema(
        {
          dataset: { type: String, required: true },
          champGauche: { type: String, required: true },
          champDroit: { type: String, required: true },
        },
        { _id: false },
      ),
      default: null,
    },
    mesure: { type: String, default: "count" },
    champ: { type: String, default: "" }, // requis pour somme / moyenne
    filtres: { type: [filtreSchema], default: [] },
    format: {
      type: String,
      enum: ["nombre", "xpf", "pourcent"],
      default: "nombre",
    },
    couleur: { type: String, default: "#6366f1" },
    icone: { type: String, default: "HiChartBar" },

    // ── type "graphique" (partage dataset / mesure / champ / filtres) ────────
    // Champ sur lequel on regroupe (axe des abscisses / parts du camembert).
    dimension: { type: String, default: "" },
    typeGraphique: {
      type: String,
      enum: ["barres", "lignes", "aires", "camembert"],
      default: "barres",
    },
    // Second regroupement : ventile chaque groupe en plusieurs séries
    // (barres groupées / empilées, courbes multiples). Vide = série unique.
    serie: { type: String, default: "" },
    // Barres empilées plutôt que côte à côte (n'a de sens qu'avec `serie`).
    empile: { type: Boolean, default: false },

    // ── type "tableau" ──────────────────────────────────────────────────────
    // Colonnes affichées, dans l'ordre. Le tri utilise `champ` + `tri`.
    colonnes: { type: [String], default: [] },

    // Nombre de groupes (graphique) ou de lignes (tableau) affichés ;
    // pour un graphique, le reste est cumulé dans « Autres ».
    // (bornes fines par type dans dashboardKpiService)
    limite: { type: Number, default: 10, min: 3, max: 200 },
    tri: {
      type: String,
      enum: ["valeurDesc", "valeurAsc", "libelle"],
      default: "valeurDesc",
    },
  },
  { _id: false },
);

// Une PAGE = un onglet du tableau de bord, avec ses propres blocs.
const pageSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    nom: { type: String, default: "Page" },
    blocs: { type: [blocSchema], default: [] },
  },
  { _id: false },
);

const userDashboardLayoutSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    // false => disposition par défaut déduite des droits.
    useCustom: { type: Boolean, default: false },
    pages: { type: [pageSchema], default: [] },
    // HÉRITAGE : dispositions enregistrées avant les pages multiples. Elles
    // sont converties en une page unique à la première lecture (cf.
    // dashboardLayoutController.normaliserPages) ; ce champ n'est plus écrit.
    blocs: { type: [blocSchema], default: [] },
  },
  { timestamps: true },
);

export default mongoose.model("UserDashboardLayout", userDashboardLayoutSchema);
