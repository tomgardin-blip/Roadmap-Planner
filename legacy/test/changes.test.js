import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCapacity } from '../src/capacity.js';
import { allocationRow as A, featureRow as F } from '../src/data/fake.js';
import { horizon } from '../src/periods.js';
import { parseVersions, thenRows, plannerKept, currentFields, loadChanges, causes, defaultSince, clampSince, versionsAtQuery } from '../src/changes.js';

const NOW = new Date(2026, 10, 6, 12);
const H = horizon('2026-11-06');
const AP = 'Application Platform';
const id = (n) => `${String(n).repeat(32)}`.slice(0, 32);
const rows = (feats) => [{
  serve_engineering_capacity_features: JSON.stringify(feats),
  serve_engineering_capacity_engineering_team_allocations: JSON.stringify([A({ id: 'e1', title: 'Eng', email: 'e1@x.invalid', team: AP, be: 1, hol26: 0, hol27: 0 })]),
}];
const S = 'serve_engineering_features_snapshot_';
const snap = (o) => ({ [`${S}notion_page_id`]: o.id, [`${S}title`]: o.name || 'x', [`${S}team`]: o.team ?? AP, [`${S}type`]: 'Feature 🚀', [`${S}status`]: o.status || 'Not started',
  [`${S}start_date_day`]: o.start ? `${o.start}T00:00:00.000Z` : null, [`${S}end_date_day`]: o.end ? `${o.end}T00:00:00.000Z` : null,
  [`${S}effort_frontend`]: 0, [`${S}effort_backend`]: o.be ?? 0, [`${S}effort_mobile`]: 0, [`${S}assigned_to`]: 'null',
  [`${S}dbt_valid_from_raw`]: o.from || '2026-10-20T04:00:00Z', [`${S}dbt_valid_to_raw`]: o.to || '2026-11-01T04:00:00Z', [`${S}dbt_is_deleted`]: 'False' });

test('then vs now: a pot moved into this quarter, more effort, a new issue; planner moves left out', () => {
  const now = [
    F({ id: id(1), title: 'Moved in', team: AP, be: 5, start: '2026-12-25', end: '2026-12-25' }), // was Q1 pot
    F({ id: id(2), title: 'Grew', team: AP, be: 8, start: '2026-12-25', end: '2026-12-25' }), // was 3
    F({ id: id(3), title: 'New', team: AP, be: 2, start: '2026-12-25', end: '2026-12-25' }),
    F({ id: id(4), title: 'Tom moved', team: AP, be: 4, start: '2026-12-25', end: '2026-12-25' }), // planner move
  ];
  const versions = parseVersions([
    snap({ id: id(1), be: 5, start: '2027-03-26', end: '2027-03-26' }),
    snap({ id: id(2), be: 3, start: '2026-12-25', end: '2026-12-25' }),
    snap({ id: id(4), be: 4, start: '2027-03-26', end: '2027-03-26' }),
  ]);
  const audit = [{ category: 'Issue moved', issueId: id(4), after: '2026-12-25 / 2026-12-25', at: '2026-11-02T10:00:00Z' }];
  const current = currentFields(rows(now));
  const kept = plannerKept(audit, versions, current);
  assert.deepEqual(kept.get(id(4)), { dates: true, status: false });
  const created = new Set([id(3)]);
  const thenRun = runCapacity(thenRows(rows(now), versions, { created, kept }), { now: NOW });
  const nowRun = runCapacity(rows(now), { now: NOW });
  const [res] = loadChanges({ thenRun, nowRun, quarters: [H[0], H[1]], horizon: H, teams: [AP], versions, created, kept, current });
  const q4 = res.quarters[0];
  const be = q4.skills.find((s) => s.skill === 'BE');
  assert.equal(Math.round(be.now - be.then), 5 + 5 + 2); // moved in + grew 3→8 + new; Tom's move not counted
  const by = Object.fromEntries(q4.items.map((x) => [x.issue.name, x]));
  assert.equal(Math.round(by['Moved in'].total), 5);
  assert.match(by['Moved in'].causes[0], /^Moved: pot 26\/03 → pot 25\/12$/);
  assert.deepEqual(by.Grew.causes, ['Effort BE 3 → 8']);
  assert.deepEqual(by.New.causes, ['New issue']);
  assert.equal(by['Tom moved'], undefined);
  assert.equal(Math.round(res.quarters[1].skills.find((s) => s.skill === 'BE').now - res.quarters[1].skills.find((s) => s.skill === 'BE').then), -5);
});

test('an issue planned at T but no longer in the rows is added back to then', () => {
  const versions = parseVersions([snap({ id: id(5), be: 6, start: '2026-12-25', end: '2026-12-25', name: 'Unplanned since' })]);
  const out = thenRows(rows([]), versions);
  const thenRun = runCapacity(out, { now: NOW });
  const nowRun = runCapacity(rows([]), { now: NOW });
  const [res] = loadChanges({ thenRun, nowRun, quarters: [H[0]], horizon: H, teams: [AP], versions, current: new Map() });
  assert.equal(Math.round(res.quarters[0].items[0].total), -6);
  assert.deepEqual(res.quarters[0].items[0].causes, ['No longer loaded']);
});

test('causes: status, team; nothing on the issue → FR commit or link', () => {
  const v = { start: null, end: null, fe: 0, be: 1, mob: 0, team: 'A', status: 'Done', assigned: [] };
  assert.deepEqual(causes(v, { ...v, team: 'B', status: 'In progress' }), ['Team: A → B', 'Status: Done → In progress']);
  assert.deepEqual(causes(v, { ...v }), ['FR commit or link changed']);
});

test('default compare time: the viewer\'s last session before today, else 14 days; never before 06/10', () => {
  const audit = [{ by: 'u1', at: '2026-11-03T15:00:00Z' }, { by: 'u1', at: '2026-11-06T09:00:00Z' }, { by: 'u2', at: '2026-11-05T09:00:00Z' }];
  assert.equal(defaultSince(audit, 'u1', '2026-11-06'), '2026-11-03T15:00:00.000Z');
  assert.equal(defaultSince(audit, 'u9', '2026-11-06'), '2026-10-23T00:00:00.000Z');
  assert.equal(clampSince('2026-10-01T00:00:00Z'), '2026-10-06T12:00:00.000Z');
  assert.equal(versionsAtQuery('2026-11-03T15:00:00.000Z').filters.dimensions.length, 2);
});
