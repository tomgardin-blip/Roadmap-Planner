// FAKE DATA for checkpoint 1 (layout only). Deterministic so screenshots are
// repeatable. Nothing here reflects real Qargo issues, effort or capacity.

import { TEAMS, SKILLS, cellId } from '../capacity.js';
import { parseISO, toISO } from '../periods.js';

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SUBJECTS = {
  'Transport Planning': ['Planning board', 'Trip builder', 'Route optimiser', 'Resource calendar', 'Subcontractor view', 'Load splitting', 'Map planning', 'Trailer swap'],
  'Order + Invoice': ['Order import', 'Rate cards', 'Invoice run', 'Credit notes', 'Surcharges', 'Self-billing', 'Order templates', 'Fuel index'],
  'Trip Execution': ['Driver app', 'Proof of delivery', 'Live ETA', 'Stop events', 'Damage reports', 'Offline mode', 'Checklists', 'Telematics feed'],
  'Application Platform': ['Permissions', 'Audit trail', 'Bulk edit', 'Custom fields', 'Saved filters', 'Notifications', 'Search', 'Data export'],
};
const VERBS = ['support for', 'rework of', 'filters on', 'multi-currency on', 'bulk actions in', 'performance of', 'new columns in', 'API for'];

// Fake engineer counts per team per skill; 10 effort days per engineer per month (SPEC.md > Capacity).
const HEADCOUNT = {
  'Transport Planning': { FE: 3, BE: 4, MOB: 0.5 },
  'Order + Invoice': { FE: 2, BE: 4, MOB: 0 },
  'Trip Execution': { FE: 2, BE: 2, MOB: 3 },
  'Application Platform': { FE: 2, BE: 3, MOB: 0.5 },
};

export function fakeCapacity(horizon) {
  const cap = {};
  for (const team of TEAMS) for (const skill of SKILLS) for (const q of horizon) for (const m of q.months) {
    cap[cellId(team, skill, m.key)] = Math.round(HEADCOUNT[team][skill] * 10);
  }
  return cap;
}

function pick(r, arr) { return arr[Math.floor(r() * arr.length)]; }

function addDays(iso, n) {
  const d = parseISO(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return toISO(d);
}

export function fakeIssues(horizon, seed = 42) {
  const r = rng(seed);
  const issues = [];
  let n = 1;
  for (const team of TEAMS) {
    const hc = HEADCOUNT[team];
    for (const q of horizon) {
      // Load factor per quarter: current tight, next close, pot overfull.
      const load = { current: 1.0, next: 1.05, pot: 1.35 }[q.role] * (0.9 + r() * 0.2);
      for (const skill of SKILLS) {
        let budget = hc[skill] * 30 * load; // 3 months × 10 days
        while (budget > 2) {
          const committed = r() < 0.35;
          const main = Math.min(budget, Math.round(2 + r() * 14));
          const effort = { FE: 0, BE: 0, MOB: 0 };
          effort[skill] = main;
          budget -= main;
          // Some issues need a second skill too.
          const other = SKILLS.filter((s) => s !== skill && hc[s] > 0);
          if (r() < 0.3 && other.length) effort[pick(r, other)] = Math.round(1 + r() * 4);

          let end, committedDate = null;
          if (committed) {
            const mi = Math.floor(r() * 3);
            const m = q.months[mi];
            end = m.lastFriday;
            // Commit 1 to 2 months after the planned month, occasionally before (at risk).
            committedDate = addDays(end, r() < 0.12 ? -10 : 25 + Math.floor(r() * 40));
          } else {
            end = q.lastFriday;
          }
          const subject = pick(r, SUBJECTS[team]);
          issues.push({
            id: `fake-${n}`,
            title: `${subject}: ${pick(r, VERBS)} ${subject.toLowerCase()} #${n}`,
            team,
            status: pick(r, ['Not started', 'Not started', 'Not started', 'In progress', 'Blocked']),
            priority: committed ? null : pick(r, ['High', 'Medium', 'Low']),
            effort,
            start: end,
            end,
            committed: committedDate,
            frCount: Math.max(1, Math.round(r() * r() * 14)),
            score: Math.round(r() * r() * 400) / 10,
          });
          n++;
        }
      }
    }
  }
  // One issue with no team, mirrors the "invisible in capacity" risk in SPEC.md.
  issues.push({
    id: `fake-${n}`, title: 'Rates rework (no team set)', team: null, status: 'Not started', priority: null,
    effort: { FE: 10, BE: 40, MOB: 0 }, start: horizon[0].lastFriday, end: horizon[0].lastFriday,
    committed: addDays(horizon[0].months[0].lastFriday, -4), frCount: 6, score: 3.1,
  });
  return issues;
}
