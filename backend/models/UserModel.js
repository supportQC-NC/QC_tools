import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { genererEanInterne } from "../utils/ean13.js";

const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: [true, "Email requis"],
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: [true, "Mot de passe requis"],
      minlength: 6,
      select: false,
    },
    nom: {
      type: String,
      required: [true, "Nom requis"],
      trim: true,
    },
    prenom: {
      type: String,
      required: [true, "Prénom requis"],
      trim: true,
    },
    // Rôles :
    //  - "admin"       : tous les modules, scopé à ses sociétés (super-admin si allEntreprises).
    //  - "responsable" : comme un "user" (grants explicites) + gère une/plusieurs équipes
    //                    (voir TeamModel). Peut créer/gérer des membres avec des permissions
    //                    ATTÉNUÉES (⊆ les siennes). Voir accessControl.js.
    //  - "user"        : membre, grants explicites uniquement.
    role: {
      type: String,
      enum: ["admin", "responsable", "user"],
      default: "user",
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    lastLogin: {
      type: Date,
      default: null,
    },
    // Notifications sidebar : horodatage de la DERNIÈRE consultation par surface.
    // « Non lu » = éléments créés après ce marqueur (voir notificationController).
    chatSeenAt: {
      type: Date,
      default: null,
    },
    tasksSeenAt: {
      type: Date,
      default: null,
    },
    // Présence : horodatage de la dernière déconnexion socket (« vu il y a X »).
    // Le statut en ligne/absent/occupé est géré EN MÉMOIRE côté socket (transitoire).
    lastSeenAt: {
      type: Date,
      default: null,
    },
    // Photo de profil (optionnelle) : id GridFS (bucket "avatars"). Le binaire
    // n'est jamais renvoyé dans le JSON ; on sert l'image via GET /api/users/:id/photo.
    photo: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    photoUpdatedAt: {
      type: Date,
      default: null,
    },
    // ── Badge de l'utilisateur ────────────────────────────────────────────
    // EAN-13 interne (préfixe « 2 »), déterministe, dérivé de l'_id : il ne
    // change jamais et se régénère à l'identique si besoin. Sert à DÉSIGNER la
    // personne par un bip — au coupon d'inventaire, on bipe son badge au lieu
    // de la chercher dans une liste déroulante.
    // `sparse` : les comptes créés avant cette fonctionnalité n'ont pas encore
    // de code ; sans lui, l'index unique les ferait tous entrer en collision
    // sur la valeur absente.
    codeBarre: {
      type: String,
      trim: true,
      index: { unique: true, sparse: true },
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    resetPasswordToken: {
      type: String,
      default: null,
    },
    resetPasswordExpire: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

// Hash password avant save
userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  const salt = await bcrypt.genSalt(12);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Badge : généré à la création, jamais réécrit ensuite.
// ⚠️ Hook SÉPARÉ de celui du mot de passe : celui-ci sort tôt
// (`isModified("password")`), et y greffer la génération la sauterait à chaque
// enregistrement qui ne touche pas au mot de passe — c'est-à-dire presque tous.
// `_id` est disponible ici : Mongoose l'attribue avant le pre-save.
userSchema.pre("save", function (next) {
  if (!this.codeBarre) {
    this.codeBarre = genererEanInterne(`user|${this._id}`);
  }
  next();
});

// Comparer les mots de passe
userSchema.methods.comparePassword = async function (candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Générer un token de reset (valable 30 min)
userSchema.methods.getResetPasswordToken = function () {
  const resetToken = crypto.randomBytes(32).toString("hex");
  this.resetPasswordToken = crypto
    .createHash("sha256")
    .update(resetToken)
    .digest("hex");
  this.resetPasswordExpire = Date.now() + 30 * 60 * 1000;
  return resetToken;
};

// Retirer les champs sensibles du JSON
userSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.password;
  delete obj.resetPasswordToken;
  delete obj.resetPasswordExpire;
  return obj;
};

const User = mongoose.model("User", userSchema);

export default User;