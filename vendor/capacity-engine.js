// === Capacity engine =================================================================
// Pure, DOM-free core of the Engineering Capacity Planner: raw serve_engineering_capacity
// rows -> issues[] (transformRows) -> derived per-team/per-skill/per-week capacity and
// demand (compute). No React, no Vite-only import syntax, no DOM/window/document access —
// importable by the Vite app (App.jsx, template-script.js) and by a standalone Node script
// alike.
//
// compute() still mutates its `DATA.issues` argument in place (adds __idx, committedEff,
// committedOwn, and overwrites `committed` with the effective committed date) — existing,
// documented behavior every downstream reader of an issue relies on. What's new relative to
// the in-app version this was extracted from:
//   - `ALLOC` is a plain argument, never a shared mutable module global.
//   - `now` is a single argument threaded through every date-relative calc (including the
//     quarter-index helper, which used to make its own independent `new Date()`).
//   - `effCommitted`/`isOverdue` take an optional `scopeMap` argument instead of reading a
//     render-only module global (always null outside one interactive UI scope).
//   - `nameToFactor`/`leadNames` are returned instead of written to shared module globals.

// ─── Row shaping: raw serve_engineering_capacity rows → issues[] ──────────────────────

function parseDate(val) {
  if (!val) return null;
  return String(val).substring(0, 10);
}

// Handles comma-separated strings, JSON array strings, and single email values.
function parseEmails(val) {
  if (!val) return [];
  const str = String(val).trim();
  if (!str || str === 'null') return [];
  let items;
  if (str.startsWith('[')) {
    try { items = JSON.parse(str); } catch (_) { items = [str]; }
  } else {
    items = str.split(',').map(s => s.trim());
  }
  return items.filter(s => s && s.includes('@'));
}

// Notion page IDs appear with hyphens in relation properties ("2e2e32e8-f8c8-…")
// but without hyphens when stored as primary keys in staging models ("2e2e32e8f8c8…").
// Normalise to no-hyphen lowercase before any Map key or lookup.
function nid(id) {
  return id ? String(id).replace(/-/g, '').toLowerCase() : '';
}

// Parses a JSON array string or comma-separated list of IDs.
function parseIds(val) {
  if (!val) return [];
  const str = String(val).trim();
  if (!str || str === 'null') return [];
  if (str.startsWith('[')) {
    try {
      const parsed = JSON.parse(str);
      return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
    } catch (_) { return []; }
  }
  return str.split(',').map(s => s.trim()).filter(Boolean);
}

// Parses the outer JSON array for a features/customer_tasks/deals column.
function parseJsonArray(val) {
  if (!val) return [];
  try {
    const parsed = JSON.parse(String(val));
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) { return []; }
}

// Map deal_status to the pill categories used in the template.
function dealStatusCategory(status) {
  if (status === 'Live') return 'Live';
  if (status === 'Onboarding') return 'Onboarding';
  return 'Other';
}

// Feature positional indices (see serve_engineering_capacity.yml for the full order):
//   0  notion_page_id          13 effort              23 effort_sre
//   1  title                   14 effort_backend       24 start_date
//   2  url                     15 effort_frontend      25 end_date
//   3  type                    16 effort_int_platform  26 committed_date
//   4  domain                  17 effort_int_orderfleet 27 preplanned_on
//   5  status                  18 effort_int_bookings  28 extractedat
//   6  assigned_to             19 effort_int_financials
//   7  assigned_to_future_empl 20 effort_ai
//   8  parent_task_id          21 effort_bi
//   9  subtasks_ids            22 effort_ps
//  10  blocks_ids
//  11  blocked_by_ids
//  12  customer_tasks_ids
//
// Task positional indices:
//   0 notion_page_id  3 task_type   6 deals_extract_notion_page_id
//   1 notion_page_url 4 priority    7 features_notion_page_ids
//   2 task_title      5 task_status 8 committed_date  9 assigned_team
//
// Deal positional indices:
//   0 notion_page_id  2 qargo_group   4 company_name    6 deal_extract_name
//   1 notion_page_url 3 status        5 go_live_date
const FEATURE_EFFORT_MAP = [
  [14, 'backend'],
  [15, 'frontend'],
  [16, 'int_platform'],
  [17, 'int_orderfleet'],
  [18, 'int_bookings'],
  [19, 'int_financials'],
  [20, 'ai'],
  [21, 'bi'],
  [23, 'sre'],
];

// Merges features/tasks/deals from all provided serve rows, deduplicates by ID,
// then reconstructs feature→task→deal relationships from linking IDs.
export function transformRows(rows) {
  const allFeatures = [];
  const allTasks = [];
  const allDeals = [];

  rows.forEach(row => {
    parseJsonArray(row['features']).forEach(f => allFeatures.push(f));
    parseJsonArray(row['customer_tasks']).forEach(t => allTasks.push(t));
    parseJsonArray(row['deals']).forEach(d => allDeals.push(d));
  });

  // Build lookup maps, dedup by ID (first occurrence wins).
  // All keys are normalised via nid() to handle hyphen/no-hyphen UUID variants.
  const taskById = new Map();
  allTasks.forEach(t => {
    const id = nid(t[0]);
    if (id && !taskById.has(id)) taskById.set(id, t);
  });

  const dealById = new Map();
  allDeals.forEach(d => {
    const id = nid(d[0]);
    if (id && !dealById.has(id)) dealById.set(id, d);
  });

  const featureById = new Map();
  allFeatures.forEach(f => {
    const id = nid(f[0]);
    if (id && !featureById.has(id)) featureById.set(id, f);
  });

  // Parent issues = features that other features point to as their parent (index 8).
  // Such roll-up issues carry no estimate of their own (the children do).
  const parentIds = new Set();
  allFeatures.forEach(f => {
    parseIds(f[8]).forEach(pid => { const n = nid(pid); if (n) parentIds.add(n); });
  });

  // Track max extractedat across features for the "Notion synced" footer timestamp
  let maxExtractedAt = null;
  allFeatures.forEach(f => {
    const v = f[28];
    if (v && (!maxExtractedAt || v > maxExtractedAt)) maxExtractedAt = v;
  });

  console.log('[ECR] transformRows: features:', featureById.size, '| tasks:', taskById.size, '| deals:', dealById.size);

  // Diagnostic: how many features reference a customer task not (yet) resolved in taskById.
  // Expected/normal on the first paint (default-only rows carry only committed tasks — see
  // App.jsx); those pills fill in once the background row merges. One aggregate line instead
  // of one per feature, since a load can easily touch hundreds of features.
  {
    let featuresWithGaps = 0, missingCtCount = 0;
    featureById.forEach(f => {
      const ctIds = parseIds(f[12]);
      if (!ctIds.length) return;
      const missing = ctIds.filter(id => !taskById.has(nid(id))).length;
      if (missing > 0) { featuresWithGaps++; missingCtCount += missing; }
    });
    if (featuresWithGaps > 0) {
      console.log('[ECR] unresolved customer-task links:', missingCtCount, 'across', featuresWithGaps, 'feature(s) — normal pre-merge, fills in once the background row loads');
    }
  }

  const issues = [];
  featureById.forEach(f => {
    const type = f[3] || '';
    // Exclude "Customer configuration 🚂" records entirely — they never enter the app.
    if (type.includes('Customer configuration')) return;
    const effortTotal = parseFloat(f[13]) || 0;

    const efforts = {};
    FEATURE_EFFORT_MAP.forEach(([idx, teamId]) => {
      const v = parseFloat(f[idx]) || 0;
      if (v > 0) efforts[teamId] = v;
    });

    const effortPs = parseFloat(f[22]) || 0;
    if (effortPs > 0) {
      efforts['professional_services'] = effortPs;
    } else if (type.includes('Customer configuration') && effortTotal > 0) {
      efforts['professional_services'] = effortTotal;
    }

    // 2D planning: per-skill efforts + explicit team property.
    // backend/frontend/ai/bi map to the existing packed feature columns.
    // effort_mobile / effort_analyst and the explicit `team` property are NOT yet
    // exposed by serve_engineering_capacity (see the dbt schema) — they default to
    // 0 / null here and will light up once those columns are added to the features
    // array and their indices filled into SKILL_EFFORT_INDEX / TEAM_INDEX below.
    // Packed feature array (serve_engineering_capacity): 14 effort_backend,
    // 15 effort_frontend, 20 effort_ai, 21 effort_bi, 29 team, 30 effort_mobile,
    // 31 effort_analyst.
    const SKILL_EFFORT_INDEX = { backend: 14, frontend: 15, mobile: 30, ai: 20, bi: 21, analyst: 31, infra: 23 };
    const TEAM_INDEX = 29;
    const skillEfforts = {};
    Object.entries(SKILL_EFFORT_INDEX).forEach(([skill, idx]) => {
      skillEfforts[skill] = idx == null ? 0 : (parseFloat(f[idx]) || 0);
    });
    const teamRaw = f[TEAM_INDEX];
    const team = teamRaw != null && String(teamRaw).trim() && String(teamRaw).trim() !== 'null' ? String(teamRaw).trim() : null;

    const emails = new Set();
    parseEmails(f[6]).forEach(e => emails.add(e));   // assigned_to
    parseEmails(f[7]).forEach(e => emails.add(e));   // assigned_to_future_employee
    const preplannedOn = parseEmails(f[27]);         // preplanned_on (kept separate too)
    preplannedOn.forEach(e => emails.add(e));

    // Build customer list from linked task IDs (f[12]).
    // Tasks absent from taskById are skipped — pill suppressed until
    // the extra row arrives and applyTemplate re-runs with merged data.
    const ctIds = parseIds(f[12]);
    const customersMap = new Map();
    ctIds.forEach(ctId => {
      const ctKey = nid(ctId);
      if (customersMap.has(ctKey)) return;
      const t = taskById.get(ctKey);
      if (!t) return;
      const dealId = t[6];
      const deal = dealId ? dealById.get(nid(dealId)) : null;
      const clean = v => (v != null && String(v).trim() && String(v).trim() !== 'null') ? String(v).trim() : '';
      // Display name = deal_extract_name (deal[6]) → company_name (deal[4]) → qargo_group (deal[2]).
      // All trimmed via clean() so the exact-match customer/group filter isn't defeated by stray
      // whitespace (a trailing space renders invisibly but breaks `value === typed`).
      const group = deal ? clean(deal[2]) : '';
      const name = deal ? (clean(deal[6]) || clean(deal[4]) || clean(deal[2])) : clean(t[2]);
      if (!name) {
        console.log('[ECR] skipping CT (no name): ctId', ctId, '| dealId', dealId, '| deal found:', !!deal, '| t[2]:', t[2]);
        return;
      }
      const status = deal ? dealStatusCategory(deal[3]) : 'Other';
      const committed = parseDate(t[8]);
      const golive = deal ? parseDate(deal[5]) : null;
      customersMap.set(ctKey, {
        name, group, status, committed, golive, url: t[1] || '',
        id:        ctKey,               // customer-task notion page id (normalised)
        dealId:    deal ? nid(deal[0]) : '', // deal (Deals Extract) notion page id
        dealUrl:   deal ? (deal[1] || '') : '', // deal (Deals Extract) notion url
        taskTitle: t[2] || '',   // customer task title
        taskType:  clean(t[3]),  // task_type
        priority:  clean(t[4]),  // priority
        taskStatus: clean(t[5]), // task_status
      });
    });

    // Subtask = this feature points to a parent (index 8, parent_task_id). Resolve the parent's
    // Notion url/name (when the parent feature is loaded) so the UI can tag it and link back.
    const parentPid = parseIds(f[8]).map(nid).filter(Boolean)[0] || '';
    const parentRow = parentPid ? featureById.get(parentPid) : null;
    issues.push({
      id:         nid(f[0]),
      url:        f[2] || '',
      name:       f[1] || '',
      status:     f[5] || '',
      type,
      isParent:   parentIds.has(nid(f[0])) || parseIds(f[9]).length > 0,
      isSubtask:  !!parentPid,
      parentUrl:  parentRow ? (parentRow[2] || '') : '',
      parentName: parentRow ? (parentRow[1] || '') : '',
      parentCommitted: parentRow ? parseDate(parentRow[26]) : null, // parent's committed (index 26)
      blocks:     parseIds(f[10]).map(nid).filter(Boolean),   // features this one blocks (index 10)
      preplannedOn,
      start:      parseDate(f[24]),
      end:        parseDate(f[25]),
      assignedTo: [...emails],
      efforts,
      skillEfforts,
      team,
      effortTotal,
      customers:  [...customersMap.values()],
      committed:  parseDate(f[26]),
      golive:     false,
      tags:       f[32] ? String(f[32]).split(',').map(s => s.trim()).filter(Boolean) : [],
      priority:   (f[33] != null && String(f[33]).trim() && String(f[33]).trim() !== 'null') ? String(f[33]).trim() : null,
    });
  });

  // All loaded customer tasks (for the All-view reverse "Customer tasks" table), with their
  // own props + linked engineering-issue ids (t[7]). Includes CTs not linked to any in-scope
  // feature. `customer` = the deal company; status/golive from the deal.
  const clean = v => (v != null && String(v).trim() && String(v).trim() !== 'null') ? String(v).trim() : '';
  const customerTasks = [];
  taskById.forEach(t => {
    const dealId = t[6];
    const deal = dealId ? dealById.get(nid(dealId)) : null;
    customerTasks.push({
      id:             nid(t[0]),
      url:            t[1] || '',
      title:          t[2] || '',
      type:           clean(t[3]),
      priority:       clean(t[4]),
      status:         clean(t[5]),
      committed:      parseDate(t[8]),
      assignedTeam:   clean(t[9]),
      dealId:         deal ? nid(deal[0]) : '',
      dealUrl:        deal ? (deal[1] || '') : '',
      customer:       deal ? (clean(deal[6]) || clean(deal[4]) || clean(deal[2])) : '',
      group:          deal ? clean(deal[2]) : '',
      customerStatus: deal ? dealStatusCategory(deal[3]) : 'Other',
      golive:         deal ? parseDate(deal[5]) : null,
      featureIds:     parseIds(t[7]).map(nid).filter(Boolean),
    });
  });

  return { issues, customerTasks, maxExtractedAt };
}

// ─── Allocation shaping: engineering_team_allocations rows → ALLOCATION plan ────────────────────
// Engineer positional indices (see serve_engineering_capacity.yml for the full order):
//   0 notion_page_id  4 part_time_pct        9 capacity_frontend 14 start_date
//   1 title           5 capacity_ai        10 capacity_infra     15 end_date
//   2 email           6 capacity_analytics 11 capacity_mobile    16 holiday_budget_2026
//   3 team            7 capacity_backend   12 capacity_other     17 holiday_budget_2027
//                      8 capacity_bi        13 is_lead
const ENGINEER_SKILL_INDEX = { ai: 5, analyst: 6, backend: 7, bi: 8, frontend: 9, infra: 10, mobile: 11, other: 12 };

function slugTeam(name) {
  return String(name || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

const TEAM_COLOR_PALETTE = [
  '#0f766e', '#2563eb', '#7c3aed', '#ea580c', '#0891b2', '#65a30d', '#ca8a04',
  '#9333ea', '#dc2626', '#0d9488', '#4f46e5', '#db2777', '#7B61FF', '#475569',
];

// Builds the ALLOCATION plan (teams + per-person time allocations) straight from the
// "Engineering team allocations" Notion database, carried on
// serve_engineering_capacity's `engineering_team_allocations` column: one row per engineer per
// (time-bound) team/skill allocation, or per open vacancy. Replaces the hand-maintained
// ALLOCATION literal that used to live in config.js — teams and people are both derived,
// not configured.
export function buildAllocation(rows, settings) {
  const allocRows = [];
  rows.forEach(row => parseJsonArray(row['engineering_team_allocations']).forEach(r => allocRows.push(r)));

  // Group by title: each Notion page is one allocation; a person whose team/skills
  // changed over time has one page per allocation, all sharing the same title.
  const byTitle = new Map();
  allocRows.forEach(r => {
    const title = r[1];
    if (!title) return;
    if (!byTitle.has(title)) byTitle.set(title, []);
    byTitle.get(title).push(r);
  });

  const teamNames = new Set();
  allocRows.forEach(r => { if (r[3]) teamNames.add(String(r[3]).trim()); });
  const teams = [...teamNames].sort().map((name, i) => ({
    id: slugTeam(name), name, color: TEAM_COLOR_PALETTE[i % TEAM_COLOR_PALETTE.length],
  }));

  const people = [];
  byTitle.forEach((rowsForTitle, title) => {
    rowsForTitle.sort((a, b) => String(a[14] || '').localeCompare(String(b[14] || '')));
    const email = rowsForTitle.map(r => r[2]).find(Boolean) || null;
    const last = rowsForTitle[rowsForTitle.length - 1];
    const holidayBudget = {
      '2026': last[16] != null ? Number(last[16]) : 26,
      '2027': last[17] != null ? Number(last[17]) : 26,
    };
    const allocations = rowsForTitle.map(r => {
      const skills = {};
      Object.entries(ENGINEER_SKILL_INDEX).forEach(([skill, idx]) => { skills[skill] = Number(r[idx]) || 0; });
      const totalSkill = Object.values(skills).reduce((a, b) => a + b, 0);
      const entry = {
        from: String(r[14] || '').substring(0, 7),
        teamId: r[3] ? slugTeam(r[3]) : '',
        lead: r[13] === true || r[13] === 'true',
        skills,
      };
      // No skill has any weight allocated this period (e.g. a temporary pause) — pin
      // pct to 0 so this allocation doesn't default to full capacity; use the real
      // part-time % otherwise.
      if (totalSkill <= 0) entry.pct = 0;
      else if (r[4] != null) entry.pct = Number(r[4]);
      return entry;
    });
    const person = { name: title, allocations, holidayBudget };
    if (email) person.email = email;
    people.push(person);
  });
  people.sort((a, b) => a.name.localeCompare(b.name));

  return { settings, skillBreakdown: true, teams, people, tiPct: {} };
}

// The "team capacities" taxonomy (config.teams — team tabs, the issue `team` property
// routing, PRODUCT_TEAM_IDS, the Budgets team-card list) is a fixed, curated subset of
// ALLOCATION.teams, shown in a fixed order (see TEAM_DISPLAY_ORDER in config.js) — not
// every team in ALLOCATION gets a tab, and membership/order aren't re-derived from
// who's currently active. Ids match ALLOCATION.teams directly (both come from the same
// slugTeam() scheme), so no separate id-translation table is needed. A name in `order`
// that ALLOCATION.teams doesn't have (e.g. a team with nobody in it at all) is skipped.
// A trailing "Other" entry (id 'other') is always appended: compute() already routes
// every issue that doesn't match a curated team — by team property or by assignee
// membership — into that exact synthetic bucket (see resolveNewTeamId's fallback and
// every `teams.add('other')` below), so its demand is already computed; this just gives
// it a tab/checkbox to be seen. It has no ALLOCATION roster of its own (no real team has
// id 'other'), so its capacity and by-person roster are always empty — only demand shows.
export function buildTeams(allocation, order) {
  const byName = new Map((allocation.teams || []).map(t => [t.name, t]));
  const curated = order.map(name => byName.get(name)).filter(Boolean).map(t => ({ id: t.id, label: t.name }));
  return [...curated, { id: 'other', label: 'Other' }];
}

// ─── Date helpers ───────────────────────────────────────────────────────────────────

export function toDate(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
export function toMonday(d) { const dt = new Date(d); const day = dt.getDay(); const diff = day === 0 ? -6 : 1 - day; dt.setDate(dt.getDate() + diff); return dt; }
export function fmtYMD(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
export function isWeekday(d) { const day = d.getDay(); return day >= 1 && day <= 5; }
// A week (keyed by its Monday) is attributed to the month of its FRIDAY (Monday + 4),
// so a full working week always counts toward a single month.
export function weekYm(wk) { const d = toDate(wk); d.setDate(d.getDate() + 4); return fmtYMD(d).substring(0, 7); }

// ─── Constants ──────────────────────────────────────────────────────────────────────

export const BUDGET = 3.0;
// Product owners — drive the "Product scoping ongoing" action item.
export const PRODUCT_OWNER_EMAILS = new Set(['pieterjan.debie@qargo.com', 'margot.aneca@qargo.com', 'christope.michiels@qargo.com', 'lise.verhoeven@qargo.com']);
// Capacity from the allocation plan is rescaled by this factor in the Team-capacities dashboard.
export const NEW_CAP_SCALE = 12 / 10.2;
export const ALLOC_SKILLS = [
  { id: 'backend',  label: 'Backend',  bg: '#e0e7ff', fg: '#3730a3' },
  { id: 'frontend', label: 'Frontend', bg: '#dcfce7', fg: '#15803d' },
  { id: 'mobile',   label: 'Mobile',   bg: '#fef3c7', fg: '#b45309' },
  { id: 'ai',       label: 'AI',       bg: '#ede9fe', fg: '#6d28d9' },
  { id: 'bi',       label: 'BI',       bg: '#cffafe', fg: '#0e7490' },
  { id: 'analyst',  label: 'Analyst',  bg: '#fce7f3', fg: '#be185d' },
  { id: 'infra',    label: 'Infra',    bg: '#ccfbf1', fg: '#0f766e' },
  { id: 'other',    label: 'Other',    bg: '#f1f5f9', fg: '#475569' },
];

// ─── Pure helpers compute() depends on ─────────────────────────────────────────────

// Maps an issue's explicit `team` string to a new-team id (by id or label,
// case-insensitively). Anything unrecognised (including null) falls to "other".
export function resolveNewTeamId(teamStr, config) {
  const teams = (config && config.teams) || [];
  if (!teamStr) return 'other';
  const norm = String(teamStr).trim().toLowerCase();
  for (const t of teams) {
    if (t.id.toLowerCase() === norm) return t.id;
    if ((t.label || '').toLowerCase() === norm) return t.id;
  }
  return 'other';
}

// Firefighter and Holiday issues contribute reduced demand (× 0.6).
export function newDemandFactor(iss) {
  const t = (iss && iss.type) || '';
  return (/firefight/i.test(t) || t.includes('Holiday')) ? 0.6 : 1;
}

// "Technical improvement" issues — a reserved slice of team capacity.
export function isTechImpr(iss) { return /technical improvement/i.test((iss && iss.type) || ''); }

// Quarter a week belongs to, taken from the week's START (Monday) month.
export function newQuarterIndexOfWeek(w) { const [y, m] = weekYm(w).split('-').map(Number); return y * 4 + Math.floor((m - 1) / 3); }
export function newCurrentQuarterIndex(now = new Date()) { return now.getFullYear() * 4 + Math.floor(now.getMonth() / 3); }

// A "pot" issue = assigned to a quarter but not exactly planned: start === end (a single day
// rather than a real date range). Excludes holidays and Done/Won't-do/Duplicate work.
export function isPotIssue(iss) {
  if (!iss || !iss.start || !iss.end || iss.start !== iss.end) return false;
  if ((iss.type || '').includes('Holiday')) return false;
  if (iss.status === 'Done' || iss.status === "Won't do" || iss.status === 'Duplicate') return false;
  return true;
}

export function ymToIdx(ym) { const [y, m] = String(ym).split('-').map(Number); return y * 12 + (m - 1); }
export function personStartIdx(p) { return Math.min(...p.allocations.map(s => ymToIdx(s.from))); }

// Active allocation for a display month = the latest allocation whose `from` is on/before it.
export function activeAllocation(p, ym) {
  const d = ymToIdx(ym);
  let best = null, bestIdx = -Infinity;
  p.allocations.forEach(s => { const si = ymToIdx(s.from); if (si <= d && si > bestIdx) { bestIdx = si; best = s; } });
  return best;
}

// Ramp: 1/3 first month, 2/3 second, then full. Someone whose start predates the
// plan's startMonth is already fully ramped for the whole visible horizon.
export function allocRamp(alloc, p, ym) {
  const startPlan = ymToIdx((alloc.settings || {}).startMonth || '2026-07');
  const ps = personStartIdx(p);
  const d = ymToIdx(ym);
  if (d < ps) return 0;
  if (ps < startPlan) return 1;
  const el = d - ps;
  return el === 0 ? 1 / 3 : el === 1 ? 2 / 3 : 1;
}

// The effective committed date (min of own + blocked-features' committed — see compute()).
// `scopeMap` (issueIdx → committed | null) lets a caller recompute this scoped to e.g. one
// customer's tasks; omit it (default null) for the base, unscoped value.
export function effCommitted(iss, scopeMap = null) {
  if (scopeMap && iss && iss.__idx != null && iss.__idx in scopeMap) return scopeMap[iss.__idx];
  return (iss && (iss.committedEff || iss.committed)) || null;
}

// "Overdue" — a committed date that WILL NOT be met: the planned end runs past the committed
// date, OR the issue carries a committed date but was never planned (no start AND no end).
// A "Done" issue is never overdue. `scopeMap` is forwarded to effCommitted (see above).
export function isOverdue(iss, scopeMap = null) {
  if (!iss || iss.status === 'Done') return false;
  const cd = effCommitted(iss, scopeMap);
  if (!cd) return false;
  return !!((iss.end && iss.end > cd) || (!iss.start && !iss.end));
}

// === Computation engine ==============================================================
// DATA = { issues, config }. ALLOC = the allocation plan ({ settings, teams, people }).
// `now` defaults to the real current time; pass it explicitly for deterministic/repeatable
// runs (headless snapshots, regression diffs). Mutates DATA.issues in place (adds __idx,
// committedEff, committedOwn; overwrites `committed` with the effective committed date) —
// existing, relied-upon behavior. Returns { computed, nameToFactor, leadNames } rather than
// writing to shared globals.
export function compute(DATA, ALLOC, { now = new Date() } = {}) {
  const { issues, config } = DATA;
  const { emailToName } = config;
  // Effective committed date: the earliest of an issue's OWN committed sources (its own
  // committed_date + each linked customer request's committed date) and — following the
  // "blocks" chain recursively — the committed dates of the features it blocks. A blocker
  // inherits the earliest deadline it gates, so an undated blocker of a committed feature
  // becomes visibly overdue. Stored as iss.committedEff and used everywhere "committed" is
  // read (the ⚠ overdue check, the overdue filter, the rendered value + its drilldown).
  {
    issues.forEach((iss, i) => { iss.__idx = i; });
    const byId = {}; issues.forEach((iss, i) => { if (iss.id) byId[iss.id] = i; });
    const ownCommitted = iss => {
      let m = iss.committed || null;
      (iss.customers || []).forEach(c => { if (c.committed && (!m || c.committed < m)) m = c.committed; });
      return m;
    };
    const cache = {};
    const eff = (id, stack) => {
      if (cache[id] !== undefined) return cache[id];
      const idx = byId[id]; if (idx == null) return null;
      const iss = issues[idx];
      if (stack.has(id)) return ownCommitted(iss); // cycle guard: use own committed only
      stack.add(id);
      let m = ownCommitted(iss);
      (iss.blocks || []).forEach(bid => { const bc = eff(bid, stack); if (bc && (!m || bc < m)) m = bc; });
      stack.delete(id);
      return (cache[id] = m);
    };
    issues.forEach(iss => { iss.committedEff = iss.id ? eff(iss.id, new Set()) : ownCommitted(iss); });
    // Centralise: the aggregated committed date REPLACES the raw one everywhere downstream
    // (TBD / committed-but-not-planned grouping, the committed/planned filter, sorts, the
    // ⚠ overdue check, rendered values). Keep the raw own committed as `committedOwn` only so
    // the drilldown can flag when the date was pulled earlier by a feature this one blocks.
    issues.forEach(iss => { iss.committedOwn = iss.committed; iss.committed = iss.committedEff; });
  }
  // Always empty now — part-time % lives on each person's ALLOCATION entry instead
  // (part_time_pct from Notion). Kept only so the legacy getPersonBudget/getDisplayName
  // call sites in template-script.js (dead — see its own comments) have a safe no-op
  // lookup rather than a ReferenceError if that code path is ever re-enabled.
  const nameToFactor = {};
  const leadNames = new Set();
  const now2 = now; // local alias, kept distinct from any per-week `now` shadowing below
  const curMonday = toMonday(now2);
  const DONE_STATUSES = new Set(['Done', "Won't do", 'Duplicate']);
  // The visible-week window is a FIXED calendar range — the current week's Monday through
  // the end of (current quarter + 2) — and is NOT derived from issue date ranges. This
  // guarantees the capacity grid and stat cards always render (from ALLOC alone), even
  // before/while issues load or when the loaded batch has no dated issues; demand simply
  // overlays onto these weeks as issues arrive.
  const _capQ = newCurrentQuarterIndex(now2) + 2;
  const allWeeks = new Set();
  {
    const d = new Date(curMonday);
    for (let i = 0; i < 80; i++) { const wk = fmtYMD(d); if (newQuarterIndexOfWeek(wk) > _capQ) break; allWeeks.add(wk); d.setDate(d.getDate() + 7); }
  }
  const startWeek = fmtYMD(curMonday);
  const sortedWeeks = [...allWeeks].sort().filter(w => w >= startWeek);
  const visibleWeekSet = new Set(sortedWeeks);
  // ── Per-team, per-skill, per-week demand ──────────────
  // An issue is routed to a team if its explicit `team` property points there OR any
  // assignee is a member of that team (allocation membership). Skill effort is spread
  // by working-day share across the visible weeks. Issues that land on a team only via
  // the `team` property (no assignee is a member of it) are also tracked as UNASSIGNED
  // for that team.
  const _normNm = s => String(s || '').toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z0-9]/g, '');
  const allocByNorm = {};
  (ALLOC.people || []).forEach(p => { allocByNorm[_normNm(p.name)] = p; });
  // config.teams ids are ALLOCATION team ids directly (both derived via slugTeam()),
  // so membership is just "is this allocation's team one of the app's recognised teams".
  const newTeamIds = new Set(((config && config.teams) || []).map(t => t.id));
  const personTeams = name => {
    const p = allocByNorm[_normNm(name)];
    const set = new Set();
    if (p) p.allocations.forEach(entry => { if (entry.teamId && newTeamIds.has(entry.teamId)) set.add(entry.teamId); });
    return set;
  };
  // The serve now also sends Done issues whose end date is in the current quarter;
  // keep those (completed work still consumed capacity) but still drop older Done /
  // Won't do / Duplicate issues.
  const CUR_Q = now2.getFullYear() * 4 + Math.floor(now2.getMonth() / 3);
  const doneThisQuarter = iss => {
    if (!iss.end) return false;
    const [y, m] = String(iss.end).split('-').map(Number);
    return (y * 4 + Math.floor((m - 1) / 3)) === CUR_Q;
  };
  // Team-capacity demand excludes issues of type "Customer task" (they belong to the
  // Customers-at-risk view, not engineering demand) as well as dropped/old-Done work.
  const skipIssue = iss => (DONE_STATUSES.has(iss.status) && !doneThisQuarter(iss)) || (iss.type || '').toLowerCase().includes('customer task');
  const newWeeklyDemand = {};   // teamId → skillId → week → days
  const unassignedWeekly = {};  // teamId → week → days (issues on the team with no member assignee)
  const unassignedEntries = {}; // teamId → week → [{issueIdx, effort}]
  const needsEstimate = {};       // teamId → [issueIdx] (real issues with no effort yet)
  const preplannedNextWeek = {};  // teamId → [issueIdx] (features preplanned on a team member, starting ≤ next Friday)
  const productScoping = {};      // teamId → [issueIdx] (status "Product scoping in progress", assigned to a product owner)
  const committedUnplanned = {};  // teamId → [issueIdx] (committed in the visible window but no start/end)
  const overdueByTeam = {};       // teamId → [issueIdx] (isOverdue: end past committed, or committed-but-unplanned)
  // Informational "foreign" rows: people handling a team's (team-property) issues who are
  // NOT members of that team — either members of another team (filled by a post-pass over
  // newPersonEntries) or email-only assignees not in the allocation plan (filled in the
  // demand loop below). Product owners are excluded. Not counted in any total.
  const foreignRosterWeek = {};    // teamId → personName → week → effort
  const foreignRosterEntries = {}; // teamId → personName → week → [{issueIdx, effort}]
  const addForeign = (teamId, nm, wk, issIdx, eff) => {
    if (!(eff > 0) || !visibleWeekSet.has(wk)) return;
    (foreignRosterWeek[teamId] = foreignRosterWeek[teamId] || {});
    (foreignRosterWeek[teamId][nm] = foreignRosterWeek[teamId][nm] || {});
    foreignRosterWeek[teamId][nm][wk] = (foreignRosterWeek[teamId][nm][wk] || 0) + eff;
    (foreignRosterEntries[teamId] = foreignRosterEntries[teamId] || {});
    (foreignRosterEntries[teamId][nm] = foreignRosterEntries[teamId][nm] || {});
    (foreignRosterEntries[teamId][nm][wk] = foreignRosterEntries[teamId][nm][wk] || []).push({ issueIdx: issIdx, effort: eff });
  };
  // Friday at the end of next week: this week's Monday + 11 days.
  const nextFri = (() => { const d = toMonday(now2); d.setDate(d.getDate() + 11); return fmtYMD(d); })();
  issues.forEach((iss, issIdx) => {
    if (skipIssue(iss)) return;
    // Holidays are no longer demand — they reduce each person's capacity directly
    // (holidays reduce capacity, computed separately below), so skip them here.
    if ((iss.type || '').includes('Holiday')) return;
    // "Preplanned next week": a real feature, not Done, starting on/before next Friday,
    // preplanned on a member of the team → listed under that team.
    if (iss.status !== 'Done' && iss.start && iss.start <= nextFri && newDemandFactor(iss) === 1) {
      const ppNames = (iss.preplannedOn || []).map(em => emailToName[em] || em);
      const ppTeams = new Set();
      ppNames.forEach(nm => personTeams(nm).forEach(t => ppTeams.add(t)));
      ppTeams.forEach(t => { (preplannedNextWeek[t] = preplannedNextWeek[t] || []).push(issIdx); });
    }
    // "Product scoping ongoing": status is "Product scoping in progress" OR it is assigned
    // to one of the product owners → listed under the team(s) it belongs to.
    if (iss.status === 'Product scoping in progress' || (iss.assignedTo || []).some(e => PRODUCT_OWNER_EMAILS.has(e))) {
      const psNames = (iss.assignedTo || []).map(em => emailToName[em] || em);
      const psTeams = new Set();
      psNames.forEach(nm => personTeams(nm).forEach(t => psTeams.add(t)));
      const psProp = resolveNewTeamId(iss.team, config);
      if (psProp !== 'other') psTeams.add(psProp);
      if (!psTeams.size) psTeams.add('other');
      psTeams.forEach(t => { (productScoping[t] = productScoping[t] || []).push(issIdx); });
    }
    // "Committed but not planned": committed date on/before the end of the visible
    // window (this + next 2 quarters), so overdue commitments count too, but no start
    // AND no end date yet.
    if (iss.committed && !iss.start && !iss.end) {
      const [cy, cm] = String(iss.committed).split('-').map(Number);
      const cq = cy * 4 + Math.floor((cm - 1) / 3);
      if (cq <= CUR_Q + 2) {
        const cNames = (iss.assignedTo || []).map(em => emailToName[em] || em);
        const cTeams = new Set();
        cNames.forEach(nm => personTeams(nm).forEach(t => cTeams.add(t)));
        const cProp = resolveNewTeamId(iss.team, config);
        if (cProp !== 'other') cTeams.add(cProp);
        if (!cTeams.size) cTeams.add('other');
        cTeams.forEach(t => { (committedUnplanned[t] = committedUnplanned[t] || []).push(issIdx); });
      }
    }
    // "Overdue" (isOverdue): committed date won't be met — planned end past it, or committed
    // but never planned (no start/end). Excludes completed issues.
    if (isOverdue(iss) && !DONE_STATUSES.has(iss.status)) {
      const oNames = (iss.assignedTo || []).map(em => emailToName[em] || em);
      const oTeams = new Set();
      oNames.forEach(nm => personTeams(nm).forEach(t => oTeams.add(t)));
      const oProp = resolveNewTeamId(iss.team, config);
      if (oProp !== 'other') oTeams.add(oProp);
      if (!oTeams.size) oTeams.add('other');
      oTeams.forEach(t => { (overdueByTeam[t] = overdueByTeam[t] || []).push(issIdx); });
    }
    // Tagged "Needs Estimate" (feature tags, index 32) → surface in the Needs-estimate
    // table regardless of whether an effort estimate already exists or a date is set
    // (real, non-drain, non-Done, non-parent).
    const taggedNeedsEstimate = (iss.tags || []).some(t => String(t).toLowerCase().includes('needs estimate'));
    if (taggedNeedsEstimate && newDemandFactor(iss) === 1 && !DONE_STATUSES.has(iss.status) && !iss.isParent) {
      const tNames = (iss.assignedTo || []).map(em => emailToName[em] || em);
      const tTeams = new Set();
      tNames.forEach(nm => personTeams(nm).forEach(t => tTeams.add(t)));
      const tProp = resolveNewTeamId(iss.team, config);
      if (tProp !== 'other') tTeams.add(tProp);
      if (!tTeams.size) tTeams.add('other');
      tTeams.forEach(t => { (needsEstimate[t] = needsEstimate[t] || []).push(issIdx); });
    }
    const skillEfforts = iss.skillEfforts || {};
    if (!ALLOC_SKILLS.some(sk => skillEfforts[sk.id] > 0)) {
      // No effort estimated. List it under the team(s) it belongs to for the
      // "Needs estimate" table — but only real (non-drain), non-Done issues that
      // have at least a start or end date assigned. Skip if already added via the
      // "Needs Estimate" tag above (avoid duplicate rows).
      if (!taggedNeedsEstimate && newDemandFactor(iss) === 1 && !DONE_STATUSES.has(iss.status) && !iss.isParent && (iss.start || iss.end)) {
        const neNames = (iss.assignedTo || []).map(em => emailToName[em] || em);
        const neTeams = new Set();
        neNames.forEach(nm => personTeams(nm).forEach(t => neTeams.add(t)));
        const nePropTeam = resolveNewTeamId(iss.team, config);
        if (nePropTeam !== 'other') neTeams.add(nePropTeam);
        if (!neTeams.size) neTeams.add('other');
        neTeams.forEach(t => { (needsEstimate[t] = needsEstimate[t] || []).push(issIdx); });
      }
      return;
    }
    if (!iss.start && !iss.end) return; // tolerate a single date (use it for both)
    const s = toDate(iss.start || iss.end), e = toDate(iss.end || iss.start);
    if (isNaN(s) || isNaN(e) || e < s) return;
    const factor = newDemandFactor(iss);
    const weekDays = {}; let totalWD = 0;
    for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
      if (!isWeekday(d)) continue;
      totalWD++;
      const mon = fmtYMD(toMonday(d));
      weekDays[mon] = (weekDays[mon] || 0) + 1;
    }
    if (!totalWD) return;
    const names = (iss.assignedTo || []).map(em => emailToName[em] || em);
    const memberTeams = new Set();
    names.forEach(nm => personTeams(nm).forEach(t => memberTeams.add(t)));
    // Email-only assignees: not a product owner and not in any allocation team → shown as
    // informative rows (not counted, not "unassigned"). Product owners are excluded here.
    const externalNames = [...new Set((iss.assignedTo || []).filter(em => !PRODUCT_OWNER_EMAILS.has(em)).map(em => emailToName[em] || em))].filter(nm => !personTeams(nm).length);
    const teams = new Set(memberTeams);
    const propTeam = resolveNewTeamId(iss.team, config);
    if (propTeam !== 'other') teams.add(propTeam);
    if (!teams.size) teams.add('other');
    const totalSkill = ALLOC_SKILLS.reduce((a, sk) => a + (skillEfforts[sk.id] > 0 ? skillEfforts[sk.id] : 0), 0) * factor;
    teams.forEach(teamId => {
      if (!newWeeklyDemand[teamId]) newWeeklyDemand[teamId] = {};
      for (const sk of ALLOC_SKILLS) {
        const eff = (skillEfforts[sk.id] || 0) * factor;
        if (!(eff > 0)) continue;
        if (!newWeeklyDemand[teamId][sk.id]) newWeeklyDemand[teamId][sk.id] = {};
        for (const [wk, days] of Object.entries(weekDays)) {
          if (!visibleWeekSet.has(wk)) continue;
          newWeeklyDemand[teamId][sk.id][wk] = (newWeeklyDemand[teamId][sk.id][wk] || 0) + eff * days / totalWD;
        }
      }
      // Reached this team only via the team property (no assignee is a member of it).
      // Assignees on OTHER teams already count there (shown as informative rows via the
      // post-pass). Here we handle the "no member on any team" case:
      //   • email-only assignees (non-product-owner) → informative rows, not counted;
      //   • no assignees at all → the counted "Unassigned" line;
      //   • only product owners → excluded entirely (scoping work; no row, not counted).
      if (!memberTeams.has(teamId) && memberTeams.size === 0) {
        if (externalNames.length) {
          for (const [wk, days] of Object.entries(weekDays)) {
            if (!visibleWeekSet.has(wk)) continue;
            const portion = totalSkill * days / totalWD / externalNames.length;
            externalNames.forEach(nm => addForeign(teamId, nm, wk, issIdx, portion));
          }
        } else if (!names.length) {
          if (!unassignedWeekly[teamId]) { unassignedWeekly[teamId] = {}; unassignedEntries[teamId] = {}; }
          for (const [wk, days] of Object.entries(weekDays)) {
            if (!visibleWeekSet.has(wk)) continue;
            const portion = totalSkill * days / totalWD;
            unassignedWeekly[teamId][wk] = (unassignedWeekly[teamId][wk] || 0) + portion;
            if (!unassignedEntries[teamId][wk]) unassignedEntries[teamId][wk] = [];
            unassignedEntries[teamId][wk].push({ issueIdx: issIdx, effort: portion });
          }
        }
      }
    });
  });
  for (const t in newWeeklyDemand) for (const sk in newWeeklyDemand[t]) for (const w in newWeeklyDemand[t][sk]) newWeeklyDemand[t][sk][w] = Math.round(newWeeklyDemand[t][sk][w] * 10) / 10;
  for (const t in unassignedWeekly) for (const w in unassignedWeekly[t]) unassignedWeekly[t][w] = Math.round(unassignedWeekly[t][w] * 10) / 10;
  // Per-person, per-week load for the "By person" roster. Feature effort is
  // skill-matched to assignees (exclusive-skill holders first; a skill no assignee
  // has stays unstaffed). Holiday/firefighter issues are treated as capacity DRAIN
  // (× 0.6) rather than feature work. Then — replicating the legacy view — feature
  // work in a drained week is capped at the person's leftover capacity
  // (weeklyCap − drain), and the displaced effort shifts to that feature's other
  // (non-drained) weeks. `skillEffort` on each entry = the person's assigned total.
  const personSkillSet = (name, ym) => {
    const p = allocByNorm[_normNm(name)];
    if (!p) return null;
    const entry = activeAllocation(p, ym);
    if (!entry) return new Set();
    const sk = entry.skills || {};
    return new Set(ALLOC_SKILLS.filter(s => sk[s.id] > 0).map(s => s.id));
  };
  // Normalised skill weights for a person that month (their allocation skill mix),
  // used to attribute skill-less drain (time off) to the person's own skill(s).
  const personSkillFrac = (name, ym) => {
    const p = allocByNorm[_normNm(name)];
    if (!p) return {};
    const entry = activeAllocation(p, ym);
    if (!entry) return {};
    const sk = entry.skills || {};
    const tot = ALLOC_SKILLS.reduce((a, s) => a + (sk[s.id] > 0 ? sk[s.id] : 0), 0);
    if (tot <= 0) return {};
    const f = {};
    ALLOC_SKILLS.forEach(s => { if (sk[s.id] > 0) f[s.id] = sk[s.id] / tot; });
    return f;
  };
  // Whether a person's active allocation that month is a team-lead allocation.
  const personIsLead = (name, ym) => {
    const p = allocByNorm[_normNm(name)];
    if (!p) return false;
    const entry = activeAllocation(p, ym);
    return !!(entry && entry.lead);
  };
  // Scaled weekly capacity for a person, used to cap feature work in a drained
  // week (≈ 3d for a full-timer, less part-time). Leads carry 0 *budgeted* IC
  // capacity, but when they're actually assigned feature work we still plan it
  // against a normal working week — otherwise any drain (a lead's firefighter /
  // support week) would wipe their assigned features to 0. Falls back to BUDGET
  // if the person isn't in the allocation plan.
  const pWeekCap = (name, wk) => {
    const p = allocByNorm[_normNm(name)];
    if (!p) return BUDGET;
    const ym = weekYm(wk);
    const entry = activeAllocation(p, ym);
    if (!entry) return 0;
    const dpm = (ALLOC.settings || {}).daysPerMonth || 10.2;
    const pct = entry.pct != null ? entry.pct : 100;
    const monthly = dpm * (pct / 100) * allocRamp(ALLOC, p, ym); // lead flag deliberately ignored
    return monthly * NEW_CAP_SCALE / 4;
  };
  // Only firefighting is a capacity drain now; holidays reduce capacity directly.
  const isDrainNew = iss => /firefight/i.test(iss.type || '');
  const weekDaysOf = (s, e) => {
    const wd = {}; let tot = 0;
    for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
      if (!isWeekday(d)) continue;
      tot++;
      const mon = fmtYMD(toMonday(d));
      wd[mon] = (wd[mon] || 0) + 1;
    }
    return { wd, tot };
  };
  const newPersonWeek = {};
  const newPersonEntries = {}; // name → week → [{issueIdx, effort, skillEffort, drain?}]
  const drainPW = {};          // name → week → total drain days
  issues.forEach((iss, issIdx) => {
    if (skipIssue(iss)) return;
    if ((iss.type || '').includes('Holiday')) return; // holidays reduce capacity, not demand
    // Tolerate a single date: an issue planned with only a start (or only an end) still
    // gets placed (its one date used for both) rather than vanishing from the grid.
    if (!iss.start && !iss.end) return;
    const s = toDate(iss.start || iss.end), e = toDate(iss.end || iss.start);
    if (isNaN(s) || isNaN(e) || e < s) return;
    const names = (iss.assignedTo || []).map(em => emailToName[em] || em);
    if (!names.length) return;
    const { wd: weekDays, tot: totalWD } = weekDaysOf(s, e);
    if (totalWD === 0) return;
    if (isDrainNew(iss)) {
      // Capacity drain: holiday/firefighter consumes the person's weekly capacity
      // (× 0.6) and displaces feature work. Its effort is still counted as demand,
      // attributed to its per-skill efforts when it has them (e.g. firefighting on
      // backend); a time-off issue with only a total effort stays skill-less.
      const skillEfforts = iss.skillEfforts || {};
      const skillSum = ALLOC_SKILLS.reduce((a, sk) => a + (skillEfforts[sk.id] > 0 ? skillEfforts[sk.id] : 0), 0);
      const base = ((skillSum > 0 ? skillSum : (iss.effortTotal || 0)) * 0.6) / names.length;
      if (!(base > 0)) return;
      const issueFrac = {};
      if (skillSum > 0) ALLOC_SKILLS.forEach(s => { if (skillEfforts[s.id] > 0) issueFrac[s.id] = skillEfforts[s.id] / skillSum; });
      names.forEach(nm => {
        if (!newPersonWeek[nm]) { newPersonWeek[nm] = {}; newPersonEntries[nm] = {}; }
        if (!drainPW[nm]) drainPW[nm] = {};
        for (const [wk, days] of Object.entries(weekDays)) {
          if (!visibleWeekSet.has(wk)) continue;
          const d = base * days / totalWD;
          const lead = personIsLead(nm, weekYm(wk));
          // A team LEAD carries 0 IC capacity, so their firefighting/holiday time is NOT
          // team load: like a holiday it must not consume capacity or count as demand. The
          // grid cell + team totals sum each entry's weekly `effort`, so we zero that for a
          // lead (→ cell shows 0, nothing added to the team's load/demand or Firefighting
          // row). The record is still listed with its full estimate in the "Skill effort"
          // column and still drives the 🔥 icon — only its weekly demand is zeroed.
          if (!lead) drainPW[nm][wk] = (drainPW[nm][wk] || 0) + d;
          const frac = lead ? {} : (skillSum > 0 ? issueFrac : personSkillFrac(nm, weekYm(wk)));
          if (!newPersonEntries[nm][wk]) newPersonEntries[nm][wk] = [];
          newPersonEntries[nm][wk].push({ issueIdx: issIdx, effort: lead ? 0 : d, skillEffort: base, drain: true, skillFrac: frac });
        }
      });
      return;
    }
    const skillEfforts = iss.skillEfforts || {};
    if (!ALLOC_SKILLS.some(sk => skillEfforts[sk.id] > 0)) return;
    const startYm = (iss.start || iss.end).substring(0, 7);
    const skillSets = {};
    names.forEach(nm => { skillSets[nm] = personSkillSet(nm, startYm); });
    const assigned = {};       // name → total assigned days for this issue
    const assignedSkills = {}; // name → { skillId: assigned days } (for the per-skill split)
    ALLOC_SKILLS.forEach(sk => {
      const eff = skillEfforts[sk.id] || 0;
      if (!(eff > 0)) return;
      const cands = names.filter(nm => skillSets[nm] && skillSets[nm].has(sk.id));
      let recipients;
      if (cands.length) {
        const excl = cands.filter(nm => skillSets[nm].size === 1);
        recipients = excl.length ? excl : cands;
      } else {
        // No assignee has this skill. Give it to the assignees in the allocation plan,
        // else to all assignees, so assigned work always shows on its assignees' rows.
        const inPlan = names.filter(nm => skillSets[nm]);
        recipients = inPlan.length ? inPlan : names;
      }
      if (!recipients.length) return;
      const share = eff / recipients.length;
      recipients.forEach(nm => {
        assigned[nm] = (assigned[nm] || 0) + share;
        (assignedSkills[nm] = assignedSkills[nm] || {})[sk.id] = (assignedSkills[nm][sk.id] || 0) + share;
      });
    });
    Object.entries(assigned).forEach(([nm, tot]) => {
      if (!(tot > 0)) return;
      // Fraction of this person's effort per skill (constant across the issue's weeks).
      const frac = {};
      const as = assignedSkills[nm] || {};
      ALLOC_SKILLS.forEach(s => { if (as[s.id] > 0) frac[s.id] = as[s.id] / tot; });
      if (!newPersonWeek[nm]) { newPersonWeek[nm] = {}; newPersonEntries[nm] = {}; }
      for (const [wk, days] of Object.entries(weekDays)) {
        if (!visibleWeekSet.has(wk)) continue;
        if (!newPersonEntries[nm][wk]) newPersonEntries[nm][wk] = [];
        newPersonEntries[nm][wk].push({ issueIdx: issIdx, effort: tot * days / totalWD, skillEffort: tot, drain: false, skillFrac: frac });
      }
    });
  });
  // Redistribute feature work around drained weeks (cap at leftover capacity, push
  // the delta to the same feature's non-drained weeks) — legacy drain logic.
  for (const nm in newPersonEntries) {
    if (!drainPW[nm]) continue; // no holiday/firefighter for this person → nothing to redistribute
    const nonDrainCount = {}; // week → distinct non-drain issue count
    for (const wk in newPersonEntries[nm]) {
      const set = new Set();
      newPersonEntries[nm][wk].forEach(en => { if (!en.drain) set.add(en.issueIdx); });
      nonDrainCount[wk] = set.size;
    }
    const groups = {}; // issueIdx → [{en, wk}]
    for (const wk in newPersonEntries[nm]) {
      newPersonEntries[nm][wk].forEach(en => { if (!en.drain) (groups[en.issueIdx] = groups[en.issueIdx] || []).push({ en, wk }); });
    }
    for (const iidx in groups) {
      const grp = groups[iidx];
      // Only cap/redistribute when the week's drain is material (> 1 day); a small
      // amount of holiday leaves the feature plan untouched.
      const drained = grp.filter(g => (drainPW[nm][g.wk] || 0) > 1);
      if (!drained.length) continue;
      const total = grp.reduce((a, g) => a + g.en.effort, 0);
      let drainedTargetSum = 0;
      const targets = drained.map(g => {
        const t = Math.max(0, (pWeekCap(nm, g.wk) - drainPW[nm][g.wk]) / (nonDrainCount[g.wk] || 1));
        drainedTargetSum += t;
        return { g, t };
      });
      const nonDrained = grp.filter(g => !((drainPW[nm][g.wk] || 0) > 1));
      if (drainedTargetSum >= total) {
        const scale = drainedTargetSum > 0 ? total / drainedTargetSum : 0;
        targets.forEach(({ g, t }) => { g.en.effort = t * scale; });
        nonDrained.forEach(g => { g.en.effort = 0; });
      } else {
        targets.forEach(({ g, t }) => { g.en.effort = t; });
        const remaining = total - drainedTargetSum;
        if (nonDrained.length > 0) { const per = remaining / nonDrained.length; nonDrained.forEach(g => { g.en.effort = per; }); }
        else { const extra = remaining / targets.length; targets.forEach(({ g }) => { g.en.effort += extra; }); }
      }
    }
  }
  // Rebuild per-week totals from the (possibly redistributed) entries.
  for (const nm in newPersonEntries) {
    newPersonWeek[nm] = {};
    for (const wk in newPersonEntries[nm]) {
      let sum = 0; newPersonEntries[nm][wk].forEach(en => { sum += en.effort; });
      newPersonWeek[nm][wk] = Math.round(sum * 10) / 10;
    }
  }
  // Foreign-assignee roster (member-of-another-team part): an issue whose `team` property
  // points at team T but is actually assigned to people on OTHER teams already counts in
  // those teams — so on T we show those people as INFORMATIONAL rows (their skill-matched
  // effort on T's issues), not counted in T's total. (Email-only assignees were already
  // added to the same structure in the demand loop via addForeign.)
  for (const nm in newPersonEntries) {
    const myTeams = new Set(personTeams(nm)); // teams this person is a member of
    // Only the "member of another team" case belongs here. Email-only assignees (not in
    // any allocation team) were already added by the demand loop above — re-adding them
    // here would double-count them in the foreign roster and list them twice in the drill-down.
    if (!myTeams.size) continue;
    for (const wk in newPersonEntries[nm]) {
      newPersonEntries[nm][wk].forEach(en => {
        if (en.drain || !(en.effort > 0)) return;
        const pt = resolveNewTeamId((DATA.issues[en.issueIdx] || {}).team, config);
        if (pt === 'other' || myTeams.has(pt)) return; // no foreign team, or the person is on it
        addForeign(pt, nm, wk, en.issueIdx, en.effort);
      });
    }
  }
  // Per-team, per-skill weekly demand for the stat cards — the same per-person load
  // split back to skills (each member attributed to their team that week), plus
  // per-skill unassigned demand, plus a skill-less drain bucket. By construction
  // Σ skills + drain = the grid's team-total demand, so the cards reconcile exactly.
  const newTeamSkillWeek = {}; // newTeamId → skillId → week → days
  const newTeamDrainWeek = {}; // newTeamId → week → days
  const tiSpentMonth = {};     // newTeamId → skillId → month → days spent on "technical improvement" issues
  const newTeamSkillMonthEntries = {}; // newTeamId → skillId → month → { issueIdx: days } (drives the stat-card modal)
  const newTeamDrainMonthEntries = {}; // newTeamId → month → { issueIdx: days }
  // Planning "pot": issues assigned to a quarter but not exactly planned (start === end — any
  // single day). Pulled OUT of the month/week demand and grouped per team/skill/quarter (by the
  // date's quarter), with a per-issue entry map driving the pot drill-down modal.
  const newTeamSkillPotQ = {};       // newTeamId → skillId → quarterIdx → days
  const newTeamSkillPotEntries = {}; // newTeamId → skillId → quarterIdx → { issueIdx: days }
  // Per-person demand (keyed by allocation name) for the engineer filter in the stat cards.
  const demWeekPersonSkill = {}; // allocName → skillId → week → days
  const drainWeekPerson = {};    // allocName → week → days
  const addSkillDem = (tid, sk, wk, v, idx) => {
    if (!(v > 0)) return;
    const iss = idx != null ? DATA.issues[idx] : null;
    if (iss && isPotIssue(iss)) {
      // Route to the quarter's "pot" bucket instead of a specific month/week.
      const [py, pm] = iss.start.split('-').map(Number);
      const qi = py * 4 + Math.floor((pm - 1) / 3);
      (newTeamSkillPotQ[tid] = newTeamSkillPotQ[tid] || {}); (newTeamSkillPotQ[tid][sk] = newTeamSkillPotQ[tid][sk] || {});
      newTeamSkillPotQ[tid][sk][qi] = (newTeamSkillPotQ[tid][sk][qi] || 0) + v;
      const p = newTeamSkillPotEntries; (p[tid] = p[tid] || {}); (p[tid][sk] = p[tid][sk] || {}); (p[tid][sk][qi] = p[tid][sk][qi] || {}); p[tid][sk][qi][idx] = (p[tid][sk][qi][idx] || 0) + v;
      return;
    }
    (newTeamSkillWeek[tid] = newTeamSkillWeek[tid] || {}); (newTeamSkillWeek[tid][sk] = newTeamSkillWeek[tid][sk] || {});
    newTeamSkillWeek[tid][sk][wk] = (newTeamSkillWeek[tid][sk][wk] || 0) + v;
    if (idx != null) { const m = weekYm(wk); const a = newTeamSkillMonthEntries; (a[tid] = a[tid] || {}); (a[tid][sk] = a[tid][sk] || {}); (a[tid][sk][m] = a[tid][sk][m] || {}); a[tid][sk][m][idx] = (a[tid][sk][m][idx] || 0) + v; }
  };
  for (const nm in newPersonEntries) {
    const p = allocByNorm[_normNm(nm)];
    const pKey = p && p.name; // allocation name (for the per-person filter maps)
    for (const wk in newPersonEntries[nm]) {
      let tid = null;
      if (p) { const entry = activeAllocation(p, weekYm(wk)); if (entry && newTeamIds.has(entry.teamId)) tid = entry.teamId; }
      if (!tid) continue;
      newPersonEntries[nm][wk].forEach(en => {
        // Attribute effort to skills via skillFrac (features and skilled drains alike);
        // any unattributed remainder (skill-less time off) goes to the drain bucket.
        const frac = en.skillFrac || {};
        let attributed = 0;
        ALLOC_SKILLS.forEach(s => { const f = frac[s.id]; if (f) { const v = en.effort * f; addSkillDem(tid, s.id, wk, v, en.issueIdx); attributed += v; if (pKey) { (demWeekPersonSkill[pKey] = demWeekPersonSkill[pKey] || {}); (demWeekPersonSkill[pKey][s.id] = demWeekPersonSkill[pKey][s.id] || {}); demWeekPersonSkill[pKey][s.id][wk] = (demWeekPersonSkill[pKey][s.id][wk] || 0) + v; } } });
        const rest = en.effort - attributed;
        if (rest > 1e-9) {
          (newTeamDrainWeek[tid] = newTeamDrainWeek[tid] || {}); newTeamDrainWeek[tid][wk] = (newTeamDrainWeek[tid][wk] || 0) + rest;
          const m = weekYm(wk); const a = newTeamDrainMonthEntries; (a[tid] = a[tid] || {}); (a[tid][m] = a[tid][m] || {}); a[tid][m][en.issueIdx] = (a[tid][m][en.issueIdx] || 0) + rest;
          if (pKey) { (drainWeekPerson[pKey] = drainWeekPerson[pKey] || {}); drainWeekPerson[pKey][wk] = (drainWeekPerson[pKey][wk] || 0) + rest; }
        }
      });
    }
  }
  for (const tid in unassignedEntries) {
    for (const wk in unassignedEntries[tid]) {
      unassignedEntries[tid][wk].forEach(en => {
        // Skill-tagged entries (unstaffed skill of an otherwise-assigned issue) land on
        // exactly that skill — no re-split across the issue's other skills.
        if (en.skill) { addSkillDem(tid, en.skill, wk, en.effort, en.issueIdx); return; }
        const se = (DATA.issues[en.issueIdx] || {}).skillEfforts || {};
        const tot = ALLOC_SKILLS.reduce((a, s) => a + (se[s.id] > 0 ? se[s.id] : 0), 0);
        if (tot <= 0) { addSkillDem(tid, 'other', wk, en.effort, en.issueIdx); return; }
        ALLOC_SKILLS.forEach(s => { if (se[s.id] > 0) addSkillDem(tid, s.id, wk, en.effort * se[s.id] / tot, en.issueIdx); });
      });
    }
  }
  // Days spent on "technical improvement" issues, per team/skill/month. Deliberately
  // INCLUDES Done issues (filtered out of the demand loops above) so completed TI
  // still counts against the TI budget. Spread by working days across all months.
  const tiEntriesMonth = {}; // newTeamId → skillId → 'YYYY-MM' → [{issueIdx, effort}]
  issues.forEach((iss, issIdx) => {
    if (!isTechImpr(iss)) return;
    if (!iss.start || !iss.end) return;
    const s = toDate(iss.start), e = toDate(iss.end);
    if (isNaN(s) || isNaN(e) || e < s) return;
    const se = iss.skillEfforts || {};
    if (!ALLOC_SKILLS.some(sk => se[sk.id] > 0)) return;
    const monthDays = {}; let totalWD = 0;
    for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) { if (!isWeekday(d)) continue; totalWD++; const m = fmtYMD(d).substring(0, 7); monthDays[m] = (monthDays[m] || 0) + 1; }
    if (!totalWD) return;
    const names = (iss.assignedTo || []).map(em => emailToName[em] || em);
    const memberTeams = new Set();
    names.forEach(nm => personTeams(nm).forEach(t => memberTeams.add(t)));
    const teams = new Set(memberTeams);
    const propTeam = resolveNewTeamId(iss.team, config);
    if (propTeam !== 'other') teams.add(propTeam);
    if (!teams.size) teams.add('other');
    teams.forEach(tid => {
      tiSpentMonth[tid] = tiSpentMonth[tid] || {};
      tiEntriesMonth[tid] = tiEntriesMonth[tid] || {};
      ALLOC_SKILLS.forEach(sk => {
        const eff = se[sk.id] || 0; if (!(eff > 0)) return;
        tiSpentMonth[tid][sk.id] = tiSpentMonth[tid][sk.id] || {};
        tiEntriesMonth[tid][sk.id] = tiEntriesMonth[tid][sk.id] || {};
        for (const [m, days] of Object.entries(monthDays)) {
          const v = eff * days / totalWD;
          tiSpentMonth[tid][sk.id][m] = (tiSpentMonth[tid][sk.id][m] || 0) + v;
          (tiEntriesMonth[tid][sk.id][m] = tiEntriesMonth[tid][sk.id][m] || []).push({ issueIdx: issIdx, effort: v });
        }
      });
    });
  });
  // Issue → new-team ids (assignee teams + `team` property), used to scope the
  // Team-caps(new) rules rail to the active team. Covers every issue (any status).
  const issueTeams = {};        // issueIdx → new teams (assignees' teams + `team` property)
  const issueMemberTeams = {};  // issueIdx → new teams the ASSIGNEES belong to (no property)
  issues.forEach((iss, i) => {
    const memberSet = new Set();
    (iss.assignedTo || []).map(em => emailToName[em] || em).forEach(nm => personTeams(nm).forEach(t => memberSet.add(t)));
    if (memberSet.size) issueMemberTeams[i] = [...memberSet];
    const set = new Set(memberSet);
    const pt = resolveNewTeamId(iss.team, config);
    if (pt !== 'other') set.add(pt);
    if (set.size) issueTeams[i] = [...set];
  });
  // Holidays reduce capacity (not demand). Capacity = (20 working days − holidays) × 0.6,
  // so a holiday costs 0.6 productive days. We build the holiday days a person is off per
  // WEEK (so the current month is handled correctly — only the current week onward counts,
  // matching the demand window). Two parts:
  //   (a) PLANNED holidays land in the week they fall (past weeks excluded via visibleWeekSet).
  //   (b) the year's UNSPENT allowance (budget − full-year planned) is spread evenly across
  //       the remaining months of that year (current month included), then across each
  //       month's remaining/visible weeks.
  const HOLIDAY_YEARS = ['2026', '2027'];
  const nowYear = now2.getFullYear(), nowMonth = now2.getMonth();
  const nowMonIdx = nowYear * 12 + nowMonth;
  const ymIdx = ym => { const [yy, mm] = ym.split('-').map(Number); return yy * 12 + (mm - 1); };
  const holidayPlanned = {};             // person name → { year: workingDays }  (full year, for the Holidays view + unspent calc)
  const holidayPlannedMonth = {};        // person name → { 'YYYY-MM': workingDays }  (full month, for the Budgets view)
  const holidayPlannedCalMonth = {};     // person name → { 'YYYY-MM': workingDays }  (the day's OWN calendar month, for the year's-unspent-left calc —
                                          //   deliberately NOT holidayPlannedMonth: a week whose Mon–Thu falls in December but whose Friday lands in
                                          //   January (a year-end week) must still count against DECEMBER's year budget, not January's)
  const holidayPlannedPersonWeek = {};   // person name → weekMonday → planned holiday days that week (visible weeks; drives the 🌴 icon)
  const holidayEntriesPersonWeek = {};   // person name → weekMonday → { issueIdx: days } (holiday issues behind a cell)
  const holidayDaysPersonWeek = {};      // person name → weekMonday → holiday days that week = planned + unspent share (capacity reduction)
  const addHolWk = (name, wk, v) => { if (!(v > 0) || !visibleWeekSet.has(wk)) return; (holidayDaysPersonWeek[name] = holidayDaysPersonWeek[name] || {}); holidayDaysPersonWeek[name][wk] = (holidayDaysPersonWeek[name][wk] || 0) + v; };
  issues.forEach((iss, issIdx) => {
    if (!(iss.type || '').includes('Holiday') || !iss.start || !iss.end) return;
    const s = toDate(iss.start), e = toDate(iss.end);
    if (isNaN(s) || isNaN(e) || e < s) return;
    const people = [...new Set((iss.assignedTo || []).map(em => emailToName[em] || em))]
      .map(nm => allocByNorm[_normNm(nm)]).filter(Boolean);
    if (!people.length) return;
    for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
      if (!isWeekday(d)) continue;
      const y = String(d.getFullYear());
      const calYm = y + '-' + String(d.getMonth() + 1).padStart(2, '0'); // the day's OWN calendar month
      const wk = fmtYMD(toMonday(d));
      const ym = weekYm(wk); // a week belongs to the month of its FRIDAY (so a full week counts to one month)
      people.forEach(p => {
        (holidayPlanned[p.name] = holidayPlanned[p.name] || {}); holidayPlanned[p.name][y] = (holidayPlanned[p.name][y] || 0) + 1;
        (holidayPlannedCalMonth[p.name] = holidayPlannedCalMonth[p.name] || {}); holidayPlannedCalMonth[p.name][calYm] = (holidayPlannedCalMonth[p.name][calYm] || 0) + 1;
        (holidayPlannedMonth[p.name] = holidayPlannedMonth[p.name] || {}); holidayPlannedMonth[p.name][ym] = (holidayPlannedMonth[p.name][ym] || 0) + 1;
        addHolWk(p.name, wk, 1); // (a) planned → capacity reduction for its own week
        if (visibleWeekSet.has(wk)) {
          (holidayPlannedPersonWeek[p.name] = holidayPlannedPersonWeek[p.name] || {}); holidayPlannedPersonWeek[p.name][wk] = (holidayPlannedPersonWeek[p.name][wk] || 0) + 1;
          (holidayEntriesPersonWeek[p.name] = holidayEntriesPersonWeek[p.name] || {}); (holidayEntriesPersonWeek[p.name][wk] = holidayEntriesPersonWeek[p.name][wk] || {}); holidayEntriesPersonWeek[p.name][wk][issIdx] = (holidayEntriesPersonWeek[p.name][wk][issIdx] || 0) + 1;
        }
      });
    }
  });
  // Visible weeks per month (a week belongs to the month of its Friday).
  const visWeeksByMonth = {};
  sortedWeeks.forEach(wk => { if (!visibleWeekSet.has(wk)) return; const m = weekYm(wk); (visWeeksByMonth[m] = visWeeksByMonth[m] || []).push(wk); });
  // Budgets view (monthly): planned holidays this month + unspent per-month share, kept
  // SEPARATE so the tooltip can show them individually. Months from the current month on.
  const holidayPlannedMonthVis = {};  // person → 'YYYY-MM' → planned days (current month onward)
  const holidayUnspentMonth = {};     // person → 'YYYY-MM' → unspent per-month share
  const addPM = (name, ym, v) => { if (!(v > 0)) return; (holidayPlannedMonthVis[name] = holidayPlannedMonthVis[name] || {}); holidayPlannedMonthVis[name][ym] = (holidayPlannedMonthVis[name][ym] || 0) + v; };
  const addUM = (name, ym, v) => { if (!(v > 0)) return; (holidayUnspentMonth[name] = holidayUnspentMonth[name] || {}); holidayUnspentMonth[name][ym] = (holidayUnspentMonth[name][ym] || 0) + v; };
  for (const name in holidayPlannedMonth) for (const ym in holidayPlannedMonth[name]) if (ymIdx(ym) >= nowMonIdx) addPM(name, ym, holidayPlannedMonth[name][ym]);
  (ALLOC.people || []).forEach(p => {
    const budget = p.holidayBudget || {};
    // Calendar-month-accurate, NOT holidayPlannedMonthVis (week-Friday-attributed): a
    // year-end week (e.g. Mon 28 Dec – Fri 1 Jan) must count its Dec weekdays against
    // DECEMBER's year budget, not January's, even though that week's capacity reduction
    // is shown in the January column everywhere else. Using the week-based map here made
    // late-December-only holidays wrongly eat into the FOLLOWING year's unspent allowance.
    const calMonths = holidayPlannedCalMonth[p.name] || {};
    HOLIDAY_YEARS.forEach(y => {
      const bud = budget[y] != null ? budget[y] : 0;
      // "Left to spread" = budget minus holidays PLANNED beyond the current month (the same
      // "left" the Holidays view shows — it excludes this month and earlier). e.g. 26 budget
      // − 3 planned in Aug–Dec = 23, spread over 6 remaining months (Jul–Dec) ≈ 3.8/month.
      let plannedUp = 0;
      for (const ym in calMonths) if (Number(ym.slice(0, 4)) === Number(y) && ymIdx(ym) > nowMonIdx) plannedUp += calMonths[ym];
      const left = Math.max(0, bud - plannedUp);
      const yr = Number(y);
      if (!(left > 0) || yr < nowYear) return;
      const months = [];
      for (let m = 0; m <= 11; m++) { if (yr * 12 + m >= nowMonIdx) months.push(y + '-' + String(m + 1).padStart(2, '0')); }
      if (!months.length) return;
      // Don't reserve any unspent-allowance holiday in the CURRENT month (it's already in
      // progress) — spread the year's `left` allowance over the FUTURE months only.
      const futureMonths = months.filter(ym => ymIdx(ym) > nowMonIdx);
      const budMonths = futureMonths.length ? futureMonths : months;
      const perBudMonth = left / budMonths.length;
      budMonths.forEach(ym => addUM(p.name, ym, perBudMonth));      // (b) unspent → Budgets monthly view
      budMonths.forEach(ym => { const wks = visWeeksByMonth[ym] || []; if (!wks.length) return; const perWeek = perBudMonth / wks.length; wks.forEach(wk => addHolWk(p.name, wk, perWeek)); }); // (b) unspent → live capacity views (per visible week)
    });
  });
  // Per-team, per-skill, per-WEEK NET capacity: (5 working days/week × pct × ramp − that
  // week's holidays) × 0.6, split by the person's skill mix. Fully week-based (in sync with
  // the demand window) so the current month is the sum of its remaining weeks. Leads carry 0
  // IC capacity — matching the roster per-person budget → stat-card total = grid team-total.
  const capWeekTeamSkill = {};
  const capWeekPersonSkill = {}; // allocName → skillId → week → net productive days (for the engineer filter)
  sortedWeeks.forEach(wk => {
    if (!visibleWeekSet.has(wk)) return;
    const ym = weekYm(wk);
    (ALLOC.people || []).forEach(p => {
      const entry = activeAllocation(p, ym);
      if (!entry || entry.lead || !entry.teamId || !newTeamIds.has(entry.teamId)) return;
      const nt = entry.teamId;
      const pct = entry.pct != null ? entry.pct : 100;
      const holWk = (holidayDaysPersonWeek[p.name] && holidayDaysPersonWeek[p.name][wk]) || 0;
      const prod = Math.max(0, 5 * (pct / 100) * allocRamp(ALLOC, p, ym) - holWk) * 0.6; // net productive days
      if (!(prod > 0)) return;
      const sk = entry.skills || {};
      const tot = ALLOC_SKILLS.reduce((a, s) => a + (sk[s.id] > 0 ? sk[s.id] : 0), 0);
      if (tot <= 0) return;
      capWeekTeamSkill[nt] = capWeekTeamSkill[nt] || {};
      capWeekPersonSkill[p.name] = capWeekPersonSkill[p.name] || {};
      ALLOC_SKILLS.forEach(s => { if (sk[s.id] > 0) { const v = prod * sk[s.id] / tot; (capWeekTeamSkill[nt][s.id] = capWeekTeamSkill[nt][s.id] || {}); capWeekTeamSkill[nt][s.id][wk] = (capWeekTeamSkill[nt][s.id][wk] || 0) + v; (capWeekPersonSkill[p.name][s.id] = capWeekPersonSkill[p.name][s.id] || {}); capWeekPersonSkill[p.name][s.id][wk] = (capWeekPersonSkill[p.name][s.id][wk] || 0) + v; } });
    });
  });
  // "Pot (uncommitted)": uncommitted pot issues (start === end) routed to each team — surfaced
  // in the Planning-support section. Non-Done / non-customer-task. (Committed pot items instead
  // feed the "Committed, to plan" cards via committedPotByTeam below.)
  const potByTeam = {};
  issues.forEach((iss, idx) => {
    if (skipIssue(iss) || !isPotIssue(iss)) return;
    if (iss.committed) return; // only NON-committed pot items belong in "Pot but not planned"
    const [py, pm] = iss.start.split('-').map(Number);
    const pqi = py * 4 + Math.floor((pm - 1) / 3);
    if (pqi < CUR_Q || pqi > CUR_Q + 2) return; // this + next 2 quarters (split into this Q / next Qs in the UI)
    (issueTeams[idx] || []).forEach(t => { (potByTeam[t] = potByTeam[t] || []).push(idx); });
  });
  // Committed pot items (start === end AND with a committed date). These aren't in potByTeam
  // (which is uncommitted-only); they feed the "Committed, to plan" cards, classified by the
  // POT date's quarter (this + next 2 quarters).
  const committedPotByTeam = {};
  issues.forEach((iss, idx) => {
    if (skipIssue(iss) || !isPotIssue(iss) || !iss.committed) return;
    const [py, pm] = iss.start.split('-').map(Number);
    const pqi = py * 4 + Math.floor((pm - 1) / 3);
    if (pqi < CUR_Q || pqi > CUR_Q + 2) return; // this + next 2 quarters, by pot date
    (issueTeams[idx] || []).forEach(t => { (committedPotByTeam[t] = committedPotByTeam[t] || []).push(idx); });
  });
  // "Good first issues": issues tagged "Good First Issue" (onboarding-friendly), per team.
  const goodFirstByTeam = {};
  issues.forEach((iss, idx) => {
    if (skipIssue(iss)) return;
    if (!(iss.tags || []).some(t => String(t).toLowerCase().includes('good first issue'))) return;
    (issueTeams[idx] || []).forEach(t => { (goodFirstByTeam[t] = goodFirstByTeam[t] || []).push(idx); });
  });
  const computed = {sortedWeeks, newWeeklyDemand, newPersonWeek, newPersonEntries, unassignedWeekly, unassignedEntries, foreignRosterWeek, foreignRosterEntries, needsEstimate, preplannedNextWeek, productScoping, committedUnplanned, potByTeam, committedPotByTeam, goodFirstByTeam, overdue: overdueByTeam, issueTeams, issueMemberTeams, holidayPlanned, holidayPlannedMonthVis, holidayUnspentMonth, holidayPlannedPersonWeek, holidayEntriesPersonWeek, holidayDaysPersonWeek, capWeekTeamSkill, capWeekPersonSkill, demWeekPersonSkill, drainWeekPerson, nextFri, newTeamSkillWeek, newTeamDrainWeek, tiSpentMonth, tiEntriesMonth, newTeamSkillMonthEntries, newTeamDrainMonthEntries, newTeamSkillPotQ, newTeamSkillPotEntries};
  return { computed, nameToFactor, leadNames };
}

// === Snapshot serializer =============================================================
// Projects compute()'s output down to the subset worth diffing day over day: team×skill×
// week demand & capacity, and issue-index-keyed lists re-keyed by the issue's stable Notion
// `id` (array indices aren't diff-safe across two independent runs — issues can be added,
// removed, or reordered between them). Excludes UI-drilldown-only structures (foreign
// roster, quarter "pot" quantity entries, per-month per-issue entry maps) that exist to feed
// modals, not to answer "what changed".
export function buildSnapshot(issues, computed) {
  const idOf = idx => (issues[idx] && issues[idx].id) || null;
  const reIdx = idxArr => (idxArr || []).map(idOf).filter(Boolean);
  const reIdxByTeam = byTeam => Object.fromEntries(Object.entries(byTeam || {}).map(([team, idxs]) => [team, reIdx(idxs)]));
  const issueTeamsById = {};
  Object.entries(computed.issueTeams || {}).forEach(([idx, teams]) => {
    const id = idOf(Number(idx));
    if (id) issueTeamsById[id] = teams;
  });
  return {
    demand: computed.newWeeklyDemand || {},
    capacity: computed.capWeekTeamSkill || {},
    issueTeams: issueTeamsById,
    needsEstimate: reIdxByTeam(computed.needsEstimate),
    committedUnplanned: reIdxByTeam(computed.committedUnplanned),
    overdue: reIdxByTeam(computed.overdue),
    preplannedNextWeek: reIdxByTeam(computed.preplannedNextWeek),
    potByTeam: reIdxByTeam(computed.potByTeam),
    committedPotByTeam: reIdxByTeam(computed.committedPotByTeam),
    goodFirstByTeam: reIdxByTeam(computed.goodFirstByTeam),
  };
}
