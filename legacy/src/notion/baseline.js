// Quarter-start effort baseline (Tom, 2026-10-10: "go with the alternative path").
// The planner records each committed issue's effort the first time it sees it in a quarter, in
// the Notion "Roadmap Planner Effort Baseline" database. At risk flags committed issues whose
// effort is now 50% or more above that baseline. Rows are the record themselves: no audit row.

import { issueTeams, TEAMS } from '../capacity.js';

export const BASELINE_DS = '62afe97a-fdaf-4007-af81-5d1e1498661e';
export const GROWTH = 1.5;
const PAGE = 100;
const CLOSED = new Set(['Done', "Won't do", 'Duplicate']);
const SK = { FE: 'frontend', BE: 'backend', MOB: 'mobile' };
const nid = (x) => String(x || '').replace(/-/g, '').toLowerCase();
const dashed = (id) => { const h = nid(id); return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`; };
const eff = (i, s) => +(i.skillEfforts?.[SK[s]] || 0);
export const totalEffort = (i) => eff(i, 'FE') + eff(i, 'BE') + eff(i, 'MOB');

export function quarterKeyOf(date) {
  return `${date.getFullYear()}-Q${Math.floor(date.getMonth() / 3) + 1}`;
}

export function baselineQueryInput(quarter, offset = 0) {
  const ds = `collection://${BASELINE_DS}`;
  return {
    data: {
      data_source_urls: [ds],
      query: `SELECT "Issue ID", "Total", "createdTime" FROM "${ds}" WHERE "Quarter" = ? ORDER BY "createdTime" ASC, url ASC LIMIT ${PAGE} OFFSET ${offset}`,
      params: [quarter],
    },
  };
}
export const BASELINE_PAGE_SIZE = PAGE;

/** Rows → Map(issue id → total). The earliest row wins if two viewers captured at once. */
export function parseBaseline(results) {
  const m = new Map();
  for (const r of results || []) {
    const id = nid(r['Issue ID']);
    if (id && !m.has(id) && r.Total != null && r.Total !== '') m.set(id, Number(r.Total));
  }
  return m;
}

/** Committed, open issues of our 4 teams with effort that have no baseline this quarter yet. */
export function missingBaselines(run, baseline) {
  return run.issues.filter((i) => i.id && /^[0-9a-f]{32}$/.test(i.id) && i.committed && !CLOSED.has(i.status)
    && totalEffort(i) > 0 && !baseline.has(i.id) && [...issueTeams(run, i)].some((t) => TEAMS.includes(t)));
}

/** notion-create-pages inputs, at most 100 rows per call. */
export function baselineRowsInputs(issues, quarter) {
  const out = [];
  for (let k = 0; k < issues.length; k += PAGE) {
    out.push({
      parent: { type: 'data_source_id', data_source_id: BASELINE_DS },
      allow_async: false,
      pages: issues.slice(k, k + PAGE).map((i) => ({ properties: {
        Name: `${quarter} — ${i.name || i.id}`.slice(0, 200), 'Issue ID': i.id, Issue: [dashed(i.id)], Quarter: quarter,
        FE: eff(i, 'FE'), BE: eff(i, 'BE'), MOB: eff(i, 'MOB'), Total: totalEffort(i),
      } })),
    });
  }
  return out;
}

/** Committed issues whose effort is now ≥ 1.5 × their baseline (baseline > 0). */
export function effortGrowth(issues, baseline) {
  const out = [];
  for (const i of issues) {
    const b = baseline.get(i.id);
    const now = totalEffort(i);
    if (i.committed && b > 0 && now >= GROWTH * b) out.push({ issue: i, detail: `Effort ${b} → ${now} d (+${Math.round((now / b - 1) * 100)}%) since first seen this quarter` });
  }
  return out;
}
