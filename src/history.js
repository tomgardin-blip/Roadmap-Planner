// Change history (SPEC "Features and screens" > 6, v2 route "b", decided 2026-10-10):
//   - planner changes from the Roadmap Planner Audit Log
//   - issues edited directly in Notion since the last Lightdash sync (live overlay), "no reason given"
//   - per quarter: what changed its load this week (planner moves in the last 7 days + those edits)
// Pure functions; the audit query input lives here too.

import { AUDIT_DS } from './notion/writes.js';

const PAGE = 100;
const nid = (x) => String(x || '').replace(/-/g, '').toLowerCase();
const idFromUrls = (v) => { try { const u = JSON.parse(v || '[]')[0]; const m = /([0-9a-f]{32})/i.exec(String(u || '').replace(/-/g, '')); return m ? m[1].toLowerCase() : null; } catch { return null; } };
const userFrom = (v) => { try { return String(JSON.parse(v || '[]')[0] || '').replace('user://', '').split('/')[0] || null; } catch { return null; } };
const quarterOf = (iso) => { if (!iso) return null; const [y, m] = String(iso).split('-').map(Number); return `${y}-Q${Math.floor((m - 1) / 3) + 1}`; };
const SK = ['frontend', 'backend', 'mobile'];

export function auditQueryInput(offset = 0) {
  const ds = `collection://${AUDIT_DS}`;
  return {
    data: {
      data_source_urls: [ds],
      query: `SELECT "Category", "Field", "Before", "After", "Reason", "Warning", "Item name", "Issue", "FR", "Changed by", "Changed by (unmatched)", "Update ID", "createdTime" FROM "${ds}" ORDER BY "createdTime" DESC, url DESC LIMIT ${PAGE} OFFSET ${offset}`,
      params: [],
    },
  };
}
export const AUDIT_PAGE_SIZE = PAGE;

export function parseAudit(results) {
  return (results || []).map((r) => ({
    category: r.Category, field: r.Field, before: r.Before, after: r.After, reason: r.Reason || '', warning: r.Warning || '',
    itemName: r['Item name'] || '', issueId: idFromUrls(r.Issue), frId: idFromUrls(r.FR),
    by: userFrom(r['Changed by']), byText: r['Changed by (unmatched)'] || '', updateId: r['Update ID'] || '',
    at: String(r.createdTime || '').replace(' ', 'T'),
  }));
}

/**
 * FR ids handled in the planner, which leave the Pushback to-do list (Tom, 2026-10-27): marked
 * "Not a pushback", or edited (committed date, priority, status) or pinged from the FR edit sheet.
 */
export const HANDLED_CATEGORIES = new Set(['Pushback override', 'FR committed changed', 'FR priority changed', 'FR status changed', 'Owner advised']);
export const dismissedFrs = (audit) => new Set(audit.filter((a) => HANDLED_CATEGORIES.has(a.category) && a.frId).map((a) => a.frId));

/** End date from an audit "start / end" string. */
const endOf = (s) => { const parts = String(s || '').split('/').map((x) => x.trim()); const e = parts[1] || parts[0]; return /^\d{4}-\d{2}-\d{2}$/.test(e) ? e : null; };

/**
 * Load moved per quarter this week. Each issue's current effort is moved out of the quarter of
 * its old end date and into the quarter of its new one. Notion edits since the sync also count
 * effort changes in place.
 * @returns Map(quarter → { in, out, items: [{name, from, to, days, source, reason}] })
 */
export function weeklyLoadChanges({ audit, changes = [], issues, now = new Date() }) {
  const effort = new Map(issues.map((i) => [i.id, SK.reduce((a, s) => a + (i.skillEfforts?.[s] || 0), 0)]));
  const out = new Map();
  const bump = (q, k, d, item) => { if (!q || !d) return; const e = out.get(q) || { in: 0, out: 0, items: [] }; e[k] += d; if (!e.items.includes(item)) e.items.push(item); out.set(q, e); };
  const since = new Date(now.getTime() - 7 * 864e5).toISOString();
  for (const a of audit) {
    if (a.at < since || !['Issue moved', 'Moved past commit'].includes(a.category)) continue;
    const from = quarterOf(endOf(a.before)); const to = quarterOf(endOf(a.after));
    if (from === to) continue;
    const days = effort.get(a.issueId) || 0;
    const item = { name: a.itemName, from, to, days, source: 'Planner', reason: a.reason, at: a.at };
    bump(from, 'out', days, item); bump(to, 'in', days, item);
  }
  for (const c of changes) {
    const b = c.before || {}; const af = { ...b, ...c.after };
    const eb = (b.fe || 0) + (b.be || 0) + (b.mob || 0); const ea = (af.fe || 0) + (af.be || 0) + (af.mob || 0);
    const from = quarterOf(b.end); const to = quarterOf(af.end);
    if (from === to && eb === ea) continue;
    const item = { name: c.name, from, to, days: ea, source: 'Notion', reason: 'No reason given' };
    if (from === to) { if (ea > eb) bump(to, 'in', ea - eb, item); else bump(from, 'out', eb - ea, item); } else { bump(from, 'out', eb, item); bump(to, 'in', ea, item); }
  }
  return out;
}
