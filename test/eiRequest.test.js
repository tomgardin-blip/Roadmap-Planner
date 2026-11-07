import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eiRequestInput, createdRowUrl, eiRequestsByFr, eiRequestLabel, eiQueueQueryInput, EI_QUEUE_DS } from '../src/eiRequest.js';

const FR = 'https://app.notion.com/p/3f5e32e8f8c881d6927bd504b6f10e54';

test('the queue row is the one the Engineering Issues app writes for "Create engineering issue"', () => {
  const x = eiRequestInput({ id: '3f5e32e8f8c881d6927bd504b6f10e54', title: 'Test Tom - ignore FR', url: FR });
  assert.deepEqual(x.parent, { type: 'data_source_id', data_source_id: EI_QUEUE_DS });
  assert.deepEqual(x.pages[0].properties, { Name: 'Test Tom - ignore FR', State: 'Requested', 'Feature request': FR, 'Code first': '__NO__', Message: 'Queued: Claude writes the issue first.' });
  assert.throws(() => eiRequestInput({ id: 'x', title: 'No link' }));
});

test('created row URL from the create result; the data source id is never taken for it', () => {
  assert.equal(createdRowUrl({ pages: [{ id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', url: 'https://app.notion.com/p/aaaaaaaabbbbccccddddeeeeeeeeeeee' }] }), 'https://app.notion.com/p/aaaaaaaabbbbccccddddeeeeeeeeeeee');
  assert.equal(createdRowUrl({ parent: EI_QUEUE_DS, id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' }), 'https://app.notion.com/p/aaaaaaaabbbbccccddddeeeeeeeeeeee');
  assert.equal(createdRowUrl(null), null);
});

test('latest request per FR; EI update rows are not FR requests', () => {
  const m = eiRequestsByFr([
    { url: 'r1', State: 'Failed', 'Feature request': FR, createdTime: '2026-11-05 10:00:00Z' },
    { url: 'r2', State: 'Ended', EI: 'https://app.notion.com/p/ei', 'Feature request': FR, createdTime: '2026-11-06 10:00:00Z' },
    { url: 'r3', State: 'Requested', 'Feature request': `${FR}\n\nWhat to change: add effort`, createdTime: '2026-11-07 10:00:00Z' },
  ]);
  assert.equal(m.size, 1);
  const r = m.get('3f5e32e8f8c881d6927bd504b6f10e54');
  assert.equal(r.url, 'r2');
  assert.equal(eiRequestLabel(r), 'EI created');
  assert.equal(eiRequestLabel({ state: 'Writing EI' }), 'Claude is writing the EI');
  assert.equal(eiRequestLabel({ state: 'Failed' }), 'EI request failed');
  assert.match(eiQueueQueryInput('2026-09-08T00:00:00Z').data.query, /"Feature request" IS NOT NULL/);
});
