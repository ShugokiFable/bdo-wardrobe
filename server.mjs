// BDO Wardrobe — local server: static files + catalog/images API + crawl trigger.
import { createServer } from 'node:http';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const resourcesDir = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(resourcesDir, 'public');
const dataDir = path.join(resourcesDir, 'data');
const catalogPath = process.env.BDO_WARDROBE_CATALOG || path.join(dataDir, 'catalog.json');
const imagesStatePath = path.join(dataDir, 'images.json');
const crawlScript = path.join(resourcesDir, 'scripts', 'crawl-images.mjs');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon'
};

let catalog = null;
async function loadCatalog() {
  if (!catalog) catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
  return catalog;
}
const loadImagesState = () => readFile(imagesStatePath, 'utf8').then(JSON.parse).catch(() => ({ images: {}, errors: {}, running: false }));

let crawlProc = null;
function startCrawl(args = []) {
  if (crawlProc && crawlProc.exitCode === null) return { ok: false, error: 'Crawl already running' };
  crawlProc = spawn(process.execPath, [crawlScript, ...args], { cwd: resourcesDir, stdio: 'ignore', detached: false });
  crawlProc.unref();
  return { ok: true, pid: crawlProc.pid };
}

function json(res, code, value) {
  const body = JSON.stringify(value);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  try {
    if (url.pathname === '/api/health') return json(res, 200, { ok: true, app: 'bdo-wardrobe', version: '1.0.0' });

    if (url.pathname === '/api/catalog') {
      const [cat, imgs] = await Promise.all([loadCatalog(), loadImagesState()]);
      // Merge image facts (file/width/height/provider) into outfits for one-shot client boot.
      let outfits = cat.outfits.map(o => {
        const img = imgs.images[o.id];
        return img ? { ...o, image: { file: `/assets/images/${img.file}?v=${encodeURIComponent(imgs.generatedAt || '')}`, width: img.width, height: img.height, provider: img.provider, sourceUrl: img.sourceUrl } } : o;
      });
      // ponytail: gender-matched sibling fallback — an outfit with no image of
      // its own borrows another class's render of the SAME outfit (same slug),
      // matched by in-game gender, and is labeled honestly in the UI.
      const MALE = new Set(['Warrior', 'Berserker', 'Wizard', 'Hashashin', 'Sage', 'Ninja', 'Musa', 'Striker', 'Dosa', 'Wukong', 'Agent', 'Archer']);
      const sameGender = (a, b) => MALE.has(a) === MALE.has(b);
      // ponytail: user directive — Berserker's massive frame & Shai's child model
      // misrepresent an outfit on any other body. Excluded BOTH ways: never
      // donors (their renders mislead), never receivers (slim-body renders
      // mislead on THEIR frames). Those stay honestly Missing.
      const NO_FALLBACK = new Set(['Berserker', 'Shai']);
      const slugOf = id => id.slice(id.indexOf('--') + 2);
      // ponytail: normalize naming drift between sources ("bd9", "bd9-outfit-set",
      // "bd9-premium-outfit-set" are one product).
      const normSlug = s => s.replace(/-(premium-outfit-set|outfit-set|premium-set|set)$/, '');
      const donorRank = o => (o.image.provider === 'pearl-abyss' || o.image.provider === 'pearl-shop-official' ? 100000 : 0) + (o.image.width || 0);
      const bySlug = new Map();
      for (const o of outfits) if (o.image) {
        const s = normSlug(slugOf(o.id));
        if (!bySlug.has(s)) bySlug.set(s, []);
        bySlug.get(s).push(o);
      }
      outfits = outfits.map(o => {
        if (o.image) return o;
        if (NO_FALLBACK.has(o.className)) return o; // never receive borrowed renders
        const sibs = (bySlug.get(normSlug(slugOf(o.id))) || [])
          .filter(s => !NO_FALLBACK.has(s.className))            // Berserker/Shai never donate
          .filter(s => s.className !== o.className)
          .filter(s => sameGender(s.className, o.className));
        if (!sibs.length) return o;
        sibs.sort((a, b) => donorRank(b) - donorRank(a) || a.className.localeCompare(b.className));
        const donor = sibs[0];
        return { ...o, image: { ...donor.image }, fallbackFrom: donor.className };
      });
      return json(res, 200, { ...cat, outfits, imageStats: { covered: Object.keys(imgs.images).length, total: cat.outfits.length, running: Boolean(imgs.running), errors: Object.keys(imgs.errors || {}).length, errorMap: imgs.errors || {} } });
    }

    if (url.pathname === '/api/crawl' && req.method === 'POST') {
      let body = {};
      try { body = JSON.parse(await readFile(req, 'utf8') || '{}'); } catch {}
      const args = [];
      if (body.all) args.push('--all');
      if (body.box) args.push(`--box=${body.box}`);
      if (body.limit) args.push(`--limit=${body.limit}`);
      return json(res, 200, startCrawl(args));
    }

    if (url.pathname === '/api/images-state') return json(res, 200, await loadImagesState());

    // Static files (public/ only, path-traversal safe).
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/') rel = '/index.html';
    const filePath = path.normalize(path.join(publicDir, rel));
    if (!filePath.startsWith(publicDir)) { res.writeHead(403); return res.end('Forbidden'); }
    try {
      const data = await readFile(filePath);
      const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
      const cache = rel.startsWith('/assets/images/') ? 'public, max-age=604800' : 'no-cache';
      res.writeHead(200, { 'content-type': type, 'cache-control': cache });
      return res.end(data);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain' });
      return res.end('Not found');
    }
  } catch (error) {
    return json(res, 500, { error: String(error.message || error) });
  }
});

const port = Number(process.env.PORT || 7861);
const host = process.env.HOST || '127.0.0.1';
server.listen(port, host, () => console.log(`BDO Wardrobe → http://${host}:${port}`));
