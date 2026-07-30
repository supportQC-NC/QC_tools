// backend/models/PreparationModel.js
import mongoose from "mongoose";

/**
 * Module « Préparation de commande » (à partir d'une proforma, état 2).
 *
 * Principe :
 *  - une proforma (proforma.dbf / prodet.dbf) est analysée ligne par ligne ;
 *  - chaque quantité est répartie entre DOCK (stock S2) et MAGASIN (stock S1) :
 *      qteDock = (S2 > 0) ? min(qteCommandée, S2) : 0
 *      qteMagasin = qteCommandée - qteDock
 *  - le DOCK est préparé en premier (ordre de la proforma / NL) ;
 *  - le MAGASIN ensuite, trié par gisement (GISM1 -> priorité du fichier Excel),
 *    les articles sans gisement étant renvoyés en fin (famille/fournisseur/désignation) ;
 *  - contrôle par lecture du gencode (résolution GENDOUBL identique au scan) ;
 *  - reliquats dock -> magasin recalculés ;
 *  - à la fin : rapport PDF (STOCK/prepa_cde) + email, et fichier de transfert de
 *    stock (quantités prélevées au dock) déposé dans collect_sec.
 *
 * Toutes les données vivent en Mongo (aucune écriture DBF).
 */

// Snapshot + suivi d'une ligne d'article à préparer.
const lignePrepaSchema = new mongoose.Schema(
  {
    // Position dans la proforma (prodet.NL) — sert aussi d'ordre dock.
    nl: { type: Number, default: 0 },

    // Identité article (snapshot).
    nart: { type: String, default: "" },
    designation: { type: String, default: "" },
    refer: { type: String, default: "" }, // référence fournisseur
    fourn: { type: Number, default: null },
    fournisseurNom: { type: String, default: "" },
    gencod: { type: String, default: "" }, // gencode principal (fiche article)
    gencodes: { type: [String], default: [] }, // tous les gencodes possibles (renvois inclus) — CDC §5/§8
    gism1: { type: String, default: "" }, // gisement (fiche article, champ GISM1)
    pvttc: { type: Number, default: 0 }, // prix TTC (prodet.PVTTC) — aide à l'identification

    // Quantité demandée sur la proforma (prodet.QTE).
    qteCommandee: { type: Number, default: 0 },

    // Stocks au moment de l'analyse.
    stockDock: { type: Number, default: 0 }, // S2
    stockMagasin: { type: Number, default: 0 }, // S1

    // Répartition calculée à l'analyse.
    qteDockAPreparer: { type: Number, default: 0 },
    qteMagasinAPreparer: { type: Number, default: 0 },

    // Quantités réellement préparées.
    qtePrepareeDock: { type: Number, default: 0 },
    qtePrepareeMagasin: { type: Number, default: 0 },

    // Gencodes bipés (traçabilité / rapport : « gencode bipé »).
    gencodeBipeDock: { type: String, default: "" },
    gencodeBipeMagasin: { type: String, default: "" },

    // Gisement (Excel <TRIG>_gissement.xlsx, lookup par GISM1 = GisementSTOCKXL) :
    //   rayon = LIBELLÉ affiché à l'opérateur ; priorite = ordre de parcours MAGASIN.
    rayon: { type: String, default: "" }, // libellé du gisement (affichage)
    sousRayon: { type: String, default: "" }, // étagère (Excel gisements, colonne SOUS-RAYON)
    priorite: { type: Number, default: null },
    aGisement: { type: Boolean, default: false }, // GISM1 présent ET trouvé dans l'Excel

    // Ordres de parcours (null si la ligne n'a pas de part dans cette phase).
    ordreDock: { type: Number, default: null },
    ordreMagasin: { type: Number, default: null },

    // Statuts de préparation par phase.
    statutDock: {
      type: String,
      enum: ["a_faire", "prepare", "introuvable"],
      default: "a_faire",
    },
    statutMagasin: {
      type: String,
      enum: ["a_faire", "prepare", "introuvable"],
      default: "a_faire",
    },

    // Déclaré introuvable au contrôle final.
    introuvable: { type: Boolean, default: false },

    // Quantité RETENUE si correction au contrôle final (sur-préparation).
    // null = pas de correction ; sinon remplace le total préparé dans le rapport.
    qteRetenue: { type: Number, default: null },
  },
  { _id: true },
);

const preparationSchema = new mongoose.Schema(
  {
    entreprise: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Entreprise",
      required: true,
    },
    nomDossierDBF: { type: String, required: true },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    // Proforma préparée (proforma.NUMFACT).
    numpro: { type: String, required: true, trim: true },

    // Origine de la sélection : proforma (ETAT 2) ou réservation (ETAT < 2).
    type: {
      type: String,
      enum: ["proforma", "reservation"],
      default: "proforma",
    },

    // Snapshot de l'entête proforma.
    proformaInfo: {
      numfact: { type: String, default: "" },
      clientNom: { type: String, default: "" }, // proforma.NOM
      clientCode: { type: Number, default: null }, // proforma.TIERS
      datfact: { type: Date, default: null },
      etat: { type: Number, default: null },
      mailings: { type: [String], default: [] }, // MAILING1-5 (non vides)
    },

    lignes: [lignePrepaSchema],

    // Étape de préparation.
    phase: {
      type: String,
      enum: ["dock", "magasin", "final"],
      default: "dock",
    },
    status: {
      type: String,
      enum: ["en_cours", "termine"],
      default: "en_cours",
    },

    commentaire: { type: String, default: "" },

    // Colisage saisi en fin de préparation (CDC §12) : nombre de colis, de
    // palettes et de longueurs. Sert à générer une feuille de colisage par unité.
    colisage: {
      nbColis: { type: Number, default: 0 },
      nbPalettes: { type: Number, default: 0 },
      nbLongueurs: { type: Number, default: 0 },
    },

    // Rapport PDF (§11 du CDC).
    rapport: {
      fileName: { type: String, default: "" },
      filePath: { type: String, default: "" },
      generatedAt: { type: Date, default: null },
      emailTo: { type: [String], default: [] },
      emailSentAt: { type: Date, default: null },
      emailError: { type: String, default: "" },
    },

    // Feuilles de colisage générées (une par colis / palette / longueur) (§13).
    feuillesColisage: [
      {
        libelle: { type: String, default: "" }, // ex. « Colis 1 / 3 »
        fileName: { type: String, default: "" },
        filePath: { type: String, default: "" },
        generatedAt: { type: Date, default: null },
      },
    ],

    // Fichier de transfert de stock (dock) déposé dans collect_sec (§12).
    fichierTransfert: {
      fileName: { type: String, default: "" },
      filePath: { type: String, default: "" },
      generatedAt: { type: Date, default: null },
    },

    preparationDebutAt: { type: Date, default: Date.now },
    preparationFinAt: { type: Date, default: null },
  },
  { timestamps: true },
);

preparationSchema.index({ entreprise: 1, user: 1, status: 1 });
preparationSchema.index({ entreprise: 1, user: 1, numpro: 1, status: 1 });

const Preparation = mongoose.model("Preparation", preparationSchema);

export default Preparation;