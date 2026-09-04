export const uniq = values => [...new Set((values || []).filter(Boolean))];

// Pearl-guide/v1 source data carries raw HTML entities in outfit names
// ("Jarette&#8217;s Armor", "Inquirer&rsquo;s Destiny"). Decode once at build time
// so ids, slugs, source-URL guesses, and UI display all see real characters.
const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“',
  hellip: '…', mdash: '—', ndash: '–'
};

export function decodeHtmlEntities(value = '') {
  return String(value).replace(/&(#x[0-9a-f]+|#\d+|[a-zA-Z]+);/gi, (match, ent) => {
    try {
      if (ent[0] === '#') {
        const hex = ent[1] === 'x' || ent[1] === 'X';
        const code = hex ? parseInt(ent.slice(2), 16) : Number(ent.slice(1));
        if (!Number.isInteger(code) || code < 0 || code > 0x10ffff) return match;
        return String.fromCodePoint(code);
      }
      return NAMED_ENTITIES[ent.toLowerCase()] ?? match;
    } catch {
      return match;
    }
  });
}

const SKIP_TAGS = new Set(['script', 'style', 'noscript', 'template']);
const BLOCK_CLOSE_TAGS = new Set(['div', 'p', 'li', 'tr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

function isHtmlNameChar(c) {
  return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c === '-' || c === ':';
}

function skipQuotedTagEnd(html, start) {
  let quote = '';
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (quote) {
      if (c === quote) quote = '';
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === '>') {
      return i + 1;
    }
  }
  return html.length;
}

function skipUntilCloseTag(html, start, name) {
  const n = html.length;
  const lower = name.toLowerCase();
  let i = start;
  while (i < n) {
    const lt = html.indexOf('<', i);
    if (lt < 0) return n;
    let k = lt + 1;
    if (html[k] !== '/') {
      i = lt + 1;
      continue;
    }
    k += 1;
    while (k < n && (html[k] === ' ' || html[k] === '\t' || html[k] === '\n' || html[k] === '\r' || html[k] === '\f')) k += 1;
    const nameStart = k;
    while (k < n && isHtmlNameChar(html[k])) k += 1;
    if (html.slice(nameStart, k).toLowerCase() === lower) return skipQuotedTagEnd(html, k);
    i = lt + 1;
  }
  return n;
}

// Extract visible text from scraped HTML. Not an XSS sanitizer — do not re-parse
// or execute the result as markup. Script/style bodies are dropped by a tag
// walker; entities are decoded once.
export function htmlToText(html = '', { blocks = false } = {}) {
  const source = String(html || '');
  let out = '';
  let i = 0;
  const n = source.length;
  while (i < n) {
    if (source[i] !== '<') {
      out += source[i++];
      continue;
    }
    if (source.startsWith('<!--', i)) {
      const bang = source.indexOf('--!>', i + 4);
      const normal = source.indexOf('-->', i + 4);
      let end = -1;
      if (normal >= 0 && (bang < 0 || normal <= bang)) end = normal + 3;
      else if (bang >= 0) end = bang + 4;
      i = end < 0 ? n : end;
      continue;
    }
    const next = source[i + 1];
    if (next === '!') {
      i = skipQuotedTagEnd(source, i + 2);
      continue;
    }
    const isClose = next === '/';
    let j = i + (isClose ? 2 : 1);
    if (j >= n || !isHtmlNameChar(source[j])) {
      out += source[i++];
      continue;
    }
    const nameStart = j;
    while (j < n && isHtmlNameChar(source[j])) j += 1;
    const name = source.slice(nameStart, j).toLowerCase();
    const tagEnd = skipQuotedTagEnd(source, j);
    const inner = source.slice(i + 1, tagEnd - (tagEnd > i && source[tagEnd - 1] === '>' ? 1 : 0));
    const selfClose = inner.trimEnd().endsWith('/');
    if (SKIP_TAGS.has(name) && !isClose && !selfClose) {
      out += ' ';
      i = skipUntilCloseTag(source, tagEnd, name);
      continue;
    }
    if (blocks && (name === 'br' || (isClose && BLOCK_CLOSE_TAGS.has(name)))) out += '\n';
    else out += ' ';
    i = tagEnd;
  }
  if (blocks) return decodeHtmlEntities(out.replace(/[ \t]+/g, ' ').replace(/\n\s+/g, '\n'));
  return decodeHtmlEntities(out).replace(/\s+/g, ' ').trim();
}

export function slugify(value = '') {
  return String(value)
    .normalize('NFKD')
    .replace(/[’']/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

export function outfitId(className, name) {
  return `${slugify(className)}--${slugify(name)}`;
}

export function normalizeCatalog(input = {}) {
  const boxMap = new Map();
  for (const raw of input.boxes || []) {
    if (!raw?.name) continue;
    const id = raw.id || slugify(raw.name);
    const previous = boxMap.get(id) || {};
    boxMap.set(id, {
      id,
      name: raw.name,
      type: raw.type || previous.type || 'outfit-box',
      sourceUrl: raw.sourceUrl || previous.sourceUrl || '',
      description: raw.description || previous.description || '',
      availability: raw.availability || previous.availability || 'unknown',
      choices: uniq([...(previous.choices || []), ...(raw.choices || [])]),
      tags: uniq([...(previous.tags || []), ...(raw.tags || [])])
    });
  }

  const outfitMap = new Map();
  for (const raw of input.outfits || []) {
    if (!raw?.className || !raw?.name) continue;
    const id = raw.id || outfitId(raw.className, raw.name);
    const previous = outfitMap.get(id) || {};
    outfitMap.set(id, {
      id,
      classId: raw.classId || previous.classId || slugify(raw.className),
      className: raw.className,
      name: raw.name,
      rarity: (raw.rarity && raw.rarity !== 'outfit') ? raw.rarity : (previous.rarity || raw.rarity || 'outfit'),
      boxes: uniq([...(previous.boxes || []), ...(raw.boxes || [])]),
      previewUrls: uniq([...(previous.previewUrls || []), ...(raw.previewUrls || [])]),
      sourceUrls: uniq([...(previous.sourceUrls || []), ...(raw.sourceUrls || [])]),
      tags: uniq([...(previous.tags || []), ...(raw.tags || [])])
    });
  }

  const classMap = new Map();
  for (const raw of input.classes || []) {
    if (!raw?.name) continue;
    const id = raw.id || slugify(raw.name);
    const previous = classMap.get(id) || {};
    classMap.set(id, { id, name: raw.name, gender: (raw.gender && raw.gender !== 'unknown') ? raw.gender : (previous.gender || 'unknown'), status: (raw.status && raw.status !== 'unknown') ? raw.status : (previous.status || 'live') });
  }
  for (const outfit of outfitMap.values()) {
    if (!classMap.has(outfit.classId)) {
      classMap.set(outfit.classId, { id: outfit.classId, name: outfit.className, gender: 'unknown', status: 'live' });
    }
  }

  return {
    meta: {
      version: input.meta?.version || 1,
      generatedAt: input.meta?.generatedAt || new Date().toISOString(),
      verifiedAt: input.meta?.verifiedAt || '',
      sources: uniq(input.meta?.sources || [])
    },
    classes: [...classMap.values()].sort((a,b) => a.name.localeCompare(b.name)),
    boxes: [...boxMap.values()],
    outfits: [...outfitMap.values()].sort((a,b) => a.className.localeCompare(b.className) || a.name.localeCompare(b.name))
  };
}

export function mergeCatalogs(base = {}, incoming = {}) {
  const a = normalizeCatalog(base);
  const b = normalizeCatalog(incoming);
  return normalizeCatalog({
    meta: {
      version: Math.max(a.meta.version || 1, b.meta.version || 1),
      generatedAt: new Date().toISOString(),
      verifiedAt: b.meta.verifiedAt || a.meta.verifiedAt,
      sources: uniq([...(a.meta.sources || []), ...(b.meta.sources || [])])
    },
    classes: [...a.classes, ...b.classes],
    boxes: [...a.boxes, ...b.boxes],
    outfits: [...a.outfits, ...b.outfits]
  });
}

export function reverseLookup(catalog, outfitOrId) {
  const normalized = normalizeCatalog(catalog);
  const id = typeof outfitOrId === 'string' ? outfitOrId : outfitOrId?.id;
  const outfit = normalized.outfits.find(o => o.id === id);
  if (!outfit) return [];
  const order = new Map(normalized.boxes.map((box, index) => [box.id, index]));
  return normalized.boxes
    .filter(box => outfit.boxes.includes(box.id))
    .sort((a,b) => (order.get(a.id) ?? 9999) - (order.get(b.id) ?? 9999));
}
