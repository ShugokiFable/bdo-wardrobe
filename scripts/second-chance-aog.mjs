// Second-chance AOG expansion: full-page gallery parse (no h4 section split).
// Catches captions the section-based builder missed — e.g. newer class pages
// (Dosa/Wukong/Deadeye) put "Academia Outfit Set, <Class> Outfit" captions in
// page-wide galleries. Applies the same drop/collision rules as clean pass.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchTextSafe } from '../lib/source-fetch.mjs';
import { parseAogGallery, AOG_UA } from '../lib/aog-fetch.mjs';
import { slugify, decodeHtmlEntities } from '../lib/catalog.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const INDEX_URL = 'https://altarofgaming.com/black-desert-online-outfits-costumes-accessories-underwear-skins/';
const catalogPath = path.join(here, '../data/catalog.json');
const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));

const classBySlug = new Map(catalog.classes.map(c => [slugify(c.name), c.name]));
const existingByClass = new Map();
for (const o of catalog.outfits) {
  const k = slugify(o.className);
  if (!existingByClass.has(k)) existingByClass.set(k, new Set());
  existingByClass.get(k).add(slugify(o.name));
}

const DROP_RE = /underwear|piercing|earring|ear cuff|glasses|eyepatch|whiskers|lapel pin/i;

function normalizeCaption(caption) {
  let n = String(caption).split(',')[0].trim();
  n = n.replace(/^\s*\[[^\]]*\]\s*/, '');
  n = n.replace(/\s+(Premium|Classic|Deluxe)?\s*(Outfit Set|Outfit|Costume|Set|Box|Clothing)\s*$/i, '');
  return decodeHtmlEntities(n.trim());
}

const index = await fetchTextSafe(INDEX_URL, { timeoutMs: 25000, maxBytes: 8_000_000, headers: AOG_UA });
const pageUrls = new Map();
for (const m of new Set([...index.text.matchAll(/https:\/\/altarofgaming\.com\/black-desert(?:-online)?-([a-z0-9-]+?)-outfits?[a-z-]*\/?/g)])) {
  if (classBySlug.has(m[1])) pageUrls.set(m[1], m[0].replace(/\/?$/, '/'));
}

const byId = new Map(catalog.outfits.map(o => [o.id, o]));
let appended = 0;
for (const [clsSlug, url] of pageUrls) {
  const page = await fetchTextSafe(url, { timeoutMs: 30000, maxBytes: 12_000_000, headers: AOG_UA });
  const have = existingByClass.get(clsSlug);
  const cls = classBySlug.get(clsSlug);
  let added = 0;
  for (const e of parseAogGallery(page.text)) {
    const name = normalizeCaption(e.caption);
    const s = slugify(name);
    if (!s || s.length < 3 || DROP_RE.test(name)) continue;
    if (have.has(s)) continue;
    have.add(s);
    const id = `${clsSlug}--${s}`;
    if (byId.has(id)) continue;
    byId.set(id, {
      id, name, className: cls,
      rarity: /premium/i.test(e.caption) ? 'premium' : /classic/i.test(e.caption) ? 'classic' : 'outfit',
      boxes: [], sources: ['altarofgaming'], addedFrom: 'aog-census-2',
    });
    appended++;
  }
  await new Promise(r => setTimeout(r, 350));
}
catalog.outfits = [...byId.values()];
writeFileSync(catalogPath, JSON.stringify(catalog));
console.log(`second-chance appended: ${appended} | catalog now: ${catalog.outfits.length}`);
for (const cls of ['Dosa', 'Wukong', 'Deadeye']) {
  const hit = catalog.outfits.filter(o => o.className === cls && /academia/i.test(o.name));
  console.log(cls, 'academia:', hit.map(o => o.id).join(', ') || 'STILL MISSING');
}
