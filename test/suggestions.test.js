import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCapacity, toIssues, issueTeams } from '../src/capacity.js';
import { pushOut, pullForward, blockedIds } from '../src/suggestions.js';
import { allocationRow as A, featureRow as F } from '../src/data/fake.js';
import { horizon } from '../src/periods.js';

// Synthetic rows only.
const NOW = new Date(2026, 9, 9, 12);
const [Q4, Q1] = horizon('2026-10-09');
const TP = 'Transport Planning';
const OI = 'Order + Invoice';
const alloc = [A({ id: 'p1', title: 'Eng 1', email: 'e1@example.invalid', team: TP, be: 1, hol26: 0, hol27: 0 })];
const run = (feats) => runCapacity([{
  serve_engineering_capacity_features: JSON.stringify(feats),
  serve_engineering_capacity_engineering_team_allocations: JSON.stringify(alloc),
}], { now: NOW });
const sc = (entries) => new Map(entries.map(([id, score, effort]) => [id, { score, effort }]));
const ids = (xs) => xs.map((x) => x.issue.id);
const pot = (d) => ({ start: d, end: d });

test('push out: no commit, not in progress; lowest score first, quick wins last; cover point marked', () => {
  const r = run([
    F({ id: 'low', team: TP, be: 6, ...pot('2026-12-25') }),
    F({ id: 'high', team: TP, be: 4, ...pot('2026-12-25') }),
    F({ id: 'qw', team: TP, be: 1, ...pot('2026-12-25') }),
    F({ id: 'com', team: TP, be: 3, committed: '2026-12-31', ...pot('2026-12-25') }),
    F({ id: 'busy', team: TP, be: 3, status: 'Implementing', ...pot('2026-12-25') }),
  ]);
  const s = sc([['low', 0.5, 6], ['high', 9, 4], ['qw', 20, 1], ['com', 1, 3], ['busy', 1, 3]]);
  const p = pushOut({ run: r, scores: s, team: TP, skill: 'BE', quarter: Q4, over: 6 });
  assert.deepEqual(ids(p.items), ['low', 'high', 'qw']);
  assert.deepEqual(p.excluded, { committed: 1, inProgress: 1, kept: 0, fixed: 0 });
  assert.equal(p.coverIdx, 0); // 6 >= 6
  assert.equal(p.items[2].cumulative, 11);
});

test('pull forward: later or unplanned, same team and skill, fits, not blocked; committed first', () => {
  const r = run([
    F({ id: 'late', team: TP, be: 3, committed: '2027-01-29', start: '2027-02-01', end: '2027-03-26' }),
    F({ id: 'comm', team: TP, be: 2, committed: '2027-03-26', ...pot('2027-03-26') }),
    F({ id: 'best', team: TP, be: 4, ...pot('2027-03-26') }),
    F({ id: 'ok', team: TP, be: 4, ...pot('2027-06-25') }),
    F({ id: 'big', team: TP, be: 9, ...pot('2027-03-26') }),
    F({ id: 'blk', team: TP, be: 1, status: 'Blocked/on hold', ...pot('2027-03-26') }),
    F({ id: 'other', team: OI, be: 1, ...pot('2027-03-26') }),
    F({ id: 'fe', team: TP, fe: 1, ...pot('2027-03-26') }),
    F({ id: 'now', team: TP, be: 1, ...pot('2026-12-25') }),
    F({ id: 'byme', team: null, assignee: 'e1@example.invalid', be: 2, ...pot('2027-03-26') }),
    F({ id: 'blocker', team: OI, be: 1, ...pot('2027-03-26') }),
    F({ id: 'blocked', team: TP, be: 1, ...pot('2027-03-26') }),
    F({ id: 'qw', team: TP, be: 1, ...pot('2027-03-26') }),
  ].map((f) => { if (f[0] === 'blocker') f[10] = 'blocked'; return f; }));
  const backlog = toIssues([{ serve_engineering_capacity_features: JSON.stringify([F({ id: 'unpl', team: TP, be: 2 })]) }]);
  const s = sc([['best', 8, 4], ['ok', 2, 4], ['byme', 5, 3], ['unpl', 6, 2.5], ['qw', 30, 1], ['comm', 1, 2], ['late', 1, 3]]);
  const p = pullForward({ run: r, scores: s, team: TP, skill: 'BE', quarter: Q4, free: 5, backlog });
  assert.deepEqual(ids(p.items), ['late', 'comm', 'best', 'unpl', 'byme', 'ok']);
  assert.equal(p.items[0].late, true);
  assert.deepEqual(ids(p.quickWins), ['qw']);
});

test('pull forward for the next quarter only looks beyond it', () => {
  const r = run([F({ id: 'q1', team: TP, be: 1, ...pot('2027-03-26') }), F({ id: 'q2', team: TP, be: 1, ...pot('2027-06-25') })]);
  assert.deepEqual(ids(pullForward({ run: r, scores: null, team: TP, skill: 'BE', quarter: Q1, free: 3 }).items), ['q2']);
});

test('team routing: Team property or assignee allocation team', () => {
  const r = run([F({ id: 'x', team: null, assignee: 'e1@example.invalid', be: 1 })]);
  assert.deepEqual([...issueTeams(r, { team: 'transport planning' })], [TP]);
  assert.deepEqual([...issueTeams(r, { team: null, assignedTo: ['e1@example.invalid'] })], [TP]);
  assert.deepEqual([...issueTeams(r, { team: 'SRE' })], []);
});

test('blockedIds ignores closed blockers', () => {
  assert.deepEqual([...blockedIds([{ status: 'Backlog', blocks: ['a'] }, { status: 'Done', blocks: ['b'] }])], ['a']);
});

test('push out: an issue kept by the viewer is not suggested (Tom, 2026-10-29)', () => {
  const r = run([F({ id: 'a', team: TP, be: 6, ...pot('2026-12-25') }), F({ id: 'b', team: TP, be: 4, ...pot('2026-12-25') })]);
  const p = pushOut({ run: r, scores: sc([['a', 1, 6], ['b', 2, 4]]), team: TP, skill: 'BE', quarter: Q4, over: 6, kept: new Set(['a']) });
  assert.deepEqual(ids(p.items), ['b']);
  assert.equal(p.excluded.kept, 1);
});

test('push out and pull forward never suggest dependency upgrades (Tom, 2026-10-29)', () => {
  const r = run([F({ id: 'dep', title: 'Dependency upgrades - Transport Planning - January 2027', team: TP, be: 1, ...pot('2026-12-25') }), F({ id: 'x', team: TP, be: 2, ...pot('2026-12-25') })]);
  const p = pushOut({ run: r, scores: sc([['dep', 0, 1], ['x', 1, 2]]), team: TP, skill: 'BE', quarter: Q4, over: 3 });
  assert.deepEqual(ids(p.items), ['x']);
  assert.equal(p.excluded.fixed, 1);
});

test('pull forward: effort on another skill must fit that skill too (Tom, 2026-10-30)', () => {
  const r = run([F({ id: 'feonly', team: TP, fe: 2, ...pot('2027-03-26') }), F({ id: 'febe', team: TP, fe: 2, be: 1, ...pot('2027-03-26') }), F({ id: 'femob', team: TP, fe: 1, mob: 1, ...pot('2027-03-26') })]);
  const p = pullForward({ run: r, scores: null, team: TP, skill: 'FE', quarter: Q4, free: 11, otherFree: { FE: 11, BE: -2, MOB: 3 } });
  assert.deepEqual(ids(p.items).sort(), ['femob', 'feonly']);
  assert.equal(p.otherSkill, 1);
});
