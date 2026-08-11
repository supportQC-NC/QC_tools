// backend/scripts/apiKeys.js
//
// Gestion des clés d'API partenaire en ligne de commande.
// Il n'y a volontairement PAS d'écran d'administration : une clé se crée une
// fois, se transmet de main à main, et se révoque. Un CLI évite d'exposer une
// surface d'attaque supplémentaire dans l'application web.
//
// Usage (depuis la racine du dépôt) :
//
//   npm run apikey:list
//
//   npm run apikey:create -- --nom "Site marchand SITEC" \
//                            --societes sitec \
//                            --scopes articles:read,clients:read \
//                            [--limite 120] [--expire 2027-12-31] \
//                            [--ips 203.0.113.10,203.0.113.11] \
//                            [--exclure-clients LOGIN,INTPASS] \
//                            [--exclure-articles PACHAT]
//
//   npm run apikey:revoke -- --prefixe qcapi_XXXXXXXXXXXX
//   npm run apikey:activate -- --prefixe qcapi_XXXXXXXXXXXX
//
// La clé en clair n'est affichée QU'UNE SEULE FOIS, à la création.

import "../loadEnv.js";
import mongoose from "mongoose";
import connectDB from "../config/db.js";
import ApiKey, { SCOPES_API } from "../models/ApiKeyModel.js";
import Entreprise from "../models/EntrepriseModel.js";

// --- Analyse des arguments : --cle valeur -----------------------------------
const parserArgs = (argv) => {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue;
    const cle = argv[i].slice(2);
    const suivant = argv[i + 1];
    args[cle] = suivant && !suivant.startsWith("--") ? suivant : true;
    if (args[cle] !== true) i++;
  }
  return args;
};

const liste = (v) =>
  typeof v === "string"
    ? v.split(",").map((s) => s.trim()).filter(Boolean)
    : [];

const terminer = async (code = 0) => {
  await mongoose.connection.close();
  process.exit(code);
};

const echec = async (message) => {
  console.error(`\n❌ ${message}\n`);
  await terminer(1);
};

// --- Commandes --------------------------------------------------------------

const creer = async (args) => {
  const nom = typeof args.nom === "string" ? args.nom.trim() : "";
  if (!nom) await echec("--nom est obligatoire");

  const dossiers = liste(args.societes);
  if (!dossiers.length)
    await echec(
      "--societes est obligatoire (nomDossierDBF, séparés par des virgules)",
    );

  const entreprises = await Entreprise.find({
    nomDossierDBF: { $in: dossiers },
  });
  const trouves = entreprises.map((e) => e.nomDossierDBF);
  const manquants = dossiers.filter((d) => !trouves.includes(d));
  if (manquants.length)
    await echec(`Société(s) inconnue(s) : ${manquants.join(", ")}`);

  const scopes = liste(args.scopes);
  if (!scopes.length) await echec(`--scopes est obligatoire (${SCOPES_API.join(", ")})`);
  const scopesInvalides = scopes.filter((s) => !SCOPES_API.includes(s));
  if (scopesInvalides.length)
    await echec(
      `Scope(s) inconnu(s) : ${scopesInvalides.join(", ")}. Valeurs possibles : ${SCOPES_API.join(", ")}`,
    );

  let expireLe = null;
  if (typeof args.expire === "string") {
    expireLe = new Date(args.expire);
    if (Number.isNaN(expireLe.getTime()))
      await echec("--expire doit être une date valide (AAAA-MM-JJ)");
  }

  const { cle, prefixe, hash } = ApiKey.genererCle();

  const doc = await ApiKey.create({
    nom,
    prefixe,
    hash,
    entreprises: entreprises.map((e) => e._id),
    scopes,
    champsExclus: {
      article: liste(args["exclure-articles"]).map((c) => c.toUpperCase()),
      clients: liste(args["exclure-clients"]).map((c) => c.toUpperCase()),
    },
    ipsAutorisees: liste(args.ips),
    limiteParMinute: args.limite ? parseInt(args.limite, 10) : 120,
    expireLe,
    notes: typeof args.notes === "string" ? args.notes : "",
  });

  console.log("\n✅ Clé d'API créée\n");
  console.log(`  Nom              : ${doc.nom}`);
  console.log(`  Préfixe (public) : ${doc.prefixe}`);
  console.log(`  Sociétés         : ${trouves.join(", ")}`);
  console.log(`  Scopes           : ${doc.scopes.join(", ")}`);
  console.log(`  Quota            : ${doc.limiteParMinute} req/min`);
  console.log(
    `  IP autorisées    : ${doc.ipsAutorisees.length ? doc.ipsAutorisees.join(", ") : "toutes"}`,
  );
  console.log(
    `  Expiration       : ${doc.expireLe ? doc.expireLe.toISOString().slice(0, 10) : "aucune"}`,
  );
  const exclus = [
    ...doc.champsExclus.article.map((c) => `article.${c}`),
    ...doc.champsExclus.clients.map((c) => `clients.${c}`),
  ];
  console.log(`  Champs exclus    : ${exclus.length ? exclus.join(", ") : "aucun (tous les champs sont exposés)"}`);
  console.log("\n────────────────────────────────────────────────────────────");
  console.log("  CLÉ SECRÈTE (affichée une seule fois, à transmettre) :\n");
  console.log(`  ${cle}`);
  console.log("────────────────────────────────────────────────────────────\n");
  console.log("Test rapide :");
  console.log(
    `  curl -H "X-API-Key: ${cle}" https://robot-nc.com/api/public/v1/ping\n`,
  );
};

const lister = async () => {
  const cles = await ApiKey.find().populate("entreprises", "nomDossierDBF").sort({ createdAt: -1 });
  if (!cles.length) {
    console.log("\nAucune clé d'API enregistrée.\n");
    return;
  }
  console.log(`\n${cles.length} clé(s) d'API :\n`);
  for (const c of cles) {
    const etat = !c.actif
      ? "RÉVOQUÉE"
      : c.expireLe && c.expireLe < new Date()
        ? "EXPIRÉE"
        : "active";
    console.log(`  [${etat}] ${c.nom}`);
    console.log(`     préfixe   : ${c.prefixe}`);
    console.log(
      `     sociétés  : ${c.entreprises.map((e) => e.nomDossierDBF).join(", ") || "—"}`,
    );
    console.log(`     scopes    : ${c.scopes.join(", ") || "—"}`);
    console.log(
      `     usage     : ${c.nbAppels} appels · dernier ${
        c.derniereUtilisation ? c.derniereUtilisation.toISOString() : "jamais"
      }${c.derniereIp ? ` depuis ${c.derniereIp}` : ""}`,
    );
    console.log("");
  }
};

const basculer = async (args, actif) => {
  const prefixe = typeof args.prefixe === "string" ? args.prefixe.trim() : "";
  if (!prefixe) await echec("--prefixe est obligatoire");
  const doc = await ApiKey.findOneAndUpdate(
    { prefixe },
    { actif },
    { new: true },
  );
  if (!doc) await echec(`Aucune clé avec le préfixe ${prefixe}`);
  console.log(
    `\n✅ Clé « ${doc.nom} » (${doc.prefixe}) ${actif ? "réactivée" : "révoquée"}.\n`,
  );
};

// --- Point d'entrée ---------------------------------------------------------

const commande = process.argv[2];
const args = parserArgs(process.argv.slice(3));

await connectDB();

switch (commande) {
  case "create":
    await creer(args);
    break;
  case "list":
    await lister();
    break;
  case "revoke":
    await basculer(args, false);
    break;
  case "activate":
    await basculer(args, true);
    break;
  default:
    console.log(`
Commandes disponibles :
  create    --nom "..." --societes sitec --scopes articles:read,clients:read
            [--limite 120] [--expire AAAA-MM-JJ] [--ips a,b]
            [--exclure-clients LOGIN,INTPASS] [--exclure-articles PACHAT]
  list
  revoke    --prefixe qcapi_XXXXXXXXXXXX
  activate  --prefixe qcapi_XXXXXXXXXXXX
`);
}

await terminer(0);
