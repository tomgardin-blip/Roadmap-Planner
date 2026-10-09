// Live data over the artifact's `mcp` capability (viewer's own Lightdash and Notion connectors).
// 1. Lightdash serve_engineering_capacity, default row (planned or committed features + allocations).
// 2. Notion: every issue edited since Lightdash's last sync, patched on top (Notion wins).
// Each source fails on its own: no Notion still renders Lightdash with a stale warning.

import { lastSync, overlayQueryInput, parseOverlay, applyOverlay, OVERLAY_PAGE_SIZE } from './notion.js';

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

async function call(mcp, server, tool, input) {
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

export async function loadLightdashRows(mcp) {
  const input = {
    projectUuid: PROJECT,
    title: 'Roadmap Planner: engineering capacity',
    description: 'Default row of serve_engineering_capacity for the Roadmap Planner',
    queryConfig: {
      exploreName: 'serve_engineering_capacity',
      dimensions: ['serve_engineering_capacity_features', 'serve_engineering_capacity_engineering_team_allocations'],
      metrics: [], sorts: [], limit: 2,
      filters: { type: 'and', dimensions: [{ fieldId: 'serve_engineering_capacity_is_default', fieldType: 'boolean', fieldFilterType: 'boolean', operator: 'equals', values: [true] }] },
    },
  };
  let res = (await call(mcp, LIGHTDASH, 'run_metric_query', input))?.result;
  for (let i = 0; res && res.status !== 'done' && i < 20; i++) {
    if (res.status === 'error' || res.status === 'cancelled' || res.status === 'expired') throw { code: 'tool_error', message: `query ${res.status}` };
    await sleep(1500);
    res = (await call(mcp, LIGHTDASH, 'get_query_result', { projectUuid: PROJECT, queryUuid: res.queryUuid }))?.result;
  }
  if (!res || !Array.isArray(res.rows)) throw { code: 'tool_error', message: 'unexpected Lightdash response' };
  return res.rows;
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
