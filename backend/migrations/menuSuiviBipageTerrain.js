// backend/migrations/menuSuiviBipageTerrain.js
//
// Migration ponctuelle (10/09/2026) — remet chaque « suivi bipage » à sa place
// dans les menus DÉJÀ ENREGISTRÉS.
//
// Contexte : le dossier « Terrain ▸ Bipage » a d'abord été livré avec
// `/admin/suivi-bipage`, qui suit en réalité le comptage d'INVENTAIRE par zone
// (LigneBipage, vidé à chaque réinitialisation d'inventaire) — rien à voir avec
// les demandes envoyées aux collecteurs. L'écran dédié au bipage terrain est
// `/admin/suivi-demandes-bipage`.
//
// Ce que fait la migration, sur le menu global ET sur les menus personnels :
//   1. retire de tout dossier « Terrain » les écrans d'INVENTAIRE qui y étaient
//      partis par erreur (`/admin/suivi-bipage`, `/admin/bipages`) ;
//   2. les remet dans le dossier d'inventaire (« Inventaire Zones ») ;
//   3. met `/admin/suivi-demandes-bipage` à sa place dans Terrain ▸ Bipage.
//
// Sans effet si le menu est déjà correct : elle peut être relancée sans risque.
// `--dry` affiche ce qui serait fait sans rien écrire.
import "../loadEnv.js";
import mongoose from "mongoose";
import MenuLayout from "../models/MenuLayoutModel.js";
import UserMenuLayout from "../models/UserMenuLayoutModel.js";

// Écrans d'INVENTAIRE partis par erreur dans le dossier Terrain : ils suivent
// le comptage par zone et se vident à chaque réinitialisation d'inventaire.
const ECRANS_INVENTAIRE = ["/admin/suivi-bipage", "/admin/bipages"];
const SUIVI_TERRAIN = "/admin/suivi-demandes-bipage";

const DRY = process.argv.includes("--dry");

// Un dossier « de terrain » = celui qui porte les demandes de bipage, ou tout
// dossier rattaché à un parent dont la clé commence par « terrain ».
const estDossierBipageTerrain = (ch, parKey) => {
  if ((ch.items || []).includes("/admin/demandes-bipage")) return true;
  const parent = ch.parent ? parKey.get(ch.parent) : null;
  return !!parent && /terrain/i.test(parent.key || "");
};

// Dossier d'inventaire d'accueil : celui qui porte déjà les écrans d'inventaire.
const estDossierInventaire = (ch) =>
  (ch.items || []).some((p) =>
    ["/admin/zones", "/admin/recap-zones", "/admin/inventaire-progression"].includes(p),
  ) || /inventaire/i.test(ch.label || "");

const corriger = (chapitres) => {
  const parKey = new Map((chapitres || []).map((c) => [c.key, c]));
  const actions = [];

  const dossiersTerrain = (chapitres || []).filter((ch) =>
    estDossierBipageTerrain(ch, parKey),
  );

  // 1. Retrait des écrans d'inventaire des dossiers terrain.
  const retires = new Set();
  dossiersTerrain.forEach((ch) => {
    ECRANS_INVENTAIRE.forEach((path) => {
      if ((ch.items || []).includes(path)) {
        ch.items = ch.items.filter((p) => p !== path);
        retires.add(path);
        actions.push(`« ${ch.label} » : retrait de ${path}`);
      }
    });
  });

  // 2. Le suivi terrain prend sa place (s'il n'est rangé nulle part).
  const dejaRange = (chapitres || []).some((ch) =>
    (ch.items || []).includes(SUIVI_TERRAIN),
  );
  if (!dejaRange && dossiersTerrain.length) {
    const cible =
      dossiersTerrain.find((ch) =>
        (ch.items || []).includes("/admin/demandes-bipage"),
      ) || dossiersTerrain[0];
    const i = cible.items.indexOf("/admin/demandes-bipage");
    cible.items.splice(i >= 0 ? i + 1 : cible.items.length, 0, SUIVI_TERRAIN);
    actions.push(`« ${cible.label} » : ajout de ${SUIVI_TERRAIN}`);
  }

  // 3. Les écrans d'inventaire retournent dans le dossier d'inventaire.
  retires.forEach((path) => {
    const encoreRange = (chapitres || []).some((ch) =>
      (ch.items || []).includes(path),
    );
    if (encoreRange) return;
    const inv = (chapitres || []).find(estDossierInventaire);
    if (inv) {
      const i = inv.items.indexOf("/admin/recap-zones");
      inv.items.splice(i >= 0 ? i + 1 : inv.items.length, 0, path);
      actions.push(`« ${inv.label} » : ${path} remis`);
    } else {
      // Aucun dossier d'inventaire : mieux vaut le laisser tomber en « Non
      // classé » (il reste atteignable) que de le ranger dans un dossier faux.
      actions.push(`aucun dossier d'inventaire trouvé — ${path} passe en « Non classé »`);
    }
  });

  return actions;
};

const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
if (!uri) {
  console.error("MONGO_URI manquant dans .env");
  process.exit(1);
}

await mongoose.connect(uri);
console.log(DRY ? "— SIMULATION (--dry), aucune écriture —" : "— Migration —");

// Menu global
const global = await MenuLayout.findOne({ scope: "default" });
if (!global) {
  console.log("Menu global : aucun document (c'est le défaut du code qui sert).");
} else {
  const actions = corriger(global.chapitres);
  if (actions.length === 0) {
    console.log("Menu global : déjà correct.");
  } else {
    actions.forEach((a) => console.log("  Menu global →", a));
    if (!DRY) {
      global.markModified("chapitres");
      await global.save();
      console.log("Menu global : enregistré.");
    }
  }
}

// Menus personnels
const persos = await UserMenuLayout.find({});
let modifies = 0;
for (const doc of persos) {
  const actions = corriger(doc.chapitres);
  if (actions.length === 0) continue;
  modifies += 1;
  actions.forEach((a) => console.log(`  Menu perso ${doc.user} →`, a));
  if (!DRY) {
    doc.markModified("chapitres");
    // eslint-disable-next-line no-await-in-loop
    await doc.save();
  }
}
console.log(
  `Menus personnels : ${persos.length} examiné(s), ${modifies} corrigé(s).`,
);

await mongoose.disconnect();
console.log("Terminé.");
process.exit(0);
