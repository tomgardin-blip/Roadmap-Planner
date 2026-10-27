// Notion writes (CLAUDE.md > Notion writes). Pure builders for the MCP tool inputs plus the
// allowlist guard; the calls themselves live in src/data/writer.js.
// Allowed: issue Start/End, FR "Success Committed" and "Priority ", FR comments tagging the
// owner, audit rows. Any issue or FR since Tom's approval on 2026-10-10 (field limits unchanged).

import { formatDate, lateVsCommit } from '../periods.js';
export const TEST_ISSUE = '3f4e32e8f8c880ef9c6dc3a0c44b1af1';
export const TEST_FR = '3f5e32e8f8c881d6927bd504b6f10e54';
export const AUDIT_DS = '9b4b26f2-ea33-4578-89c2-252389cd5564';

// All issues and FRs are writable since Tom approved it on 2026-10-10 ("unlock all").
// The guard still refuses anything that is not a Notion page id.

export const FR_PRIORITIES = ['Needed 1 month before', 'Needed for go-live', 'Top 3', 'High', 'Medium', 'Low', 'Needed after go-live', 'No longer needed', "Won't do"];
// FR Status: the planner may only close an FR as "Won't do" (Tom, 2026-10-27); no other status writes.
export const FR_STATUS_CLOSE = "Won't do";
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

// Engineering issue Priority (Bugs & Features), set from the Quarter plan (Tom, 2026-10-27).
export const ISSUE_PRIORITIES = ['Urgent', 'High', 'Medium', 'Low', 'Not assigned'];
export function issuePriorityInput(issueId, priority) {
  assertAllowed('issue', issueId);
  if (!ISSUE_PRIORITIES.includes(priority)) throw new Error(`Unknown issue priority ${priority}`);
  return { page_id: dashed(issueId), command: 'update_properties', properties: { Priority: priority } };
}

// Engineering issue Status (Bugs & Features), every option, set from the FR edit sheet (Tom, 2026-10-27).
// Notion order: to do, in progress, complete.
export const EI_STATUSES = ['Product scoping TODO', 'Claude - to review', 'Product scoping in progress', 'Product scoping complete', 'Backlog', 'Blocked/on hold', 'Ready to implement',
  'Support standby', 'To design/scope this week', 'Designing/scoping', 'To implement this week', 'Implementing', 'To test',
  'PS - Ready to preplan', 'Production Ready', 'Done', 'Duplicate', "Won't do"];
export function issueStatusInput(issueId, status) {
  assertAllowed('issue', issueId);
  if (!EI_STATUSES.includes(status)) throw new Error(`Unknown issue status ${status}`);
  return { page_id: dashed(issueId), command: 'update_properties', properties: { Status: status } };
}

/** notion-update-page input for an FR: only Success Committed and Priority are ever sent. */
export function frUpdateInput(frId, { successCommitted, priority, status } = {}) {
  assertAllowed('fr', frId);
  const properties = {};
  if (successCommitted !== undefined) Object.assign(properties, dateProps('Success Committed', successCommitted));
  if (priority !== undefined) {
    if (priority !== null && !FR_PRIORITIES.includes(priority)) throw new Error(`Unknown priority ${priority}`);
    properties['Priority '] = priority;
  }
  if (status !== undefined) {
    if (status !== FR_STATUS_CLOSE) throw new Error(`Status can only be set to ${FR_STATUS_CLOSE}`);
    properties.Status = status;
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
  // Moves set Start = End (a pot): a month pot in the commit month is fine (lateVsCommit).
  if (lateVsCommit({ start: end, end, committed: issue.committed })) w.push(`After commit ${formatDate(issue.committed)}`);
  for (const b of blockers) if (b.end && end && b.end > end) w.push(`Blocked by "${b.name}" ending ${formatDate(b.end)}`);
  return w;
}

/**
 * Comment on the FR (Tom 2026-10-27): tags the owner, lists what changed, then Tom's comment.
 * "@Owner fyi: Committed: 18 Dec 2026 → 29 Jan 2027. <comment>", or "@Owner <comment>" with no change.
 * No owner: the same text without a tag. Never "(via Roadmap Planner, by …)": posted as the viewer.
 */
export function ownerCommentMarkdown({ ownerId, changes = [], comment }) {
  const what = changes.map((c) => `${c.label}: ${c.before || '–'} → ${c.after || '–'}`).join('; ');
  const tag = ownerId ? `<mention-user url="user://${ownerId}"/> ` : '';
  const text = [what ? `fyi: ${what}.` : '', (comment || '').trim()].filter(Boolean).join(' ');
  return `${tag}${text}`.trim();
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
  return { name: p.Name || '', start: p['date:Start:start']?.slice(0, 10) || null, end: p['date:End:start']?.slice(0, 10) || null, priority: p.Priority || null, status: p.Status || null };
}

export function readFr(payload) {
  const p = parseFetchedProperties(payload);
  return { name: p.Task || '', successCommitted: p['date:Success Committed:start']?.slice(0, 10) || null, priority: p['Priority '] || null, status: p.Status || null };
}
