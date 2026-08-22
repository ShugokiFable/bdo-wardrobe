// BDO Wardrobe — gallery-first UI
import { loadState, saveState } from './state.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

let CATALOG = { outfits: [], boxes: [], classes: [] };
let FILTER = { q: '', cls: '', box: '', rarity: '', quality: '', sort: 'class' };
let COMPARE = [];
let LIGHTBOX = { list: [], index: 0 };
let CRAWL_TIMER = null;

// ---------- helpers ----------
const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const byId = new Map();
const boxName = new Map();
const className = new Map();

function qualityOf(o) {
  const img = o.image;
  if (!img) return 'missing';
  if (o.fallbackFrom) return 'fallback';
  if (img.provider === 'pearl-abyss' || img.provider === 'pearl-shop-official') return 'official';
  if (img.provider === 'bdo-fashion-upscaled') return 'upscaled';
  return (img.width >= 500) ? 'hq' : 'ok';
}
function shotAspect(o) {
  return Boolean(o.image && o.image.height > o.image.width * 1.4);
}
function badgeFor(o) {
  const q = qualityOf(o);
  if (q === 'official') return '<span class="badge official">Official</span>';
  if (q === 'hq') return '<span class="badge hq">HQ</span>';
  if (q === 'fallback') return `<span class="badge fallback" title="Preview borrowed from the ${esc(o.fallbackFrom)} version of this outfit — no ${esc(o.className)} render exists yet">Fallback: ${esc(o.fallbackFrom)}</span>`;
  return '';
}
function imgOrPlaceholder(o) {
  if (o.image) return `<img loading="lazy" src="${esc(o.image.file)}" alt="${esc(o.className)} — ${esc(o.name)}">`;
  return `<div class="card-ph">No source image</div>`;
}
function cardHTML(o) {
  return `
  <article class="card" data-id="${esc(o.id)}">
    <div class="card-img" data-act="open">${imgOrPlaceholder(o)}</div>
    <div class="card-body">
      <div class="card-class">${esc(o.className)}</div>
      <div class="card-name">${esc(o.name)}</div>
      <div class="card-foot">
        ${badgeFor(o)}
        <div class="card-actions">
          <button class="icon-btn ${state.wardrobe[o.id] === 'favorite' ? 'on' : ''}" data-act="favorite" title="Favorite">♥</button>
          <button class="icon-btn ${state.wardrobe[o.id] === 'owned' ? 'on' : ''}" data-act="owned" title="Owned">✓</button>
          <button class="icon-btn ${state.wardrobe[o.id] === 'wishlist' ? 'on' : ''}" data-act="wishlist" title="Wishlist">⭐</button>
          <button class="icon-btn" data-act="compare" title="Compare">⇄</button>
        </div>
        ${o.boxes?.length ? `<span class="badge" title="${esc(o.boxes.map(b => boxName.get(b) || b).join(', '))}">box</span>` : ''}
      </div>
    </div>
  </article>`;
}

// ---------- state ----------
const state = loadState();

// ---------- boot ----------
async function boot() {
  const res = await fetch('/api/catalog');
  CATALOG = await res.json();
  for (const o of CATALOG.outfits) byId.set(o.id, o);
  for (const b of CATALOG.boxes) boxName.set(b.id, b.name);
  for (const c of CATALOG.classes) className.set(c.id, c.name);
  buildFilters();
  renderBoxes();
  renderClasses();
  renderCompare();
  renderGallery();
  bindChrome();
  pollCrawl();
}
boot();

// ---------- filters ----------
function buildFilters() {
  const counts = new Map();
  for (const o of CATALOG.outfits) counts.set(o.className, (counts.get(o.className) || 0) + 1);
  $('#class-chips').innerHTML = [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    .map(([cls, n]) => `<button class="chip" data-cls="${esc(cls)}">${esc(cls)} <span class="muted">${n}</span></button>`).join('');

  $('#box-select').innerHTML = '<option value="">All boxes</option>' + CATALOG.boxes
    .map(b => `<option value="${esc(b.id)}">${esc(b.name)} (${(b.choices || []).length ? `${(b.choices || []).length} choices` : `${outfitCountForBox(b)} outfits`})</option>`).join('');

  $('#rarity-chips').innerHTML = ['premium', 'outfit', 'classic'].map(r => `<button class="chip" data-rarity="${r}">${r}</button>`).join('');
  $('#quality-chips').innerHTML = [
    ['official', 'Official'], ['hq', 'HQ'], ['ok', 'Standard'], ['upscaled', 'Upscaled'], ['fallback', 'Fallback'], ['missing', 'Missing image']
  ].map(([v, label]) => `<button class="chip" data-quality="${v}">${label}</button>`).join('');
}
function outfitCountForBox(b) {
  return CATALOG.outfits.filter(o => (o.boxes || []).includes(b.id)).length;
}
function filtered() {
  const q = FILTER.q.trim().toLowerCase();
  let list = CATALOG.outfits.filter(o => {
    if (FILTER.cls && o.className !== FILTER.cls) return false;
    if (FILTER.box && !(o.boxes || []).includes(FILTER.box)) return false;
    if (FILTER.rarity && o.rarity !== FILTER.rarity) return false;
    if (FILTER.quality && qualityOf(o) !== FILTER.quality) return false;
    if (q && !(o.name.toLowerCase().includes(q) || o.className.toLowerCase().includes(q))) return false;
    return true;
  });
  const sorters = {
    class: (a, b) => a.className.localeCompare(b.className) || a.name.localeCompare(b.name),
    name: (a, b) => a.name.localeCompare(b.name),
    quality: (a, b) => qualityRank(b) - qualityRank(a) || a.className.localeCompare(b.className),
    largest: (a, b) => (b.image?.width || 0) - (a.image?.width || 0)
  };
  return list.sort(sorters[FILTER.sort] || sorters.class);
}
function qualityRank(o) {
  return { official: 3, hq: 2, ok: 1, fallback: 1, missing: 0 }[qualityOf(o)];
}

function renderGallery() {
  const list = filtered();
  const html = list.map(cardHTML).join('');
  $('#gallery').innerHTML = html;
  $('#gallery-empty').hidden = list.length > 0;
  const covered = list.filter(o => o.image).length;
  $('#filter-stats').textContent = `${list.length} outfits · ${covered} with images (${list.length ? Math.round(100 * covered / list.length) : 0}%)`;
  $('#compare-count').textContent = COMPARE.length;
  $('#compare-count').hidden = COMPARE.length === 0;
}

// ---------- events ----------
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-act]');
  const chip = e.target.closest('.chip[data-cls], .chip[data-rarity], .chip[data-quality]');
  if (chip) {
    const key = chip.dataset.cls !== undefined ? 'cls' : chip.dataset.rarity !== undefined ? 'rarity' : 'quality';
    const val = chip.dataset.cls ?? chip.dataset.rarity ?? chip.dataset.quality;
    FILTER[key] = FILTER[key] === val ? '' : val;
    $$('.chip').forEach(c => { if (c !== chip) c.classList.remove('active'); });
    chip.classList.toggle('active', Boolean(FILTER[key]));
    renderGallery();
    return;
  }
  if (!btn) return;
  const card = btn.closest('[data-id]');
  const id = card?.dataset.id;
  const act = btn.dataset.act;
  if (act === 'open' && id) openLightbox(id);
  if (act === 'favorite' || act === 'owned' || act === 'wishlist') {
    if (!id) return;
    state.wardrobe[id] = state.wardrobe[id] === act ? '' : act;
    if (!state.wardrobe[id]) delete state.wardrobe[id];
    saveState(state);
    e.stopPropagation();
    btn.closest('.card').querySelectorAll('.card-actions .icon-btn').forEach(b => b.classList.toggle('on', b.dataset.act === state.wardrobe[id]));
    if ($('#view-wardrobe').classList.contains('active')) renderWardrobe();
  }
  if (act === 'compare' && id) toggleCompare(id);
});

// ponytail: full-gallery rebuild per keystroke is fine at ~800 cards, sluggish
// at 1,900+ — debounce the search input so typing stays smooth.
let searchTimer = null;
$('#global-search').addEventListener('input', (e) => { FILTER.q = e.target.value; clearTimeout(searchTimer); searchTimer = setTimeout(renderGallery, 160); });
$('#box-select').addEventListener('change', (e) => { FILTER.box = e.target.value; renderGallery(); });
$('#sort-select').addEventListener('change', (e) => { FILTER.sort = e.target.value; renderGallery(); });
$('#clear-filters').addEventListener('click', () => {
  FILTER = { ...FILTER, q: '', cls: '', box: '', rarity: '', quality: '' };
  $('#global-search').value = '';
  $$('.chip').forEach(c => c.classList.remove('active'));
  $('#box-select').value = '';
  renderGallery();
});

function bindChrome() {
  $$('.nav-btn').forEach(btn => btn.addEventListener('click', () => {
    $$('.nav-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    $$('.view').forEach(v => v.classList.remove('active'));
    $(`#view-${btn.dataset.view}`).classList.add('active');
    if (btn.dataset.view === 'wardrobe') renderWardrobe();
    if (btn.dataset.view === 'studio') renderStudio();
  }));
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement !== $('#global-search')) { e.preventDefault(); $('#global-search').focus(); }
    if (e.key === 'Escape') closeLightbox();
    if ($('#lightbox').hidden) return;
    if (e.key === 'ArrowLeft') stepLightbox(-1);
    if (e.key === 'ArrowRight') stepLightbox(1);
    if (e.key.toLowerCase() === 'c') toggleCompare(currentOutfit()?.id);
  });
  $('#lb-close').addEventListener('click', closeLightbox);
  $('#lb-prev').addEventListener('click', () => stepLightbox(-1));
  $('#lb-next').addEventListener('click', () => stepLightbox(1));
  $('#lb-img').addEventListener('click', (e) => e.target.classList.toggle('zoomed'));
  $$('#lightbox [data-act]').forEach(btn => btn.addEventListener('click', () => {
    const o = currentOutfit();
    if (!o) return;
    const act = btn.dataset.act;
    if (act === 'compare') { toggleCompare(o.id); return; }
    state.wardrobe[o.id] = state.wardrobe[o.id] === act ? '' : act;
    if (!state.wardrobe[o.id]) delete state.wardrobe[o.id];
    saveState(state);
    renderLightbox();
    renderGallery();
  }));
  $('#lightbox').addEventListener('click', (e) => { if (e.target.id === 'lightbox') closeLightbox(); });
  $('#lb-img-wrap').addEventListener('click', (e) => { if (e.target.id === 'lb-img-wrap') closeLightbox(); });
}

// ---------- lightbox ----------
function currentOutfit() { return LIGHTBOX.list[LIGHTBOX.index]; }
function openLightbox(id) {
  LIGHTBOX.list = filtered();
  LIGHTBOX.index = Math.max(0, LIGHTBOX.list.findIndex(o => o.id === id));
  $('#lightbox').hidden = false;
  renderLightbox();
}
function closeLightbox() { $('#lightbox').hidden = true; }
function stepLightbox(delta) {
  if (!LIGHTBOX.list.length) return;
  LIGHTBOX.index = (LIGHTBOX.index + delta + LIGHTBOX.list.length) % LIGHTBOX.list.length;
  renderLightbox();
}
function renderLightbox() {
  const o = currentOutfit();
  if (!o) return closeLightbox();
  $('#lb-img').src = o.image ? o.image.file : '';
  $('#lb-img').style.display = o.image ? '' : 'none';
  $('#lb-img').classList.remove('zoomed');
  $('#lb-class').textContent = o.className;
  $('#lb-name').textContent = o.name;
  const q = qualityOf(o);
  if (q === 'fallback') {
    $('#lb-quality').innerHTML = `<span class="badge fallback">Fallback: ${esc(o.fallbackFrom)}</span><span class="badge">${o.image.width}×${o.image.height}</span>`
      + ` <span class="lb-note">Preview borrowed from the ${esc(o.fallbackFrom)} version of this outfit — no ${esc(o.className)} render published yet.</span>`;
  } else {
  $('#lb-quality').innerHTML = q === 'missing' ? '<span class="badge missing">No source image</span>'
    : `<span class="badge ${q === 'official' ? 'official' : q === 'hq' ? 'hq' : q === 'upscaled' ? 'upscaled' : ''}">${q === 'official' ? 'Official' : q === 'hq' ? 'HQ' : q === 'upscaled' ? 'Upscaled' : 'Standard'}</span>`
      + (o.image ? `<span class="badge">${o.image.width}×${o.image.height}</span>` : '');
  }
  $('#lb-meta').innerHTML = [
    ['Rarity', o.rarity || 'outfit'],
    ['Provider', o.image?.provider || '—'],
    ['Boxes', (o.boxes || []).map(b => boxName.get(b) || b).join(', ') || '—']
  ].map(([k, v]) => `<div><span>${k}</span><span>${esc(v)}</span></div>`).join('');
  $('#lb-boxes').innerHTML = (o.boxes || []).map(b => `<span class="badge">${esc(boxName.get(b) || b)}</span>`).join('');
  $$('#lightbox [data-act]').forEach(btn => {
    const act = btn.dataset.act;
    btn.classList.toggle('on', act !== 'compare' && state.wardrobe[o.id] === act);
  });
  const src = o.image?.sourceUrl || (o.sourceUrls || [])[0];
  const a = $('#lb-source');
  if (src) { a.href = src; a.hidden = false; } else { a.hidden = true; }
}

// ---------- boxes / classes ----------
function renderBoxes() {
  $('#box-grid').innerHTML = CATALOG.boxes.map(b => {
    const n = outfitCountForBox(b);
    const choices = (b.choices || []);
    const choiceRows = choices.map(c => {
      const slug = c.replace(/\s+Outfit Box$/i, '').replace(/^\[Shai\]\s*/i, '').trim();
      const matches = CATALOG.outfits.filter(o => o.name === slug);
      return `<li><span>${esc(c)}</span><span class="muted">${matches.length ? `${matches.length} outfits` : 'not in catalog'}</span></li>`;
    }).join('');
    return `
    <article class="card panel" data-box="${esc(b.id)}">
      <h3>${esc(b.name)}</h3>
      <div class="count-big">${n}</div>
      <div class="muted">outfits${choices.length ? ` · ${choices.length} choices` : ''} · ${b.type || ''}</div>
      ${choices ? `<ul class="box-choices">${choiceRows}</ul>` : ''}
      <button class="ghost-btn box-open" data-box-open="${esc(b.id)}">View in gallery →</button>
    </article>`;
  }).join('');
  $$('[data-box-open]').forEach(btn => btn.addEventListener('click', () => {
    FILTER.box = btn.dataset.boxOpen;
    $('#box-select').value = FILTER.box;
    $$('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === 'gallery'));
    $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-gallery'));
    renderGallery();
  }));
}

function renderClasses() {
  const rows = CATALOG.outfits.reduce((acc, o) => {
    const r = acc.get(o.className) || { total: 0, images: 0 };
    r.total++; if (o.image) r.images++;
    acc.set(o.className, r);
    return acc;
  }, new Map());
  $('#class-grid').innerHTML = [...rows.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([cls, r]) => `
    <article class="card panel" data-cls-open="${esc(cls)}">
      <h3>${esc(cls)}</h3>
      <div class="count-big">${r.total}</div>
      <div class="muted">outfits · ${r.images} with images (${r.total ? Math.round(100 * r.images / r.total) : 0}%)</div>
    </article>`).join('');
  $$('[data-cls-open]').forEach(card => card.addEventListener('click', () => {
    FILTER.cls = card.dataset.clsOpen;
    $$('.chip[data-cls]').forEach(c => c.classList.toggle('active', c.dataset.cls === FILTER.cls));
    $$('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === 'gallery'));
    $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-gallery'));
    renderGallery();
  }));
}

// ---------- compare ----------
function toggleCompare(id) {
  if (!id) return;
  const i = COMPARE.indexOf(id);
  if (i >= 0) COMPARE.splice(i, 1);
  else {
    COMPARE.push(id);
    if (COMPARE.length > 4) COMPARE.shift();
  }
  renderCompare();
  renderGallery();
  toast(COMPARE.length ? `Compare: ${COMPARE.length}/4` : 'Compare cleared');
}
function renderCompare() {
  $('#compare-grid').innerHTML = COMPARE.map(id => {
    const o = byId.get(id);
    if (!o) return '';
    return cardHTML(o);
  }).join('') || '<div class="empty">Add outfits with ⇄ from any card or the lightbox (C).</div>';
  $('#compare-count').textContent = COMPARE.length;
  $('#compare-count').hidden = COMPARE.length === 0;
}

// ---------- wardrobe ----------
function renderWardrobe() {
  const activeTab = $('#wardrobe-tabs .chip.active')?.dataset.status || 'favorite';
  const list = Object.entries(state.wardrobe).filter(([, s]) => s === activeTab).map(([id]) => byId.get(id)).filter(Boolean);
  $('#wardrobe-gallery').innerHTML = list.map(cardHTML).join('');
  $('#wardrobe-empty').hidden = list.length > 0;
}
$$('#wardrobe-tabs .chip').forEach(btn => btn.addEventListener('click', () => {
  $$('#wardrobe-tabs .chip').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderWardrobe();
}));
$('#wardrobe-export').addEventListener('click', () => {
  downloadFile(`bdo-wardrobe-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(state.wardrobe, null, 2));
});
$('#wardrobe-import').addEventListener('click', () => $('#import-file').click());
$('#import-file').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (typeof data !== 'object' || !data) throw new Error('bad file');
    for (const [id, s] of Object.entries(data)) {
      if (['favorite', 'owned', 'wishlist'].includes(s) && byId.has(id)) state.wardrobe[id] = s;
    }
    saveState(state); renderWardrobe(); toast('Wardrobe imported');
  } catch { toast('Import failed — not a wardrobe export'); }
  e.target.value = '';
});

// ---------- studio ----------
function downloadFile(name, content) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}
function renderStudio() {
  const covered = CATALOG.outfits.filter(o => o.image).length;
  const total = CATALOG.outfits.length;
  $('#coverage-fill').style.width = `${total ? Math.round(100 * covered / total) : 0}%`;
  $('#coverage-text').textContent = `${covered} / ${total} outfits have images (${Math.round(100 * covered / (total || 1))}%).`;
  const errors = Object.entries(CATALOG.imageStats?.errorMap || {});
  $('#error-list').innerHTML = errors.length ? errors.map(([id, msg]) => `<div><b>${esc(byId.get(id)?.name || id)}</b> — ${esc(msg)}</div>`).join('') : 'None 🎉';
}
async function pollCrawl() {
  clearTimeout(CRAWL_TIMER);
  try {
    const s = await (await fetch('/api/images-state')).json();
    const running = Boolean(s.running);
    $('#crawl-status').textContent = running
      ? `Crawling… ${s.done || 0} / ${s.total || '?'} images`
      : `Library: ${s.done || 0} images. Last run: ${s.finishedAt ? new Date(s.finishedAt).toLocaleString() : '—'}`;
    $('#crawl-missing').disabled = running;
    $('#crawl-all').disabled = running;
    if (running) CRAWL_TIMER = setTimeout(pollCrawl, 3000);
  } catch { CRAWL_TIMER = setTimeout(pollCrawl, 8000); }
}
$('#crawl-missing').addEventListener('click', async () => {
  await fetch('/api/crawl', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  toast('Fetch started'); pollCrawl();
});
$('#crawl-all').addEventListener('click', async () => {
  if (!confirm('Re-crawl all outfits? Existing images are re-downloaded.')) return;
  await fetch('/api/crawl', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"all":true}' });
  toast('Full re-crawl started'); pollCrawl();
});
$('#export-catalog').addEventListener('click', async () => {
  const cat = await (await fetch('/api/catalog')).json();
  downloadFile('bdo-catalog.json', JSON.stringify(cat, null, 2));
});

// ---------- misc ----------
let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 1800);
}
