// Normalize AOG caption typo "Trent Camouflage" -> official "Treant Camouflage".
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { slugify } from '../lib/catalog.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const p = path.join(here, '../data/catalog.json');
const catalog = JSON.parse(readFileSync(p, 'utf8'));

let fixed = 0;
const ids = new Set(catalog.outfits.map(o => o.id));
for (const o of catalog.outfits) {
  if (!/^trent camouflage/i.test(o.name)) continue;
  o.name = o.name.replace(/^trent /i, 'Treant ');
  const nid = `${slugify(o.className)}--${slugify(o.name)}`;
  if (!ids.has(nid)) { ids.delete(o.id); o.id = nid; ids.add(nid); fixed++; }
}
writeFileSync(p, JSON.stringify(catalog));
console.log('renamed:', fixed);
