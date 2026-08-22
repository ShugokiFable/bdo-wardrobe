// One-shot: resolve all current error entries through the full pipeline
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveOutfitPreview, fetchImageSafe, isLowResPreviewUrl } from '../lib/source-fetch.mjs';
import { resolveAogPreview } from '../lib/aog-fetch.mjs';

const here = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const catalog = JSON.parse(readFileSync(path.join(here, 'data/catalog.json'), 'utf8'));
const statePath = path.join(here, 'data/images.json');
const state = JSON.parse(readFileSync(statePath, 'utf8'));
const imagesDir = path.join(here, 'public/assets/images');
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/avif': 'avif', 'image/gif': 'gif' };
const officialRows = [];
let slugIndex = [];

try {
  const idx = await (await fetch('https://bdo.mmo-fashion.com/wp-sitemap.xml', { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(15000) })).text();
  const subs = [...idx.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]).filter(u => /post-sitemap\d*\.xml$/.test(u));
  for (const s of subs.slice(0, 6)) {
    const xml = await (await fetch(s, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(20000) })).text();
    for (const m of xml.matchAll(/<loc>https:\/\/bdo\.mmo-fashion\.com\/([^\/]+)\/<\/loc>/g)) slugIndex.push(m[1]);
  }
  slugIndex = [...new Set(slugIndex)];
} catch {}

const errIds = Object.keys(state.errors);
console.log(`targets: ${errIds.length}`);
let found = 0;
for (const id of errIds) {
  const outfit = catalog.outfits.find(o => o.id === id);
  if (!outfit) { delete state.errors[id]; continue; }
  let resolved = null;
  try { resolved = await resolveAogPreview(outfit); } catch {}
  if (!resolved) {
    try { resolved = await resolveOutfitPreview(outfit, { officialRows, slugIndex }); } catch {}
  }
  if (!resolved) { console.log(`MISS ${id}`); continue; }
  let done = false, lastErr = '';
  for (const url of resolved.previewUrls.slice(0, 4)) {
    try {
      const payload = await fetchImageSafe(url, { timeoutMs: 25000 });
      const b = payload.bytes;
      let w = 0, h = 0;
      if (b[0] === 0x89 && b[1] === 0x50) { w = b.readUInt32BE(16); h = b.readUInt32BE(20); }
      else if (b[0] === 0xFF && b[1] === 0xD8) {
        let i = 2;
        while (i < b.length - 9) {
          if (b[i] !== 0xFF) { i++; continue; }
          const marker = b[i + 1];
          if (marker >= 0xC0 && marker <= 0xCF && ![0xC4, 0xC8, 0xCC].includes(marker)) { h = b.readUInt16BE(i + 5); w = b.readUInt16BE(i + 7); break; }
          i += 2 + b.readUInt16BE(i + 2);
        }
      } else if (b.slice(0, 4).toString('ascii') === 'RIFF' && b.slice(8, 12).toString('ascii') === 'WEBP') {
        const chunk = b.slice(12, 16).toString('ascii');
        if (chunk === 'VP8X') { const t = b.readUIntLE(24, 3) + 1; h = b.readUIntLE(27, 3) + 1; w = t; }
        else if (chunk === 'VP8 ') { w = b.readUInt16LE(26) & 0x3fff; h = b.readUInt16LE(28) & 0x3fff; }
        else if (chunk === 'VP8L') { const bits = b.readUInt32LE(21); w = (bits & 0x3fff) + 1; h = ((bits >> 14) & 0x3fff) + 1; }
      }
      if (!w || !h || w < 120 || h < 200) throw new Error(`dims fail ${w}x${h}`);
      // mmo-fashion previews are portrait; altar-of-gaming ships official-style
      // LANDSCAPE showcases (2560x1440) — accept those only for that provider.
      if (resolved.provider !== 'altar-of-gaming' && w > h) throw new Error(`landscape rejected ${w}x${h}`);
      if (resolved.provider === 'altar-of-gaming' && (w < 1000 || h < 500)) throw new Error(`aog too small ${w}x${h}`);
      const ext = EXT[payload.contentType] || 'jpg';
      const file = `${outfit.id}.${ext}`;
      writeFileSync(path.join(imagesDir, file), b);
      state.images[outfit.id] = { file, url, sourceUrl: resolved.sourceUrl || '', provider: resolved.provider || '', width: w, height: h, bytes: b.length, lowResSource: false };
      delete state.errors[id];
      found++;
      console.log(`OK   ${id} <- ${resolved.provider} ${w}x${h}`);
      done = true;
      break;
    } catch (e) { lastErr = String(e.message || e); }
  }
  if (!done) state.errors[id] = `all candidates failed: ${(lastErr || '').slice(0, 120)}`;
}
state.finishedAt = new Date().toISOString();
writeFileSync(statePath, JSON.stringify(state, null, 1));
console.log(`DONE: ${found}/${errIds.length} recovered, ${Object.keys(state.errors).length} errors left`);
