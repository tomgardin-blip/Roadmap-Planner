// Write flows in the UI: move an issue (date buttons), edit an FR (Success Committed, Priority),
// advise the FR's owner in Notion. All writes go through src/data/writer.js (test pages only).

import { formatDate } from '../periods.js';
import { FR_PRIORITIES, REASONS, effectiveCommitted, moveWarnings, isAllowed, TEST_ISSUE, TEST_FR } from '../notion/writes.js';
import { moveIssue, editFr, readFrLive, readIssue, findOwner, adviseOwner, previewComment, whoAmI } from '../data/writer.js';
import { explainError, NOTION } from '../data/live.js';
import { openSheet, closeSheet, toast } from './sheet.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fd = (iso) => (iso ? formatDate(iso) : '–');
const errText = (err) => (err?.code === 'not_allowed' || err?.code === 'audit_failed' ? err.message : explainError(NOTION, err));

function reasonField() {
  return `<label class="sfld">Reason <span class="muted">(optional, goes in the audit log and the owner ping)</span>
    <div class="chips">${REASONS.map((r) => `<button type="button" class="chip" data-reason="${esc(r)}">${esc(r)}</button>`).join('')}</div>
    <input id="sReason" type="text" maxlength="200" placeholder="Or type a reason"></label>`;
}
function wireReason(sheet) {
  sheet.addEventListener('click', (e) => {
    const c = e.target.closest('[data-reason]');
    if (!c) return;
    sheet.querySelectorAll('.chip').forEach((x) => x.classList.toggle('on', x === c));
    sheet.querySelector('#sReason').value = c.dataset.reason;
  });
}
const busy = (btn, on, label) => { btn.disabled = on; if (label) btn.textContent = label; };

/** Date button: set Start = End = date on an issue. ctx: { mcp, issue, date, label, blockers, onDone } */
export function startMove(ctx) {
  const { mcp, issue, date, label, blockers = [], onDone } = ctx;
  if (!mcp) return toast('Writes need the live page in claude.ai.', 'bad');
  if (!isAllowed('issue', issue.id)) return toast('Test mode: only "Test Tom - ignore" can be moved for now.', 'bad');
  const warnings = moveWarnings(issue, date, blockers);
  const sheet = openSheet(`
    <h3>Move "${esc(issue.name)}"</h3>
    <div class="srow">Start = End = <b>${fd(date)}</b> (${esc(label)})</div>
    ${warnings.map((w) => `<div class="swarn">⚠ ${esc(w)}. Allowed; it is logged.</div>`).join('')}
    ${reasonField()}
    <div class="sact"><button data-sheet-close>Cancel</button><button class="primary" id="sSave">Move</button></div>`);
  wireReason(sheet);
  sheet.querySelector('#sSave').addEventListener('click', async (e) => {
    busy(e.target, true, 'Saving…');
    try {
      const r = await moveIssue(mcp, { issue, start: date, end: date, reason: sheet.querySelector('#sReason').value.trim(), blockers });
      closeSheet();
      toast(`Moved to ${fd(date)}. Was ${fd(r.before.start)} → ${fd(r.before.end)}. Logged.`);
      onDone?.(r);
    } catch (err) {
      busy(e.target, false, 'Move');
      toast(errText(err), 'bad');
    }
  });
}

/** FR edit: Success Committed and Priority. ctx: { mcp, fr: {id, title, dealId}, golive, onDone } */
export async function startFrEdit(ctx) {
  const { mcp, fr, golive, onDone } = ctx;
  if (!mcp) return toast('Writes need the live page in claude.ai.', 'bad');
  if (!isAllowed('fr', fr.id)) return toast('Test mode: only "Test Tom - ignore FR" can be edited for now.', 'bad');
  let sheet = openSheet(`<h3>${esc(fr.title || 'FR')}</h3><div class="srow muted">Reading the live values from Notion…</div>`);
  let cur;
  try { cur = await readFrLive(mcp, fr.id); } catch (err) { closeSheet(); return toast(errText(err), 'bad'); }
  sheet = openSheet(`
    <h3>${esc(cur.name || fr.title)}</h3>
    <label class="sfld">Committed date <span class="muted">(writes Success Committed)</span>
      <input id="sSc" type="date" value="${esc(cur.successCommitted || '')}"></label>
    <label class="sfld">Priority
      <select id="sPr">${[cur.priority && !FR_PRIORITIES.includes(cur.priority) ? cur.priority : null, ...FR_PRIORITIES].filter(Boolean)
        .map((p) => `<option ${p === cur.priority ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select></label>
    <div class="srow muted" id="sEff"></div>
    ${reasonField()}
    <div class="sact"><button data-sheet-close>Cancel</button><button class="primary" id="sSave">Save</button></div>`);
  wireReason(sheet);
  const effLine = () => {
    const sc = sheet.querySelector('#sSc').value || null;
    const pr = sheet.querySelector('#sPr').value;
    const eff = effectiveCommitted({ successCommitted: sc, priority: pr, golive });
    sheet.querySelector('#sEff').innerHTML = `Committed will be <b>${fd(eff)}</b>${pr === 'Needed for go-live' && golive ? ` (earliest of this date and go-live ${fd(golive)})` : ''}.`;
  };
  sheet.addEventListener('input', effLine);
  effLine();
  sheet.querySelector('#sSave').addEventListener('click', async (e) => {
    const reason = sheet.querySelector('#sReason').value.trim();
    busy(e.target, true, 'Saving…');
    try {
      const r = await editFr(mcp, { fr, successCommitted: sheet.querySelector('#sSc').value || null, priority: sheet.querySelector('#sPr').value, reason });
      if (!r.changes.length) { closeSheet(); return toast('Nothing changed.'); }
      onDone?.(r);
      await promptAdvise({ mcp, fr: { ...fr, title: r.name }, changes: r.changes, reason, updateId: r.updateId });
    } catch (err) {
      busy(e.target, false, 'Save');
      toast(errText(err), 'bad');
    }
  });
}

async function promptAdvise({ mcp, fr, changes, reason, updateId }) {
  const shown = changes.map((c) => ({ ...c, before: c.field === 'Success Committed' ? fd(c.before) : c.before, after: c.field === 'Success Committed' ? fd(c.after) : c.after }));
  openSheet(`<h3>Saved in Notion</h3><div class="srow muted">Looking up the FR's Responsible Success…</div>`);
  let owner = null;
  try { owner = await findOwner(mcp, fr.id); } catch (err) { closeSheet(); return toast(`Saved and logged. Owner lookup failed: ${errText(err)}`, 'bad'); }
  if (!owner) { closeSheet(); return toast('Saved and logged. This FR has no Responsible Success, so no ping.'); }
  const by = (await whoAmI(mcp).catch(() => ({}))).name;
  const sheet = openSheet(`
    <h3>Advise ${esc(owner.name)} in Notion?</h3>
    <div class="srow muted">Saved and logged. This comment goes on the FR and tags ${esc(owner.name)}${fr.id.replace(/-/g, '') === TEST_FR ? ' (test FR: tags you)' : ''}:</div>
    <div class="squote">${esc(previewComment({ owner, changes: shown, reason, by }))}</div>
    <div class="sact"><button data-sheet-close>Skip</button><button class="primary" id="sSend">Send</button></div>`);
  sheet.querySelector('#sSend').addEventListener('click', async (e) => {
    busy(e.target, true, 'Sending…');
    try {
      await adviseOwner(mcp, { fr, owner, changes: shown, reason, updateId });
      closeSheet();
      toast(`${owner.name} tagged in Notion. Logged.`);
    } catch (err) {
      busy(e.target, false, 'Send');
      toast(errText(err), 'bad');
    }
  });
}

/** Live view of the test issue and test FR, so the write path can be tried end to end. */
export async function loadTestPages(mcp) {
  const [issue, fr] = await Promise.all([readIssue(mcp, TEST_ISSUE), readFrLive(mcp, TEST_FR)]);
  return {
    issue: { id: TEST_ISSUE, name: issue.name || 'Test Tom - ignore', url: `https://app.notion.com/p/${TEST_ISSUE}`, start: issue.start, end: issue.end, committed: null, skillEfforts: {}, status: '' },
    fr: { id: TEST_FR, title: fr.name || 'Test Tom - ignore FR', url: `https://app.notion.com/p/${TEST_FR}`, priority: fr.priority, successCommitted: fr.successCommitted, dealId: null },
  };
}
