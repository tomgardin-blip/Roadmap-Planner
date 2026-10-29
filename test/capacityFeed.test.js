import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFeed, applyFeed, feedAgeDays, feedQueryInput } from '../src/data/capacityFeed.js';

test('capacity feed: parse latest run, replace capacity per team and skill, keep the rest', () => {
  const feed = parseFeed([
    { Team: 'order-invoice', Skill: 'backend', Weeks: '{"2026-10-26": 5.5, "2026-11-02": 7, "bad": 3}', Engine: 'abc123', run: '2026-10-27T07:14:00Z' },
    { Team: 'order-invoice', Skill: 'frontend', Weeks: '{"2026-10-26": 3}', run: '2026-10-27T07:14:00Z' },
    { Team: 'x', Skill: 'ai', Weeks: '{"2026-10-26": 1}' },
    { Team: 'y', Skill: 'backend', Weeks: 'not json' },
  ]);
  assert.deepEqual(feed.weeks, { 'order-invoice': { backend: { '2026-10-26': 5.5, '2026-11-02': 7 }, frontend: { '2026-10-26': 3 } } });
  assert.equal(feed.engine, 'abc123');
  const run = { computed: { capWeekTeamSkill: { 'order-invoice': { backend: { '2026-10-26': 9 }, mobile: { '2026-10-26': 1 } }, 'transport-planning': { backend: { '2026-10-26': 4 } } } } };
  applyFeed(run, feed);
  assert.deepEqual(run.computed.capWeekTeamSkill['order-invoice'].backend, { '2026-10-26': 5.5, '2026-11-02': 7 });
  assert.deepEqual(run.computed.capWeekTeamSkill['order-invoice'].mobile, { '2026-10-26': 1 });
  assert.deepEqual(run.computed.capWeekTeamSkill['transport-planning'].backend, { '2026-10-26': 4 });
  assert.equal(run.capacitySource.run, '2026-10-27T07:14:00Z');
  assert.ok(Math.abs(feedAgeDays(feed, new Date('2026-10-28T07:14:00Z')) - 1) < 1e-9);
  assert.equal(parseFeed([]), null);
  assert.match(feedQueryInput('abc').data.query, /MAX\("date:Run:start"\)/);
});

import { parseLdCapacity } from '../src/data/capacityFeed.js';
test('Lightdash engineering_capacity rows → feed, every team × skill of ours present (Sander, 2026-10-29)', () => {
  const f = parseLdCapacity([
    { engineering_team_allocations_team: 'Order + Invoice', engineering_capacity_skill: 'backend', engineering_capacity_week_start: '2026-10-26T00:00:00.000Z', engineering_capacity_sum_capacity_days: 3 },
    { engineering_team_allocations_team: 'Order + Invoice', engineering_capacity_skill: 'backend', engineering_capacity_week_start: '2026-10-26T00:00:00.000Z', engineering_capacity_sum_capacity_days: 2 },
    { engineering_team_allocations_team: 'SRE', engineering_capacity_skill: 'backend', engineering_capacity_week_start: '2026-10-26T00:00:00.000Z', engineering_capacity_sum_capacity_days: 9 },
  ], '2026-10-29T10:00:00Z');
  assert.deepEqual(f.weeks['Order + Invoice'].backend, { '2026-10-26': 5 });
  assert.deepEqual(f.weeks['Application Platform'].mobile, {});
  assert.equal(f.weeks.SRE, undefined);
  assert.equal(parseLdCapacity([]), null);
});
