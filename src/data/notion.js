// Live Notion overlay (SPEC.md > Data flow, step 2).
// Lightdash is a synced copy that lags. On open we read every Bugs & Features issue
// edited in Notion since Lightdash's last sync and patch Start, End, Effort FE/BE/MOB,
// Team and Status onto the Lightdash feature rows before the capacity engine runs.
// Notion values win. Pure functions; the MCP call itself lives in live.js.

import { effectiveCommitted } from '../notion/writes.js';

export const ISSUES_DS = 'collection://18fe3fdb-2a33-4c08-b93c-7fd34931ee01';
const PAGE = 100; // Notion SQL caps every query at 100 rows

// Feature positions in the Lightdash rows (serve_engineering_capacity field order).
const F = { id: 0, title: 1, url: 2, type: 3, status: 5, be: 14, fe: 15, start: 24, end: 25, extractedAt: 28, team: 29, mob: 30 };

/** Notion page id from a page URL, normalised like the engine (no hyphens, lower case). */
export function pageIdFromUrl(url) {
  const m = /([0-9a-f]{32})(?:[?#].*)?$/i.exec(String(url || '').replace(/-/g, ''));
  return m ? m[1].toLowerCase() : null;
}
const nid = (id) => (id ? String(id).replace(/-/g, '').toLowerCase() : '');

/** Latest Lightdash extraction time across the loaded feature rows: the "since" for the overlay. */
export function lastSync(lightdashRows) {
  let max = null;
  for (const r of lightdashRows) {
    const blob = r.serve_engineering_capacity_features;
    for (const f of (typeof blob === 'string' ? JSON.parse(blob || '[]') : blob || [])) {
      const v = f[F.extractedAt];
      if (v && (!max || v > max)) max = v;
    }
  }
  return max;
}

/** Tool input for one page of "edited since" rows (notion-query-data-sources, SQL mode). */
export function overlayQueryInput(sinceIso, offset = 0) {
  return {
    data: {
      data_source_urls: [ISSUES_DS],
      query: `SELECT url, "Name", "Type", "Team", "Status", "Effort FE", "Effort BE", "Effort MOB", "date:Start:start", "date:End:start", "Last edited time" FROM "${ISSUES_DS}" WHERE datetime("Last edited time") > datetime(?) ORDER BY "Last edited time" DESC, url DESC LIMIT ${PAGE} OFFSET ${offset}`,
      params: [sinceIso],
    },
  };
}
export const OVERLAY_PAGE_SIZE = PAGE;

const day = (v) => (v ? String(v).slice(0, 10) : null);
const numOrNull = (v) => (v == null || v === '' ? null : Number(v));

/** Notion SQL result rows → Map(pageId → live values). */
export function parseOverlay(results) {
  const out = new Map();
  for (const r of results || []) {
    const id = pageIdFromUrl(r.url);
    if (!id) continue;
    out.set(id, {
      id, url: r.url, name: r.Name ?? null, type: r.Type ?? null,
      team: r.Team || null, status: r.Status || null,
      fe: numOrNull(r['Effort FE']), be: numOrNull(r['Effort BE']), mob: numOrNull(r['Effort MOB']),
      start: day(r['date:Start:start']), end: day(r['date:End:start']),
      editedAt: r['Last edited time'] || null,
    });
  }
  return out;
}

/**
 * Patch the overlay onto the Lightdash rows. Returns new rows (input untouched) plus
 * a report: which issues changed, and issues edited in Notion that Lightdash has not
 * loaded yet (new since the sync, or outside the loaded rows) — those are added as
 * minimal rows when they have a date, so their effort is not invisible.
 * addMissing: false only patches (for the backlog rows, whose missing issues are in the default row).
 */
export function applyOverlay(lightdashRows, overlay, { addMissing = true } = {}) {
  const seen = new Set();
  const changed = [];
  const rows = lightdashRows.map((r) => {
    const blob = r.serve_engineering_capacity_features;
    if (blob == null) return r;
    const feats = (typeof blob === 'string' ? JSON.parse(blob || '[]') : blob).map((f) => {
      const o = overlay.get(nid(f[F.id]));
      if (!o) return f;
      seen.add(o.id);
      const g = f.slice();
      const before = { start: day(g[F.start]), end: day(g[F.end]), fe: numOrNull(g[F.fe]), be: numOrNull(g[F.be]), mob: numOrNull(g[F.mob]), team: g[F.team] || null, status: g[F.status] || null };
      g[F.start] = o.start; g[F.end] = o.end;
      g[F.fe] = o.fe; g[F.be] = o.be; g[F.mob] = o.mob;
      g[F.team] = o.team; g[F.status] = o.status;
      // Lightdash stores an empty effort as 0, Notion as null: the same thing for capacity.
      const same = (k) => (['fe', 'be', 'mob'].includes(k) ? (before[k] || 0) === (o[k] || 0) : before[k] === o[k]);
      const diff = Object.keys(before).filter((k) => !same(k));
      if (diff.length) changed.push({ id: o.id, name: o.name || g[F.title], fields: diff, before, after: Object.fromEntries(diff.map((k) => [k, o[k]])) });
      return g;
    });
    return { ...r, serve_engineering_capacity_features: JSON.stringify(feats) };
  });

  const added = [];
  const extra = [];
  for (const o of addMissing ? overlay.values() : []) {
    if (seen.has(o.id) || !(o.start || o.end)) continue;
    if (['Done', "Won't do", 'Duplicate'].includes(o.status)) continue;
    const f = new Array(35).fill(null);
    Object.assign(f, { [F.id]: o.id, [F.title]: o.name, [F.url]: o.url, [F.type]: o.type, [F.status]: o.status, [F.fe]: o.fe, [F.be]: o.be, [F.mob]: o.mob, [F.start]: o.start, [F.end]: o.end, [F.team]: o.team });
    extra.push(f);
    added.push({ id: o.id, name: o.name });
  }
  if (extra.length) {
    rows.push({ serve_engineering_capacity_features: JSON.stringify(extra), serve_engineering_capacity_engineering_team_allocations: '[]' });
  }
  return { rows, changed, added };
}

// FR overlay (Tom, 2026-10-27): the same "edited since the Lightdash sync" read for Customer Tasks, so
// an FR edited in the planner (or in Notion) shows its live priority, status and committed date after
// a reload too, not Lightdash's stale copy. Patched onto the customer_tasks rows before scoring.
export const TASKS_DS = 'collection://0d55b141-941e-473a-9240-4983e8790f92';
const T = { id: 0, priority: 4, status: 5, deal: 6, committed: 8 };

export function frOverlayQueryInput(sinceIso, offset = 0) {
  return {
    data: {
      data_source_urls: [TASKS_DS],
      query: `SELECT url, "Priority ", "Status", "date:Success Committed:start", "Last edited time" FROM "${TASKS_DS}" WHERE datetime("Last edited time") > datetime(?) ORDER BY "Last edited time" DESC, url DESC LIMIT ${PAGE} OFFSET ${offset}`,
      params: [sinceIso],
    },
  };
}

/** Notion SQL result rows → Map(FR page id → { priority, status, successCommitted }). */
export function parseFrOverlay(results) {
  const out = new Map();
  for (const r of results || []) {
    const id = pageIdFromUrl(r.url);
    if (id) out.set(id, { priority: r['Priority '] || null, status: r.Status || null, successCommitted: day(r['date:Success Committed:start']) });
  }
  return out;
}

/**
 * Patch the FR overlay onto every customer_tasks column in rows. The committed date is Lightdash's
 * "Committed" formula recomputed: earliest of Success Committed and, for "Needed for go-live", the
 * deal's go-live (golive: Map(deal id → date)); none for Won't do / No longer needed. Returns new rows.
 */
export function applyFrOverlay(rows, overlay, golive = new Map()) {
  if (!overlay?.size) return rows;
  return rows.map((r) => {
    const blob = r.serve_engineering_capacity_customer_tasks;
    if (blob == null) return r;
    let hit = false;
    const tasks = (typeof blob === 'string' ? JSON.parse(blob || '[]') : blob).map((t) => {
      const o = overlay.get(nid(t[T.id]));
      if (!o) return t;
      hit = true;
      const g = t.slice();
      const gone = o.status === "Won't do" || o.priority === "Won't do" || o.priority === 'No longer needed';
      g[T.priority] = o.priority; g[T.status] = o.status;
      g[T.committed] = gone ? null : effectiveCommitted({ successCommitted: o.successCommitted, priority: o.priority, golive: golive.get(nid(g[T.deal])) || null });
      return g;
    });
    return hit ? { ...r, serve_engineering_capacity_customer_tasks: JSON.stringify(tasks) } : r;
  });
}

/** Deal id → go-live date from the deals column of the loaded rows. */
export function goliveMap(rows) {
  const out = new Map();
  for (const r of rows) {
    const blob = r.serve_engineering_capacity_deals;
    for (const d of (typeof blob === 'string' ? JSON.parse(blob || '[]') : blob || [])) if (d[0] && d[5]) out.set(nid(d[0]), String(d[5]).slice(0, 10));
  }
  return out;
}

const idsOf = (v) => (!v ? [] : String(v).trim().startsWith('[') ? JSON.parse(v) : String(v).split(',')).map(nid).filter(Boolean);

/**
 * After the FR overlay (Tom, 2026-10-27): an issue's committed date in Lightdash is a stored copy of its
 * Notion "Committed" formula, the earliest committed date of its FRs. Every issue linked to an FR edited
 * since the sync takes the earliest committed date of its FRs as they are now (none if none). Issues it
 * blocks still pull it earlier in the engine. before/after: rows without / with the overlay.
 */
export function recommitIssues(before, after, overlay) {
  if (!overlay?.size) return after;
  const committedOf = (rows) => {
    const m = new Map();
    for (const r of rows) for (const t of (typeof r.serve_engineering_capacity_customer_tasks === 'string' ? JSON.parse(r.serve_engineering_capacity_customer_tasks || '[]') : r.serve_engineering_capacity_customer_tasks || [])) {
      m.set(nid(t[T.id]), { committed: t[T.committed] ? String(t[T.committed]).slice(0, 10) : null, features: idsOf(t[7]) });
    }
    return m;
  };
  const now = committedOf(after);
  const links = new Map();
  for (const [tid, t] of now) for (const fid of t.features) (links.get(fid) || links.set(fid, new Set()).get(fid)).add(tid);
  const minOf = (ids, m) => [...ids].map((id) => m.get(id)?.committed).filter(Boolean).sort()[0] || null;
  return after.map((r) => {
    const blob = r.serve_engineering_capacity_features;
    if (blob == null) return r;
    let hit = false;
    const feats = (typeof blob === 'string' ? JSON.parse(blob || '[]') : blob).map((f) => {
      const ids = new Set([...(links.get(nid(f[F.id])) || []), ...idsOf(f[12]).filter((x) => now.has(x))]);
      if (![...ids].some((x) => overlay.has(x))) return f;
      const newMin = minOf(ids, now);
      if ((f[26] ? String(f[26]).slice(0, 10) : null) === newMin) return f;
      hit = true; const g = f.slice(); g[26] = newMin; return g;
    });
    return hit ? { ...r, serve_engineering_capacity_features: JSON.stringify(feats) } : r;
  });
}
