// FAKE DATA in the exact shape of the Lightdash serve_engineering_capacity rows,
// so the fake and real paths both run through the capacity engine. Deterministic
// so screenshots are repeatable. Nothing here reflects real Qargo people or issues.

import { parseISO, toISO } from '../periods.js';
import { TEAMS } from '../capacity.js';

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
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
const addDays = (iso, n) => { const d = parseISO(iso); d.setUTCDate(d.getUTCDate() + n); return toISO(d); };

// Positional builders (element order = the explore's field descriptions).
export function allocationRow({ id, title, email, team, fe = 0, be = 0, mob = 0, lead = false, start = '2026-06-01', end = null, hol26 = 26, hol27 = 26 }) {
  return [id, title, email, team, null, 0, 0, be, 0, fe, 0, mob, 0, lead, start, end, hol26, hol27];
}
export function featureRow({ id, title, type = 'Feature 🚀', status = 'Not started', assignee = null, start = null, end = null, committed = null, team = null, fe = 0, be = 0, mob = 0, priority = null, blockedBy = null }) {
  const f = new Array(35).fill(null);
  Object.assign(f, {
    0: id, 1: title, 2: `https://example.invalid/${id}`, 3: type, 5: status, 6: assignee, 11: blockedBy,
    14: be || null, 15: fe || null, 24: start, 25: end, 26: committed, 29: team, 30: mob || null, 33: priority,
  });
  return f;
}

const SUBJECTS = ['Planning board', 'Trip builder', 'Order import', 'Rate cards', 'Driver app', 'Proof of delivery', 'Permissions', 'Bulk edit', 'Live ETA', 'Invoice run', 'Saved filters', 'Map planning'];
const VERBS = ['support for', 'rework of', 'filters on', 'bulk actions in', 'performance of', 'API for'];

// Fake engineers per team per skill.
const HEADCOUNT = {
  'Transport Planning': { FE: 3, BE: 4, MOB: 0 },
  'Order + Invoice': { FE: 2, BE: 4, MOB: 0 },
  'Trip Execution': { FE: 0, BE: 2, MOB: 0, FEMOB: 2 },
  'Application Platform': { FE: 1, BE: 4, MOB: 0 },
};

export function fakeLightdashRows(horizon, seed = 42) {
  const r = rng(seed);
  const allocations = [];
  let n = 1;
  for (const team of TEAMS) {
    const hc = HEADCOUNT[team];
    allocations.push(allocationRow({ id: `a${n}`, title: `Lead ${team}`, email: `lead${n}@example.invalid`, team, be: 1, lead: true })); n++;
    for (const [skill, count] of Object.entries(hc)) {
      for (let i = 0; i < count; i++) {
        const fe = skill === 'FE' || skill === 'FEMOB' ? 1 : 0;
        const mob = skill === 'MOB' || skill === 'FEMOB' ? 1 : 0;
        const be = skill === 'BE' ? 1 : 0;
        allocations.push(allocationRow({ id: `a${n}`, title: `Engineer ${n}`, email: `eng${n}@example.invalid`, team, fe, be, mob })); n++;
      }
    }
  }

  const features = [];
  let f = 1;
  for (const team of TEAMS) {
    const hc = HEADCOUNT[team];
    const skills = { FE: hc.FE + (hc.FEMOB || 0) / 2, BE: hc.BE, MOB: hc.MOB + (hc.FEMOB || 0) / 2 };
    for (const q of horizon) {
      const load = { current: 1.0, next: 1.05, pot: 1.3 }[q.role] * (0.9 + r() * 0.2);
      for (const [skill, fte] of Object.entries(skills)) {
        let budget = fte * 36 * load;
        while (budget > 2) {
          const days = Math.min(budget, Math.round(2 + r() * 12));
          budget -= days;
          const kind = r();
          let start, end, committed = null;
          if (kind < 0.55) {
            end = start = q.lastFriday; // quarter pot
          } else if (kind < 0.8) {
            const m = pick(r, q.months);
            end = start = m.lastFriday; // committed month placement (pot in the planner)
            committed = addDays(end, 20 + Math.floor(r() * 40));
          } else {
            const m = pick(r, q.months);
            start = addDays(m.lastFriday, -25); // dated range inside the month
            end = m.lastFriday;
          }
          const subject = pick(r, SUBJECTS);
          features.push(featureRow({
            id: `f${f}`, title: `${subject}: ${pick(r, VERBS)} ${subject.toLowerCase()} #${f}`, team, start, end, committed,
            fe: skill === 'FE' ? days : 0, be: skill === 'BE' ? days : 0, mob: skill === 'MOB' ? days : 0,
            priority: committed ? null : pick(r, ['High', 'Medium', 'Low']),
            status: pick(r, ['Not started', 'Not started', 'In progress', 'Blocked']),
          }));
          f++;
        }
      }
    }
  }
  // One issue with effort but no team: the "invisible in capacity" risk from SPEC.md.
  features.push(featureRow({ id: `f${f}`, title: 'Rates rework (no team set)', start: horizon[0].lastFriday, end: horizon[0].lastFriday, be: 40, fe: 10 }));

  return [{
    serve_engineering_capacity_is_default: true,
    serve_engineering_capacity_features: JSON.stringify(features),
    serve_engineering_capacity_customer_tasks: '[]',
    serve_engineering_capacity_deals: '[]',
    serve_engineering_capacity_engineering_team_allocations: JSON.stringify(allocations),
  }];
}
