// Add the official [Agent] outfit roster (from the July 30 2026 launch post)
// to the catalog. Idempotent by class-scoped slug.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { slugify } from '../lib/catalog.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const p = path.join(here, '../data/catalog.json');
const catalog = JSON.parse(readFileSync(p, 'utf8'));

const AGENT_OUTFITS = [
  ['Hexround Reaper', 'classic'],
  ['Citrus', 'premium'],
  ["Lookin' Frosh", 'premium'],
  ['Rookies', 'premium'],
  ['Outlaws of Margoria', 'premium'],
  ['Corvicanus Robe', 'premium'],
  ['Mr. Mussels', 'premium'],
  ['Clocked In', 'premium'],
  ['Desert Camouflage Premium Set', 'premium'],
  ['Treant Camouflage Premium Set', 'premium'],
  ['BD9 Outfit Set', 'premium'],
];

const have = new Set(catalog.outfits.filter(o => o.className === 'Agent').map(o => slugify(o.name)));
let added = 0;
for (const [name, rarity] of AGENT_OUTFITS) {
  const slug = slugify(name);
  if (have.has(slug)) continue;
  catalog.outfits.push({
    id: `agent--${slug}`,
    name,
    className: 'Agent',
    rarity,
    boxes: [],
    sources: [{ provider: 'pearl-shop-announcement', ref: 'groupContentNo=10399' }],
    addedFrom: 'agent-launch-post',
  });
  have.add(slug);
  added++;
}
writeFileSync(p, JSON.stringify(catalog));
console.log(`added ${added} Agent outfits; agent total: ${catalog.outfits.filter(o => o.className === 'Agent').length}`);
console.log(catalog.outfits.filter(o => o.className === 'Agent').map(o => o.name).join(' | '));
