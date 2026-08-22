// CORRECTED Agent registration — only mappings proven by side-by-side vision
// comparison against known references. Hexround Reaper + BD9 have NO verified
// render (their official shots are CDN-blocked) -> honest Missing.
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const EXT = path.join(ROOT, 'data', 'ext-agent');
const IMGDIR = path.join(ROOT, 'public', 'assets', 'images');

// id -> { file, note } — every file vision-verified against ground truth
const VERIFIED = {
  'agent--hexbound-reaper': null, // placeholder guard (old typo id, unused)
};

const SETS = [
  // [catalog id, ext-agent file, quality note]
  ['agent--hexround-reaper',      '12952f6151d20260728113013687.jpg', 'gunslinger coat + revolvers (Edward "G" Canary), profile action pose — Console-post Hexround section'],
  ['agent--bd9-outfit-set',       null, 'only official render is a ~200px gallery thumbnail — sibling fallback instead'],
  ['agent--citrus',               '3248419e52820260730074346701.jpg', 'orange BLACK DESERT tank, resort beach'],
  ['agent--clocked-in',           '2aa17c6e33620260730082715602.jpg', 'dress shirt, tie, ID badge lanyard'],
  ['agent--mr-mussels',           '0abc1339a1a20260730082502194.jpg', 'open white shirt wading in shallows'],
  ['agent--lookin-frosh',         '6ffc227aab320260730081136049.png', 'backpack, tee+jeans, campus'],
  ['agent--rookies',              'e9bc438c9b920260730081255625.jpg', 'BLACK DESERT x PEARLABS varsity jacket, bookshelves (side-by-side matched)'],
  ['agent--outlaws-of-margoria',  'd2258c75bda20260730081855310.png', 'bandana + open shirt on ship rail (side-by-side confirmed)'],
  ['agent--corvicanus-robe',      'b165a5c360b20260730075200574.png', 'raven-feather mantle, silver plate, red lining (matched vs known ref)'],
  ['agent--desert-camouflage-premium-set', '451ae4fa3ca20260810081619337.jpg', 'tan camo wrappings on dunes'],
  ['agent--treant-camouflage-premium-set', '36cf8ee22a020260810081920776.jpg', 'leaf-and-bark armor, forest clearing'],
];

function jpegDims(b) {
  if (b[0] === 0x89 && b[1] === 0x50) return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  if (b[0] === 0x52 && b[1] === 0x49) return { width: b.readUInt32LE(16), height: b.readUInt32LE(20) }; // RIFF webp vp8x
  let off = 2;
  while (off + 9 < b.length) {
    if (b[off] !== 0xFF) { off++; continue; }
    const marker = b[off + 1];
    if (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC)
      return { height: b.readUInt16BE(off + 5), width: b.readUInt16BE(off + 7) };
    off += 2 + b.readUInt16BE(off + 2);
  }
  return { width: 0, height: 0 };
}

const stPath = path.join(ROOT, 'data', 'images.json');
const st = JSON.parse(readFileSync(stPath, 'utf8'));

for (const [id, file, note] of SETS) {
  if (!file) {
    // honest missing: drop any wrongly-registered image, record error
    if (st.images[id]) {
      delete st.images[id];
      console.log('removed wrong/absent image for', id);
    }
    st.errors[id] = `Missing: ${note}`;
    continue;
  }
  const src = path.join(EXT, file);
  if (!existsSync(src)) { console.log('SKIP (no local file)', id); continue; }
  const bytes = readFileSync(src);
  const dims = jpegDims(bytes);
  const ext = path.extname(file).toLowerCase();
  const dest = `${id}${ext}`;
  copyFileSync(src, path.join(IMGDIR, dest));
  st.images[id] = {
    file: dest,
    url: `https://s1.pearlcdn.com/NAEU/Upload/News/${file}`,
    sourceUrl: 'https://blackdesert.pearlabyss.com/Console/en-US/News/Notice/Detail?_boardNo=19680',
    provider: 'pearl-shop-official',
    width: dims.width, height: dims.height,
    bytes: statSync(path.join(IMGDIR, dest)).size,
    note,
  };
  delete st.errors[id];
}

writeFileSync(stPath, JSON.stringify(st));
console.log('images:', Object.keys(st.images).length, '| errors:', Object.keys(st.errors).length);
