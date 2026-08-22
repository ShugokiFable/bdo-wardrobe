// BDO Wardrobe — persisted UI state (localStorage-backed)
// v2→v1 migration: favorites saved under the old "bdo-wardrobe-2" key carry over.
const KEY = 'bdo-wardrobe';
const OLD_KEY = 'bdo-wardrobe-2';
export function loadState() {
  try {
    let raw = localStorage.getItem(KEY);
    if (!raw) {
      const old = localStorage.getItem(OLD_KEY);
      if (old) {
        try { localStorage.setItem(KEY, old); } catch {}
        raw = old;
      }
    }
    return { wardrobe: {}, ...JSON.parse(raw || '{}') };
  } catch { return { wardrobe: {} }; }
}
export function saveState(state) {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {}
}
