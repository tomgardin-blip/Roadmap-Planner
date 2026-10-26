// Live data over the artifact's `mcp` capability (viewer's own Lightdash and Notion connectors).
// 1. Lightdash serve_engineering_capacity, default row (planned or committed features + allocations).
// 2. Notion: every issue edited since Lightdash's last sync, patched on top (Notion wins).
// Each source fails on its own: no Notion still renders Lightdash with a stale warning.

import { lastSync, overlayQueryInput, parseOverlay, applyOverlay, OVERLAY_PAGE_SIZE } from './notion.js';
import { auditQueryInput, parseAudit, AUDIT_PAGE_SIZE } from '../history.js';
import { baselineQueryInput, parseBaseline, BASELINE_PAGE_SIZE, missingBaselines, baselineRowsInputs, totalEffort } from '../notion/baseline.js';

export const LIGHTDASH = 'Lightdash';
export const NOTION = 'Notion';
const PROJECT = 'd4d21d1b-488b-4ff0-8a1e-a621c498c932';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Human copy per MCP error code (never one generic banner). */
export function explainError(server, err) {
  const code = err && err.code;
  switch (code) {
    case 'needs_reauth': return `Reconnect ${server} in claude.ai Settings → Connectors.`;
    case 'server_not_connected': return `Add the ${server} connector in claude.ai Settings → Connectors.`;
    case 'selection_required': return `Choose which ${server} connector this page should use when claude.ai asks.`;
    case 'not_in_manifest': return `${server} is turned off for this page. Allow it in the page's Permissions menu.`;
    case 'blocked_by_policy': return `Your organisation blocks this ${server} tool.`;
    case 'approval_required': return `${server} needs your approval. Reload and allow it.`;
    case 'server_unavailable': return `${server} is not answering right now. Try again in a minute.`;
    case 'tool_error': return `${server} returned an error: ${err.message || 'no details'}.`;
    case 'not_granted': case 'capability_disabled': case 'capability_removed':
      return 'Connectors are not available in this view. Open the page in claude.ai.';
    default: return `${server} failed (${code || 'unknown error'}).`;
  }
}

export async function call(mcp, server, tool, input) {
  try {
    return (await mcp.callTool(server, tool, input, { cache: false })).payload;
  } catch (err) {
    if (err && err.retryable) {
      await sleep((err.retryAfterMs || 1500) + Math.random() * 500);
      return (await mcp.callTool(server, tool, input, { cache: false })).payload;
    }
    throw err;
  }
}

export async function runQuery(mcp, title, queryConfig) {
  const input = { projectUuid: PROJECT, title, description: `${title} (Roadmap Planner)`, queryConfig };
  let res = (await call(mcp, LIGHTDASH, 'run_metric_query', input))?.result;
  for (let i = 0; res && res.status !== 'done' && i < 20; i++) {
    if (res.status === 'error' || res.status === 'cancelled' || res.status === 'expired') throw { code: 'tool_error', message: `query ${res.status}` };
    await sleep(1500);
    res = (await call(mcp, LIGHTDASH, 'get_query_result', { projectUuid: PROJECT, queryUuid: res.queryUuid }))?.result;
  }
  if (!res || !Array.isArray(res.rows)) throw { code: 'tool_error', message: 'unexpected Lightdash response' };
  return res.rows;
}

const isDefault = (v) => ({ type: 'and', dimensions: [{ fieldId: 'serve_engineering_capacity_is_default', fieldType: 'boolean', fieldFilterType: 'boolean', operator: 'equals', values: [v] }] });

/** Default row: planned or committed features, allocations, committed customer tasks, deals. */
export function loadLightdashRows(mcp) {
  return runQuery(mcp, 'Roadmap Planner: engineering capacity', {
    exploreName: 'serve_engineering_capacity',
    // Customer tasks feed the engine's effective committed date (earliest of the issue and its FRs); deals name the customers.
    dimensions: ['serve_engineering_capacity_features', 'serve_engineering_capacity_engineering_team_allocations', 'serve_engineering_capacity_customer_tasks', 'serve_engineering_capacity_deals'],
    metrics: [], sorts: [], limit: 2, filters: isDefault(true),
  });
}

/** One column of the non-default row: 'customer_tasks' (uncommitted FRs, ~4 MB) or 'features' (unplanned backlog, ~1.7 MB). */
export function loadExtraColumn(mcp, column) {
  return runQuery(mcp, `Roadmap Planner: backlog ${column}`, {
    exploreName: 'serve_engineering_capacity',
    dimensions: [`serve_engineering_capacity_${column}`],
    metrics: [], sorts: [], limit: 2, filters: isDefault(false),
  });
}

/** Deals of signed customers (HubSpot deal status Closed-Won): Set of deal ids, no dashes. */
export async function loadSignedDeals(mcp) {
  const rows = await runQuery(mcp, 'Roadmap Planner: signed deals', {
    exploreName: 'deals_extract', dimensions: ['deals_extract_notion_page_id'], metrics: [], sorts: [], limit: 5000,
    filters: { type: 'and', dimensions: [{ fieldId: 'deals_extract_deal_status', fieldType: 'string', fieldFilterType: 'string', operator: 'equals', values: ['Closed-Won'] }] },
  });
  return signedSet(rows);
}
export const signedSet = (rows) => new Set((rows || []).map((r) => String(r.deals_extract_notion_page_id || '').replace(/-/g, '').toLowerCase()).filter(Boolean));

/**
 * FRs that count in the prep queues (Tom, 2026-10-26): Type "Feature request", Category containing
 * "Feature Request", open, prep priorities. Two queries (GO LIVE, Top 3) keep each under the
 * 1000-row cap. Set of FR ids, no dashes.
 */
export async function loadFeatureFrs(mcp) {
  const q = (title, priorities) => runQuery(mcp, `Roadmap Planner: feature requests ${title}`, {
    exploreName: 'customer_tasks', dimensions: ['customer_tasks_customer_task_notion_page_id'], metrics: [], sorts: [], limit: 5000,
    filters: { type: 'and', dimensions: [
      { fieldId: 'customer_tasks_task_type', fieldType: 'string', fieldFilterType: 'string', operator: 'equals', values: ['Feature request'] },
      { fieldId: 'customer_tasks_task_category', fieldType: 'string', fieldFilterType: 'string', operator: 'include', values: ['Feature Request'] },
      { fieldId: 'customer_tasks_task_priority', fieldType: 'string', fieldFilterType: 'string', operator: 'equals', values: priorities },
      { fieldId: 'customer_tasks_task_status', fieldType: 'string', fieldFilterType: 'string', operator: 'notEquals', values: ['Done', "Won't do", 'Duplicate'] },
    ] },
  });
  const rows = [...await q('GO LIVE', ['Needed for go-live', 'Needed 1 month before']), ...await q('Top 3', ['Top 3'])];
  return featureFrSet(rows);
}
export const featureFrSet = (rows) => new Set((rows || []).map((r) => String(r.customer_tasks_customer_task_notion_page_id || '').replace(/-/g, '').toLowerCase()).filter(Boolean));

/** Deal sizes of £25k and over: everything else counts ×1, so smaller deals are not needed. */
export function loadDealSizes(mcp) {
  return runQuery(mcp, 'Roadmap Planner: deal sizes', {
    exploreName: 'deals_extract',
    dimensions: ['deals_extract_notion_page_id', 'deals_extract_onboarding_deal_size_gbp'],
    metrics: [], sorts: [{ fieldId: 'deals_extract_onboarding_deal_size_gbp', descending: true }], limit: 5000,
    filters: { type: 'and', dimensions: [{ fieldId: 'deals_extract_onboarding_deal_size_gbp', fieldType: 'number', fieldFilterType: 'number', operator: 'greaterThanOrEqual', values: [25000] }] },
  });
}

/**
 * Background load after the grid renders (decided 2026-10-10): deal sizes + uncommitted FRs
 * first (scores), then the unplanned features (pull-forward backlog). The Notion overlay is
 * applied to the backlog rows too. onStep(name, payload | {error}) reports each step.
 */
export async function loadExtras(mcp, overlay, onStep) {
  try {
    const [deals, tasks, signed, frs] = [await loadDealSizes(mcp), await loadExtraColumn(mcp, 'customer_tasks'), await loadSignedDeals(mcp), await loadFeatureFrs(mcp)];
    onStep('scores', { deals, tasks, signed, frs });
  } catch (err) {
    onStep('scores', { error: explainError(LIGHTDASH, err) });
  }
  try {
    let features = await loadExtraColumn(mcp, 'features');
    if (overlay) features = applyOverlay(features, overlay, { addMissing: false }).rows;
    onStep('backlog', { features });
  } catch (err) {
    onStep('backlog', { error: explainError(LIGHTDASH, err) });
  }
}

export async function loadOverlay(mcp, since) {
  const all = [];
  for (let offset = 0; offset < 5000; offset += OVERLAY_PAGE_SIZE) {
    const page = await call(mcp, NOTION, 'notion-query-data-sources', overlayQueryInput(since, offset));
    const results = page?.results || [];
    all.push(...results);
    if (!page?.has_more && results.length < OVERLAY_PAGE_SIZE) break;
  }
  return parseOverlay(all);
}

/** Full live load. Returns rows for the engine plus per-source status for the UI. */
export async function loadLive(mcp) {
  const status = { lightdash: 'loading', notion: 'loading', lightdashError: null, notionError: null, syncedAt: null, changed: [], added: [] };
  let rows;
  try {
    rows = await loadLightdashRows(mcp);
    status.lightdash = 'ok';
  } catch (err) {
    status.lightdash = 'error';
    status.lightdashError = explainError(LIGHTDASH, err);
    status.notion = 'skipped';
    return { rows: null, status };
  }
  status.syncedAt = lastSync(rows);
  try {
    const overlay = await loadOverlay(mcp, status.syncedAt || '1970-01-01T00:00:00Z');
    const patched = applyOverlay(rows, overlay);
    status.overlay = overlay;
    rows = patched.rows;
    status.changed = patched.changed;
    status.added = patched.added;
    status.notion = 'ok';
  } catch (err) {
    status.notion = 'error';
    status.notionError = explainError(NOTION, err);
  }
  return { rows, status };
}

/**
 * Read this quarter's effort baseline from Notion and add rows for committed issues seen for the
 * first time. Returns Map(issue id → baseline total), including the rows just written.
 */
export async function syncBaseline(mcp, run, quarter, { write = true } = {}) {
  const all = [];
  for (let offset = 0; offset < 10000; offset += BASELINE_PAGE_SIZE) {
    const page = await call(mcp, NOTION, 'notion-query-data-sources', baselineQueryInput(quarter, offset));
    const results = page?.results || [];
    all.push(...results);
    if (!page?.has_more && results.length < BASELINE_PAGE_SIZE) break;
  }
  const baseline = parseBaseline(all);
  const missing = write ? missingBaselines(run, baseline) : [];
  for (const input of baselineRowsInputs(missing, quarter)) await call(mcp, NOTION, 'notion-create-pages', input);
  for (const i of missing) baseline.set(i.id, totalEffort(i));
  return { baseline, added: missing.length };
}

/** The latest audit rows (newest first), up to `max`. */
export async function loadAudit(mcp, max = 500) {
  const all = [];
  for (let offset = 0; offset < max; offset += AUDIT_PAGE_SIZE) {
    const page = await call(mcp, NOTION, 'notion-query-data-sources', auditQueryInput(offset));
    const results = page?.results || [];
    all.push(...results);
    if (!page?.has_more && results.length < AUDIT_PAGE_SIZE) break;
  }
  return parseAudit(all);
}

/** Map(FR id → Responsible Success email) for many FRs in one Lightdash query. */
export async function loadOwnerEmails(mcp, frIds) {
  const dashed = (id) => { const h = String(id).replace(/-/g, '').toLowerCase(); return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`; };
  const out = new Map();
  for (let k = 0; k < frIds.length; k += 400) {
    const rows = await runQuery(mcp, 'Roadmap Planner: pushback owners', {
      exploreName: 'deals_extract',
      dimensions: ['customer_tasks_customer_task_notion_page_id', 'customer_tasks_responsible_success_email'],
      metrics: [], sorts: [], limit: 1000,
      filters: { type: 'and', dimensions: [{ fieldId: 'customer_tasks_customer_task_notion_page_id', fieldType: 'string', fieldFilterType: 'string', operator: 'equals', values: frIds.slice(k, k + 400).map(dashed) }] },
    });
    for (const r of rows || []) if (r.customer_tasks_responsible_success_email) out.set(String(r.customer_tasks_customer_task_notion_page_id).replace(/-/g, ''), r.customer_tasks_responsible_success_email);
  }
  return out;
}
