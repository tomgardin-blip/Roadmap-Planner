import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAudit, dismissedFrs, weeklyLoadChanges } from '../src/history.js';

// Shapes as returned by the Notion SQL query on 2026-10-10; synthetic values.
const row = (o) => ({ Category: 'Issue moved', Field: 'Start/End', Before: '2026-11-27 / 2026-11-27', After: '2027-01-29 / 2027-01-29', Reason: 'Capacity', Warning: null,
  'Item name': 'X', Issue: '["https://app.notion.com/aaaaaaaabbbbccccddddeeeeeeeeeeee"]', FR: null, 'Changed by': '["user://u-1"]', 'Changed by (unmatched)': null, 'Update ID': 'rp-1', createdTime: '2026-10-09 10:00:00Z', ...o });

test('parseAudit reads ids, user and time', () => {
  const [a] = parseAudit([row()]);
  assert.equal(a.issueId, 'aaaaaaaabbbbccccddddeeeeeeeeeeee');
  assert.equal(a.by, 'u-1');
  assert.equal(a.at, '2026-10-09T10:00:00Z');
  assert.equal(a.frId, null);
});

test('dismissed FRs come from Pushback override rows', () => {
  const audit = parseAudit([row({ Category: 'Pushback override', Issue: null, FR: '["https://app.notion.com/11111111222233334444555555555555"]' }), row()]);
  assert.deepEqual([...dismissedFrs(audit)], ['11111111222233334444555555555555']);
});

test('weekly load: planner moves in the last 7 days and Notion edits since sync', () => {
  const issues = [{ id: 'aaaaaaaabbbbccccddddeeeeeeeeeeee', skillEfforts: { backend: 5 } }];
  const audit = parseAudit([row(), row({ createdTime: '2026-09-01 10:00:00Z' })]);
  const changes = [{ name: 'N', before: { end: '2026-12-25', be: 2 }, after: { be: 6 } }];
  const m = weeklyLoadChanges({ audit, changes, issues, now: new Date('2026-10-10T12:00:00Z') });
  assert.deepEqual({ in: m.get('2027-Q1').in, out: m.get('2027-Q1').out }, { in: 5, out: 0 });
  assert.deepEqual({ in: m.get('2026-Q4').in, out: m.get('2026-Q4').out }, { in: 4, out: 5 });
});

import { estimateMessage } from '../src/estimate.js';
test('estimate message: bold header, one line per issue, trimmed under the Slack limit', () => {
  const e = (n, extra = {}) => ({ issue: { name: `Issue ${n}`, url: `https://example.invalid/${n}`, team: 'Transport Planning', committed: '2026-12-01', ...extra }, frs: [{}, {}] });
  const m = estimateMessage([{ label: 'Required for GO LIVE', entries: [e(1), e(2, { team: null, committed: null })] }, { label: 'Top 3', entries: [] }]);
  assert.match(m, /^\*\*2 issues need/);
  assert.match(m, /• \[Issue 1\]\(https:\/\/example.invalid\/1\) · Transport Planning · 2 FRs · commit 1 Dec 2026/);
  assert.match(m, /• \[Issue 2\]\(https:\/\/example.invalid\/2\) · No team · 2 FRs$/);
  assert.doesNotMatch(m, /Top 3/);
  assert.doesNotMatch(m, /--/);
  const big = estimateMessage([{ label: 'G', entries: Array.from({ length: 200 }, (_, k) => e(k)) }]);
  assert.ok(big.length < 5000);
  assert.match(big, /and \d+ more in the Roadmap Planner$/);
});
