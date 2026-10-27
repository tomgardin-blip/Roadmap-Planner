// Notion writes (CLAUDE.md > Notion writes). Pure builders for the MCP tool inputs plus the
// allowlist guard; the calls themselves live in src/data/writer.js.
// Allowed: issue Start/End, FR "Success Committed" and "Priority ", FR comments tagging the
// owner, audit rows. Any issue or FR since Tom's approval on 2026-10-10 (field limits unchanged).

export const TEST_ISSUE = '3f4e32e8f8c880ef9c6dc3a0c44b1af1';
export const TEST_FR = '3f5e32e8f8c881d6927bd504b6f10e54';
export const AUDIT_DS = '9b4b26f2-ea33-4578-89c2-252389cd5564';

// All issues and FRs are writable since Tom approved it on 2026-10-10 ("unlock all").
// The guard still refuses anything that is not a Notion page id.

export const FR_PRIORITIES = ['Needed 1 month before', 'Needed for go-live', 'Top 3', 'High', 'Medium', 'Low', 'Needed after go-live'];
export const GO_LIVE_PRIORITY = 'Needed for go-live';
export const REASONS = ['Commit moved', 'Estimate grew', 'Capacity', 'Dependency', 'Customer asked'];

const nid = (x) => String(x || '').replace(/-/g, '').toLowerCase();
const dashed = (id) => { const h = nid(id); return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`; };

export class NotAllowedError extends Error {
  constructor(kind, id) { super(`Not a Notion ${kind} id: ${id}.`); this.code = 'not_allowed'; }
}
export const isAllowed = (kind, id) => (kind === 'issue' || kind === 'fr') && /^[0-9a-f]{32}$/.test(nid(id));
export function assertAllowed(kind, id) { if (!isAllowed(kind, id)) throw new NotAllowedError(kind, id); }

const dateProps = (name, iso) => (iso
  ? { [`date:${name}:start`]: iso, [`date:${name}:is_datetime`]: 0 }
  : { [`date:${name}:start`]: null });

/** notion-update-page input: issue Start = start, End = end (the date buttons set both to one Friday). */
export function issueDatesInput(issueId, start, end) {
  assertAllowed('issue', issueId);
  return { page_id: dashed(issueId), command: 'update_properties', properties: { ...dateProps('Start', start), ...dateProps('End', end) } };
}

/** notion-update-page input for an FR: only Success Committed and Priority are ever sent. */
export function frUpdateInput(frId, { successCommitted, priority } = {}) {
  assertAllowed('fr', frId);
  const properties = {};
  if (successCommitted !== undefined) Object.assign(properties, dateProps('Success Committed', successCommitted));
  if (priority !== undefined) {
    if (priority !== null && !FR_PRIORITIES.includes(priority)) throw new Error(`Unknown priority ${priority}`);
    properties['Priority '] = priority;
  }
  if (!Object.keys(properties).length) throw new Error('Nothing to write');
  return { page_id: dashed(frId), command: 'update_properties', properties };
}

/**
 * The FR's "Committed" formula, as Tom described it (2026-10-10): the earliest of Success
 * Committed and, when priority is Needed for go-live, the deal's go-live date.
 */
export function effectiveCommitted({ successCommitted, priority, golive }) {
  const c = [successCommitted, priority === GO_LIVE_PRIORITY ? golive : null].filter(Boolean).sort();
  return c[0] || null;
}

/** Warnings for moving an issue to `end` (allowed, never blocked: Tom 2026-10-10). */
export function moveWarnings(issue, end, blockers = []) {
  const w = [];
  if (issue.committed && end && end > issue.committed) w.push(`After commit ${issue.committed}`);
  for (const b of blockers) if (b.end && end && b.end > end) w.push(`Blocked by "${b.name}" ending ${b.end}`);
  return w;
}

/**
 * Comment text tagging the owner. Reason included when one was entered (Tom 2026-10-10). Never
 * "(via Roadmap Planner, by …)": the comment is posted as the viewer already (Tom 2026-10-27).
 */
export function ownerCommentMarkdown({ ownerId, changes, reason }) {
  const what = changes.map((c) => `${c.label}: ${c.before || '–'} → ${c.after || '–'}`).join('; ');
  return `<mention-user url="user://${ownerId}"/> fyi: ${what}.${reason ? ` Reason: ${reason}` : ''}`;
}

export function ownerCommentInput(frId, args) {
  assertAllowed('fr', frId);
  return { page_id: dashed(frId), markdown: ownerCommentMarkdown(args) };
}

/** notion-create-pages input for one audit row. */
export function auditRowInput({ category, field, before, after, reason, warning, issueId, frId, itemName, ownerId, changedById, changedByText, updateId }) {
  const p = {
    Name: `${category} — ${itemName || ''}`.trim(),
    Category: category,
    Field: field,
    Before: before ?? '–',
    After: after ?? '–',
    Reason: reason || '',
    Warning: warning || '',
    'Item name': itemName || '',
    'Update ID': updateId,
  };
  if (issueId) p.Issue = [dashed(issueId)];
  if (frId) p.FR = [dashed(frId)];
  if (ownerId) p.Owner = [ownerId];
  if (changedById) p['Changed by'] = [changedById]; else p['Changed by (unmatched)'] = changedByText || '';
  return { parent: { type: 'data_source_id', data_source_id: AUDIT_DS }, pages: [{ properties: p }], allow_async: false };
}

/** Values of a fetched page, from the notion-fetch result's <properties> JSON. */
export function parseFetchedProperties(payload) {
  const text = typeof payload === 'string' ? payload : payload?.text || '';
  const m = /<properties>\s*([\s\S]*?)\s*<\/properties>/.exec(text);
  if (!m) throw new Error('Could not read the page properties');
  return JSON.parse(m[1]);
}

export function readIssueDates(payload) {
  const p = parseFetchedProperties(payload);
  return { name: p.Name || '', start: p['date:Start:start']?.slice(0, 10) || null, end: p['date:End:start']?.slice(0, 10) || null };
}

export function readFr(payload) {
  const p = parseFetchedProperties(payload);
  return { name: p.Task || '', successCommitted: p['date:Success Committed:start']?.slice(0, 10) || null, priority: p['Priority '] || null };
}
