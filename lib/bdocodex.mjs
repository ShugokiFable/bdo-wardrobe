import { decodeHtmlEntities, htmlToText } from './catalog.mjs';

const decode = decodeHtmlEntities;
const textOf = html => htmlToText(html, { blocks: true });

function cleanOutfitName(value) {
  return decode(value)
    .replace(/^\[[^\]]+\]\s*/, '')
    .replace(/\s+(Premium|Classic)\s+Set\s*$/i, '')
    .replace(/\s+Outfit\s+Set\s*$/i, '')
    .replace(/\s+Set\s*$/i, '')
    .trim();
}

function absoluteUrl(value, baseUrl) {
  try { return new URL(decode(value), baseUrl).href; } catch { return ''; }
}

function classifyLink(text) {
  if (/\b(?:Premium|Classic|Outfit)\s+Set\b/i.test(text)) return 'outfit';
  if (/\b(?:Outfit|Costume)\s+Box\b/i.test(text)) return 'box';
  return 'other';
}

function imageLooksUseful(url) {
  const lower = url.toLowerCase();
  if (!/^https?:/.test(lower)) return false;
  if (/(logo|favicon|sprite|icon|flag|blank|loading|pixel|avatar|grade|item_icon)/.test(lower)) return false;
  return /\.(?:png|jpe?g|webp|avif)(?:\?|$)/i.test(lower);
}

export function parseCodexPage(html, pageUrl) {
  const source = String(html || '');
  const text = textOf(source);
  const titleMatch = source.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)
    || source.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? textOf(titleMatch[1]).trim().replace(/\s+-\s+BDO.*$/i, '') : '';

  const mappings = [];
  const seenMapping = new Set();
  const mappingRe = /\b([A-Za-z][A-Za-z '\-]+?)\s*=\s*\[([^\]]+)\]\s*([^\n<]+?)(?:Premium|Classic)?\s+Set\b/gi;
  let match;
  while ((match = mappingRe.exec(text))) {
    const className = match[1].trim();
    const bracketClass = match[2].trim();
    if (className.length > 30 || bracketClass.length > 30) continue;
    const full = `[${bracketClass}] ${match[3].trim()} Set`;
    const outfitName = cleanOutfitName(full);
    const key = `${className}|${outfitName}`;
    if (!seenMapping.has(key) && outfitName) {
      seenMapping.add(key);
      mappings.push({ className, outfitName, rarity: /classic/i.test(match[0]) ? 'classic' : 'premium' });
    }
  }

  const links = [];
  const linkRe = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  while ((match = linkRe.exec(source))) {
    const label = textOf(match[2]).trim().replace(/\s+/g, ' ');
    if (!label) continue;
    const url = absoluteUrl(match[1], pageUrl);
    const kind = classifyLink(label);
    if (!url || kind === 'other') continue;
    links.push({ url, label, kind });
    const selectable = label.match(/^\[([^\]]+)\]\s+(.+?)\s+(Premium|Classic|Outfit)\s+Set$/i);
    if (selectable) {
      const className = selectable[1].trim();
      const outfitName = selectable[2].trim();
      const key = `${className}|${outfitName}`;
      if (!seenMapping.has(key)) {
        seenMapping.add(key);
        mappings.push({ className, outfitName, rarity: selectable[3].toLowerCase() });
      }
    }
  }

  const exclusiveClasses = [];
  const exclusiveMatch = text.match(/Exclusive:\s*([^\n]+)/i);
  if (exclusiveMatch) {
    for (const className of exclusiveMatch[1].split(',').map(x => x.trim()).filter(Boolean)) {
      if (className.length <= 30 && /^[A-Za-z][A-Za-z '\-]+$/.test(className)) exclusiveClasses.push(className);
    }
  }

  const imageCandidates = [];
  const addImage = raw => {
    const url = absoluteUrl(raw, pageUrl);
    if (url && imageLooksUseful(url) && !imageCandidates.includes(url)) imageCandidates.push(url);
  };
  for (const re of [
    /<meta\b[^>]*(?:property|name)=["']og:image["'][^>]*content=["']([^"']+)["'][^>]*>/gi,
    /<meta\b[^>]*content=["']([^"']+)["'][^>]*(?:property|name)=["']og:image["'][^>]*>/gi,
    /<(?:img|source)\b[^>]*(?:data-src|data-original|src)=["']([^"']+)["'][^>]*>/gi
  ]) {
    while ((match = re.exec(source))) addImage(match[1]);
  }

  return { title, mappings, exclusiveClasses, links, imageCandidates, pageUrl };
}
