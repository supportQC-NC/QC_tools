import fs from "fs";
const root = "\\\\192.168.0.250\\Rcommun\\STOCK";
console.log("root existe ?", fs.existsSync(root));
const all = fs.readdirSync(root, { withFileTypes: true });
console.log("total entrées:", all.length);
console.log("dossiers:");
for (const d of all) if (d.isDirectory()) console.log("  ", JSON.stringify(d.name));
