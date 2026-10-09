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
