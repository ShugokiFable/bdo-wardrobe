// AOG catalog expansion: parse every class page WITH section context,
// diff against catalog (decoded, slug-compared), merge new outfits in.
// Idempotent — safe to rerun. Writes data/aog-new.json report.
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

// class slug -> className from catalog's own class list
const classBySlug = new Map(catalog.classes.map(c => [slugify(c.name), c.name]));

// existing outfit keys per class (slug-of-name)
const existingByClass = new Map();
for (const o of catalog.outfits) {
  const k = slugify(o.className);
  if (!existingByClass.has(k)) existingByClass.set(k, new Set());
  existingByClass.get(k).add(slugify(o.name));
}

// sections that are NOT outfits
const EXCLUDE_RE = /earring|ear cuff|glasses|eyepatch|piercing|whisker|underwear|accessor|about\b|latest content|currently popular|featured content|guides|more\s+bdo/i;

function parsePageWithSections(html) {
  // split document by h4 headings, keep heading text with each chunk
  const parts = html.split(/<h4[^>]*>/);
  const out = [];
  for (let i = 1; i < parts.length; i++) {
    const chunk = parts[i];
    const heading = decodeHtmlEntities(chunk.slice(0, chunk.indexOf('</h4>')).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
    const body = chunk.slice(chunk.indexOf('</h4>'));
    if (!heading || EXCLUDE_RE.test(heading)) continue;
    for (const e of parseAogGallery(body)) {
      const name = decodeHtmlEntities(normalizeCaption(e.caption));
      if (!name || name.length < 3) continue;
      out.push({ section: heading, name, img: e.img });
    }
  }
  return out;
}

function normalizeCaption(caption) {
  let n = String(caption).split(',')[0].trim();
  n = n.replace(/^\s*\[[^\]]*\]\s*/, '');
  n = n.replace(/\s+(Premium|Classic|Deluxe)?\s*(Outfit Set|Outfit|Costume|Set|Box|Clothing)\s*$/i, '');
  return n.trim();
}

// 1) index -> class page urls
const index = await fetchTextSafe(INDEX_URL, { timeoutMs: 25000, maxBytes: 8_000_000, headers: AOG_UA });
const pageUrls = new Map();
for (const m of new Set([...index.text.matchAll(/https:\/\/altarofgaming\.com\/black-desert(?:-online)?-([a-z0-9-]+?)-outfits?[a-z-]*\/?/g)])) {
  if (classBySlug.has(m[1])) pageUrls.set(m[1], m[0].replace(/\/?$/, '/'));
}
console.log('matched class pages:', pageUrls.size, '/', classBySlug.size);

// 2) parse each page
const fresh = [];   // {className, name, img, section}
let dupeInPage = 0;
for (const [clsSlug, url] of pageUrls) {
  const page = await fetchTextSafe(url, { timeoutMs: 30000, maxBytes: 12_000_000, headers: AOG_UA });
  const entries = parsePageWithSections(page.text);
  const have = existingByClass.get(clsSlug);
  const seen = new Set();
  let added = 0;
  for (const e of entries) {
    const s = slugify(e.name);
    if (!s || seen.has(s)) { dupeInPage++; continue; }
    seen.add(s);
    if (have.has(s)) continue;
    have.add(s); // guard vs cross-page dupes
    fresh.push({ className: classBySlug.get(clsSlug), name: e.name, img: e.img, section: e.section });
    added++;
  }
  console.log(`${clsSlug.padEnd(14)} +${added}`);
  await new Promise(r => setTimeout(r, 350));
}

// 3) merge into catalog
const rarityOf = (section) => /premium/i.test(section) ? 'premium' : /classic/i.test(section) ? 'classic' : 'outfit';
const idOf = (e) => `${slugify(e.className)}--${slugify(e.name)}`;
const byId = new Map(catalog.outfits.map(o => [o.id, o]));
let appended = 0;
for (const e of fresh) {
  const id = idOf(e);
  if (byId.has(id)) continue;
  byId.set(id, {
    id,
    name: e.name,
    className: e.className,
    rarity: rarityOf(e.section),
    boxes: [],
    sources: ['altarofgaming'],
    aogImg: e.img,
    addedFrom: 'aog-census'
  });
  appended++;
}
catalog.outfits = [...byId.values()];
writeFileSync(catalogPath, JSON.stringify(catalog));
writeFileSync(path.join(here, '../data/aog-new.json'), JSON.stringify(fresh, null, 1));

console.log(`\ncatalog outfits: ${catalog.outfits.length} (appended ${appended}, in-page dupes skipped ${dupeInPage})`);
const agent = catalog.outfits.filter(o => o.className === 'Agent');
console.log('agent outfits now:', agent.map(o => o.name).join(' | ') || '(none)');
