import "../loadEnv.js";
const uri = process.env.MONGO_URI || process.env.MONGODB_URI || "";
// Masque les identifiants, ne montre que host + nom de base + options.
const masked = uri.replace(/\/\/[^@]+@/, "//***:***@");
let dbName = "(défaut)";
try {
  const m = uri.match(/mongodb(?:\+srv)?:\/\/[^/]+\/([^?]+)/i);
  if (m) dbName = decodeURIComponent(m[1]);
} catch {}
console.log("URI (masquée) :", masked);
console.log("BASE utilisée :", dbName);
