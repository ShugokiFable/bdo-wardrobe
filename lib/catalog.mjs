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
  return String(value)
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-zA-Z]+);/g, (m, name) => NAMED_ENTITIES[name.toLowerCase()] ?? m);
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
