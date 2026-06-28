// import mongoose from "mongoose";

// const entrepriseSchema = new mongoose.Schema(
//   {
//     nomDossierDBF: {
//       type: String,
//       required: [true, "Nom du dossier DBF requis"],
//       unique: true,
//       trim: true,
//     },
//     trigramme: {
//       type: String,
//       required: [true, "Trigramme requis"],
//       unique: true,
//       uppercase: true,
//       trim: true,
//       minlength: [2, "Trigramme minimum 2 caractères"],
//       maxlength: [5, "Trigramme maximum 5 caractères"],
//     },
//     nomComplet: {
//       type: String,
//       required: [true, "Nom complet requis"],
//       trim: true,
//     },
//     description: {
//       type: String,
//       default: "",
//     },
//     isActive: {
//       type: Boolean,
//       default: true,
//     },
//     // Chemin vers le dossier DBF
//     cheminBase: {
//       type: String,
//       default: "\\\\serveur\\Bases",
//     },
//     // Chemin vers le dossier des photos articles
//     cheminPhotos: {
//       type: String,
//       default: "",
//     },
//     // Chemin d'export des fichiers inventaire (.dat)
//     cheminExportInventaire: {
//       type: String,
//       default: "\\\\192.168.0.250\\Rcommun\\STOCK\\collect_sec",
//     },
//     // Mapping des noms d'entrepôts (S1, S2, S3, S4, S5)
//     mappingEntrepots: {
//       S1: {
//         type: String,
//         default: "Magasin",
//       },
//       S2: {
//         type: String,
//         default: "S2",
//       },
//       S3: {
//         type: String,
//         default: "S3",
//       },
//       S4: {
//         type: String,
//         default: "S4",
//       },
//       S5: {
//         type: String,
//         default: "S5",
//       },
//     },
//     // Mapping des états de commande (personnalisable par entreprise)
//     mappingEtatsCommande: {
//       type: Map,
//       of: String,
//       default: () =>
//         new Map([
//           ["0", "Brouillon"],
//           ["1", "A Préparer"],
//           ["2", "Proforma"],
//           ["3", "Reliquat"],
//           ["4", "Envoyée"],
//           ["5", "Confirmée"],
//           ["6", "Transit"],
//           ["7", "Bateau"],
//           ["8", "Avion"],
//           ["9", "Commande locale"],
//         ]),
//     },
//     createdBy: {
//       type: mongoose.Schema.Types.ObjectId,
//       ref: "User",
//     },
//   },
//   {
//     timestamps: true,
//   },
// );

// // Virtuel: chemin complet vers le dossier DBF
// entrepriseSchema.virtual("cheminComplet").get(function () {
//   return `${this.cheminBase}\\${this.nomDossierDBF}`;
// });

// // Inclure les virtuels dans JSON
// entrepriseSchema.set("toJSON", { virtuals: true });
// entrepriseSchema.set("toObject", { virtuals: true });

// const Entreprise = mongoose.model("Entreprise", entrepriseSchema);

// export default Entreprise;

import mongoose from "mongoose";
import path from "path";

// Chemins pilotables par variables d'environnement (bascule dev/prod AUTOMATIQUE) :
//  - en dev (Windows)  : NE PAS définir DBF_BASE_PATH / RCOMMON_COLLECT_PATH
//                        -> les valeurs UNC stockées en base sont utilisées.
//  - en prod (Ubuntu)  : DBF_BASE_PATH=/mnt/bases
//                        RCOMMON_COLLECT_PATH=/mnt/rcommun/STOCK/collect_sec
//    -> les getters ci-dessous renvoient ces chemins quelle que soit la valeur
//       stockée, donc AUCUNE migration des entreprises en base n'est nécessaire.
const DEFAULT_BASE = "\\\\serveur\\Bases";
const DEFAULT_COLLECT = "\\\\192.168.0.250\\Rcommun\\STOCK\\collect_sec";

const entrepriseSchema = new mongoose.Schema(
  {
    nomDossierDBF: {
      type: String,
      required: [true, "Nom du dossier DBF requis"],
      unique: true,
      trim: true,
    },
    trigramme: {
      type: String,
      required: [true, "Trigramme requis"],
      unique: true,
      uppercase: true,
      trim: true,
      minlength: [2, "Trigramme minimum 2 caractères"],
      maxlength: [5, "Trigramme maximum 5 caractères"],
    },
    nomComplet: {
      type: String,
      required: [true, "Nom complet requis"],
      trim: true,
    },
    description: {
      type: String,
      default: "",
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    // Chemin vers le dossier DBF.
    // En prod, DBF_BASE_PATH (ex: /mnt/bases via SSHFS) prime sur la valeur stockée
    // => bascule automatique dev (UNC) / prod (montage) SANS toucher aux contrôleurs.
    cheminBase: {
      type: String,
      default: DEFAULT_BASE,
      get: (v) => process.env.DBF_BASE_PATH || v,
    },
    // Chemin vers le dossier des photos articles
    cheminPhotos: {
      type: String,
      default: "",
    },
    // Chemin d'export des fichiers inventaire (.dat) — Rcommun.
    // En prod, RCOMMON_COLLECT_PATH prime sur la valeur stockée (bascule auto).
    cheminExportInventaire: {
      type: String,
      default: DEFAULT_COLLECT,
      get: (v) => process.env.RCOMMON_COLLECT_PATH || v,
    },
    // Mapping des noms d'entrepôts (S1, S2, S3, S4, S5)
    mappingEntrepots: {
      S1: { type: String, default: "Magasin" },
      S2: { type: String, default: "S2" },
      S3: { type: String, default: "S3" },
      S4: { type: String, default: "S4" },
      S5: { type: String, default: "S5" },
    },
    // Mapping des états de commande (personnalisable par entreprise)
    mappingEtatsCommande: {
      type: Map,
      of: String,
      default: () =>
        new Map([
          ["0", "Brouillon"],
          ["1", "A Préparer"],
          ["2", "Proforma"],
          ["3", "Reliquat"],
          ["4", "Envoyée"],
          ["5", "Confirmée"],
          ["6", "Transit"],
          ["7", "Bateau"],
          ["8", "Avion"],
          ["9", "Commande locale"],
        ]),
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  {
    timestamps: true,
  },
);

// Virtuel: chemin complet vers le dossier DBF.
// path.join => séparateur correct selon l'OS (\ sous Windows, / sous Linux).
entrepriseSchema.virtual("cheminComplet").get(function () {
  return path.join(this.cheminBase || "", this.nomDossierDBF || "");
});

// Inclure les virtuels dans JSON
entrepriseSchema.set("toJSON", { virtuals: true });
entrepriseSchema.set("toObject", { virtuals: true });

const Entreprise = mongoose.model("Entreprise", entrepriseSchema);

export default Entreprise;