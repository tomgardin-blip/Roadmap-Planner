// Live Notion overlay (SPEC.md > Data flow, step 2).
// Lightdash is a synced copy that lags. On open we read every Bugs & Features issue
// edited in Notion since Lightdash's last sync and patch Start, End, Effort FE/BE/MOB,
// Team and Status onto the Lightdash feature rows before the capacity engine runs.
// Notion values win. Pure functions; the MCP call itself lives in live.js.

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
 */
export function applyOverlay(lightdashRows, overlay) {
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
  for (const o of overlay.values()) {
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
