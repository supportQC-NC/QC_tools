import { DBFFile } from 'dbffile';
import fs from 'fs';
import svc from '../backend/services/articleService.js';
const cible = '88381570091';
const socs = fs.readdirSync('//192.168.0.250/Bases').filter(f => fs.existsSync(`//192.168.0.250/Bases/${f}/article.dbf`));
for (const soc of socs) {
  const d = await DBFFile.open(`//192.168.0.250/Bases/${soc}/article.dbf`, { readMode:'loose' });
  const recs = await d.readRecords(400000);
  const hits = recs.filter(r => String(r.GENCOD ?? '').replace(/^0+/,'').trim() === cible);
  if (!hits.length) continue;
  const cache = svc.createCacheEntry(recs, { lastModified: 0 });
  for (const h of hits) {
    console.log(`${soc} : NART ${String(h.NART).trim()} GENCOD "${String(h.GENCOD).trim()}" (${String(h.GENCOD).trim().length} car.) ${String(h.DESIGN??'').trim().slice(0,30)}`);
  }
  for (const scan of ['0088381570091','088381570091','88381570091']) {
    const iG = svc.lookupGencod(cache, scan);
    const exact = cache.indexByGencod.get(scan);
    console.log(`   scan "${scan.padEnd(13)}" → AVANT ${exact!==undefined?'OK':'INCONNU'} | APRÈS ${iG!==undefined? 'OK ('+String(cache.records[iG].NART).trim()+')':'INCONNU'}`);
  }
}
