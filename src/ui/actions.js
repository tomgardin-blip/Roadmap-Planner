// Write flows in the UI: move an issue (date buttons), edit an FR (Success Committed, Priority),
// advise the FR's owner in Notion. All writes go through src/data/writer.js (test pages only).

import { formatDate } from '../periods.js';
import { FR_PRIORITIES, REASONS, effectiveCommitted, moveWarnings, isAllowed, TEST_ISSUE, TEST_FR } from '../notion/writes.js';
import { moveIssue, editFr, readFrLive, readIssue, findOwner, adviseOwner, previewComment, whoAmI, dismissPushback, postSlack } from '../data/writer.js';
import { ESTIMATE_TARGETS, estimateLines, estimatePosts } from '../estimate.js';
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
  if (!isAllowed('issue', issue.id)) return toast('This issue has no Notion id.', 'bad');
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

/**
 * Bulk move (Tom, 2026-10-26): Start = End = date on several issues, one reason for all. Each issue is
 * its own Notion write and audit row, in order; stops at the first failure and says how far it got.
 * ctx: { mcp, items: [{ issue, blockers }], date, label, onDone(results) }
 */
export function startBulkMove(ctx) {
  const { mcp, items, date, label, onDone } = ctx;
  if (!mcp) return toast('Writes need the live page in claude.ai.', 'bad');
  const ok = items.filter((x) => isAllowed('issue', x.issue.id));
  if (!ok.length) return toast('Nothing selected that can be moved.', 'bad');
  const rows = ok.map(({ issue, blockers }) => {
    const w = moveWarnings(issue, date, blockers);
    return `<div class="pickrow"><span><b>${esc(issue.name)}</b><span class="muted"> · now ${issue.start || issue.end ? `${fd(issue.start)} → ${fd(issue.end)}` : 'no dates'}</span>${w.map((x) => `<div class="warnt">⚠ ${esc(x)}</div>`).join('')}</span></div>`;
  }).join('');
  const nWarn = ok.filter(({ issue, blockers }) => moveWarnings(issue, date, blockers).length).length;
  const sheet = openSheet(`
    <h3>Move ${ok.length} issue${ok.length === 1 ? '' : 's'}</h3>
    <div class="srow">Start = End = <b>${fd(date)}</b> (${esc(label)}) on each</div>
    ${nWarn ? `<div class="swarn">⚠ ${nWarn} with a warning, shown below. Allowed; each is logged.</div>` : ''}
    <div class="picklist">${rows}</div>
    ${reasonField()}
    <div class="sact"><button data-sheet-close>Cancel</button><button class="primary" id="sSave">Move ${ok.length}</button></div>`);
  wireReason(sheet);
  sheet.querySelector('#sSave').addEventListener('click', async (e) => {
    const reason = sheet.querySelector('#sReason').value.trim();
    const done = [];
    for (let i = 0; i < ok.length; i++) {
      busy(e.target, true, `Moving ${i + 1}/${ok.length}…`);
      try {
        const r = await moveIssue(mcp, { issue: ok[i].issue, start: date, end: date, reason, blockers: ok[i].blockers });
        done.push({ issue: ok[i].issue, r });
      } catch (err) {
        busy(e.target, false, `Move ${ok.length}`);
        toast(`${done.length} of ${ok.length} moved. Stopped at "${ok[i].issue.name}": ${errText(err)}`, 'bad');
        if (done.length) onDone?.(done);
        return;
      }
    }
    closeSheet();
    toast(`Moved ${done.length} issue${done.length === 1 ? '' : 's'} to ${fd(date)}. Each logged.`);
    onDone?.(done);
  });
}

/** FR edit: Success Committed and Priority. ctx: { mcp, fr: {id, title, dealId}, golive, onDone } */
export async function startFrEdit(ctx) {
  const { mcp, fr, golive, onDone } = ctx;
  if (!mcp) return toast('Writes need the live page in claude.ai.', 'bad');
  if (!isAllowed('fr', fr.id)) return toast('This FR has no Notion id.', 'bad');
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

/** "Not a pushback" with an optional reason, logged to the audit DB. */
export function startDismiss({ mcp, fr, issue, onDone }) {
  if (!mcp) return toast('Writes need the live page in claude.ai.', 'bad');
  const sheet = openSheet(`
    <h3>Not a pushback</h3>
    <div class="srow"><b>${esc(fr.title || 'FR')}</b> stays committed and leaves the pushback list. Logged in the audit log so Product can learn the call.</div>
    <label class="sfld">Reason <span class="muted">(optional)</span><input id="sReason" type="text" maxlength="200" placeholder="e.g. real go-live blocker"></label>
    <div class="sact"><button data-sheet-close>Cancel</button><button class="primary" id="sSave">Log it</button></div>`);
  sheet.querySelector('#sSave').addEventListener('click', async (e) => {
    busy(e.target, true, 'Saving…');
    const reason = sheet.querySelector('#sReason').value.trim();
    try { await dismissPushback(mcp, { fr, issue, reason }); closeSheet(); toast('Logged as not a pushback.'); onDone?.({ reason }); } catch (err) { busy(e.target, false, 'Log it'); toast(errText(err), 'bad'); }
  });
}

/**
 * Pick which "No estimate" issues to post (none ticked by default, Tom 2026-10-10), preview and
 * edit the text, then post to Slack as the viewer. groups: [{ label, entries: [{ issue, frs }] }].
 */
export function startEstimatePost({ mcp, groups, target = ESTIMATE_TARGETS.productFeature }) {
  const ch = target.channel;
  if (!mcp) return toast('Posting needs the live page in claude.ai.', 'bad');
  const list = groups.filter((g) => g.entries.length).map((g) => `
    <div class="pickgrp"><div class="pickhead"><b>${esc(g.label)}</b> <span class="muted">(${g.entries.length})</span>
      <button type="button" class="chip" data-pickall="${esc(g.label)}">All</button><button type="button" class="chip" data-picknone="${esc(g.label)}">None</button></div>
      ${g.entries.map((e) => `<label class="pickrow" data-grp="${esc(g.label)}"><input type="checkbox" data-pick="${e.issue.id}">
        <span><b>${esc(e.issue.name)}</b><span class="muted"> · ${esc(e.issue.team || 'No team')} · ${e.frs.length} FR${e.frs.length === 1 ? '' : 's'}${e.issue.committed ? ` · commit ${fd(e.issue.committed)}` : ''}</span></span></label>`).join('')}
    </div>`).join('');
  const sheet = openSheet(`
    <h3>Post to ${esc(ch.name)}</h3>
    <div class="srow muted">Tick the issues to post. One post per issue (one line below = one post), as you, ${esc(target.how)}. Changing the selection rebuilds the text.</div>
    <div class="picklist">${list || '<div class="placeholder">No issues without an estimate.</div>'}</div>
    <div class="srow"><b id="pickCount">0</b> selected</div>
    <textarea id="sMsg" rows="10" class="smsg" placeholder="Tick issues above to build the posts"></textarea>
    <div class="sact"><button data-sheet-close>Cancel</button><button class="primary" id="sSend" disabled>Post</button></div>`);
  const rebuild = () => {
    const picked = new Set([...sheet.querySelectorAll('input[data-pick]:checked')].map((x) => x.dataset.pick));
    sheet.querySelector('#pickCount').textContent = picked.size;
    const seen = new Set();
    const entries = groups.flatMap((g) => g.entries).filter((e) => picked.has(e.issue.id) && !seen.has(e.issue.id) && seen.add(e.issue.id));
    sheet.querySelector('#sMsg').value = estimateLines(entries, target).join('\n');
    sheet.querySelector('#sSend').disabled = !picked.size;
  };
  sheet.addEventListener('change', (e) => { if (e.target.matches('input[data-pick]')) rebuild(); });
  sheet.addEventListener('click', (e) => {
    const all = e.target.closest('[data-pickall]'); const none = e.target.closest('[data-picknone]');
    const grp = (all || none)?.dataset.pickall || (all || none)?.dataset.picknone;
    if (!grp) return;
    sheet.querySelectorAll(`.pickrow[data-grp="${CSS.escape(grp)}"] input`).forEach((x) => { x.checked = !!all; });
    rebuild();
  });
  sheet.querySelector('#sSend').addEventListener('click', async (e) => {
    const posts = estimatePosts(sheet.querySelector('#sMsg').value, target);
    if (!posts.length) return;
    // One message per issue, sent in order; stop at the first refusal and say how far it got.
    for (let i = 0; i < posts.length; i++) {
      busy(e.target, true, `Posting ${i + 1}/${posts.length}…`);
      try { await postSlack(mcp, ch.id, posts[i]); } catch (err) {
        busy(e.target, false, 'Post');
        const why = err?.code === 'tool_error' ? `Slack refused: ${err.message || 'no details'}` : explainError('Slack', err);
        return toast(`${i} of ${posts.length} posted. ${why}`, 'bad');
      }
    }
    closeSheet(); toast(`Posted ${posts.length} issue${posts.length === 1 ? '' : 's'} to ${ch.name}.`);
  });
}
