// Data quality checks (Tom, 2026-10-28: "go for it", checks #1–#10 of the 28 Oct list). Pure functions.
// FR checks read the Lightdash customer task rows (positional: 0 id, 1 url, 2 title, 3 type, 4 priority,
// 5 status, 6 deal, 7 linked issues, 8 committed, 9 assigned team) and the deals (0 id, 3 stage,
// 5 go-live). Issue checks read the engine issues of our 4 teams. Only signed customers' FRs count
// once the signed deals are loaded (as everywhere else).

import { formatDate } from './periods.js';
import { issueTeams, TEAMS, pickedTeams } from './capacity.js';
import { idList } from './scoring.js';

const CLOSED = new Set(['Done', "Won't do", 'Duplicate']);
const FR_CLOSED = new Set(['Done', "Won't do", 'Duplicate', 'Closed', 'Cancelled', 'No longer needed']);
const GO_LIVE = new Set(['Needed for go-live', 'Needed 1 month before']);
const NOT_LIVE_ANY_MORE = new Set(['Live', 'Churn', 'Deal Lost', 'Dropped']);
const SCOPING = new Set(['Product scoping TODO', 'Product scoping in progress']);
const SKILLS = ['frontend', 'backend', 'mobile'];
const effortOf = (i) => SKILLS.reduce((a, s) => a + (i.skillEfforts?.[s] || 0), 0);
const nid = (x) => String(x || '').replace(/-/g, '').toLowerCase();
const day = (d) => (d ? String(d).slice(0, 10) : null);
const blob = (r, n) => { const v = r[`serve_engineering_capacity_${n}`]; return Array.isArray(v) ? v : v ? JSON.parse(v) : []; };

export const CHECKS = [
  { key: 'frNoIssue', side: 'fr', label: 'Committed FR with no engineering issue linked', fix: 'Product to create or link an issue' },
  { key: 'issueDoneFrOpen', side: 'fr', label: 'Engineering issue Done, FR still open', fix: 'Edit FR → Status Done, and tell the customer' },
  { key: 'goLivePassed', side: 'fr', label: '"Needed for go-live", but the go-live has passed', fix: 'Edit FR → Needed after go-live, or fix the go-live date' },
  { key: 'frCommitPast', side: 'fr', label: 'FR committed date in the past, issue not Done', fix: 'Edit FR → a new committed date' },
  { key: 'goLiveCustomerLive', side: 'fr', label: '"Needed for go-live", customer already Live / Churned / Lost', fix: 'Edit FR → Needed after go-live' },
  { key: 'goLiveNoDate', side: 'fr', label: '"Needed for go-live", deal has no go-live date', fix: 'Set the go-live on the deal' },
  { key: 'blockedNoBlocker', side: 'issue', label: 'Blocked/on hold, no open blocker linked', fix: 'Ask the lead which issue blocks it' },
  { key: 'plannedScoping', side: 'issue', label: 'Planned, but still in Product scoping', fix: 'Edit → engineering issue status' },
  { key: 'plannedNoEffort', side: 'issue', label: 'Planned with dates, 0 effort', fix: 'Estimate it, or it counts 0 in capacity' },
  { key: 'staleBlocker', side: 'issue', label: 'Blocker already Done / Won\'t do, link still there', fix: 'Remove the "Blocked by" link in Notion' },
];

/**
 * @param run       runCapacity() result
 * @param backlog   engine issues of the unplanned backlog (may be [])
 * @param taskRows  Lightdash rows carrying customer_tasks (default + extra)
 * @param featureRows Lightdash rows carrying features (default + extra), for FR → issue links from the issue side
 * @param dealRows  Lightdash rows carrying deals
 * @param signed    Set of signed deal ids, or null (not loaded: every FR counts)
 * @param today     'YYYY-MM-DD'
 * @returns { [checkKey]: [{ issue?, fr?, detail }] }
 */
export function dataQuality({ run, backlog = [], taskRows = [], featureRows = [], dealRows = [], signed = null, team = 'all', today }) {
  const out = Object.fromEntries(CHECKS.map((c) => [c.key, []]));
  const picked = pickedTeams(team);
  const issues = new Map();
  for (const i of [...run.issues, ...backlog]) if (i.id && !issues.has(i.id)) issues.set(i.id, i);
  const ours = (i) => [...issueTeams(run, i)].some((t) => (picked || TEAMS).includes(t));

  // FR → linked issues, from both sides (the FR's relation and the issue's).
  const frIssues = new Map();
  const link = (fr, iss) => { if (fr && iss) (frIssues.get(fr) || frIssues.set(fr, new Set()).get(fr)).add(iss); };
  for (const f of featureRows.flatMap((r) => blob(r, 'features'))) for (const t of idList(f[12])) link(t, nid(f[0]));
  const deals = new Map();
  for (const d of dealRows.flatMap((r) => blob(r, 'deals'))) if (d[0] && !deals.has(nid(d[0]))) deals.set(nid(d[0]), d);

  const seen = new Set();
  for (const t of taskRows.flatMap((r) => blob(r, 'customer_tasks'))) {
    const id = nid(t[0]);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    if (FR_CLOSED.has(t[5])) continue;
    const dealId = nid(t[6]);
    if (signed && (!dealId || !signed.has(dealId))) continue;
    for (const x of idList(t[7])) link(id, x);
    const linked = [...(frIssues.get(id) || [])].map((x) => issues.get(x)).filter(Boolean);
    // Team filter: an FR shows when one of its issues is in the picked teams; FRs without an issue only under All teams.
    if (picked && !linked.some(ours)) continue;
    const fr = { id, url: t[1], title: t[2], type: t[3], priority: t[4], status: t[5], dealId: t[6], committed: day(t[8]), assignedTeam: t[9] || null };
    const openIssues = linked.filter((i) => !CLOSED.has(i.status));
    const doneIssue = linked.find((i) => i.status === 'Done');
    const deal = dealId ? deals.get(dealId) : null;
    const golive = deal ? day(deal[5]) : null;
    const entry = (detail, issue = openIssues[0] || linked[0] || null) => ({ fr, issue, detail });
    if (fr.committed && !(frIssues.get(id)?.size)) out.frNoIssue.push(entry(`Committed ${formatDate(fr.committed)}${fr.assignedTeam ? ` · assigned to ${fr.assignedTeam}` : ''}`, null));
    if (doneIssue && !openIssues.length) out.issueDoneFrOpen.push(entry(`"${doneIssue.name}" is Done · FR status ${fr.status || 'none'}`, doneIssue));
    if (GO_LIVE.has(fr.priority) && deal) {
      if (golive && golive < today) out.goLivePassed.push(entry(`Go-live ${formatDate(golive)} has passed${deal[3] ? ` · deal stage ${deal[3]}` : ''}`));
      if (NOT_LIVE_ANY_MORE.has(String(deal[3] || '').trim())) out.goLiveCustomerLive.push(entry(`Deal stage ${deal[3]}${golive ? ` · go-live ${formatDate(golive)}` : ''}`));
      if (!golive) out.goLiveNoDate.push(entry(`No go-live on the deal${deal[3] ? ` (stage ${deal[3]})` : ''}, so no committed date can be worked out`));
    }
    if (fr.committed && fr.committed < today && openIssues.length) out.frCommitPast.push(entry(`Committed ${formatDate(fr.committed)} · "${openIssues[0].name}" is ${openIssues[0].status || 'open'}`));
  }

  // Issue side: open issues of our teams.
  const blockersOf = new Map();
  for (const b of issues.values()) for (const x of b.blocks || []) (blockersOf.get(x) || blockersOf.set(x, []).get(x)).push(b);
  for (const i of issues.values()) {
    if (CLOSED.has(i.status) || (i.type || '').includes('Holiday') || i.isParent || !ours(i)) continue;
    const planned = !!(i.start || i.end);
    const bl = blockersOf.get(i.id) || [];
    const openBl = bl.filter((b) => !CLOSED.has(b.status));
    const doneBl = bl.filter((b) => CLOSED.has(b.status));
    if (i.status === 'Blocked/on hold' && !openBl.length) out.blockedNoBlocker.push({ issue: i, detail: doneBl.length ? `Only finished blockers: ${doneBl.map((b) => `"${b.name}" (${b.status})`).join(', ')}` : 'No "Blocked by" linked' });
    if (planned && SCOPING.has(i.status)) out.plannedScoping.push({ issue: i, detail: `Status ${i.status}, planned ${formatDate(i.end || i.start)}` });
    if (planned && effortOf(i) === 0) out.plannedNoEffort.push({ issue: i, detail: `Planned ${formatDate(i.end || i.start)}, no FE/BE/MOB effort` });
    if (doneBl.length) out.staleBlocker.push({ issue: i, detail: `Blocked by ${doneBl.map((b) => `"${b.name}" (${b.status})`).join(', ')}` });
  }
  const by = (e) => String(e.fr?.committed || e.issue?.committed || e.issue?.end || '9');
  for (const k of Object.keys(out)) out[k].sort((a, b) => by(a).localeCompare(by(b)));
  return out;
}

export const qualityCount = (q) => (q ? CHECKS.reduce((a, c) => a + q[c.key].length, 0) : null);
