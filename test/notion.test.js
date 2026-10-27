import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pageIdFromUrl, lastSync, overlayQueryInput, parseOverlay, applyOverlay } from '../src/data/notion.js';
import { runCapacity, buildGrid } from '../src/capacity.js';
import { allocationRow as A, featureRow as Fr } from '../src/data/fake.js';
import { horizon } from '../src/periods.js';

// Synthetic rows only.
const ID1 = 'aaaaaaaabbbbccccddddeeeeeeeeeeee';
const ID2 = '11111111222233334444555555555555';
const withSync = (f, at) => { f[28] = at; return f; };
const rows = (feats) => [{
  serve_engineering_capacity_features: JSON.stringify(feats),
  serve_engineering_capacity_engineering_team_allocations: JSON.stringify([
    A({ id: 'a1', title: 'Eng a1', email: 'a1@example.invalid', team: 'Transport Planning', fe: 1, hol26: 0, hol27: 0 }),
  ]),
}];
const notionRow = (id, over = {}) => ({
  url: `https://app.notion.com/${id}`, Name: 'Synthetic', Type: 'Feature 🚀', Team: 'Transport Planning', Status: 'Not started',
  'Effort FE': 6, 'Effort BE': null, 'Effort MOB': null, 'date:Start:start': '2026-12-25', 'date:End:start': '2026-12-25',
  'Last edited time': '2026-10-09 19:00:00Z', ...over,
});

test('page id from Notion URLs, with or without hyphens and slugs', () => {
  assert.equal(pageIdFromUrl(`https://app.notion.com/${ID1}`), ID1);
  assert.equal(pageIdFromUrl('https://app.notion.com/p/qargo/Test-Tom-ignore-3f4e32e8f8c880ef9c6dc3a0c44b1af1'), '3f4e32e8f8c880ef9c6dc3a0c44b1af1');
  assert.equal(pageIdFromUrl('https://www.notion.so/3f4e32e8-f8c8-80ef-9c6d-c3a0c44b1af1?pvs=4'), '3f4e32e8f8c880ef9c6dc3a0c44b1af1');
  assert.equal(pageIdFromUrl('nope'), null);
});

test('last sync = latest extraction time; query pages from there', () => {
  const r = rows([withSync(Fr({ id: ID1, title: 'x' }), '2026-10-09T18:31:13Z'), withSync(Fr({ id: ID2, title: 'y' }), '2026-10-01T08:00:00Z')]);
  assert.equal(lastSync(r), '2026-10-09T18:31:13Z');
  const q = overlayQueryInput('2026-10-09T18:31:13Z', 100);
  assert.deepEqual(q.data.params, ['2026-10-09T18:31:13Z']);
  assert.match(q.data.query, /LIMIT 100 OFFSET 100$/);
});

test('Notion values win over Lightdash and every change is reported', () => {
  const lightdash = rows([Fr({ id: ID2, title: 'Untouched', team: 'Transport Planning', start: '2027-03-26', end: '2027-03-26', fe: 2 }), Fr({ id: ID1, title: 'Moved', team: 'Transport Planning', start: '2027-03-26', end: '2027-03-26', fe: 4 })]);
  const overlay = parseOverlay([notionRow(ID1)]); // now Q4 pot, FE 6
  const { rows: patched, changed, added } = applyOverlay(lightdash, overlay);
  assert.deepEqual(changed.map((c) => [c.id, c.fields.sort()]), [[ID1, ['end', 'fe', 'start']]]);
  assert.deepEqual(changed[0].before.end, '2027-03-26');
  assert.deepEqual(added, []);
  const H = horizon('2026-10-09');
  const run = runCapacity(patched, { now: new Date(2026, 9, 9, 12) });
  const q = buildGrid(run, H).rows.find((r) => r.team === 'Transport Planning' && r.skill === 'FE').quarters;
  assert.equal(q[0].pot, 6); // moved into Q4 by the overlay
  assert.equal(q[1].pot, 2); // the untouched issue stays in Q1
  // Input rows untouched.
  assert.match(lightdash[0].serve_engineering_capacity_features, /2027-03-26/);
});

test('issues new since the sync are added when dated, skipped when done or undated', () => {
  const overlay = parseOverlay([
    notionRow(ID2),
    notionRow('22222222333344445555666666666666', { 'date:Start:start': null, 'date:End:start': null }),
    notionRow('33333333444455556666777777777777', { Status: 'Done' }),
  ]);
  const { rows: patched, added } = applyOverlay(rows([]), overlay);
  assert.deepEqual(added.map((a) => a.id), [ID2]);
  const run = runCapacity(patched, { now: new Date(2026, 9, 9, 12) });
  assert.ok(run.issues.some((i) => i.id === ID2 && i.team === 'Transport Planning'));
});

test('empty effort (Lightdash 0, Notion null) is not a change', () => {
  const lightdash = rows([Fr({ id: ID1, title: 'Same', team: 'Transport Planning', start: '2026-12-25', end: '2026-12-25', fe: 6 })]);
  const { changed } = applyOverlay(lightdash, parseOverlay([notionRow(ID1, { 'Effort MOB': null, 'Effort BE': null })]));
  assert.deepEqual(changed, []);
});

test('applyOverlay addMissing:false only patches, never adds rows', () => {
  const ov = parseOverlay([notionRow(ID2)]);
  const r = applyOverlay(rows([Fr({ id: ID1, team: 'Transport Planning', fe: 1 })]), ov, { addMissing: false });
  assert.equal(r.added.length, 0);
  assert.equal(r.rows.length, 1);
});

test('FR overlay: live priority, status and recomputed committed date patched onto customer task rows', async () => {
  const { parseFrOverlay, applyFrOverlay, frOverlayQueryInput } = await import('../src/data/notion.js');
  const A = '2c4e32e8-f8c8-8088-a6c9-d94280c4fbe3'; const B = 'aaaaaaaabbbbccccddddeeeeeeeeeeee'; const C = 'cccccccccccccccccccccccccccccccc';
  const ov = parseFrOverlay([
    { url: 'https://app.notion.com/2c4e32e8f8c88088a6c9d94280c4fbe3', 'Priority ': 'Needed after go-live', Status: 'Not Started', 'date:Success Committed:start': '2027-03-26' },
    { url: `https://app.notion.com/${B}`, 'Priority ': 'Needed for go-live', Status: 'Not Started', 'date:Success Committed:start': '2027-06-25' },
    { url: `https://app.notion.com/${C}`, 'Priority ': 'High', Status: "Won't do", 'date:Success Committed:start': '2027-01-29' },
  ]);
  const t = (id, deal) => { const x = new Array(10).fill(null); x[0] = id; x[4] = 'Needed for go-live'; x[5] = 'Not Started'; x[6] = deal; x[8] = '2026-11-30'; return x; };
  const rows = [{ serve_engineering_capacity_customer_tasks: JSON.stringify([t(A, 'd1'), t(B, 'd1'), t(C, 'd1'), t('other', 'd1')]) }];
  const out = JSON.parse(applyFrOverlay(rows, ov, new Map([['d1', '2027-02-26']]))[0].serve_engineering_capacity_customer_tasks);
  assert.deepEqual([out[0][4], out[0][8]], ['Needed after go-live', '2027-03-26']); // no go-live rule any more
  assert.equal(out[1][8], '2027-02-26'); // go-live earlier than Success Committed
  assert.equal(out[2][8], null); // Won't do: no commit
  assert.deepEqual(out[3], t('other', 'd1'));
  assert.match(frOverlayQueryInput('2026-10-27T10:00:00Z').data.query, /"Priority ".*Last edited time/);
});

test('FR overlay: issues linked to an edited FR take the earliest FR commit as it is now', async () => {
  const { parseFrOverlay, applyFrOverlay, recommitIssues } = await import('../src/data/notion.js');
  const FA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'; const FB = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'; const I1 = '11111111111111111111111111111111'; const I2 = '22222222222222222222222222222222';
  const t = (id, c, feats) => { const x = new Array(10).fill(null); x[0] = id; x[4] = 'High'; x[5] = 'Not Started'; x[6] = 'd'; x[7] = JSON.stringify(feats); x[8] = c; return x; };
  const f = (id, c) => { const x = new Array(35).fill(null); x[0] = id; x[26] = c; return x; };
  const rows = [{ serve_engineering_capacity_features: JSON.stringify([f(I1, '2026-11-09'), f(I2, '2026-10-01')]), serve_engineering_capacity_customer_tasks: JSON.stringify([t(FA, '2026-11-09', [I1, I2]), t(FB, '2027-01-29', [I1])]) }];
  const ov = parseFrOverlay([{ url: `https://app.notion.com/${FA}`, 'Priority ': 'High', Status: 'Not Started', 'date:Success Committed:start': '2027-03-26' }]);
  const out = JSON.parse(recommitIssues(rows, applyFrOverlay(rows, ov), ov)[0].serve_engineering_capacity_features);
  assert.equal(out[0][26], '2027-01-29'); // FA set it; FB is now the earliest
  assert.equal(out[1][26], '2027-03-26'); // linked to FA only: FA's new date
  const untouched = [{ serve_engineering_capacity_features: JSON.stringify([f('33333333333333333333333333333333', '2026-10-01')]), serve_engineering_capacity_customer_tasks: JSON.stringify([t(FB, '2027-01-29', ['33333333333333333333333333333333'])]) }];
  assert.equal(JSON.parse(recommitIssues(untouched, applyFrOverlay(untouched, ov), ov)[0].serve_engineering_capacity_features)[0][26], '2026-10-01'); // no edited FR linked: kept
});

test('overlay: a "Blocked by" removed in Notion drops the link from the blocker before Lightdash syncs', () => {
  const IMT = '379e32e8f8c881d896f8ec6f6e242419'; const GLY = '2b5e32e8f8c881ed8e32cbafc7264a7e'; const NEW = '11111111111111111111111111111111';
  const f = (id, blocks) => { const x = new Array(35).fill(null); x[0] = id; x[10] = blocks; return x; };
  const rows = [{ serve_engineering_capacity_features: JSON.stringify([f(GLY, ['379e32e8-f8c8-81d8-96f8-ec6f6e242419', 'aaaa']), f(IMT, null), f(NEW, null)]) }];
  const ov = parseOverlay([
    { url: `https://app.notion.com/${IMT}`, Name: 'IMT', Status: 'Backlog', 'Blocked by': null },
    { url: `https://app.notion.com/${NEW}`, Name: 'N', Status: 'Backlog', 'Blocked by': JSON.stringify([`https://app.notion.com/${GLY}`]) },
  ]);
  const out = JSON.parse(applyOverlay(rows, ov).rows[0].serve_engineering_capacity_features);
  assert.deepEqual(out[0][10], ['aaaa', NEW]); // IMT dropped, the new link added
  assert.equal(out[1][11], null);
  assert.deepEqual(out[2][11], [GLY]);
  assert.deepEqual(JSON.parse(rows[0].serve_engineering_capacity_features)[0][10], ['379e32e8-f8c8-81d8-96f8-ec6f6e242419', 'aaaa']); // input untouched
});
