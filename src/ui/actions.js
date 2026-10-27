// Write flows in the UI: move an issue (date buttons), edit an FR (Success Committed, Priority),
// advise the FR's owner in Notion. All writes go through src/data/writer.js (test pages only).

import { formatDate } from '../periods.js';
import { FR_PRIORITIES, FR_STATUS_CLOSE, EI_STATUSES, REASONS, effectiveCommitted, moveWarnings, isAllowed, TEST_FR } from '../notion/writes.js';
import { moveIssue, editFr, readFrLive, readIssue, setIssueStatus, findOwner, adviseOwner, whoAmI, dismissPushback, postSlack } from '../data/writer.js';
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

/** Month and quarter buttons for a date field (same dates as the issue date buttons). */
function dateChips(horizon, current) {
  if (!horizon.length) return '';
  const b = (d, label) => `<button type="button" class="${d === current ? 'cur' : ''}" data-scdate="${d}" title="${fd(d)}">${esc(label)}</button>`;
  let h = '<div class="datebtns">';
  for (const q of horizon) for (const m of q.months) h += b(m.lastFriday, m.label);
  h += '<span class="sep"></span>';
  for (const q of horizon) h += b(q.lastFriday, q.shortLabel);
  return `${h}</div>`;
}

/**
 * FR edit: Success Committed, Priority, FR status, and the status of the engineering issue it was
 * opened from (Tom, 2026-10-27: every EI status). ctx: { mcp, fr, issue?, golive, onDone, onIssueStatus }
 */
export async function startFrEdit(ctx) {
  const { mcp, fr, issue, golive, horizon = [], onDone, onIssueStatus } = ctx;
  if (!mcp) return toast('Writes need the live page in claude.ai.', 'bad');
  if (!isAllowed('fr', fr.id)) return toast('This FR has no Notion id.', 'bad');
  let sheet = openSheet(`<h3>${esc(fr.title || 'FR')}</h3><div class="srow muted">Reading the live values from Notion…</div>`);
  let cur;
  let ei = null;
  try {
    [cur, ei] = await Promise.all([readFrLive(mcp, fr.id), issue && isAllowed('issue', issue.id) ? readIssue(mcp, issue.id) : null]);
  } catch (err) { closeSheet(); return toast(errText(err), 'bad'); }
  sheet = openSheet(`
    <h3>${esc(cur.name || fr.title)}</h3>
    <label class="sfld">Committed date <span class="muted">(writes Success Committed)</span>
      <input id="sSc" type="date" value="${esc(cur.successCommitted || '')}"></label>
    ${dateChips(horizon, cur.successCommitted)}
    <label class="sfld">Priority
      <select id="sPr">${[cur.priority && !FR_PRIORITIES.includes(cur.priority) ? cur.priority : null, ...FR_PRIORITIES].filter(Boolean)
        .map((p) => `<option ${p === cur.priority ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select></label>
    <label class="sfld">Feature request status <span class="muted">(this FR in Customer Tasks, not the engineering issue)</span>
      <select id="sSt">${cur.status === FR_STATUS_CLOSE ? `<option selected>${esc(FR_STATUS_CLOSE)}</option>`
        : `<option value="" selected>Keep current: ${esc(cur.status || 'none')}</option><option value="${esc(FR_STATUS_CLOSE)}">${esc(FR_STATUS_CLOSE)} (close the FR)</option>`}</select></label>
    ${ei ? `<label class="sfld">Engineering issue status <span class="muted">(${esc(ei.name || issue.name || 'the issue')} in Bugs &amp; Features)</span>
      <select id="sEi">${[ei.status && !EI_STATUSES.includes(ei.status) ? ei.status : null, ...EI_STATUSES].filter(Boolean)
        .map((st) => `<option ${st === ei.status ? 'selected' : ''}>${esc(st)}</option>`).join('')}</select></label>` : ''}
    <div class="srow muted" id="sEff"></div>
    <label class="sfld">Comment <span class="muted" id="sOwner">(posted on the FR in Notion; looking up the Responsible Success…)</span>
      <textarea id="sCmt" rows="3" class="smsg" maxlength="1500" placeholder="Optional. What changed and why, or just a note to the owner"></textarea></label>
    <div class="sact"><button data-sheet-close>Cancel</button><button class="primary" id="sSave">Save</button></div>`);
  // Every save posts one comment on the FR that tags its Responsible Success (Tom, 2026-10-27):
  // the changes, then the comment. No owner: posted without a tag (never a fallback to Sales).
  let owner; let ownerErr = null;
  const ownerP = findOwner(mcp, fr.id).then((o) => { owner = o; }, (err) => { owner = null; ownerErr = errText(err); })
    .then(() => {
      const el = sheet.querySelector('#sOwner');
      if (el) el.textContent = owner ? `(posted on the FR in Notion, tags ${owner.name}${fr.id.replace(/-/g, '') === TEST_FR ? ', test FR: you' : ''})` : `(posted on the FR in Notion without a tag: ${ownerErr ? `owner lookup failed, ${ownerErr}` : 'no Responsible Success'})`;
    });
  const effLine = () => {
    const sc = sheet.querySelector('#sSc').value || null;
    const pr = sheet.querySelector('#sPr').value;
    const eff = effectiveCommitted({ successCommitted: sc, priority: pr, golive });
    sheet.querySelector('#sEff').innerHTML = `Committed will be <b>${fd(eff)}</b>${pr === 'Needed for go-live' && golive ? ` (earliest of this date and go-live ${fd(golive)})` : ''}.`;
  };
  sheet.addEventListener('input', effLine);
  // Month / quarter buttons fill the date with that period's last Friday, as the issue date buttons do.
  sheet.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-scdate]');
    if (!b) return;
    sheet.querySelector('#sSc').value = b.dataset.scdate;
    sheet.querySelectorAll('button[data-scdate]').forEach((x) => x.classList.toggle('cur', x === b));
    effLine();
  });
  effLine();
  sheet.querySelector('#sSave').addEventListener('click', async (e) => {
    const comment = sheet.querySelector('#sCmt').value.trim();
    busy(e.target, true, 'Saving…');
    try {
      const st = sheet.querySelector('#sSt').value;
      const r = await editFr(mcp, { fr, successCommitted: sheet.querySelector('#sSc').value || null, priority: sheet.querySelector('#sPr').value, status: st && st !== cur.status ? st : undefined, reason: comment });
      if (r.changes.length) onDone?.(r);
      const eiSel = sheet.querySelector('#sEi');
      let eiChange = null;
      if (eiSel && eiSel.value !== ei.status) {
        try {
          eiChange = (await setIssueStatus(mcp, { issue: { ...issue, name: ei.name || issue.name }, status: eiSel.value, reason: comment, updateId: r.updateId })).change;
        } catch (err) {
          closeSheet();
          return toast(`${r.changes.length ? 'FR saved, but the' : 'The'} engineering issue status was not saved: ${errText(err)}`, 'bad');
        }
        if (eiChange) onIssueStatus?.(issue, eiChange.after);
      }
      const all = eiChange ? [...r.changes, eiChange] : r.changes;
      if (!all.length && !comment) { closeSheet(); return toast('Nothing changed.'); }
      const done = () => onDone?.({ ...r, changes: all, commented: true, comment });
      busy(e.target, true, 'Posting comment…');
      await ownerP;
      const shown = all.map((c) => ({ ...c, before: c.field === 'Success Committed' ? fd(c.before) : c.before, after: c.field === 'Success Committed' ? fd(c.after) : c.after }));
      try {
        await adviseOwner(mcp, { fr: { ...fr, title: r.name || cur.name || fr.title }, owner, changes: shown, comment, updateId: r.updateId });
      } catch (err) {
        closeSheet();
        return toast(`${all.length ? 'Saved and logged, but the' : 'The'} comment was not posted: ${errText(err)}`, 'bad');
      }
      done();
      closeSheet();
      toast(`${all.length ? 'Saved. ' : ''}Comment posted${owner ? `, ${owner.name} tagged` : ' (no owner to tag)'}. Logged.`);
    } catch (err) {
      busy(e.target, false, 'Save');
      toast(errText(err), 'bad');
    }
  });
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
        <span><b>${esc(e.issue.name)}</b><span class="muted"> · ${e.fr ? 'FR, no engineering issue yet' : `${esc(e.issue.team || 'No team')} · ${e.frs.length} FR${e.frs.length === 1 ? '' : 's'}`}${e.issue.committed ? ` · commit ${fd(String(e.issue.committed).slice(0, 10))}` : ''}</span></span></label>`).join('')}
    </div>`).join('');
  const sheet = openSheet(`
    <h3>${ch.id.startsWith('U') ? 'Send' : 'Post'} to ${esc(ch.name)}</h3>
    <div class="srow muted">Tick the issues (or FRs with no engineering issue yet) to post. One post per issue (one line below = one post), as you, ${esc(target.how)}. Changing the selection rebuilds the text.</div>
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
