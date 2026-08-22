// BDO Wardrobe — image crawler
// Resolves the best full-res preview per outfit (official Pearl Abyss rows first,
// then mmo-fashion), downloads bytes to assets/images/, measures real dimensions.
// Resumable: skips outfits already present in images.json.
// Run: node scripts/crawl-images.mjs [--all] [--box=<id>] [--limit=N]
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveOutfitPreview, fetchPearlOutfitGuideRows, fetchImageSafe, isLowResPreviewUrl, canonicalHighResImageUrl, classMatchKey } from '../lib/source-fetch.mjs';
import { resolveAogPreview } from '../lib/aog-fetch.mjs';
import { slugify } from '../lib/catalog.mjs';

const resourcesDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const catalogPath = path.join(resourcesDir, 'data', 'catalog.json');
const imagesDir = path.join(resourcesDir, 'public', 'assets', 'images');
const statePath = path.join(resourcesDir, 'data', 'images.json');

const args = process.argv.slice(2);
const wantAll = args.includes('--all');
const boxArg = args.find(a => a.startsWith('--box='))?.slice(6);
const limitArg = Number(args.find(a => a.startsWith('--limit='))?.slice(8) || 0);
const nameArg = args.find(a => a.startsWith('--name='))?.slice(7).toLowerCase();

const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
mkdirSync(imagesDir, { recursive: true });

const state = existsSync(statePath)
  ? JSON.parse(readFileSync(statePath, 'utf8'))
  : { generatedAt: '', images: {}, errors: {} };
state.running = true;
state.startedAt = new Date().toISOString();
const save = () => {
  state.generatedAt = new Date().toISOString();
  state.done = Object.keys(state.images).length;
  state.total = targets.length;
  state.running = true;
  writeFileSync(statePath, JSON.stringify(state));
};
const finish = () => {
  state.running = false;
  state.finishedAt = new Date().toISOString();
  state.done = Object.keys(state.images).length;
  state.total = targets.length;
  writeFileSync(statePath, JSON.stringify(state));
};

// ---- measured image dimensions (stdlib header parse) -----------------------
function imageSize(bytes) {
  try {
    if (bytes.length > 24 && bytes[0] === 0x89 && bytes[1] === 0x50) { // PNG
      return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
    }
    if (bytes.length > 10 && bytes.toString('ascii', 0, 3) === 'GIF') {
      return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) };
    }
    if (bytes.length > 4 && bytes[0] === 0xFF && bytes[1] === 0xD8) { // JPEG
      let off = 2;
      while (off + 9 < bytes.length) {
        if (bytes[off] !== 0xFF) { off++; continue; }
        const marker = bytes[off + 1];
        if (marker >= 0xC0 && marker <= 0xCF && ![0xC4, 0xC8, 0xCC].includes(marker)) {
          return { height: bytes.readUInt16BE(off + 5), width: bytes.readUInt16BE(off + 7) };
        }
        off += 2 + bytes.readUInt16BE(off + 2);
      }
      return null;
    }
    if (bytes.length > 30 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
      const chunk = bytes.toString('ascii', 12, 16);
      if (chunk === 'VP8 ') return { width: bytes.readUInt16LE(26) & 0x3FFF, height: bytes.readUInt16LE(28) & 0x3FFF };
      if (chunk === 'VP8L') {
        const b = bytes.readUInt32LE(21);
        return { width: (b & 0x3FFF) + 1, height: ((b >> 14) & 0x3FFF) + 1 };
      }
      if (chunk === 'VP8X') {
        return { width: bytes.readUIntLE(24, 3) + 1, height: bytes.readUIntLE(27, 3) + 1 };
      }
    }
  } catch {}
  return null;
}

const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };

// ---- official rows first: they both fill gaps AND upgrade existing entries ---
let officialRows = [];
try { officialRows = await fetchPearlOutfitGuideRows({ timeoutMs: 15000 }); console.log(`Official guide rows: ${officialRows.length}`); }catch (e) { console.log(`Official guide unavailable (${e.message}); fashion-only.`); }
const officialKeys = new Set(officialRows.map(r => `${classMatchKey(r.className)}|${slugify(r.name)}`));
const officialKey = o => `${classMatchKey(o.className)}|${slugify(o.name)}`;

// ---- sitemap slug index: real page slugs beat guessed URLs -------------------
let slugIndex = [];
try {
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36';
  const idx = await (await fetch('https://bdo.mmo-fashion.com/wp-sitemap.xml', { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) })).text();
  const subs = [...idx.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]).filter(u => /post-sitemap\d*\.xml$/.test(u));
  for (const sub of subs) {
    const xml = await (await fetch(sub, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) })).text();
    for (const m of xml.matchAll(/<loc>https:\/\/bdo\.mmo-fashion\.com\/([^\/]+)\/<\/loc>/g)) slugIndex.push(m[1]);
  }
  console.log(`Sitemap slug index: ${slugIndex.length} slugs`);
} catch (e) { console.log(`Sitemap unavailable (${e.message}); guessed URLs only.`); }

// Errors from previous runs whose cause we just fixed are stale — drop them so
// the retry pass actually retries.
for (const [id, msg] of Object.entries(state.errors)) {
  if (/HTTP 404|did not match|not an outfit preview|no downloadable full-size/.test(msg)) delete state.errors[id];
}

// ---- target list: missing, errored, or upgradeable-to-official ----------------
let targets = catalog.outfits.filter(o => {
  const entry = state.images[o.id];
  if (entry && (entry.provider === 'pearl-abyss' || !officialKeys.has(officialKey(o))) && !wantAll) return false;
  if (boxArg && !(o.boxes || []).includes(boxArg)) return false;
  if (nameArg && !o.name.toLowerCase().includes(nameArg)) return false;
  return true;
});
if (limitArg) targets = targets.slice(0, limitArg);
console.log(`Crawl targets: ${targets.length} outfits${boxArg ? ` (box=${boxArg})` : ''}${wantAll ? ' (--all)' : ''}`);
save();

const urlBytesCache = new Map(); // url -> {bytes, contentType} within this run
let processed = 0, found = 0;

async function crawlOne(outfit) {
  const oldEntry = state.images[outfit.id];
  try {
    let resolved = null;
    // ponytail: AOG-first for entries born from the AOG census (they have no
    // mmo-fashion page — fashion-first just burns a slow 404 + Wayback retry);
    // fashion-first for legacy catalog entries so official/fashion wins upgrades.
    const aogFirst = /^aog-census/.test(outfit.addedFrom || '') || outfit.addedFrom === 'agent-launch-post';
    if (aogFirst) {
      try { resolved = await resolveAogPreview(outfit); } catch {}
      if (!resolved) { try { resolved = await resolveOutfitPreview(outfit, { officialRows, slugIndex }); } catch {} }
    } else {
      // ponytail: fashion-first, AOG second — resolveOutfitPreview THROWS on
      // no-match, so it must be caught here or the AOG fallback never runs.
      try { resolved = await resolveOutfitPreview(outfit, { officialRows, slugIndex }); } catch {}
      if (!resolved) {
        try { resolved = await resolveAogPreview(outfit); } catch {}
      }
    }
    if (!resolved) throw new Error('No preview from any source');
    // ponytail: origin first (true full-size), then Jetpack big-resize — some 2016-era
    // pages embed only tiny thumbs while the underlying file is large; wp.com serves
    // it at up to 800x2000 on request. Landscape-only pages still fail the gate honestly.
    const candidates = [];
    for (const raw of (resolved.previewUrls || []).slice(0, 4)) {
      const url = canonicalHighResImageUrl(raw);
      if (!candidates.includes(url)) candidates.push(url);
      const m = url.match(/^https:\/\/bdo\.mmo-fashion\.com(\/wp-content\/uploads\/[^?]+)/);
      if (m) {
        const viaWp = `https://i0.wp.com/bdo.mmo-fashion.com${m[1]}?resize=800%2C2000&ssl=1`;
        if (!candidates.includes(viaWp)) candidates.push(viaWp);
      }
    }
    for (const url of candidates) {
      try {
        let payload = urlBytesCache.get(url);
        if (!payload) {
          payload = await fetchImageSafe(url, { timeoutMs: 20000 });
          urlBytesCache.set(url, payload);
        }
        const dims = imageSize(payload.bytes);
        // ponytail: 120x200 floor accepts small-but-real full-body shots from 2016-era
        // pages (their largest existing size); square thumbs still rejected.
        // AOG showcases are official-style LANDSCAPE (2560x1440) — allowed for that provider only.
        if (!dims || dims.width < 120 || dims.height < 200) continue;
        if (dims.width > dims.height && resolved.provider !== 'altar-of-gaming') continue;
        // Jetpack big-resize of an embedded thumbnail: real content, upscaled pixels —
        // tag honestly so the UI badges "Upscaled" instead of fake HQ.
        const upscaled = /^https:\/\/i\d\.wp\.com\/.+resize=/.test(url);
        const ext = EXT[payload.contentType] || 'jpg';
        const file = `${outfit.id}.${ext}`;
        writeFileSync(path.join(imagesDir, file), payload.bytes);
        state.images[outfit.id] = {
          file,
          url,
          sourceUrl: resolved.sourceUrl || '',
          provider: upscaled ? 'bdo-fashion-upscaled' : (resolved.provider || ''),
          width: dims.width,
          height: dims.height,
          bytes: payload.bytes.length,
          lowResSource: isLowResPreviewUrl(url)
        };
        delete state.errors[outfit.id];
        found++;
        return;
      } catch { /* try next candidate */ }
    }
    state.errors[outfit.id] = 'resolved but no downloadable full-size image';
  } catch (e) {
    state.errors[outfit.id] = String(e.message || e).slice(0, 200);
  }
}

// ponytail: fixed 2-worker pool (4 got rate-limited by mmo-fashion); raise only if needed
// ponytail: old entry kept in `oldEntry` — image only deleted AFTER a new one lands.
const CONCURRENCY = 2;
let index = 0;
async function worker() {
  while (index < targets.length) {
    const outfit = targets[index++];
    await crawlOne(outfit);
    processed++;
    if (processed % 10 === 0) { save(); console.log(`[${processed}/${targets.length}] found=${found} errors=${Object.keys(state.errors).length}`); }
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
save();
finish();
const widths = Object.values(state.images).map(i => i.width).sort((a, b) => a - b);
console.log(`DONE: ${found} new images (total ${state.done}/${catalog.outfits.length}), ${Object.keys(state.errors).length} unresolved`);
if (widths.length) console.log(`width median=${widths[Math.floor(widths.length / 2)]} min=${widths[0]} max=${widths[widths.length - 1]}`);
