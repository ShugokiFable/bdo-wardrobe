// Altar of Gaming gallery resolver — second source behind BDO Fashion.
// AOG hosts captioned 4K official-style screenshots of every outfit per class
// ("Academia Outfit Set", "Rosa De Sharon Outfit Set", ...), including classes
// and outfits mmo-fashion never covered (post-2024 classes, deleted pages).
import { fetchTextSafe } from './source-fetch.mjs';
import { slugify, decodeHtmlEntities } from './catalog.mjs';

const AOG_UA = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0 Safari/537.36', 'accept': 'text/html,application/xhtml+xml' };
export { AOG_UA };

// "Academia Outfit Set, Dosa Outfit" / "[Musa] Seoryeon Corps Classic Set" -> base outfit name
export function normalizeAogName(caption) {
  let n = String(caption).split(',')[0].trim();
  n = n.replace(/^\s*\[[^\]]*\]\s*/, '');
  n = n.replace(/\s+(Premium|Classic|Deluxe)?\s*(Outfit Set|Outfit|Costume|Set|Box|Clothing)\s*$/i, '');
  return n.trim();
}
const AOG_INDEX_URL = 'https://altarofgaming.com/black-desert-online-outfits-costumes-accessories-underwear-skins/';
const pageCache = new Map(); // classSlug -> {html, pageUrl} | null

// Parse one class page into captioned gallery entries, in document order.
// Two WordPress layouts exist: div.wp-caption (single images) and
// dl.gallery <dt><a>…</a><dd class='gallery-caption'>caption</dd> (galleries).
export function parseAogGallery(html) {
  const entries = [];
  const divRe = /<div[^>]*class="[^"]*wp-caption[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?=<)/g;
  for (const m of html.matchAll(divRe)) {
    const block = m[1];
    const link = block.match(/href="(https:\/\/assets\.altarofgaming\.com\/[^"]+\.(?:jpe?g|png|webp))"/i);
    const cap = block.match(/wp-caption-text[^>]*>([^<]+)</i);
    if (link) entries.push({ url: link[1], caption: cap ? decodeHtmlEntities(cap[1].trim()) : '' });
  }
  // WordPress [gallery] layout: <dl class='gallery-item'><dt><a href='attachment-page'>
  // <img src="ASSET URL">…</a></dt><dd class='wp-caption-text gallery-caption'>caption</dd></dl>
  const galRe = /<dl class='gallery-item'>([\s\S]*?)<\/dl>/g;
  for (const m of html.matchAll(galRe)) {
    const block = m[1];
    const src = block.match(/\ssrc="(https:\/\/assets\.altarofgaming\.com\/[^"]+\.(?:jpe?g|png|webp))"/i);
    const cap = block.match(/gallery-caption[^>]*>([\s\S]*?)<\/dd>/i);
    if (src) entries.push({ url: src[1], caption: decodeHtmlEntities(cap ? cap[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').trim() : '') });
  }
  return entries;
}

async function loadClassPage(className) {
  const key = slugify(className);
  if (pageCache.has(key)) return pageCache.get(key);
  try {
    const index = await fetchTextSafe(AOG_INDEX_URL, { timeoutMs: 25000, maxBytes: 8_000_000, headers: AOG_UA });
    const byClass = new Map(); // classSlug -> url
    for (const m of new Set([...index.text.matchAll(/https:\/\/altarofgaming\.com\/black-desert(?:-online)?-([a-z0-9-]+?)-outfits?[a-z-]*\/?/g)])) {
      if (!byClass.has(m[1])) byClass.set(m[1], m[0]);
    }
    const pageUrl = byClass.get(key);
    if (!pageUrl) { pageCache.set(key, null); return null; }
    const page = await fetchTextSafe(pageUrl, { timeoutMs: 30000, maxBytes: 8_000_000, headers: AOG_UA });
    const val = { html: page.text, pageUrl: page.url || pageUrl };
    pageCache.set(key, val);
    return val;
  } catch {
    // ponytail: do NOT cache fetch failures — one transient 403 would poison
    // every remaining outfit of the class for the whole run. Next caller retries.
    return null;
  }
}

export async function resolveAogPreview(outfit) {
  const page = await loadClassPage(outfit.className);
  if (!page) throw new Error(`altarofgaming: no class page for ${outfit.className}`);
  const entries = parseAogGallery(page.html);
  const nameLower = outfit.name.toLowerCase();
  // Every gallery entry whose caption mentions the outfit name is a candidate;
  // prefer the shortest caption (plain set shot beats "...with Weapon Skin").
  const hits = entries
    .filter(e => e.caption.toLowerCase().includes(nameLower))
    .sort((a, b) => a.caption.length - b.caption.length);
  if (!hits.length) throw new Error(`altarofgaming: no caption mentioning "${outfit.name}" on ${outfit.className} page`);
  const best = hits[0];
  const others = hits.slice(1, 4).map(h => h.url);
  return {
    provider: 'altar-of-gaming',
    sourceUrl: page.pageUrl,
    previewUrls: [best.url, ...others]
  };
}
