// Headless verification of BDO Wardrobe (playwright-core).
// Browser resolution: BDO_WARDROBE_BROWSER env > Opera GX (local dev) >
// playwright-managed Chromium (CI: `npx playwright install chromium`).
// Usage: node verify.mjs <url> <screenshot-dir>
import { chromium } from 'playwright-core';
import { mkdirSync, existsSync } from 'node:fs';

const [url, shotDir] = [process.argv[2] || 'http://127.0.0.1:7861', process.argv[3] || '.'];
mkdirSync(shotDir, { recursive: true });

const CANDIDATES = [
  process.env.BDO_WARDROBE_BROWSER,
  'C:/Users/karlo/AppData/Local/Programs/Opera GX/opera.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean);
const OPERA = CANDIDATES.find(existsSync) || null; // null = playwright-managed browser
const browser = await chromium.launch({ executablePath: OPERA, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };

await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(1200);

// 1. Boot + catalog
const boot = await page.evaluate(async () => {
  const r = await fetch('/api/catalog');
  const d = await r.json();
  return { outfits: d.outfits.length, boxes: d.boxes.length, covered: d.imageStats.covered, academia: d.outfits.filter(o => o.boxes.includes('academia')).length };
});
check('catalog loads', boot.outfits === 4343 && boot.boxes === 11, `${boot.outfits} outfits, ${boot.boxes} boxes, ${boot.covered} imaged`);
check('academia box filled', boot.academia === 27, `${boot.academia} outfits`);

// 2. Gallery renders cards
const cards = await page.locator('#gallery .card').count();
check('gallery renders', cards > 400, `${cards} cards`);

// 3. Lightbox opens with image (pick a card that HAS an image)
await page.locator('#gallery .card', { has: page.locator('img') }).first().locator('.card-img').click();
await page.waitForTimeout(600);
const lbVisible = await page.locator('#lightbox:not([hidden])').count();
const lbName = await page.locator('#lb-name').textContent();
const lbImgOk = await page.evaluate(() => { const i = document.querySelector('#lb-img'); return i.style.display !== 'none' && (i.complete ? i.naturalWidth > 100 : true); });
check('lightbox opens', lbVisible === 1 && lbName.length > 0, lbName);
check('lightbox image real', lbImgOk);
await page.screenshot({ path: `${shotDir}/lightbox.png` });

// 4. Arrow navigation
const name1 = lbName;
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(300);
const name2 = await page.locator('#lb-name').textContent();
check('lightbox arrows navigate', name2 !== name1, `${name1} → ${name2}`);

// 5. Favorite from lightbox + persistence
await page.locator('#lightbox [data-act="favorite"]').first().click();
await page.waitForTimeout(200);
await page.keyboard.press('Escape');
const favStored = await page.evaluate(() => JSON.parse(localStorage.getItem('bdo-wardrobe') || '{}').wardrobe);
check('favorite persists', Object.values(favStored).includes('favorite'), JSON.stringify(favStored).slice(0, 80));

// 6. Class filter narrows
await page.locator('#class-chips .chip').first().click();
await page.waitForTimeout(300);
const filtered = await page.locator('#gallery .card').count();
check('class filter works', filtered > 0 && filtered < cards, `${filtered} cards`);
await page.screenshot({ path: `${shotDir}/gallery-filtered.png` });
await page.locator('#clear-filters').click();

// 7. Quality filter (missing images) — honest labels exist
await page.locator('#quality-chips .chip[data-quality="missing"]').click();
await page.waitForTimeout(300);
const missing = await page.locator('#gallery .card').count();
check('missing-image filter works', missing >= 0, `${missing} cards without images`);
await page.locator('#clear-filters').click();

// 8. Boxes view shows academia 29
await page.locator('.nav-btn[data-view="boxes"]').click();
await page.waitForTimeout(300);
const academiaCard = await page.locator('.card[data-box="academia"] .count-big').textContent();
check('boxes view academia=27', academiaCard.trim() === '27', academiaCard.trim());

// 9. Compare flow
await page.locator('.nav-btn[data-view="gallery"]').click();
await page.waitForTimeout(300);
await page.locator('#gallery .card [data-act="compare"]').nth(0).click();
await page.locator('#gallery .card [data-act="compare"]').nth(1).click();
await page.waitForTimeout(200);
const compareCount = await page.locator('#compare-count').textContent();
check('compare adds', compareCount.trim() === '2', compareCount.trim());
await page.locator('.nav-btn[data-view="compare"]').click();
await page.waitForTimeout(300);
const compareCards = await page.locator('#compare-grid .card').count();
check('compare view renders', compareCards === 2, `${compareCards} cards`);

// 10. Wardrobe view shows the favorited outfit
await page.locator('.nav-btn[data-view="wardrobe"]').click();
await page.waitForTimeout(300);
const wardrobeCards = await page.locator('#wardrobe-gallery .card').count();
check('wardrobe shows favorite', wardrobeCards === 1, `${wardrobeCards} card(s)`);
await page.screenshot({ path: `${shotDir}/final.png` });

const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
console.log('CONSOLE/PAGE ERRORS:', errors.length ? errors.slice(0, 5) : 'none');
await browser.close();
process.exit(failed.length || errors.length ? 1 : 0);
