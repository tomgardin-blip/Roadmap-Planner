// Parses the serve_engineering_capacity explore (Lightdash) into plain objects.
// The explore serves positional JSON arrays; the element order below is copied
// from the explore's field descriptions (verified 2026-10-09). The order is the
// contract: if Lightdash changes it, update these maps and the tests.
// Pure functions only: fetching through the artifact's MCP capability lives elsewhere.

export const FEATURE_FIELDS = [
  'id', 'title', 'url', 'type', 'domain', 'status', 'assignedTo', 'assignedToFutureEmployee',
  'parentId', 'subtaskIds', 'blocksIds', 'blockedByIds', 'customerTaskIds',
  'effort', 'effortBE', 'effortFE', 'effortIntPlatform', 'effortIntOrderFleet', 'effortIntBookings',
  'effortIntFinancials', 'effortAI', 'effortBI', 'effortPS', 'effortSRE',
  'start', 'end', 'committed', 'preplannedOn', 'extractedAt', 'team', 'effortMOB', 'effortAnalyst',
  'tags', 'priority', 'claudable',
];

export const TASK_FIELDS = [
  'id', 'url', 'title', 'type', 'priority', 'status', 'dealId', 'featureIds', 'committed',
  'assignedTeam', 'billableAmount', 'billableStatus', 'intakeDoneDate',
];

export const ALLOCATION_FIELDS = [
  'id', 'title', 'email', 'team', 'partTimePct', 'capAI', 'capAnalytics', 'capBE', 'capBI', 'capFE',
  'capInfra', 'capMOB', 'capOther', 'isLead', 'start', 'end', 'holidayBudget2026', 'holidayBudget2027',
];

export const DEAL_FIELDS = ['id', 'url', 'companyName', 'status', 'qargoGroup', 'goLive', 'dealExtractName'];

/** Map one positional array onto named keys. Throws when the length does not match the contract. */
export function fromPositional(arr, fields, kind) {
  if (!Array.isArray(arr)) throw new Error(`${kind}: expected an array, got ${typeof arr}`);
  if (arr.length !== fields.length) {
    throw new Error(`${kind}: expected ${fields.length} elements, got ${arr.length} (Lightdash field order changed?)`);
  }
  const o = {};
  fields.forEach((f, i) => { o[f] = arr[i]; });
  return o;
}

function parseBlob(blob, fields, kind) {
  if (blob == null || blob === '') return [];
  const rows = typeof blob === 'string' ? JSON.parse(blob) : blob;
  return rows.map((r) => fromPositional(r, fields, kind));
}

const num = (v) => (v == null ? 0 : Number(v));
const list = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);
const day = (v) => (v ? String(v).slice(0, 10) : null);

export function parseFeature(raw) {
  return {
    ...raw,
    start: day(raw.start),
    end: day(raw.end),
    committed: day(raw.committed),
    subtaskIds: list(raw.subtaskIds),
    blocksIds: list(raw.blocksIds),
    blockedByIds: list(raw.blockedByIds),
    customerTaskIds: list(raw.customerTaskIds),
    effort: { FE: num(raw.effortFE), BE: num(raw.effortBE), MOB: num(raw.effortMOB) },
  };
}

export function parseTask(raw) {
  return { ...raw, committed: day(raw.committed), featureIds: list(raw.featureIds) };
}

export function parseAllocation(raw) {
  return {
    ...raw,
    start: day(raw.start),
    end: day(raw.end),
    skills: { FE: num(raw.capFE), BE: num(raw.capBE), MOB: num(raw.capMOB) },
  };
}

export function parseDeal(raw) {
  return { ...raw, goLive: day(raw.goLive) };
}

/**
 * Merge the explore's rows (is_default TRUE and FALSE) into one model.
 * Each row has the five blob columns; allocations and deals are only on the default row.
 */
export function parseCapacityRows(rows) {
  const col = (r, name) => r[`serve_engineering_capacity_${name}`];
  const out = { features: [], tasks: [], allocations: [], deals: [] };
  for (const r of rows) {
    out.features.push(...parseBlob(col(r, 'features'), FEATURE_FIELDS, 'feature').map(parseFeature));
    out.tasks.push(...parseBlob(col(r, 'customer_tasks'), TASK_FIELDS, 'task').map(parseTask));
    out.allocations.push(...parseBlob(col(r, 'engineering_team_allocations'), ALLOCATION_FIELDS, 'allocation').map(parseAllocation));
    out.deals.push(...parseBlob(col(r, 'deals'), DEAL_FIELDS, 'deal').map(parseDeal));
  }
  return out;
}
