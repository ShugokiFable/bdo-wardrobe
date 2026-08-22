// Cleanup pass over AOG-expanded catalog:
//  1) strip weapon suffixes (" with Blade & Horn Bow") from AOG-added names
//  2) drop underwear/accessory captions
//  3) drop entries whose cleaned class-scoped slug collides with a pre-existing
//     (non-AOG) outfit — the older entry wins (it carries boxes/images)
// Re-ids renamed entries when free. Idempotent.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { slugify } from '../lib/catalog.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const p = path.join(here, '../data/catalog.json');
const catalog = JSON.parse(readFileSync(p, 'utf8'));

const DROP_RE = /underwear|piercing|earring|ear cuff|glasses|eyepatch|whiskers|lapel pin/i;

function cleanName(n) {
  let s = String(n);
  s = s.replace(/\s+with\s+[^,]*$/i, '');          // "Premium Set with Blade & Horn Bow"
  s = s.replace(/\s{2,}/g, ' ').trim();
  return s;
}

const outfits = catalog.outfits;
const takenByClass = new Map(); // clsSlug -> Set(slug)
for (const o of outfits) {
  if (o.addedFrom === 'aog-census') continue;
  const c = slugify(o.className);
  if (!takenByClass.has(c)) takenByClass.set(c, new Set());
  takenByClass.get(c).add(slugify(o.name));
}

let dropped = 0, renamed = 0, collided = 0;
const kept = [];
const seenIds = new Set();
for (const o of outfits) {
  if (o.addedFrom !== 'aog-census') { seenIds.add(o.id); kept.push(o); continue; }
  const cleaned = cleanName(o.name);
  if (!cleaned || DROP_RE.test(cleaned)) { dropped++; continue; }
  const cls = slugify(o.className);
  let slug = slugify(cleaned);
  if (!slug) { dropped++; continue; }
  const pre = takenByClass.get(cls);
  if (pre && pre.has(slug)) { collided++; continue; }         // old entry wins
  if (takenByClass.has(cls)) takenByClass.get(cls).add(slug); else takenByClass.set(cls, new Set([slug]));
  const id = `${cls}--${slug}`;
  if (id !== o.id && !seenIds.has(id)) { o.id = id; renamed++; }
  else if (seenIds.has(id)) { collided++; continue; }
  o.name = cleaned;
  seenIds.add(o.id);
  kept.push(o);
}
catalog.outfits = kept;
writeFileSync(p, JSON.stringify(catalog));
console.log(`outfits now: ${kept.length} | dropped ${dropped} | collided ${collided} | re-id ${renamed}`);
console.log('agent:', kept.filter(o => o.className === 'Agent').map(o => o.name).join(' | ') || '(none)');
