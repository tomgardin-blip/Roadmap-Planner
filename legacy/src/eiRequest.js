// Create an engineering issue for an FR through the Engineering Issues app (Tom, 2026-11-07: "The flow to
// create engineering issues has changed. It's no longer post in Slack and tag claude code, it has to go
// through the [Engineering Issues] artifact"). The app's "Create engineering issue" adds one row to its Notion
// queue "Test a feature — requests" (State Requested, Feature request = the FR link, Code first off); the
// Mac mini runner then writes the EI with the product-feature skill and fills in the EI link. The planner
// writes the same row, as the viewer, one per FR (Tom approved, 2026-11-07), then an audit row.
// "No estimate" issues (Tom, 2026-11-07, later the same day: "EI without estimate in the planner need to trigger the
// update issue flow in the engineering issues artifact"): the app's "Update issue" row instead, the EI link and
// "What to change: …" as the request; product-feature then rewrites the EI with its estimate.
// Pure functions; the MCP calls live in writer.js.

export const EI_QUEUE_DS = '04a2a1c5-5d4e-4032-826c-4cc5d4a9f4df';
export const EI_QUEUE = `collection://${EI_QUEUE_DS}`;
export const EI_APP = 'Engineering Issues app';
export const EI_QUEUED_MSG = 'Queued: Claude writes the issue first.';
const nid = (x) => (String(x || '').replace(/-/g, '').match(/[0-9a-f]{32}/i) || [])[0]?.toLowerCase() || null;

/** notion-create-pages input: the row the app's "Create engineering issue" writes for one FR. */
export function eiRequestInput(fr) {
  if (!fr?.url) throw new Error('This FR has no Notion link.');
  const name = String(fr.title || 'Feature request').trim().slice(0, 200) || 'Feature request';
  return {
    parent: { type: 'data_source_id', data_source_id: EI_QUEUE_DS },
    pages: [{ properties: { Name: name, State: 'Requested', 'Feature request': fr.url, 'Code first': '__NO__', Message: EI_QUEUED_MSG } }],
  };
}

export const EI_UPDATE_MSG = 'Queued: Claude updates the issue.';
export const ESTIMATE_CHANGE = 'Add the effort estimate (Effort FE / BE / MOB in days); rewrite it with product-feature where needed.';

/** notion-create-pages input: the row the app's "Update issue" writes, here to get an EI estimated. */
export function eiUpdateInput(issue, change = ESTIMATE_CHANGE) {
  if (!issue?.url) throw new Error('This issue has no Notion link.');
  const name = String(issue.name || 'Engineering Issue').replace(/^🚀\s*/, '').trim().slice(0, 200) || 'Engineering Issue';
  return {
    parent: { type: 'data_source_id', data_source_id: EI_QUEUE_DS },
    pages: [{ properties: { Name: name, State: 'Requested', 'Feature request': `${issue.url}\n\nWhat to change: ${change}`, 'Code first': '__NO__', Message: EI_UPDATE_MSG } }],
  };
}

/** The new row's page URL from the create result, or null. */
export function createdRowUrl(result) {
  const s = JSON.stringify(result || {});
  const url = /https:\/\/(?:app|www)\.notion\.(?:so|com)\/[^"\s]*?([0-9a-f]{32})/i.exec(s);
  if (url) return url[0];
  const ids = (s.match(/[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}/gi) || []).map(nid).filter((x) => x && x !== EI_QUEUE_DS.replace(/-/g, ''));
  return ids[0] ? `https://app.notion.com/p/${ids[0]}` : null;
}

/** Queue rows of the last `days` days that came from a feature request (Notion SQL; 100 per page). */
export function eiQueueQueryInput(sinceIso, offset = 0) {
  return {
    data: {
      data_source_urls: [EI_QUEUE],
      query: `SELECT url, "Name", "State", "EI", "Feature request", "Message", createdTime FROM "${EI_QUEUE}" WHERE "Feature request" IS NOT NULL AND "Feature request" <> '' AND datetime(createdTime) >= datetime(?) ORDER BY createdTime DESC LIMIT 100 OFFSET ${offset}`,
      params: [sinceIso],
    },
  };
}

/**
 * Queue rows → Map(id → latest request { kind, state, ei, message, at, url }), keyed by the link the request
 * starts with: an FR (kind "create") or, for "What to change:" rows, the EI being updated (kind "update").
 */
export function eiRequestsByItem(results) {
  const out = new Map();
  for (const r of results || []) {
    const text = String(r['Feature request'] || '').trim();
    const kind = /\n\s*\nWhat to change: /.test(text) ? 'update' : 'create';
    const id = nid(text.split(/\s/)[0]);
    if (!id) continue;
    const at = String(r.createdTime || '').replace(' ', 'T');
    const prev = out.get(id);
    if (prev && prev.at >= at) continue;
    out.set(id, { kind, state: r.State || 'Requested', ei: kind === 'create' ? r.EI || null : null, message: r.Message || '', at, url: r.url || null });
  }
  return out;
}
export const eiRequestsByFr = eiRequestsByItem;

/** Short label for an FR's latest request, shown on its card. */
export function eiRequestLabel(req) {
  if (!req) return null;
  if (req.kind === 'update') {
    if (req.state === 'Failed') return 'Estimate request failed';
    if (req.state === 'Ended') return 'EI updated';
    if (req.state === 'Writing EI') return 'Claude is updating the EI';
    return 'Estimate requested';
  }
  if (req.ei) return 'EI created';
  if (req.state === 'Failed') return 'EI request failed';
  if (req.state === 'Writing EI') return 'Claude is writing the EI';
  if (req.state === 'Ended') return 'EI request ended';
  return 'EI requested';
}
