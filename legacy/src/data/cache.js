// Local browser cache (Tom, 2026-11-18, Liam's tip: "local browse caching … should mean it loads instantly and only
// updates rather than re-pulling on every refresh"). The last full live load is kept in this browser's IndexedDB
// (per viewer, per browser; never shared, never sent anywhere). On open the planner shows it at once and refreshes
// from Lightdash and Notion behind it. Structured clone keeps Maps and Sets as they are.
// Every call is wrapped: a private window, blocked storage or a full disk just means no cache.

const DB = 'roadmap-planner';
const STORE = 'snapshot';
const KEY = 'last';
// Bump when the shape of what is stored changes, so an old snapshot is ignored instead of misread.
export const CACHE_VERSION = 1;
// Older than this, the snapshot is not shown (a week-old plan is more misleading than a spinner).
export const CACHE_MAX_AGE_MS = 3 * 864e5;

function open() {
  return new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    } catch (e) { reject(e); }
  });
}

async function tx(mode, fn) {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const r = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(r?.result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  } finally { db.close(); }
}

/** The cached snapshot if usable ({ v, at, ... }), else null. */
export async function readCache(now = Date.now()) {
  try {
    const snap = await tx('readonly', (s) => s.get(KEY));
    return usable(snap, now) ? snap : null;
  } catch { return null; }
}

export const usable = (snap, now = Date.now()) => !!snap && snap.v === CACHE_VERSION && Array.isArray(snap.rows)
  && Number.isFinite(Date.parse(snap.at)) && now - Date.parse(snap.at) <= CACHE_MAX_AGE_MS;

/** Store the snapshot; false when the browser refuses (quota, private mode). */
export async function writeCache(snap) {
  try { await tx('readwrite', (s) => s.put({ ...snap, v: CACHE_VERSION }, KEY)); return true; } catch { return false; }
}

export async function clearCache() {
  try { await tx('readwrite', (s) => s.delete(KEY)); } catch { /* nothing to clear */ }
}
