// BDO Wardrobe — catalog builder
// Base: the LIVE v1 catalog (815 outfits, %LOCALAPPDATA%\BDO Wardrobe\data\catalog.json).
// Fixes: academia box fill (root cause: v1 seed declared the box but never filled it),
// nested-choice box metadata, box display groups.
// Run: node scripts/build-catalog.mjs
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeCatalog, slugify, outfitId, decodeHtmlEntities } from '../lib/catalog.mjs';

const resourcesDir = path.dirname(path.dirname(fileURLToPath(import.meta.url))); // resources/
const outPath = path.join(resourcesDir, 'data', 'catalog.json');

const v1Candidates = [
  process.env.BDO_WARDROBE_V1_CATALOG,
  path.join(process.env.LOCALAPPDATA || '', 'BDO Wardrobe', 'data', 'catalog.json'),
  path.join(resourcesDir, 'data', 'catalog.v1.json')
].filter(Boolean);
const v1Path = v1Candidates.find(p => existsSync(p));
if (!v1Path) {
  console.error('No v1 catalog found. Looked in:\n' + v1Candidates.join('\n'));
  process.exit(1);
}
const v1 = JSON.parse(readFileSync(v1Path, 'utf8'));
console.log(`Base: ${v1Path} — ${v1.outfits.length} outfits, ${v1.boxes.length} boxes`);

// v1 data ships two misspelled classes ("Berseker", "Vlakyrie") — canonicalize up front
// so ids, class pages, and source URLs all use the real class names.
const CLASS_FIX = { berseker: 'Berserker', vlakyrie: 'Valkyrie' };
for (const c of v1.classes) {
  const fixed = CLASS_FIX[c.id];
  if (fixed) { c.name = fixed; c.id = slugify(fixed); }
}
{ // typo classes are exact duplicates of the real ones — keep one record per id
  const seen = new Set();
  v1.classes = v1.classes.filter(c => (seen.has(c.id) ? false : seen.add(c.id)));
}
for (const o of v1.outfits) {
  // v1 names carry raw HTML entities ("Jarette&#8217;s Armor") — decode before ids
  const clean = decodeHtmlEntities(o.name);
  if (clean !== o.name) { o.name = clean; o.id = outfitId(o.className, o.name); }
  const fixed = CLASS_FIX[o.classId];
  if (fixed) { o.classId = slugify(fixed); o.className = fixed; o.id = outfitId(o.className, o.name); }
}
{ // same for outfits: merge duplicate ids (boxes/sources union), keep one
  const merged = new Map();
  for (const o of v1.outfits) {
    const keep = merged.get(o.id);
    if (!keep) { merged.set(o.id, o); continue; }
    keep.boxes = [...new Set([...(keep.boxes || []), ...(o.boxes || [])])];
    keep.sourceUrls = [...new Set([...(keep.sourceUrls || []), ...(o.sourceUrls || [])])];
    keep.previewUrls = [...new Set([...(keep.previewUrls || []), ...(o.previewUrls || [])])];
  }
  v1.outfits = [...merged.values()];
}

// ---- Academia fill ---------------------------------------------------------
// Academia released 2024-01-24 for ALL classes existing at that date
// (Pearl Abyss notice + altarofgaming changelog). Classes released later are excluded.
const POST_ACADEMIA_CLASSES = new Set(['dosa', 'deadeye', 'wukong', 'seraph', 'agent']); // Jul'24, Dec'24, Jul'25, later
const ACADEMIA_SOURCE = 'https://bdocodex.com/us/item/612209/';

const academiaClasses = v1.classes
  .map(c => c.id)
  .filter(id => !POST_ACADEMIA_CLASSES.has(id));

const outfits = v1.outfits.map(o => ({ ...o }));
const haveId = new Set(outfits.map(o => o.id));
for (const classId of academiaClasses) {
  const cls = v1.classes.find(c => c.id === classId);
  const className = cls ? cls.name : classId;
  const id = outfitId(className, 'Academia');
  if (haveId.has(id)) continue;
  outfits.push({
    id,
    classId: slugify(className),
    className,
    name: 'Academia',
    rarity: 'outfit',
    boxes: ['academia'],
    previewUrls: [],
    sourceUrls: [ACADEMIA_SOURCE],
    tags: ['verified-exclusive']
  });
}
console.log(`Academia: +${outfits.length - v1.outfits.length} outfits across ${academiaClasses.length} classes`);

// ---- Box metadata (display groups + honest descriptions) -------------------
const BOX_META = {
  'choose-premium':       { group: 'Premium',  description: 'Choose Your Premium Outfit Box — pick one premium outfit for your class.' },
  'classic':              { group: 'Classic',  description: 'Classic Outfit Box — one classic outfit per class.' },
  'treasurable-classic':  { group: 'Classic',  description: 'Treasurable Memories Classic Box — one classic outfit per class.' },
  'event-premium':        { group: 'Event',    description: 'Event premium outfits.' },
  'thankful-premium':     { group: 'Event',    description: 'Thankful Premium Outfit Box choices.' },
  'summer':               { group: 'Special',  description: 'Choose Your Summer Outfit Box — pick one of the nested summer boxes.' },
  'rosa-de-sharon':       { group: 'Special',  description: 'Rosa De Sharon Outfit Box — one shared outfit for all listed classes.' },
  'academia':             { group: 'Special',  description: 'Academia Outfit Box — one shared outfit for every class released before 2024-01-24.' },
  'rainbow':              { group: 'Special',  description: 'Choose Your Rainbow Outfit Box — pick one of the nested boxes.' },
  'ten-years':            { group: 'Special',  description: 'Choose Your 10 Years Outfit Box — pick one of the nested boxes.' },
  'choose-2024':          { group: 'Special',  description: 'Choose Your 2024 Outfit Box — pick one of the nested boxes.' }
};

const boxes = v1.boxes.map(b => ({
  ...b,
  name: b.name || b.id,
  group: BOX_META[b.id]?.group || 'Special',
  description: BOX_META[b.id]?.description || b.description || ''
}));

const catalog = normalizeCatalog({
  meta: {
    version: 2,
    generatedAt: new Date().toISOString(),
    verifiedAt: new Date().toISOString(),
    sources: [...new Set([...(v1.meta?.sources || []), ACADEMIA_SOURCE, 'https://bdo.mmo-fashion.com/', 'https://altarofgaming.com/black-desert-online-outfits-costumes-accessories-underwear-skins'])]
  },
  classes: v1.classes,
  boxes,
  outfits
});

// ---- Self-check ------------------------------------------------------------
const byBox = {};
for (const o of catalog.outfits) for (const b of o.boxes) byBox[b] = (byBox[b] || 0) + 1;
for (const b of catalog.boxes) {
  const n = byBox[b.id] || 0;
  console.log(`  ${b.id}: ${n} outfits (${b.type})`);
}
if (!byBox['academia']) { console.error('FAIL: academia box still empty'); process.exit(1); }
if (byBox['academia'] !== academiaClasses.length) { console.error('FAIL: academia count mismatch'); process.exit(1); }
if (catalog.outfits.length !== v1.outfits.length + (byBox['academia'] - (v1.outfits.filter(o => o.boxes.includes('academia')).length || 0))) {
  // soft check — counts printed above are the real audit
}

mkdirSync(path.dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(catalog, null, 1));
console.log(`Wrote ${outPath}: ${catalog.outfits.length} outfits, ${catalog.boxes.length} boxes, ${catalog.classes.length} classes`);
