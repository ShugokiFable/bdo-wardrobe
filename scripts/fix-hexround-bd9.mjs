// Final Agent corrections:
// 1) hexround-reaper <- 0c2c4d11...png (beaked reaper, premium outfit)
// 2) bd9-outfit-set -> REMOVE wrong image (tiny-thumb product has no usable
//    render) so server sibling-fallback (Archer, gender-matched) takes over.
import { readFileSync, writeFileSync, copyFileSync, existsSync, statSync } from 'node:fs';
const RES = 'Z:/Backup/Ai Apps/Apps/BDO-Wardrobe/resources';
const st = JSON.parse(readFileSync(`${RES}/data/images.json`, 'utf8'));
st.images ??= {}; st.errors ??= {};

function pngDim(b){ return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) }; }
function jpgDim(b){ let o=2; while(o+9<b.length){ if(b[o]!==0xFF){o++;continue;} const m=b[o+1]; const l=b.readUInt16BE(o+2);
  if(m>=0xC0&&m<=0xCF&&m!==0xC4&&m!==0xC8&&m!==0xCC) return { width:b.readUInt16BE(o+7), height:b.readUInt16BE(o+5) }; o+=2+l; } return null; }

// --- 1) Hexround Reaper ---
const src = `${RES}/data/ext-agent/0c2c4d11bf520260730075231705.png`;
if (!existsSync(src)) throw new Error('missing source file');
const buf = readFileSync(src);
const d = pngDim(buf);
copyFileSync(src, `${RES}/public/assets/images/agent--hexround-reaper.png`);
st.images['agent--hexround-reaper'] = {
  file: 'agent--hexround-reaper.png',
  url: 'https://www.naeu.playblackdesert.com/news/announcement/10399',
  sourceUrl: 'https://s1.pearlcdn.com/NAEU/Upload/News/0c2c4d11bf520260730075231705.png',
  provider: 'pearl-shop-official',
  width: d.width, height: d.height,
  addedFrom: 'agent-launch-post'
};
delete st.errors['agent--hexround-reaper'];
console.log('hexround registered:', JSON.stringify(d));

// --- 2) BD9: drop wrong image, let sibling-fallback serve ---
delete st.images['agent--bd9-outfit-set'];
st.errors['agent--bd9-outfit-set'] = 'No usable official render exists (gallery thumbnail is ~200px). Serving gender-matched sibling fallback.';
console.log('bd9 image removed -> fallback');

writeFileSync(`${RES}/data/images.json`, JSON.stringify(st, null, 1));
console.log('done | total images:', Object.keys(st.images).length);
