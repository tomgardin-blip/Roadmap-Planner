// "Pushback Req GL" (Tom, 2026-10-30): an FR priority meaning "needed for go-live, but we can't make it:
// the COM/AM has to tell the customer". Such an FR leaves At risk → "Planned after the committed date" and
// gets its own list: how long it has waited since it was set, and a Slack reminder to the COM/AM.
// Pure functions over the Lightdash customer task rows (positional: 0 id, 1 url, 2 title, 3 type,
// 4 priority, 5 status, 6 deal, 7 linked issues, 8 committed) and the audit log.

import { issueTeams, TEAMS, pickedTeams } from './capacity.js';
import { idList } from './scoring.js';

export const PUSHBACK_REQ = 'Pushback Req GL';
const FR_CLOSED = new Set(['Done', "Won't do", 'Duplicate', 'Closed', 'Cancelled', 'No longer needed']);
const nid = (x) => String(x || '').replace(/-/g, '').toLowerCase();
const day = (d) => (d ? String(d).slice(0, 10) : null);
const blob = (r, n) => { const v = r[`serve_engineering_capacity_${n}`]; return Array.isArray(v) ? v : v ? JSON.parse(v) : []; };
const daysBetween = (a, b) => Math.round((Date.UTC(...b.split('-').map((x, i) => (i === 1 ? x - 1 : +x))) - Date.UTC(...a.split('-').map((x, i) => (i === 1 ? x - 1 : +x)))) / 864e5);

/** When the planner set the FR to Pushback Req GL: the latest audit row that did, or null (set outside the planner). */
export function pushbackSince(audit, frId) {
  const hit = (audit || []).filter((a) => a.frId === frId && (
    (a.category === 'FR priority changed' && a.after === PUSHBACK_REQ)
    || (a.category === 'Owner advised' && String(a.after || '').includes(`→ ${PUSHBACK_REQ}`))));
  return hit.map((a) => a.at).sort().pop() || null;
}

/**
 * @returns [{ fr, issues, since, days, reminded: { at, link } | null }], longest waiting first; unknown start last.
 */
export function pushbackReqList({ run, backlog = [], taskRows = [], featureRows = [], signed = null, nonFeature = null, audit = [], team = 'all', today }) {
  const picked = pickedTeams(team);
  const issues = new Map();
  for (const i of [...run.issues, ...backlog]) if (i.id && !issues.has(i.id)) issues.set(i.id, i);
  const ours = (i) => [...issueTeams(run, i)].some((t) => (picked || TEAMS).includes(t));
  const frIssues = new Map();
  const link = (fr, iss) => { if (fr && iss) (frIssues.get(fr) || frIssues.set(fr, new Set()).get(fr)).add(iss); };
  for (const f of featureRows.flatMap((r) => blob(r, 'features'))) for (const t of idList(f[12])) link(t, nid(f[0]));
  const out = [];
  const seen = new Set();
  for (const t of taskRows.flatMap((r) => blob(r, 'customer_tasks'))) {
    const id = nid(t[0]);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    if (t[4] !== PUSHBACK_REQ || FR_CLOSED.has(t[5])) continue;
    // Product features only, as the rest of the planner (Type "Feature request", Category Feature Request).
    if (t[3] !== 'Feature request' || nonFeature?.has(id)) continue;
    if (signed && !signed.has(nid(t[6]))) continue;
    for (const x of idList(t[7])) link(id, x);
    const linked = [...(frIssues.get(id) || [])].map((x) => issues.get(x)).filter(Boolean);
    if (picked && !linked.some(ours)) continue;
    const fr = { id, url: t[1], title: t[2], type: t[3], priority: t[4], status: t[5], dealId: t[6], committed: day(t[8]) };
    const since = pushbackSince(audit, id);
    const asked = (audit || []).filter((a) => a.category === 'COM/AM asked' && a.frId === id && (!since || a.at >= since)).sort((a, b) => String(b.at).localeCompare(String(a.at)))[0];
    out.push({ fr, issues: linked, since, days: since && today ? daysBetween(day(since), today) : null, reminded: asked ? { at: asked.at, link: /^https:/.test(asked.after || '') ? asked.after : null } : null });
  }
  return out.sort((a, b) => (a.days == null) - (b.days == null) || (b.days ?? 0) - (a.days ?? 0));
}

/** Issue ids whose committed date is set by a Pushback Req GL FR: left out of "Planned after the committed date". */
export function heldByPushback(list) {
  const ids = new Set();
  for (const e of list || []) for (const i of e.issues) if (e.fr.committed && day(i.committed) === e.fr.committed) ids.add(i.id);
  return ids;
}
