// One-shot audit: crawl every AOG class page, extract captioned outfits,
// diff against the catalog per class. Writes data/aog-census.json.
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchTextSafe } from '../lib/source-fetch.mjs';
import { parseAogGallery, AOG_UA, normalizeAogName } from '../lib/aog-fetch.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const AOG_INDEX_URL = 'https://altarofgaming.com/black-desert-online-outfits-costumes-accessories-underwear-skins/';

const catalog = JSON.parse(await (await import('node:fs')).promises.readFile(path.join(here, '../data/catalog.json'), 'utf8'));
const catalogByClass = new Map();
for (const o of catalog.outfits) {
  const k = o.className.toLowerCase();
  if (!catalogByClass.has(k)) catalogByClass.set(k, new Set());
  catalogByClass.get(k).add(normalizeAogName(o.name));
}

const index = await fetchTextSafe(AOG_INDEX_URL, { timeoutMs: 25000, maxBytes: 8_000_000, headers: AOG_UA });
const byClass = new Map();
for (const m of new Set([...index.text.matchAll(/https:\/\/altarofgaming\.com\/black-desert(?:-online)?-([a-z0-9-]+?)-outfits?[a-z-]*\/?/g)])) {
  byClass.set(m[1], m[0].replace(/\/?$/, '/'));
}
console.log('class pages:', byClass.size, [...byClass.keys()].join(','));

const census = {};
for (const [slug, url] of byClass) {
  try {
    const page = await fetchTextSafe(url, { timeoutMs: 25000, maxBytes: 12_000_000, headers: AOG_UA });
    const entries = parseAogGallery(page.text);
    census[slug] = entries.map(e => ({ caption: e.caption, name: normalizeAogName(e.caption), img: e.img }));
    console.log(`${slug.padEnd(14)} ${entries.length} entries`);
    await new Promise(r => setTimeout(r, 400));
  } catch (e) {
    console.log(`${slug} FAIL ${e.message}`);
  }
}
writeFileSync(path.join(here, '../data/aog-census.json'), JSON.stringify(census, null, 1));

// diff
console.log('\n=== DIFF (AOG has, catalog lacks) ===');
const slugToCatalogClass = new Map([...catalogByClass.keys()].map(k => [k, k]));
let totalNew = 0;
for (const [slug, entries] of Object.entries(census)) {
  const clsKey = slugToCatalogClass.get(slug);
  if (!clsKey) { console.log(`${slug}: NO CATALOG CLASS`); continue; }
  const have = catalogByClass.get(clsKey);
  const missing = [];
  for (const e of entries) {
    if (!e.name || e.name.length < 3) continue;
    if (!have.has(e.name)) missing.push(e.name);
  }
  if (missing.length) {
    totalNew += missing.length;
    console.log(`${slug} (+${missing.length}): ${missing.slice(0, 12).join(' | ')}${missing.length > 12 ? ' …' : ''}`);
  }
}
console.log(`\nTOTAL new outfit entries: ${totalNew}`);
