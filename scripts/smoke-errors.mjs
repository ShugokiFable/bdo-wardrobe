// Smoke: every distinct failure pattern from the user's error report
import { resolveOutfitPreview } from '../lib/source-fetch.mjs';
import { slugify } from '../lib/catalog.mjs';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36';
const slugIndex = [];
const idx = await (await fetch('https://bdo.mmo-fashion.com/wp-sitemap.xml', { headers: { 'User-Agent': UA } })).text();
for (const sub of [...idx.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]).filter(u => /post-sitemap\d*\.xml$/.test(u))) {
  const xml = await (await fetch(sub, { headers: { 'User-Agent': UA } })).text();
  for (const m of xml.matchAll(/<loc>https:\/\/bdo\.mmo-fashion\.com\/([^\/]+)\/<\/loc>/g)) slugIndex.push(m[1]);
}
console.log('slugIndex:', slugIndex.length);

const cases = [
  ['Berserker', 'Ulfhedinn Ornamental Knot'],  // weapon-token false reject
  ['Berserker', 'Ulfhedinn Axe'],
  ['Maehwa', "Te'enah"],                        // SEO title
  ['Woosa', "Orzeca's Rose"],                   // SEO title
  ['Maegu', "Orzeca's Rose"],
  ['Ranger', "Jarette's Armor"],                // prefix name match
  ['Valkyrie', 'Venslar (Long Boots)'],         // boots token
  ['Valkyrie', 'Venslar'],
  ['Shai', 'Blanchard Headpiece'],              // headpiece token
  ['Witch', 'Dreaming Star'],                   // slug discovery -> dreaming-stars
  ['Wizard', "Sage's Memory"],                  // slug discovery -> memory-of-sage
  ['Nova', 'Rosa De Sharon'],                   // wayback snapshot
  ['Musa', "Nouse's Shard"],
  ['Lahn', 'Orchid Fall'],                      // prefix -> crescent-pendulum page
  ['Warrior', 'Cornelius N'],                   // expected: genuinely absent
  ['Berserker', 'Academia'],                    // expected: genuinely absent
];

let ok = 0, expectedFail = 0, unexpected = 0;
for (const [className, name] of cases) {
  const outfit = { className, name, sourceUrls: [] };
  try {
    const r = await resolveOutfitPreview(outfit, { officialRows: [], slugIndex });
    const u = (r.previewUrls || [])[0] || '';
    console.log('OK  ', `${className} — ${name}`.padEnd(38), r.provider.padEnd(12), u.slice(0, 90));
    ok++;
  } catch (e) {
    const msg = String(e.message).split('.')[0];
    console.log('FAIL', `${className} — ${name}`.padEnd(38), msg.slice(0, 80));
    if (['Cornelius N', 'Academia'].includes(name)) expectedFail++; else unexpected++;
  }
}
console.log(`\nresolved=${ok} expected-fail=${expectedFail} UNEXPECTED=${unexpected}`);
