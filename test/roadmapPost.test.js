import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plannedText, roadmapMessage, TEAM_LEADS, slackLink } from '../src/roadmapPost.js';

test('roadmap post: Tom\'s text, then link, planned start and end, committed', () => {
  assert.equal(plannedText({ start: '2026-12-25', end: '2026-12-25' }), '25/12/2026 (Q4 pot)');
  assert.equal(plannedText({ start: '2027-01-29', end: '2027-01-29' }), '29/01/2027 (Jan pot)');
  assert.equal(plannedText({ start: '2026-10-26', end: '2026-11-06' }), '26/10/2026 → 06/11/2026');
  assert.equal(plannedText({}), 'not planned (no dates)');
  const m = roadmapMessage('  Can we plan a week for this?  ', { name: 'Orders | X', url: 'https://app.notion.com/p/abc', start: '2027-01-29', end: '2027-01-29', committed: '2027-01-15' });
  assert.equal(m, 'Can we plan a week for this?\n\n• **Engineering issue:** [Orders | X](https://app.notion.com/p/abc)\n• **Planned:** 29/01/2027 (Jan pot)\n• **Committed:** 15/01/2027');
  assert.match(roadmapMessage('Hi', { name: 'X', url: 'u' }, TEAM_LEADS['Trip Execution']), /^<@U041Z01AKFC> Hi\n\n/);
  assert.match(roadmapMessage('Hi', { name: 'X', url: 'u' }, TEAM_LEADS['Trip Execution'], { preview: true }), /^@Jone Hoong Hi/);
  assert.match(roadmapMessage('Hi', { name: 'X' }), /^Hi\n\n.*\*\*Committed:\*\* none$/s);
  assert.match(roadmapMessage('Hi', { name: 'X', url: 'u', committed: '2027-01-04', commitBy: 'set by Tyneside Express' }), /\*\*Committed:\*\* 04\/01\/2027 \(set by Tyneside Express\)$/);
});

test('roadmap post: message link from the Slack result, permalink or built from ts', () => {
  assert.equal(slackLink({ text: 'Message sent: https://qargotms.slack.com/archives/C0A32B4JQS1/p1793132125000100 ok' }), 'https://qargotms.slack.com/archives/C0A32B4JQS1/p1793132125000100');
  assert.equal(slackLink({ ok: true, channel: 'C0A32B4JQS1', ts: '1793132125.000100' }), 'https://qargotms.slack.com/archives/C0A32B4JQS1/p1793132125000100');
  assert.equal(slackLink({ ok: true }), null);
});

test('roadmap post templates: dependency asks both leads, blocked asks the team lead; mentions on send', async () => {
  const { dependencyMessage, blockedMessage, withMentions } = await import('../src/roadmapPost.js');
  const a = { name: 'A', url: 'ua', team: 'Trip Execution', start: '2027-03-26', end: '2027-03-26', committed: '2026-12-02', commitBy: 'set by Nijman' };
  const b = { name: 'B', url: 'ub', team: 'Transport Planning', start: '2027-04-05', end: '2027-04-30', committed: null };
  const m = dependencyMessage(a, b, [TEAM_LEADS['Trip Execution'], TEAM_LEADS['Transport Planning'], TEAM_LEADS['Trip Execution']]);
  assert.match(m, /^@Jone Hoong @Sam Buysse Is this dependency correct\?/);
  assert.match(m, /\[A\]\(ua\) \(Trip Execution\) is blocked by \[B\]\(ub\) \(Transport Planning\)/);
  assert.match(m, /Blocked issue: planned 26\/03\/2027 \(Q1 pot\), committed 02\/12\/2026 \(set by Nijman\)/);
  assert.match(m, /Blocker: planned 05\/04\/2027 → 30\/04\/2027, committed none/);
  assert.match(withMentions(m, [TEAM_LEADS['Trip Execution'], TEAM_LEADS['Transport Planning']]), /^<@U041Z01AKFC> <@U02SD5QCSSH> /);
  assert.match(blockedMessage(a, [TEAM_LEADS['Trip Execution']]), /^@Jone Hoong Is this issue really blocked\/on hold\?/);
});
