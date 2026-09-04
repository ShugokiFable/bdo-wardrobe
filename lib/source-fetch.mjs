import { parseCodexPage } from './bdocodex.mjs';
import { decodeHtmlEntities, htmlToText, mergeCatalogs, normalizeCatalog, slugify } from './catalog.mjs';

const ALLOWED_HOSTS = [
  'bdocodex.com',
  'playblackdesert.com',
  'blackdesert.pearlabyss.com',
  'bdo.mmo-fashion.com',
  'altarofgaming.com',
  'pearlcdn.com',
  'wp.com',
  'archive.org',
  'web.archive.org'
];

export const PEARL_PREMIUM_GUIDE_URL = 'https://blackdesert.pearlabyss.com/Asia/en-US/Game/Wiki?_masterWikiNo=216';

const KNOWN_OFFICIAL_PREVIEW_FALLBACKS = new Map([
  ['ranger|crown-eagle', 'https://s1.pearlcdn.com/KR/Upload/WIKI/3748fab941c20230915190651441.png'],
  ['ranger|eternal-snow', 'https://s1.pearlcdn.com/KR/Upload/WIKI/48f191503e320230915190650816.png']
]);

const NON_OUTFIT_DETAIL_TOKENS = [
  'dagger','longbow','kamasylven-sword','kamasylven','elven-sword','crossbow','greatbow',
  'shortsword','sura-katana','katana','kunai','kerispear','horn-bow','crescent-blade','vediant',
  'kriegsmesser','ornamental-knot','iron-buster','scythe','amulet','celestial-bo-staff','bo-staff',
  'gardbrace','cestus','gauntlet','vambrace','greatsword','shield','sword','staff','godr-sphera',
  'ad-sphera','sphera','lancia','sah-chakram','shamshir','haladie','combat-axe','axe','sting',
  'quoratum','morning-star','kyve','talisman','patraca','slayer','florang','vitclari','pendulum',
  'crimson-glaives','noble-sword','blade','bow','helmet','headpiece','gloves','shoes','boots','weapon'
];

const FULL_BODY_HINTS = ['all-front','full-front','fullbody','full-body','front','armor','outfit'];



export function canonicalHighResImageUrl(value) {
  let url;
  try { url = new URL(value); } catch { return String(value || ''); }
  const wpProxy = /^i\d+\.wp\.com$/i.test(url.hostname) && url.pathname.startsWith('/bdo.mmo-fashion.com/');
  if (wpProxy) {
    url.protocol = 'https:';
    url.hostname = 'bdo.mmo-fashion.com';
    url.pathname = url.pathname.replace(/^\/bdo\.mmo-fashion\.com/i, '');
  }
  if (url.hostname === 'bdo.mmo-fashion.com' && /\/wp-content\/uploads\//i.test(url.pathname)) {
    url.pathname = url.pathname.replace(/-\d{2,5}x\d{2,5}(?=\.(?:jpe?g|png|webp|avif)$)/i, '');
    url.search = '';
    url.hash = '';
  }
  return url.href;
}

export function isLowResPreviewUrl(value='') {
  const text = String(value);
  return /(?:[?&](?:resize|fit|w|width|h|height)=)|-\d{2,5}x\d{2,5}(?=\.(?:jpe?g|png|webp|avif)(?:\?|$))/i.test(text);
}

function pathSlug(value='') {
  try {
    const url = new URL(value);
    return slugify(decodeURIComponent(url.pathname));
  } catch { return slugify(value); }
}

function hasSlugToken(slug, token) {
  return new RegExp(`(?:^|-)${token.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}(?:-|$)`, 'i').test(slug);
}

export function isLikelyNonOutfitPreviewUrl(value='') {
  let url;
  try { url = new URL(value); } catch { return false; }
  if (url.hostname !== 'bdo.mmo-fashion.com') return false;
  const slug = pathSlug(value);
  return NON_OUTFIT_DETAIL_TOKENS.some(token => hasSlugToken(slug, token));
}

function sourceLooksLikeNonOutfitPage(value='') {
  let url;
  try { url = new URL(value); } catch { return false; }
  if (url.hostname !== 'bdo.mmo-fashion.com') return false;
  return NON_OUTFIT_DETAIL_TOKENS.some(token => hasSlugToken(pathSlug(value), token));
}

export function auditOutfitPreviews(outfit={}) {
  const previewUrls = [...new Set(outfit.previewUrls || [])];
  const good = previewUrls.filter(url => !isLikelyNonOutfitPreviewUrl(url));
  const suspicious = previewUrls.filter(isLikelyNonOutfitPreviewUrl);
  const badSource = (outfit.sourceUrls || []).some(sourceLooksLikeNonOutfitPage);
  let next = previewUrls;
  let needsRepair = false;
  if (good.length) next = [...good, ...suspicious];
  else if (previewUrls.length && (suspicious.length || badSource)) { next = []; needsRepair = true; }
  const tags = [...new Set((outfit.tags || []).filter(tag => tag !== 'needs-preview-repair'))];
  if (needsRepair) tags.push('needs-preview-repair');
  return {...outfit, previewUrls:next, tags};
}

export function applyKnownOfficialPreviewFallback(outfit={}) {
  const audited = auditOutfitPreviews(outfit);
  const key = `${classMatchKey(audited.className)}|${slugify(audited.name)}`;
  const official = KNOWN_OFFICIAL_PREVIEW_FALLBACKS.get(key);
  if (!official) return audited;
  const existing = (audited.previewUrls || []).filter(url => url !== official && !isLikelyNonOutfitPreviewUrl(url));
  const tags = (audited.tags || []).filter(tag => tag !== 'needs-preview-repair');
  return {
    ...audited,
    previewUrls:[official,...existing],
    sourceUrls:[...new Set([...(audited.sourceUrls || []).filter(url => !sourceLooksLikeNonOutfitPage(url)),PEARL_PREMIUM_GUIDE_URL])],
    tags:[...new Set([...tags,'official-preview','hq-preview','verified-outfit-preview'])]
  };
}

export function previewNeedsRepair(outfit={}) {
  const audited = auditOutfitPreviews(outfit);
  return Boolean((outfit.previewUrls || []).length && !(audited.previewUrls || []).length && audited.tags.includes('needs-preview-repair'));
}

function plainText(value='') {
  return htmlToText(value);
}

function fashionImageCandidates(html, pageUrl) {
  const source = String(html || '');
  const values = [];
  let match;
  const push = raw => {
    if (!raw) return;
    try { values.push(new URL(String(raw).replace(/&amp;/gi,'&'), pageUrl).href); } catch {}
  };
  for (const re of [/<meta\b[^>]*(?:property|name)=["']og:image["'][^>]*content=["']([^"']+)["'][^>]*>/gi, /<meta\b[^>]*content=["']([^"']+)["'][^>]*(?:property|name)=["']og:image["'][^>]*>/gi]) {
    while ((match = re.exec(source))) push(match[1]);
  }
  for (const attr of ['data-orig-file','data-large-file','data-lazy-src','data-src','src']) {
    const re = new RegExp(`\\b${attr}=["']([^"']+)["']`, 'gi');
    while ((match = re.exec(source))) push(match[1]);
  }
  for (const re of [/\bsrcset=["']([^"']+)["']/gi,/\bdata-srcset=["']([^"']+)["']/gi]) {
    while ((match = re.exec(source))) {
      for (const part of match[1].split(',')) push(part.trim().split(/\s+/)[0]);
    }
  }
  const hrefRe = /<a\b[^>]*href=["']([^"']+\.(?:jpe?g|png|webp|avif)(?:\?[^"']*)?)["'][^>]*>/gi;
  while ((match = hrefRe.exec(source))) push(match[1]);

  const result = [];
  for (const value of values) {
    const url = canonicalHighResImageUrl(value);
    let parsed; try { parsed = new URL(url); } catch { continue; }
    if (parsed.hostname !== 'bdo.mmo-fashion.com') continue;
    if (!/\/wp-content\/uploads\//i.test(parsed.pathname)) continue;
    if (!/\.(?:jpe?g|png|webp|avif)$/i.test(parsed.pathname)) continue;
    const base = decodeURIComponent(parsed.pathname.split('/').pop() || '');
    if (/twitter|facebook|discord|youtube|instagram|reddit|pinterest|tumblr|gravatar|avatar|header|logo/i.test(base)) continue; // site chrome
    if (/^\d{1,3}\.(?:jpe?g|png|webp|avif)$/i.test(base)) continue; // PEGI badges etc.
    if (!result.includes(url)) result.push(url);
  }
  return result;
}

export function parseFashionArchivePage(html, pageUrl) {
  const source = String(html || '');
  const outfits = [];
  const seen = new Set();
  let match;
  const linkRe = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  while ((match = linkRe.exec(source))) {
    const label = plainText(match[2]);
    const item = label.match(/^\[([^\]]+)\]\s+(.+)$/);
    if (!item) continue;
    let sourceUrl; try { sourceUrl = new URL(match[1], pageUrl).href; } catch { continue; }
    if (!/^https:\/\/bdo\.mmo-fashion\.com\//i.test(sourceUrl)) continue;
    if (/\/category\/|\/tag\/|\/author\/|\/page\//i.test(new URL(sourceUrl).pathname)) continue;
    const className = item[1].trim();
    const name = item[2].trim();
    const key = `${className}|${name}`;
    if (!className || !name || seen.has(key)) continue;
    seen.add(key);
    outfits.push({className,name,sourceUrl,sourceUrls:[sourceUrl],rarity:'outfit',boxes:[],previewUrls:[],tags:['fashion-archive']});
  }
  const currentMatch = new URL(pageUrl).pathname.match(/\/page\/(\d+)\/?$/i);
  const currentPage = currentMatch ? Number(currentMatch[1]) : 1;
  const pages = [];
  const pageRe = /href=["']([^"']*\/category\/database\/items\/apparel\/armor\/outfit\/page\/(\d+)\/?)['"]/gi;
  while ((match = pageRe.exec(source))) {
    const n = Number(match[2]);
    if (n > currentPage) {
      try { pages.push({n,url:new URL(match[1],pageUrl).href}); } catch {}
    }
  }
  pages.sort((a,b)=>a.n-b.n);
  return {outfits,nextPageUrl:pages[0]?.url || ''};
}

export function selectPreviewTargets(catalog, options={}) {
  const skip = new Set(Array.isArray(options.skipIds) ? options.skipIds : []);
  let targets = (catalog?.outfits || []).filter(o => {
    if (skip.has(o.id)) return false;
    if (!o.previewUrls?.length) return true;
    if (previewNeedsRepair(o)) return true;
    return Boolean(options.upgradeLowRes) && o.previewUrls.some(isLowResPreviewUrl) && !o.previewUrls.some(url => !isLowResPreviewUrl(url));
  });
  if (Array.isArray(options.ids) && options.ids.length) {
    const wanted = new Set(options.ids); targets = targets.filter(o => wanted.has(o.id));
  }
  if (options.boxId) targets = targets.filter(o => (o.boxes || []).includes(options.boxId));
  if (options.className && options.className !== 'all') targets = targets.filter(o => o.className === options.className);
  if (options.limit != null) targets = targets.slice(0, Math.max(0, Number(options.limit) || 0));
  return targets;
}

function allowedHost(hostname) {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  return ALLOWED_HOSTS.some(base => host === base || host.endsWith(`.${base}`));
}

function privateLiteral(host) {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (h === 'localhost' || h === '::1' || h === '0.0.0.0') return true;
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a,b] = m.slice(1).map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

export function assertAllowedRemoteUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Invalid remote URL'); }
  if (!['http:','https:'].includes(url.protocol)) throw new Error('Only HTTP(S) sources are supported');
  if (privateLiteral(url.hostname) || !allowedHost(url.hostname)) throw new Error(`Source host is not allowed: ${url.hostname}`);
  return url;
}

function inferRarity(name = '') {
  if (/classic/i.test(name)) return 'classic';
  if (/premium/i.test(name)) return 'premium';
  return 'outfit';
}

function inferOutfitFromTitle(title = '') {
  const match = title.match(/^\[([^\]]+)\]\s+(.+?)\s+(Premium|Classic|Outfit)\s+Set$/i);
  if (!match) return null;
  return { className:match[1].trim(), name:match[2].trim(), rarity:match[3].toLowerCase() };
}

function familyNameFromBox(title = '') {
  return title.replace(/^\[Event\]\s*/i, '').replace(/\s+Outfit\s+Box$/i, '').trim();
}

export function catalogFromParsedPage(parsed, options = {}) {
  const boxId = options.boxId || slugify(parsed.title || 'synced-box');
  const boxName = options.boxName || parsed.title || 'Synced Outfit Box';
  const outfits = [];
  for (const row of parsed.mappings || []) {
    const matching = (parsed.links || []).find(link => link.kind === 'outfit' && link.label.includes(`[${row.className}]`) && link.label.toLowerCase().includes(row.outfitName.toLowerCase()));
    outfits.push({
      className:row.className,
      name:row.outfitName,
      rarity:row.rarity || inferRarity(matching?.label || ''),
      boxes:[boxId],
      sourceUrls:[matching?.url || parsed.pageUrl].filter(Boolean),
      previewUrls:[],
      tags:['synced']
    });
  }

  if (!outfits.length && parsed.exclusiveClasses?.length && /outfit\s+box/i.test(parsed.title || '')) {
    const name = familyNameFromBox(parsed.title);
    for (const className of parsed.exclusiveClasses) outfits.push({
      className, name, rarity:'outfit', boxes:[boxId], sourceUrls:[parsed.pageUrl].filter(Boolean), previewUrls:[], tags:['synced-exclusive']
    });
  }

  const inferred = inferOutfitFromTitle(parsed.title || '');
  if (!outfits.length && inferred) outfits.push({
    className:inferred.className,
    name:inferred.name,
    rarity:inferred.rarity,
    boxes:[boxId],
    sourceUrls:[parsed.pageUrl].filter(Boolean),
    previewUrls:parsed.imageCandidates || [],
    tags:['synced-preview']
  });

  return normalizeCatalog({
    meta:{sources:[parsed.pageUrl].filter(Boolean), verifiedAt:new Date().toISOString().slice(0,10)},
    boxes:[{id:boxId,name:boxName,sourceUrl:options.rootUrl || parsed.pageUrl,type:'synced',availability:'catalogued'}],
    outfits
  });
}

export async function fetchTextSafe(value, {timeoutMs=15000,maxBytes=5_000_000,headers} = {}) {
  let url = assertAllowedRemoteUrl(value);
  for (let redirects = 0; redirects <= 4; redirects++) {
    const response = await fetch(url, {
      redirect:'manual',
      signal:AbortSignal.timeout(timeoutMs),
      headers: headers || {'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0 Safari/537.36 BDO-Wardrobe/1.3','accept':'text/html,application/xhtml+xml'}
    });
    if ([301,302,303,307,308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) throw new Error(`Redirect from ${url.href} had no Location`);
      url = assertAllowedRemoteUrl(new URL(location, url).href);
      continue;
    }
    if (!response.ok) throw new Error(`HTTP ${response.status} fetching ${url.href}`);
    const type = response.headers.get('content-type') || '';
    if (!/text\/html|application\/xhtml\+xml|text\/plain/i.test(type)) throw new Error(`Unsupported content type: ${type}`);
    const length = Number(response.headers.get('content-length') || 0);
    if (length > maxBytes) throw new Error(`Source is too large (${length} bytes)`);
    const text = await response.text();
    if (Buffer.byteLength(text) > maxBytes) throw new Error(`Source exceeded ${maxBytes} bytes`);
    return {text,url:url.href,status:response.status};
  }
  throw new Error('Too many redirects');
}

export async function syncSource(sourceUrl, options = {}) {
  const root = assertAllowedRemoteUrl(sourceUrl).href;
  const boxId = options.boxId || slugify(options.boxName || root.split('/').filter(Boolean).at(-1) || 'synced-box');
  const maxPages = Math.min(Math.max(Number(options.maxPages || (options.deepImages ? 240 : 70)), 1), 300);
  const maxDepth = options.deepImages ? 2 : 1;
  const queue = [{url:root,depth:0}];
  const visited = new Set();
  const logs = [];
  let catalog = normalizeCatalog({boxes:[{id:boxId,name:options.boxName || 'Synced Outfit Box',sourceUrl:root,type:'synced'}]});
  let rootTitle = options.boxName || '';

  while (queue.length && visited.size < maxPages) {
    const current = queue.shift();
    if (visited.has(current.url)) continue;
    visited.add(current.url);
    try {
      const fetched = await fetchTextSafe(current.url, {timeoutMs:options.timeoutMs || 15000});
      const parsed = parseCodexPage(fetched.text, fetched.url);
      if (!rootTitle && current.depth === 0) rootTitle = parsed.title || 'Synced Outfit Box';
      const partial = catalogFromParsedPage(parsed, {boxId,boxName:rootTitle || parsed.title,rootUrl:root});
      catalog = mergeCatalogs(catalog, partial);
      logs.push({url:current.url,status:'ok',title:parsed.title,mappings:parsed.mappings.length,images:parsed.imageCandidates.length});

      // If an outfit detail page yielded previews, merge them into matching existing row.
      const inferred = inferOutfitFromTitle(parsed.title || '');
      if (inferred && parsed.imageCandidates?.length) {
        const matchId = `${slugify(inferred.className)}--${slugify(inferred.name)}`;
        const row = catalog.outfits.find(o => o.id === matchId);
        if (row) row.previewUrls = [...new Set([...(row.previewUrls || []), ...parsed.imageCandidates])];
      }

      if (current.depth < maxDepth) {
        for (const link of parsed.links || []) {
          if (link.kind === 'box' || (options.deepImages && link.kind === 'outfit')) {
            try {
              const allowed = assertAllowedRemoteUrl(link.url).href;
              if (!visited.has(allowed)) queue.push({url:allowed,depth:current.depth+1});
            } catch {}
          }
        }
      }
    } catch (error) {
      logs.push({url:current.url,status:'error',error:error.message});
    }
  }
  catalog.meta.generatedAt = new Date().toISOString();
  catalog.meta.sources = [...new Set([...(catalog.meta.sources || []), root])];
  return {catalog,logs,pages:visited.size};
}

function fashionNameVariants(name='') {
  const exact = String(name || '').trim();
  const variants = [exact];
  if (/\bdivinus\b/i.test(exact)) {
    const base = exact.replace(/\s+divinus\b/ig, '').trim();
    if (base) variants.push(base, `${base} (Wings)`);
  }
  if (/\(wings\)/i.test(exact)) variants.push(exact.replace(/\s*\(wings\)\s*/i, '').trim());
  if (/^eternal snow$/i.test(exact)) variants.push('Neve');
  return [...new Set(variants.filter(Boolean))];
}

export function fashionCandidateUrls(outfit) {
  if (!outfit?.className || !outfit?.name) throw new Error('Outfit class and name are required');
  return fashionNameVariants(outfit.name).map(name => `https://bdo.mmo-fashion.com/${slugify(outfit.className)}-${slugify(name)}/`);
}

export function fashionCandidateUrl(outfit) {
  return fashionCandidateUrls(outfit)[0];
}

// Class-name keys with known spelling variants — mmo-fashion itself ships
// typo'd slugs ("vlakyrie-lucirian") and legacy data mixes dusa/dosa.
export function classSlugVariants(name='') {
  const key = slugify(name);
  const twins = { dusa: 'dosa', dosa: 'dusa', vlakyrie: 'valkyrie', valkyrie: 'vlakyrie' };
  return [...new Set([key, twins[key]].filter(Boolean))];
}

export function classMatchKey(name='') {
  const key = slugify(name);
  return key === 'dusa' ? 'dosa' : key === 'vlakyrie' ? 'valkyrie' : key;
}

function outfitMatchSlugs(name='') {
  return [...new Set(fashionNameVariants(name).map(slugify).filter(Boolean))];
}

function cleanFashionTitleName(title='') {
  return String(title || '')
    .replace(/^BDO Fashion\s*\|\s*/i, '')             // SEO titles: "BDO Fashion | [Class] Name (Black Desert Online)"
    .replace(/\s*\(Black Desert Online\)\s*$/i, '')
    .replace(/^\[[^\]]+\]\s*/, '')
    .replace(/\s+-\s+BDO Fashion.*$/i, '')
    .trim();
}

function previewScore(value, outfit) {
  const slug = pathSlug(value);
  let score = 0;
  const classSlug = slugify(outfit.className);
  if (hasSlugToken(slug, classSlug)) score += 30;
  for (const nameSlug of outfitMatchSlugs(outfit.name)) if (slug.includes(nameSlug)) score += 35;
  if (!isLikelyNonOutfitPreviewUrl(value)) score += 80;
  for (const hint of FULL_BODY_HINTS) if (slug.includes(hint)) score += 12;
  if (/back|rear/.test(slug)) score -= 15; // back/rear views lose to front shots
  return score;
}

export function parseFashionPreview(html, pageUrl, outfit) {
  const parsed = parseCodexPage(html, pageUrl);
  const titleSlug = slugify(parsed.title || '');
  const classSlug = slugify(outfit.className);
  const titleNameSlug = slugify(cleanFashionTitleName(parsed.title || ''));
  const acceptedNameSlugs = outfitMatchSlugs(outfit.name);
  const classVariants = classSlugVariants(outfit.className);
  const classMatches = classVariants.some(v => titleSlug.includes(v));
  // page titles may carry less of the name than the catalog ("Cornelius N" -> page "Cornelius",
  // "Contular B" -> page "Contular"): also accept when the page's whole name is a prefix of ours
  const nameMatches = acceptedNameSlugs.some(s => titleNameSlug === s || titleNameSlug.includes(s) || s.startsWith(titleNameSlug));
  const ownNameTokens = outfitMatchSlugs(outfit.name).flatMap(s => s.split('-')); // "ulfhedinn ornamental knot" -> its own tokens
  const tokenHit = NON_OUTFIT_DETAIL_TOKENS.find(token =>
    !ownNameTokens.includes(token) && hasSlugToken(titleNameSlug, token));
  if (!classMatches || !nameMatches) {
    if (sourceLooksLikeNonOutfitPage(pageUrl) || tokenHit) {
      throw new Error(`BDO Fashion weapon/detail page is not an outfit preview for ${outfit.className} — ${outfit.name}`);
    }
    throw new Error(`BDO Fashion page did not match ${outfit.className} — ${outfit.name}`);
  }
  // Title explicitly names this outfit -> trust it; weapon/detail pages that ARE the
  // outfit's only page (e.g. "[Lahn] Orchid Fall Crescent Pendulum") must pass.
  // Image-level filters below still reject close-up-only pages honestly.
  const candidates = fashionImageCandidates(html, pageUrl);
  if (!candidates.length) throw new Error('No usable preview images found on BDO Fashion page');
  const matched = candidates.filter(value => {
    let path; try { path = decodeURIComponent(new URL(value).pathname); } catch { return false; }
    const fileSlug = slugify(path.split('/').at(-1)?.replace(/\.[^.]+$/, '') || '');
    const nameTokens = acceptedNameSlugs.join('-').split('-').filter(Boolean);
    const stemHit = (hay, t) => hay.includes(t) || hay.includes(t.replace(/s$/, '')); // "sages" <-> "sage"
    return fileSlug.includes(classSlug) && nameTokens.every(t => stemHit(fileSlug, t));
  });
  const pool = matched.length ? matched : candidates;
  const fullShots = pool.filter(url => !isLikelyNonOutfitPreviewUrl(url));
  const detailShots = pool.filter(isLikelyNonOutfitPreviewUrl);
  if (!fullShots.length && !detailShots.length) throw new Error(`No full outfit preview images found on BDO Fashion page for ${outfit.className} — ${outfit.name}`);
  const sortedFull = [...fullShots].sort((a,b) => previewScore(b,outfit) - previewScore(a,outfit));
  const sortedDetail = [...detailShots].sort((a,b) => previewScore(b,outfit) - previewScore(a,outfit));
  return {provider:'bdo-fashion',sourceUrl:pageUrl,previewUrls:[...sortedFull,...sortedDetail]};
}

// Some mmo-fashion URLs are poisoned in their CDN cache (404 to everyone) but serve
// fine with a cache-buster — vary the key per process run.
const RUN_BUST = `?bdo-wardrobe=${Date.now()}`;

export async function resolveFashionPreview(outfit, options={}) {
  const stored = (outfit?.sourceUrls || []).filter(url => /^https:\/\/bdo\.mmo-fashion\.com\//i.test(url));
  const safeStored = stored.filter(url => !sourceLooksLikeNonOutfitPage(url));
  // Sitemap-discovered slugs: real pages whose slugs don't match naive guessing
  // ("witch-dreaming-stars", "wizard-memory-of-sage"). Class + all name tokens must hit.
  const discovered = [];
  if (Array.isArray(options.slugIndex)) {
    const classVariants = classSlugVariants(outfit.className);
    const nameTokens = outfitMatchSlugs(outfit.name).join('-').split('-').filter(t => t.length > 1);
    const stemHit = (hay, t) => hay.includes(t) || hay.includes(t.replace(/s$/, '')); // "sages" <-> "sage"
    for (const slug of options.slugIndex) {
      if (classVariants.some(v => slug.includes(v)) && nameTokens.length && nameTokens.every(t => stemHit(slug, t))) {
        discovered.push(`https://bdo.mmo-fashion.com/${slug}/`);
      }
    }
  }
  const urls = [...new Set([...safeStored, ...discovered, ...fashionCandidateUrls(outfit)])];
  const errors = [];
  for (const url of urls) {
    try {
      const fetchUrl = url.startsWith('https://bdo.mmo-fashion.com/') ? url + RUN_BUST : url;
      const fetched = await fetchTextSafe(fetchUrl, {timeoutMs:options.timeoutMs || 15000,maxBytes:options.maxBytes || 6_000_000});
      return parseFashionPreview(fetched.text, url, outfit);
    } catch (error) { errors.push(`${url}: ${error.message}`); }
  }
  // ponytail: Wayback fallback — some pages soft-404 to non-browser clients (CDN/WAF),
  // and a few are gone entirely; snapshot HTML still carries the full image set.
  // CDX intermittently returns empty under rate limiting — retry once per URL.
  if (options.wayback !== false) {
    for (const url of urls.slice(0, 4)) {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          if (attempt) await new Promise(resolve => setTimeout(resolve, 2500));
          const cdx = await fetch(`http://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(url.replace(/^https?:\/\//,''))}&output=json&limit=5&filter=statuscode:200`, {signal:AbortSignal.timeout(15000)}).then(r => r.json());
          const stamp = Array.isArray(cdx) && cdx.length > 1 ? cdx[cdx.length - 1][1] : null;
          if (!stamp) continue;
          const snap = await fetchTextSafe(`https://web.archive.org/web/${stamp}/${url}`, {timeoutMs:options.timeoutMs || 25000,maxBytes:options.maxBytes || 6_000_000});
          return parseFashionPreview(snap.text, url, outfit);
        } catch (error) { errors.push(`wayback ${url}: ${error.message}`); }
      }
    }
  }
  throw new Error(`No matching BDO Fashion preview found for ${outfit.className} — ${outfit.name}. ${errors.slice(0,3).join(' | ')}`);
}

function imageUrlsFromBlock(block, pageUrl) {
  const values = [];
  let match;
  const push = raw => {
    if (!raw) return;
    try {
      const url = new URL(String(raw).replace(/&amp;/gi,'&'), pageUrl).href;
      if (/\.pearlcdn\.com$/i.test(new URL(url).hostname) && /\.(?:jpe?g|png|webp|avif)(?:\?|$)/i.test(url)) values.push(url);
    } catch {}
  };
  for (const attr of ['href','data-src','data-lazy-src','src']) {
    const re = new RegExp(`\\b${attr}=["']([^"']+)["']`, 'gi');
    while ((match = re.exec(block))) push(match[1]);
  }
  return [...new Set(values)];
}

export function parsePearlOutfitGuide(html, pageUrl=PEARL_PREMIUM_GUIDE_URL) {
  const source = String(html || '');
  // Structure-agnostic: collect caption labels and pearlcdn images WITH positions,
  // pair each caption with the nearest unconsumed image above it (cells render
  // image first, caption below). Immune to nested-table block regex breakage.
  const labels = [];
  let m;
  const labelRe = /\[([^\]\n<>]{2,30})\]\s*((?:&[a-z]+;|[^<\[]){5,120}?)\s+(Premium|Classic|Outfit)\s+Set\b/gi;
  while ((m = labelRe.exec(source))) {
    const name = decodeHtmlEntities(m[2]).replace(/\s+/g, ' ').trim();
    if (!name) continue;
    labels.push({ pos: m.index, className: m[1].trim(), name });
  }
  const images = [];
  const imgRe = /(?:src|href|data-src|data-lazy-src)=["']([^"']*pearlcdn\.com\/[^"']*\.(?:jpe?g|png|webp|avif)(?:\?[^"']*)?)["']/gi;
  while ((m = imgRe.exec(source))) {
    if (/\/thumbnail\//i.test(m[1])) continue; // og:image thumbs; cells carry full-size
    images.push({ pos: m.index, url: m[1].replace(/&amp;/gi, '&') });
  }
  const rows = [];
  const seen = new Set();
  const used = new Set();
  for (const label of labels) {
    const key = `${classMatchKey(label.className)}|${slugify(label.name)}`;
    if (seen.has(key)) continue;
    let pick = null;
    for (let i = images.length - 1; i >= 0; i--) {
      if (images[i].pos < label.pos && !used.has(i)) { pick = i; break; }
    }
    if (pick === null) pick = images.findIndex((img, i) => img.pos > label.pos && !used.has(i));
    if (pick < 0) continue;
    used.add(pick);
    seen.add(key);
    rows.push({ className: label.className, name: label.name, previewUrl: images[pick].url, sourceUrl: pageUrl, provider: 'pearl-abyss' });
  }
  return rows;
}

export async function fetchPearlOutfitGuideRows(options={}) {
  const fetched = await fetchTextSafe(PEARL_PREMIUM_GUIDE_URL,{timeoutMs:options.timeoutMs || 15000,maxBytes:options.maxBytes || 15_000_000});
  return parsePearlOutfitGuide(fetched.text,fetched.url);
}

export async function resolveOutfitPreview(outfit, options={}) {
  const officialRows = Array.isArray(options.officialRows) ? options.officialRows : [];
  const exact = officialRows.find(row => classMatchKey(row.className) === classMatchKey(outfit.className) && slugify(row.name) === slugify(outfit.name));
  if (exact?.previewUrl) return {provider:'pearl-abyss',sourceUrl:exact.sourceUrl || PEARL_PREMIUM_GUIDE_URL,previewUrls:[exact.previewUrl]};
  const fallbackKey = `${classMatchKey(outfit.className)}|${slugify(outfit.name)}`;
  const knownOfficial = KNOWN_OFFICIAL_PREVIEW_FALLBACKS.get(fallbackKey);
  if (knownOfficial) return {provider:'pearl-abyss',sourceUrl:PEARL_PREMIUM_GUIDE_URL,previewUrls:[knownOfficial]};
  if (options.skipFashion) throw new Error(`No official preview fallback found for ${outfit.className} — ${outfit.name}.`);
  return resolveFashionPreview(outfit,options);
}

export async function discoverFashionOutfits(options={}) {
  const maxPages = Math.min(Math.max(Number(options.maxPages || 30),1),50);
  let pageUrl = 'https://bdo.mmo-fashion.com/category/database/items/apparel/armor/outfit/';
  const visited = new Set();
  const outfits = [];
  const logs = [];
  while (pageUrl && visited.size < maxPages && !visited.has(pageUrl)) {
    visited.add(pageUrl);
    try {
      const fetched = await fetchTextSafe(pageUrl,{timeoutMs:options.timeoutMs || 15000,maxBytes:options.maxBytes || 8_000_000});
      const parsed = parseFashionArchivePage(fetched.text,fetched.url);
      outfits.push(...parsed.outfits);
      logs.push({url:fetched.url,status:'ok',outfits:parsed.outfits.length});
      pageUrl = parsed.nextPageUrl;
    } catch (error) {
      logs.push({url:pageUrl,status:'error',error:error.message});
      break;
    }
  }
  return {catalog:normalizeCatalog({meta:{sources:[...visited]},outfits}),logs,pages:visited.size};
}

export async function fetchImageSafe(value, {timeoutMs=15000,maxBytes=20_000_000} = {}) {
  let url = assertAllowedRemoteUrl(value);
  for (let redirects = 0; redirects <= 4; redirects++) {
    const response = await fetch(url, {
      redirect:'manual',
      signal:AbortSignal.timeout(timeoutMs),
      headers:{
        'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0 Safari/537.36 BDO-Wardrobe/1.3',
        'accept':'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        'referer': (url.hostname === 'pearlcdn.com' || url.hostname.endsWith('.pearlcdn.com')) ? 'https://blackdesert.pearlabyss.com/' : 'https://bdo.mmo-fashion.com/'
      }
    });
    if ([301,302,303,307,308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) throw new Error(`Redirect from ${url.href} had no Location`);
      url = assertAllowedRemoteUrl(new URL(location, url).href);
      continue;
    }
    if (!response.ok) throw new Error(`HTTP ${response.status} fetching image ${url.href}`);
    const contentType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!/^image\/(?:jpeg|png|webp|avif|gif|svg\+xml)$/.test(contentType)) throw new Error(`Unsupported image content type: ${contentType || 'unknown'}`);
    const length = Number(response.headers.get('content-length') || 0);
    if (length > maxBytes) throw new Error(`Image is too large (${length} bytes)`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > maxBytes) throw new Error(`Image is too large (${bytes.length} bytes)`);
    if (!bytes.length) throw new Error('Image response was empty');
    return {url:url.href,contentType,bytes};
  }
  throw new Error('Too many image redirects');
}
