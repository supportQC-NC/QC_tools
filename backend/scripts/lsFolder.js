import fs from "fs";
import path from "path";
const dir = process.argv[2];
const rec = (d, p = 0) => {
  let out = "";
  let e = [];
  try { e = fs.readdirSync(d, { withFileTypes: true }); }
  catch (err) { return `${"  ".repeat(p)}! ${err.code || err.message}\n`; }
  for (const x of e) {
    const fp = path.join(d, x.name);
    if (x.isDirectory()) { out += `${"  ".repeat(p)}[DIR] ${x.name}/\n`; if (p < 3) out += rec(fp, p + 1); }
    else { let s = ""; try { s = ` (${fs.statSync(fp).size} o)`; } catch {} out += `${"  ".repeat(p)}      ${x.name}${s}\n`; }
  }
  return out || `${"  ".repeat(p)}(vide)\n`;
};
console.log("Existe ?", fs.existsSync(dir));
process.stdout.write(rec(dir));
