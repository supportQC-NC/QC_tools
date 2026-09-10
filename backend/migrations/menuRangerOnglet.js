// backend/migrations/menuRangerOnglet.js
//
// Range un onglet dans un dossier du menu DÉJÀ ENREGISTRÉ (global + menus
// personnels). Sans ça, un écran ajouté après coup n'apparaît qu'en
// « Non classé » chez les instances qui ont enregistré leur organisation —
// le défaut du code ne s'applique qu'aux menus jamais personnalisés.
//
//   node backend/migrations/menuRangerOnglet.js <path> <dossier> [--apres=<path>] [--dry]
//
// Mode retrait (écran supprimé de l'application) — le dossier n'est pas requis,
// et un dossier laissé vide disparaît :
//   node backend/migrations/menuRangerOnglet.js <path> --retirer [--dry]
//
// <dossier> est cherché sur le LIBELLÉ du dossier (insensible à la casse et aux
// accents), puis sur sa clé. Sans effet si l'onglet est déjà rangé quelque part :
// on ne déplace jamais ce que l'utilisateur a rangé lui-même.
import "../loadEnv.js";
import mongoose from "mongoose";
import MenuLayout from "../models/MenuLayoutModel.js";
import UserMenuLayout from "../models/UserMenuLayoutModel.js";

const args = process.argv.slice(2);
const DRY = args.includes("--dry");
const apresArg = args.find((a) => a.startsWith("--apres="));
const APRES = apresArg ? apresArg.split("=")[1] : "";
const RETIRER = args.includes("--retirer");
const [PATH, DOSSIER] = args.filter((a) => !a.startsWith("--"));

if (!PATH || (!DOSSIER && !RETIRER)) {
  console.error(
    "Usage : node backend/migrations/menuRangerOnglet.js <path> <dossier> [--apres=<path>] [--dry]",
  );
  process.exit(1);
}

const norm = (v) =>
  (v || "")
    .toString()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

// Retrait d'un onglet : on le sort de tous les dossiers, et un dossier qui se
// retrouve vide est supprimé — sinon le constructeur de menu affiche une carte
// vide que personne ne comprend.
const retirer = (chapitres) => {
  const actions = [];
  (chapitres || []).forEach((c) => {
    if (!(c.items || []).includes(PATH)) return;
    c.items = c.items.filter((p) => p !== PATH);
    actions.push(`« ${c.label} » : retrait de ${PATH}`);
  });
  const vides = (chapitres || []).filter(
    (c) =>
      (c.items || []).length === 0 &&
      !(chapitres || []).some((x) => x.parent === c.key),
  );
  vides.forEach((c) => {
    const i = chapitres.indexOf(c);
    if (i >= 0) {
      chapitres.splice(i, 1);
      actions.push(`« ${c.label} » : dossier vide supprimé`);
    }
  });
  return actions.length ? actions.join(" · ") : null;
};

const corriger = (chapitres) => {
  if (RETIRER) return retirer(chapitres);
  const dejaRange = (chapitres || []).some((c) => (c.items || []).includes(PATH));
  if (dejaRange) return null;
  const cible = (chapitres || []).find(
    (c) => norm(c.label) === norm(DOSSIER) || norm(c.key) === norm(DOSSIER),
  );
  if (!cible) return `dossier « ${DOSSIER} » introuvable`;
  const i = APRES ? cible.items.indexOf(APRES) : -1;
  cible.items.splice(i >= 0 ? i + 1 : cible.items.length, 0, PATH);
  return `« ${cible.label} » : ajout de ${PATH}`;
};

const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
await mongoose.connect(uri);
console.log(DRY ? "— SIMULATION (--dry) —" : "— Migration —");

const global = await MenuLayout.findOne({ scope: "default" });
if (!global) {
  console.log("Menu global : aucun document (c'est le défaut du code qui sert).");
} else {
  const action = corriger(global.chapitres);
  if (!action) console.log("Menu global : rien à faire.");
  else {
    console.log("  Menu global →", action);
    if (!DRY && !action.startsWith("dossier")) {
      global.markModified("chapitres");
      await global.save();
      console.log("Menu global : enregistré.");
    }
  }
}

// Menus personnels : on ne range QUE chez ceux qui ont le dossier visé, et on
// ne touche pas à ceux qui ont déjà rangé l'onglet à leur façon.
const persos = await UserMenuLayout.find({});
let modifies = 0;
for (const doc of persos) {
  const action = corriger(doc.chapitres);
  if (!action || action.startsWith("dossier")) continue;
  modifies += 1;
  console.log(`  Menu perso ${doc.user} →`, action);
  if (!DRY) {
    doc.markModified("chapitres");
    // eslint-disable-next-line no-await-in-loop
    await doc.save();
  }
}
console.log(`Menus personnels : ${persos.length} examiné(s), ${modifies} corrigé(s).`);

await mongoose.disconnect();
console.log("Terminé.");
process.exit(0);
