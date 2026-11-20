// "What changed since you last planned" (Tom, 2026-11-06, History): why a team is overbooked again in the
// current or next quarter while it was fine when he last planned it. Only other people's changes: moves,
// clears and status changes made in the planner are left out.
//
// How: Lightdash keeps a daily snapshot of every engineering issue (serve_engineering_features_snapshot,
// dbt SCD2, from 06/10/2026). The issues that changed since the compare time T are put back to their
// version at T in the loaded rows, and issues created after T are taken out; the capacity engine then runs
// on those "then" rows and on today's rows, so each issue's days per team × skill × quarter are the
// engine's own numbers, before and after. The difference per issue is what it added or freed.
// Not covered: FR commit changes (an undated committed issue's TBD quarter) and capacity changes.
// Pure functions; the Lightdash calls live in data/live.js.

import { TEAMS, SKILLS, cellIssues, buildGrid } from './capacity.js';

const S = 'serve_engineering_features_snapshot';
const PROJECT_FIELDS = ['notion_page_id', 'title', 'team', 'type', 'status', 'start_date_day', 'end_date_day',
  'effort_frontend', 'effort_backend', 'effort_mobile', 'assigned_to', 'dbt_valid_from_raw', 'dbt_valid_to_raw', 'dbt_is_deleted'];
export const SNAPSHOT_START = '2026-10-06';
const nid = (x) => String(x || '').replace(/-/g, '').toLowerCase();
const day = (v) => (v ? String(v).slice(0, 10) : null);
const ts = (fieldId, operator, value) => ({ fieldId: `${S}_${fieldId}`, fieldType: 'timestamp', fieldFilterType: 'date', operator, values: [value] });

/** Lightdash query: the version of every issue valid at T that has changed since (valid_from ≤ T < valid_to). */
export function versionsAtQuery(T) {
  return {
    exploreName: S, dimensions: PROJECT_FIELDS.map((f) => `${S}_${f}`), metrics: [], sorts: [], limit: 5000,
    filters: { type: 'and', dimensions: [ts('dbt_valid_from_raw', 'lessThanOrEqual', T), ts('dbt_valid_to_raw', 'greaterThan', T)] },
  };
}
/** Lightdash query: ids of issues with a version that started after T (with versionsAt, finds issues created after T). */
export function touchedSinceQuery(T) {
  return { exploreName: S, dimensions: [`${S}_notion_page_id`], metrics: [], sorts: [], limit: 5000, filters: { type: 'and', dimensions: [ts('dbt_valid_from_raw', 'greaterThan', T)] } };
}

const emails = (v) => { if (!v || v === 'null') return []; try { const a = JSON.parse(v); return Array.isArray(a) ? a.filter((s) => String(s).includes('@')) : []; } catch { return []; } };
/** Snapshot rows → Map(issue id → its version at T). */
export function parseVersions(rows) {
  const out = new Map();
  for (const r of rows || []) {
    const g = (f) => r[`${S}_${f}`];
    const id = nid(g('notion_page_id'));
    if (!id) continue;
    out.set(id, {
      id, name: g('title') || '', type: g('type') || null, team: g('team') || null, status: g('status') || null,
      start: day(g('start_date_day')), end: day(g('end_date_day')),
      fe: Number(g('effort_frontend')) || 0, be: Number(g('effort_backend')) || 0, mob: Number(g('effort_mobile')) || 0,
      assigned: emails(g('assigned_to')), from: g('dbt_valid_from_raw'), changedAt: g('dbt_valid_to_raw'),
      deleted: String(g('dbt_is_deleted')) === 'True',
    });
  }
  return out;
}
export const touchedIds = (rows) => new Set((rows || []).map((r) => nid(r[`${S}_notion_page_id`])).filter(Boolean));

// Feature positions in the Lightdash rows (as data/notion.js).
const F = { id: 0, title: 1, url: 2, type: 3, status: 5, assigned: 6, be: 14, fe: 15, start: 24, end: 25, team: 29, mob: 30 };
const blob = (v) => (typeof v === 'string' ? JSON.parse(v || '[]') : v || []);

/**
 * What the planner itself changed on an issue after its version at T was taken (anyone using the planner;
 * Tom: "the planner changes are all me"). When today's value is still the planner's, that part is kept as
 * it is today, so it does not show as someone else's change.
 * @returns Map(issue id → { dates: bool, status: bool })
 */
export function plannerKept(audit, versions, current) {
  const out = new Map();
  for (const [id, v] of versions) {
    const rows = (audit || []).filter((a) => a.issueId === id && (!v.from || a.at > String(v.from))).sort((a, b) => String(a.at).localeCompare(String(b.at)));
    const now = current.get(id);
    if (!rows.length || !now) continue;
    const move = rows.filter((a) => ['Issue moved', 'Moved past commit'].includes(a.category)).pop();
    const st = rows.filter((a) => a.category === 'EI status changed').pop();
    const [ms, me] = move ? String(move.after || '').split('/').map((x) => x.trim()).map((x) => (x === '–' ? null : x)) : [];
    const k = {
      dates: !!move && (ms || null) === (now.start || null) && (me || null) === (now.end || null),
      status: !!st && st.after === now.status,
    };
    if (k.dates || k.status) out.set(id, k);
  }
  return out;
}

/** Today's start/end/status/efforts/team per issue id, from the loaded rows. */
export function currentFields(rows) {
  const out = new Map();
  for (const r of rows || []) for (const f of blob(r.serve_engineering_capacity_features)) {
    const id = nid(f[F.id]);
    if (id && !out.has(id)) out.set(id, { id, name: f[F.title], url: f[F.url], type: f[F.type], start: day(f[F.start]), end: day(f[F.end]), status: f[F.status] || null, team: f[F.team] || null, fe: Number(f[F.fe]) || 0, be: Number(f[F.be]) || 0, mob: Number(f[F.mob]) || 0, assigned: emails(Array.isArray(f[F.assigned]) ? JSON.stringify(f[F.assigned]) : f[F.assigned]) });
  }
  return out;
}

/**
 * The loaded rows as they were at T: changed issues back to their version at T (minus what the planner
 * did, see plannerKept), issues created after T without effort or dates, and issues that were planned at
 * T but are no longer in the rows added back.
 */
export function thenRows(rows, versions, { created = new Set(), kept = new Map() } = {}) {
  const seen = new Set();
  const out = rows.map((r) => {
    const b = r.serve_engineering_capacity_features;
    if (b == null) return r;
    let hit = false;
    const feats = blob(b).map((f) => {
      const id = nid(f[F.id]);
      const v = versions.get(id);
      if (created.has(id) && !v) { hit = true; const g = f.slice(); g[F.fe] = 0; g[F.be] = 0; g[F.mob] = 0; g[F.start] = null; g[F.end] = null; return g; }
      if (!v) return f;
      seen.add(id); hit = true;
      const k = kept.get(id) || {};
      const g = f.slice();
      if (!k.dates) { g[F.start] = v.start; g[F.end] = v.end; }
      if (!k.status) g[F.status] = v.deleted ? "Won't do" : v.status;
      g[F.fe] = v.fe; g[F.be] = v.be; g[F.mob] = v.mob; g[F.team] = v.team;
      g[F.assigned] = v.assigned.length ? JSON.stringify(v.assigned) : null;
      return g;
    });
    return hit ? { ...r, serve_engineering_capacity_features: JSON.stringify(feats) } : r;
  });
  const extra = [];
  for (const v of versions.values()) {
    if (seen.has(v.id) || v.deleted || !(v.start || v.end)) continue;
    const f = new Array(35).fill(null);
    Object.assign(f, { [F.id]: v.id, [F.title]: v.name, [F.type]: v.type, [F.status]: v.status, [F.fe]: v.fe, [F.be]: v.be, [F.mob]: v.mob, [F.start]: v.start, [F.end]: v.end, [F.team]: v.team, [F.assigned]: v.assigned.length ? JSON.stringify(v.assigned) : null });
    extra.push(f);
  }
  if (extra.length) out.push({ serve_engineering_capacity_features: JSON.stringify(extra), serve_engineering_capacity_engineering_team_allocations: '[]' });
  return out;
}

const fmt = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '–');
const when = (s, e) => (!s && !e ? 'not planned' : s && e && s !== e ? `${fmt(s)}–${fmt(e)}` : `pot ${fmt(e || s)}`);
const r1 = (x) => Math.round(x * 10) / 10;

/** Why an issue's days changed: what differs between its version at T and today. */
export function causes(v, now, { created = false, kept = {} } = {}) {
  if (created || !v) return ['New issue'];
  const out = [];
  if (!now) return v.deleted ? ['Deleted'] : ['No longer loaded'];
  if (v.deleted) out.push('Restored');
  if (!kept.dates && ((v.start || null) !== (now.start || null) || (v.end || null) !== (now.end || null))) out.push(`Moved: ${when(v.start, v.end)} → ${when(now.start, now.end)}`);
  for (const [k, l] of [['fe', 'FE'], ['be', 'BE'], ['mob', 'MOB']]) if ((v[k] || 0) !== (now[k] || 0)) out.push(`Effort ${l} ${r1(v[k] || 0)} → ${r1(now[k] || 0)}`);
  if ((v.team || null) !== (now.team || null)) out.push(`Team: ${v.team || 'none'} → ${now.team || 'none'}`);
  if (!kept.status && (v.status || null) !== (now.status || null)) out.push(`Status: ${v.status || '–'} → ${now.status || '–'}`);
  const a = [...v.assigned].sort().join(); const b = [...(now.assigned || [])].sort().join();
  if (a !== b) out.push('Assignees changed');
  return out.length ? out : ['FR commit or link changed'];
}

/**
 * Per team (the picked ones) and quarter (the given ones): planned days then and now per skill, the
 * capacity, and the issues whose days changed, most added first.
 * @returns [{ team, quarters: [{ key, label, skills: [{ skill, then, now, capacity }], then, now, capacity, items: [{ issue, delta: {FE,BE,MOB}, total, causes, changedAt }] }] }]
 */
export function loadChanges({ thenRun, nowRun, quarters, horizon, teams = TEAMS, versions, created = new Set(), kept = new Map(), current = new Map() }) {
  const gThen = buildGrid(thenRun, horizon); const gNow = buildGrid(nowRun, horizon);
  const cell = (g, team, skill, key) => g.rows.find((r) => r.team === team && r.skill === skill)?.quarters.find((q) => q.key === key);
  return teams.map((team) => ({
    team,
    quarters: quarters.map((q) => {
      const key = `${q.year}-Q${q.q}`;
      const items = new Map();
      const skills = SKILLS.map((skill) => {
        const per = (run) => new Map(cellIssues(run, team, skill, key).map((x) => [x.issue.id, x]));
        const a = per(thenRun); const b = per(nowRun);
        for (const id of new Set([...a.keys(), ...b.keys()])) {
          const d = (b.get(id)?.days || 0) - (a.get(id)?.days || 0);
          if (Math.abs(d) < 0.05) continue;
          const e = items.get(id) || { issue: b.get(id)?.issue || a.get(id)?.issue, delta: {}, total: 0 };
          e.delta[skill] = d; e.total += d; items.set(id, e);
        }
        const t = cell(gThen, team, skill, q.key); const n = cell(gNow, team, skill, q.key);
        return { skill, then: t?.planned || 0, now: n?.planned || 0, capacity: n?.capacity || 0 };
      });
      const list = [...items.values()].map((e) => ({
        ...e, causes: causes(versions.get(e.issue.id), current.get(e.issue.id), { created: created.has(e.issue.id) && !versions.has(e.issue.id), kept: kept.get(e.issue.id) }),
        changedAt: versions.get(e.issue.id)?.changedAt || null,
      })).sort((x, y) => y.total - x.total);
      const sum = (k) => skills.reduce((s, x) => s + x[k], 0);
      return { key: q.key, label: q.label, skills, then: sum('then'), now: sum('now'), capacity: sum('capacity'), items: list };
    }),
  }));
}

/**
 * Default compare time: the end of the viewer's last planner session before today (their latest audit
 * row before today), else 14 days ago; never before the snapshot started.
 */
export function defaultSince(audit, viewerId, today) {
  const mine = (audit || []).filter((a) => viewerId && a.by && nid(a.by) === nid(viewerId) && String(a.at).slice(0, 10) < today).map((a) => a.at).sort();
  const last = mine.pop();
  return clampSince(last ? new Date(last).toISOString() : new Date(Date.parse(`${today}T00:00:00Z`) - 14 * 864e5).toISOString());
}
export const clampSince = (iso) => (String(iso) < `${SNAPSHOT_START}T12:00:00.000Z` ? `${SNAPSHOT_START}T12:00:00.000Z` : iso);
