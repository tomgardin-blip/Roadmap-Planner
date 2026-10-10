// Issue scoring (SPEC "Scoring and prioritisation").
//   demand = sum over linked open FRs of (priority weight × customer revenue multiplier)
//   score  = demand ÷ (Effort FE + BE + MOB)
// Pure functions over the Lightdash positional rows; no I/O.
//
// Choices SPEC does not make yet are named options in SCORING_DEFAULTS so they can be
// switched once Tom decides; nothing below guesses silently.

export const PRIORITY_WEIGHTS = {
  'Needed 1 month before': 10,
  'Needed for go-live': 10,
  'Top 3': 5,
  High: 3,
  Medium: 2,
  Low: 1,
  'Needed after go-live': 0,
  'No longer needed': 0,
  "Won't do": 0,
};

// [lower bound GBP, multiplier], highest first.
export const REVENUE_BANDS = [[75000, 2], [25000, 1.5], [0, 1]];

// Lightdash only serves open customer tasks today; these are excluded if they ever appear.
export const CLOSED_TASK_STATUSES = new Set(['Done', 'Closed', 'Cancelled', "Won't do", 'No longer needed', 'Duplicate']);

export const SCORING_DEFAULTS = {
  // Task types that count as an FR. null = every type (decided 2026-10-10).
  types: null,
  // false: each FR counts, also several from the same customer on one issue (decided 2026-10-10).
  // true: one customer counts once per issue, at its highest weight.
  perCustomerOnce: false,
  // Weight for a task with no priority set.
  unknownPriorityWeight: 0,
  // Multiplier for a customer with no deal size: same as under 25k (rare, decided 2026-10-10).
  unknownDealMultiplier: 1,
  // FRs linked to a parent issue do not count for its sub-tasks (decided 2026-10-10).
  inheritParentFRs: false,
  // Quick wins: scored issues with total effort (FE+BE+MOB) at or under this many days are
  // listed apart from the main ranking. 2 confirmed by Tom 2026-10-10.
  quickWinMaxEffort: 2,
};

export function revenueMultiplier(gbp, unknown = SCORING_DEFAULTS.unknownDealMultiplier) {
  const n = Number(gbp);
  if (gbp == null || gbp === '' || !Number.isFinite(n)) return unknown;
  for (const [min, m] of REVENUE_BANDS) if (n >= min) return m;
  return 1;
}

export function priorityWeight(priority, unknown = SCORING_DEFAULTS.unknownPriorityWeight) {
  return priority != null && priority in PRIORITY_WEIGHTS ? PRIORITY_WEIGHTS[priority] : unknown;
}

const nid = (x) => String(x || '').replace(/-/g, '').toLowerCase();
const parseBlob = (v) => (Array.isArray(v) ? v : v ? JSON.parse(v) : []);
// Relation cells come as a JSON array, a comma string, or null.
export function idList(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v.map(nid);
  const s = String(v).trim();
  if (s.startsWith('[')) { try { return JSON.parse(s).map(nid); } catch { return []; } }
  return s.split(',').map((x) => nid(x.trim())).filter(Boolean);
}

/**
 * Score one issue from its effort and its linked FRs.
 * frs: [{ id, priority, status, type, dealId }]; dealSize: Map(dealId → GBP).
 */
export function scoreIssue({ fe = 0, be = 0, mob = 0 }, frs, dealSize = new Map(), opts = {}) {
  const o = { ...SCORING_DEFAULTS, ...opts };
  const effort = (+fe || 0) + (+be || 0) + (+mob || 0);
  const counted = [];
  for (const t of frs) {
    if (CLOSED_TASK_STATUSES.has(t.status)) continue;
    if (o.types && !o.types.includes(t.type)) continue;
    const w = priorityWeight(t.priority, o.unknownPriorityWeight);
    const m = revenueMultiplier(t.dealId ? dealSize.get(nid(t.dealId)) : null, o.unknownDealMultiplier);
    counted.push({ ...t, weight: w, multiplier: m, points: w * m });
  }
  let used = counted;
  if (o.perCustomerOnce) {
    const best = new Map();
    for (const c of counted) {
      const k = c.dealId ? nid(c.dealId) : `task:${c.id}`;
      if (!best.has(k) || c.points > best.get(k).points) best.set(k, c);
    }
    used = [...best.values()];
  }
  const demand = used.reduce((a, c) => a + c.points, 0);
  return {
    effort,
    demand,
    // No effort: cannot divide, so unscored (null), not top of the list.
    score: effort > 0 ? demand / effort : null,
    frCount: used.length,
    customers: new Set(used.filter((c) => c.dealId).map((c) => nid(c.dealId))).size,
    frs: used,
  };
}

/**
 * Score every feature in the Lightdash rows.
 * features/tasks: the positional blobs (all rows concatenated); dealSize: Map(dealId → GBP).
 * Links are taken from both sides (feature → tasks and task → features).
 * Returns Map(featureId → scoreIssue result + { id }).
 */
export function scoreFeatures(features, tasks, dealSize = new Map(), opts = {}) {
  const o = { ...SCORING_DEFAULTS, ...opts };
  const taskById = new Map(tasks.map((t) => [nid(t[0]), t]));
  const featById = new Map(features.map((f) => [nid(f[0]), f]));
  const links = new Map(features.map((f) => [nid(f[0]), new Set()]));
  for (const f of features) for (const tid of idList(f[12])) if (taskById.has(tid)) links.get(nid(f[0])).add(tid);
  for (const t of tasks) for (const fid of idList(t[7])) if (links.has(fid)) links.get(fid).add(nid(t[0]));
  if (o.inheritParentFRs) {
    for (const f of features) for (const pid of idList(f[8])) {
      const p = links.get(pid);
      if (p && featById.has(pid)) for (const tid of p) links.get(nid(f[0])).add(tid);
    }
  }
  const out = new Map();
  for (const f of features) {
    const id = nid(f[0]);
    const frs = [...links.get(id)].map((tid) => {
      const t = taskById.get(tid);
      return { id: tid, priority: t[4], status: t[5], type: t[3], dealId: t[6] };
    });
    out.set(id, { id, ...scoreIssue({ fe: f[15], be: f[14], mob: f[30] }, frs, dealSize, o) });
  }
  return out;
}

/** Map(dealId → GBP) from deals_extract rows ({deals_extract_notion_page_id, deals_extract_onboarding_deal_size_gbp}). */
export function dealSizeMap(rows) {
  const m = new Map();
  for (const r of rows || []) {
    const v = r.deals_extract_onboarding_deal_size_gbp;
    if (r.deals_extract_notion_page_id && v != null && v !== '') m.set(nid(r.deals_extract_notion_page_id), Number(v));
  }
  return m;
}

/**
 * Split scored issues into the main ranking and quick wins, each by score high to low.
 * Unscored issues (no effort) are left out. Score 0 (no demand) is never a quick win: it sits at
 * the bottom of the main list, whatever its effort.
 * items: [{ score, effort, ... }]
 */
export function rankIssues(items, opts = {}) {
  const { quickWinMaxEffort } = { ...SCORING_DEFAULTS, ...opts };
  const byScore = (a, b) => b.score - a.score || a.effort - b.effort;
  const scored = items.filter((x) => x.score != null);
  return {
    main: scored.filter((x) => x.effort > quickWinMaxEffort || x.score === 0).sort(byScore),
    quickWins: scored.filter((x) => x.effort <= quickWinMaxEffort && x.score > 0).sort(byScore),
  };
}

/** Score from Lightdash rows (any mix of default and extra rows): features and tasks blobs are concatenated. */
export function scoreRows(rows, dealSize = new Map(), opts = {}) {
  const col = (r, n) => parseBlob(r[`serve_engineering_capacity_${n}`] ?? r[n]);
  const features = rows.flatMap((r) => col(r, 'features'));
  const tasks = rows.flatMap((r) => col(r, 'customer_tasks'));
  return scoreFeatures(features, tasks, dealSize, opts);
}

export { parseBlob };
