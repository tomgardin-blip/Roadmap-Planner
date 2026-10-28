import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as W from '../src/notion/writes.js';
import { moveIssue, editFr, findOwner, adviseOwner, setIssuePriority, setIssueStatus } from '../src/data/writer.js';

// Synthetic ids and users only; the two test page ids are the real allowlisted test pages.
const OTHER = 'aaaaaaaabbbbccccddddeeeeeeeeeeee';
const fetched = (props) => ({ text: `<page>\n<properties>\n${JSON.stringify(props)}\n</properties>\n</page>` });

test('guard: any issue or FR page id (unlocked 2026-10-10), nothing else', () => {
  assert.equal(W.isAllowed('issue', OTHER), true);
  assert.equal(W.isAllowed('fr', '3f5e32e8-f8c8-81d6-927b-d504b6f10e54'), true);
  assert.equal(W.isAllowed('deal', OTHER), false);
  assert.throws(() => W.issueDatesInput('not-an-id', '2026-11-27', '2026-11-27'), /Not a Notion issue id/);
  assert.throws(() => W.frUpdateInput('', { priority: 'High' }), /Not a Notion fr id/);
});

test('issue write sends only Start and End', () => {
  const i = W.issueDatesInput(W.TEST_ISSUE, '2026-11-27', '2026-11-27');
  assert.equal(i.page_id, '3f4e32e8-f8c8-80ef-9c6d-c3a0c44b1af1');
  assert.deepEqual(Object.keys(i.properties).sort(), ['date:End:is_datetime', 'date:End:start', 'date:Start:is_datetime', 'date:Start:start']);
});

test('FR write sends only Success Committed and Priority; unknown priority refused', () => {
  const i = W.frUpdateInput(W.TEST_FR, { successCommitted: '2027-01-29', priority: 'Top 3' });
  assert.deepEqual(Object.keys(i.properties).sort(), ['Priority ', 'date:Success Committed:is_datetime', 'date:Success Committed:start']);
  assert.throws(() => W.frUpdateInput(W.TEST_FR, { priority: 'Urgent' }), /Unknown priority/);
  assert.throws(() => W.frUpdateInput(W.TEST_FR, {}), /Nothing to write/);
  assert.equal(W.frUpdateInput(W.TEST_FR, { priority: 'No longer needed' }).properties['Priority '], 'No longer needed');
  assert.equal(W.frUpdateInput(W.TEST_FR, { status: "Won't do" }).properties.Status, "Won't do");
  assert.equal(W.frUpdateInput(W.TEST_FR, { status: 'Done' }).properties.Status, 'Done'); // Tom, 2026-10-28
  assert.throws(() => W.frUpdateInput(W.TEST_FR, { status: 'In progress' }), /only be set to Won't do or Done/);
});

test('effective committed: earliest of Success Committed and go-live when Needed for go-live', () => {
  assert.equal(W.effectiveCommitted({ successCommitted: '2027-01-29', priority: 'High', golive: '2026-12-01' }), '2027-01-29');
  assert.equal(W.effectiveCommitted({ successCommitted: '2027-01-29', priority: 'Needed for go-live', golive: '2026-12-01' }), '2026-11-24'); // go-live − 7 days
  assert.equal(W.effectiveCommitted({ successCommitted: null, priority: 'Needed for go-live', golive: '2027-02-01' }), '2027-01-25');
  assert.equal(W.effectiveCommitted({ successCommitted: null, priority: 'Needed 1 month before', golive: '2027-03-31' }), '2027-02-28'); // one calendar month, clamped
  assert.equal(W.effectiveCommitted({ successCommitted: '2026-12-01', priority: 'Needed 1 month before', golive: '2027-03-15' }), '2026-12-01');
  assert.equal(W.effectiveCommitted({ successCommitted: null, priority: 'Low', golive: '2026-12-01' }), null);
});

test('move warnings: after commit and open blocker, never a block', () => {
  assert.deepEqual(W.moveWarnings({ committed: '2026-11-30' }, '2026-12-25'), ['After commit 30/11/2026']);
  assert.deepEqual(W.moveWarnings({ committed: '2027-01-31' }, '2026-12-25', [{ name: 'B', end: '2027-01-29' }]), ['Blocked by "B" ending 29/01/2027']);
  assert.deepEqual(W.moveWarnings({}, '2026-12-25'), []);
});

test('owner comment: tag then the comment only, no list of changes; no-owner variant', () => {
  const ch = [{ label: 'Priority', before: 'High', after: 'Top 3' }];
  const c = (args) => W.ownerCommentInput(W.TEST_FR, args).rich_text;
  assert.deepEqual(c({ ownerId: 'u-1', changes: ch, comment: 'Pushed by customer' }), [
    { type: 'mention', mention: { type: 'user', user: { id: 'u-1' } } },
    { type: 'text', text: { content: ' Pushed by customer' } },
  ]);
  assert.equal(c({ ownerId: 'u-1', comment: 'Can you check with the customer?' })[1].text.content, ' Can you check with the customer?');
  assert.deepEqual(c({ changes: ch, comment: 'x' }), [{ type: 'text', text: { content: 'x' } }]);
  assert.equal(W.ownerCommentInput(W.TEST_FR, { ownerId: 'u-1', comment: 'y'.repeat(2500) }).rich_text.length, 3);
  assert.equal(W.ownerCommentInput(W.TEST_FR, { comment: 'x' }).markdown, undefined);
  assert.doesNotMatch(W.ownerCommentText({ changes: ch, comment: 'x' }), /Roadmap Planner|Reason/);
});

test('audit row: relation, who, and update id', () => {
  const r = W.auditRowInput({ category: 'FR priority changed', field: 'Priority', before: 'High', after: 'Top 3', frId: W.TEST_FR, itemName: 'X', changedById: 'u-1', updateId: 'rp-1' });
  assert.equal(r.parent.data_source_id, W.AUDIT_DS);
  const p = r.pages[0].properties;
  assert.deepEqual(p.FR, ['3f5e32e8-f8c8-81d6-927b-d504b6f10e54']);
  assert.deepEqual(p['Changed by'], ['u-1']);
  assert.equal(p['Update ID'], 'rp-1');
  assert.equal(p.Issue, undefined);
});

test('reads Start/End and FR values from a fetch result', () => {
  assert.deepEqual(W.readIssueDates(fetched({ Name: 'I', 'date:Start:start': '2026-11-27', 'date:End:start': '2026-11-27' })), { name: 'I', start: '2026-11-27', end: '2026-11-27', priority: null, status: null });
  assert.deepEqual(W.readFr(fetched({ Task: 'F', 'Priority ': 'Medium', 'date:Success Committed:start': '2026-12-18' })), { name: 'F', successCommitted: '2026-12-18', priority: 'Medium', status: null });
  assert.deepEqual(W.readFr(fetched({ Task: 'F' })), { name: 'F', successCommitted: null, priority: null, status: null });
});

// Fake mcp that records calls and answers like the real servers did on 2026-10-10.
function fakeMcp({ page = {}, ownerEmail = null } = {}) {
  const calls = [];
  return {
    calls,
    async callTool(server, tool, input) {
      calls.push({ server, tool, input });
      if (tool === 'notion-fetch') return { payload: fetched(page) };
      if (tool === 'notion-get-users') return { payload: input.user_id === 'self'
        ? { results: [{ id: 'me-1', name: 'Viewer', email: 'viewer@example.invalid' }] }
        : { results: input.query === 'owner@example.invalid' ? [{ id: 'own-1', name: 'Owner', email: 'owner@example.invalid' }] : [] } };
      if (tool === 'run_metric_query') return { payload: { result: { status: 'done', rows: ownerEmail ? [{ customer_tasks_responsible_success_email: ownerEmail }] : [] } } };
      return { payload: {} };
    },
  };
}

test('moveIssue: refuses a bad id before any call', async () => {
  const mcp = fakeMcp();
  await assert.rejects(moveIssue(mcp, { issue: { id: 'x' }, start: '2026-11-27', end: '2026-11-27' }), /Not a Notion/);
  assert.equal(mcp.calls.length, 0);
});

test('moveIssue: read before, write, then audit with warning', async () => {
  const mcp = fakeMcp({ page: { Name: 'T', 'date:Start:start': null } });
  const r = await moveIssue(mcp, { issue: { id: W.TEST_ISSUE, name: 'T', committed: '2026-11-30' }, start: '2026-12-25', end: '2026-12-25', reason: 'Capacity' });
  const tools = mcp.calls.map((c) => c.tool);
  assert.deepEqual(tools, ['notion-fetch', 'notion-update-page', 'notion-get-users', 'notion-create-pages']);
  const row = mcp.calls[3].input.pages[0].properties;
  assert.equal(row.Category, 'Moved past commit');
  assert.equal(row.Warning, 'After commit 30/11/2026');
  assert.equal(row.Reason, 'Capacity');
  assert.deepEqual(row['Changed by'], ['me-1']);
  assert.deepEqual(r.warnings, ['After commit 30/11/2026']);
});

test('editFr: writes only what changed, one audit row per field; no-op when unchanged', async () => {
  const mcp = fakeMcp({ page: { Task: 'F', 'Priority ': 'Medium', 'date:Success Committed:start': '2026-12-18' } });
  const r = await editFr(mcp, { fr: { id: W.TEST_FR, title: 'F' }, successCommitted: '2026-12-18', priority: 'Top 3' });
  assert.deepEqual(r.changes.map((c) => c.field), ['Priority']);
  assert.deepEqual(mcp.calls.find((c) => c.tool === 'notion-update-page').input.properties, { 'Priority ': 'Top 3' });
  assert.equal(mcp.calls.filter((c) => c.tool === 'notion-create-pages').length, 1);
  const mcp2 = fakeMcp({ page: { Task: 'F', 'Priority ': 'Medium' } });
  assert.deepEqual((await editFr(mcp2, { fr: { id: W.TEST_FR }, priority: 'Medium' })).changes, []);
  assert.equal(mcp2.calls.some((c) => c.tool === 'notion-update-page'), false);
});

test('findOwner: Lightdash email → Notion user; none → null (no fallback); test FR → viewer', async () => {
  assert.deepEqual(await findOwner(fakeMcp({ ownerEmail: 'owner@example.invalid' }), OTHER), { id: 'own-1', name: 'Owner', email: 'owner@example.invalid' });
  assert.equal(await findOwner(fakeMcp({ ownerEmail: null }), OTHER), null);
  const t = await findOwner(fakeMcp(), W.TEST_FR);
  assert.equal(t, null); // viewer@example.invalid is not returned by the fake search: proves the email match is exact
});

test('adviseOwner: comment then audit, the comment text in both', async () => {
  const mcp = fakeMcp();
  await adviseOwner(mcp, { fr: { id: W.TEST_FR, title: 'F' }, owner: { id: 'own-1', name: 'Owner' }, changes: [{ label: 'Committed', before: '2026-12-18', after: '2027-01-29' }], comment: 'Capacity' });
  const c = mcp.calls.find((x) => x.tool === 'notion-create-comment').input;
  assert.equal(c.rich_text[0].mention.user.id, 'own-1');
  assert.equal(c.rich_text[1].text.content, ' Capacity');
  const row = mcp.calls.find((x) => x.tool === 'notion-create-pages').input.pages[0].properties;
  assert.equal(row.Category, 'Owner advised');
  assert.deepEqual(row.Owner, ['own-1']);
});

test('issue priority: only the Priority property, known options only, audited', async () => {
  assert.deepEqual(W.issuePriorityInput(W.TEST_ISSUE, 'High').properties, { Priority: 'High' });
  assert.throws(() => W.issuePriorityInput(W.TEST_ISSUE, 'Top 3'), /Unknown issue priority/);
  const mcp = fakeMcp();
  const r = await setIssuePriority(mcp, { issue: { id: W.TEST_ISSUE, name: 'T' }, priority: 'Urgent' });
  assert.equal(r.changed, true);
  const up = mcp.calls.find((x) => x.tool === 'notion-update-page').input;
  assert.deepEqual(Object.keys(up.properties), ['Priority']);
  const row = mcp.calls.find((x) => x.tool === 'notion-create-pages').input.pages[0].properties;
  assert.equal(row.Category, 'Issue priority changed');
});

test('issue status: only the Status property, every Notion option, audited as EI status changed', async () => {
  assert.deepEqual(W.issueStatusInput(W.TEST_ISSUE, 'To test').properties, { Status: 'To test' });
  assert.ok(W.EI_STATUSES.includes("Won't do") && W.EI_STATUSES.includes('Backlog') && W.EI_STATUSES.length === 18);
  assert.throws(() => W.issueStatusInput(W.TEST_ISSUE, 'Status'), /Unknown issue status/);
  const mcp = fakeMcp();
  const r = await setIssueStatus(mcp, { issue: { id: W.TEST_ISSUE, name: 'T' }, status: 'Done', reason: 'x' });
  assert.equal(r.change.after, 'Done');
  const up = mcp.calls.find((x) => x.tool === 'notion-update-page').input;
  assert.deepEqual(Object.keys(up.properties), ['Status']);
  const row = mcp.calls.find((x) => x.tool === 'notion-create-pages').input.pages[0].properties;
  assert.equal(row.Category, 'EI status changed');
});
