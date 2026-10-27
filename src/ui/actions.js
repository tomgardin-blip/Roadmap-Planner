// Write flows in the UI: move an issue (date buttons), edit an FR (Success Committed, Priority),
// advise the FR's owner in Notion. All writes go through src/data/writer.js (test pages only).

import { formatDate, potQuarters } from '../periods.js';
import { FR_PRIORITIES, FR_STATUS_CLOSE, EI_STATUSES, REASONS, effectiveCommitted, goLiveDeadline, moveWarnings, isAllowed, TEST_FR } from '../notion/writes.js';
import { postRoadmap, moveIssue, editFr, readFrLive, readIssue, setIssueStatus, findOwner, adviseOwner, whoAmI, dismissPushback, postSlack } from '../data/writer.js';
import { ESTIMATE_TARGETS, estimateLines, estimatePosts } from '../estimate.js';
import { ROADMAP_CHANNEL, roadmapMessage } from '../roadmapPost.js';
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

// Saves run in the background (Tom, 2026-10-27): Save closes the window at once, the planner shows the
// change straight away, and a "Saving…" toast stays up while Notion writes; then a done or error toast.
let pending = 0;
async function inBackground(label, job) {
  pending++;
  toast(`Saving${pending > 1 ? ` ${pending} changes` : ''}… ${label}`, 'busy');
  try {
    const msg = await job();
    pending--;
    toast(pending ? `${msg} Still saving ${pending}…` : msg, pending ? 'busy' : '');
  } catch (err) {
    pending--;
    toast(err?.bgMessage || errText(err), 'bad');
  }
}
const fail = (bgMessage, cause) => Object.assign(new Error(bgMessage), { bgMessage, cause });

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
  sheet.querySelector('#sSave').addEventListener('click', () => {
    const reason = sheet.querySelector('#sReason').value.trim();
    const was = { start: issue.start || null, end: issue.end || null };
    closeSheet();
    onDone?.({ before: was, after: { start: date, end: date } }); // shown at once
    inBackground(`"${issue.name}" to ${fd(date)}`, async () => {
      try {
        const r = await moveIssue(mcp, { issue, start: date, end: date, reason, blockers });
        return `Moved to ${fd(date)}. Was ${fd(r.before.start)} → ${fd(r.before.end)}. Logged.`;
      } catch (err) {
        onDone?.({ before: { start: date, end: date }, after: was }); // put it back
        throw fail(`"${issue.name}" was not moved, put back: ${errText(err)}`, err);
      }
    });
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
  sheet.querySelector('#sSave').addEventListener('click', () => {
    const reason = sheet.querySelector('#sReason').value.trim();
    const was = ok.map(({ issue }) => ({ issue, r: { after: { start: issue.start || null, end: issue.end || null } } }));
    closeSheet();
    onDone?.(ok.map(({ issue }) => ({ issue, r: { after: { start: date, end: date } } }))); // shown at once
    inBackground(`${ok.length} issue${ok.length === 1 ? '' : 's'} to ${fd(date)}`, async () => {
      for (let i = 0; i < ok.length; i++) {
        try {
          await moveIssue(mcp, { issue: ok[i].issue, start: date, end: date, reason, blockers: ok[i].blockers });
        } catch (err) {
          onDone?.(was.slice(i)); // the ones not saved go back
          throw fail(`${i} of ${ok.length} moved. Stopped at "${ok[i].issue.name}", the rest put back: ${errText(err)}`, err);
        }
      }
      return `Moved ${ok.length} issue${ok.length === 1 ? '' : 's'} to ${fd(date)}. Each logged.`;
    });
  });
}

/** Month and quarter buttons for a date field (same dates as the issue date buttons). */
function dateChips(horizon, current) {
  if (!horizon.length) return '';
  const b = (d, label) => `<button type="button" class="${d === current ? 'cur' : ''}" data-scdate="${d}" title="${fd(d)}">${esc(label)}</button>`;
  let h = '<div class="datebtns">';
  for (const q of horizon) for (const m of q.months) h += b(m.lastFriday, m.label);
  h += '<span class="sep"></span>';
  for (const q of potQuarters(horizon)) h += b(q.lastFriday, q.shortLabel);
  // Clear the committed date (Tom, 2026-10-27): writes an empty Success Committed.
  h += '<span class="sep"></span><button type="button" data-scclear title="Clear Success Committed">Clear</button>';
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
      <textarea id="sCmt" rows="3" class="smsg" maxlength="1500" placeholder="Optional. Posted on the FR as you write it, tagging the owner. Empty: no comment"></textarea></label>
    <div class="sact"><button data-sheet-close>Cancel</button><button class="primary" id="sSave">Save</button></div>`);
  // A save with a comment posts it on the FR, tagging its Responsible Success (Tom, 2026-10-27): only
  // the tag and Tom's text, no list of changes. Empty comment: nothing posted. No owner: no tag.
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
    const dl = goLiveDeadline(pr, golive);
    sheet.querySelector('#sEff').innerHTML = `Committed will be <b>${fd(eff)}</b>${dl ? ` (earliest of this date and ${pr === 'Needed for go-live' ? '7 days' : 'one month'} before go-live ${fd(golive)}: ${fd(dl)})` : ''}.`;
  };
  sheet.addEventListener('input', effLine);
  // Month / quarter buttons fill the date with that period's last Friday, as the issue date buttons do.
  sheet.addEventListener('click', (e) => {
    if (e.target.closest('button[data-scclear]')) {
      sheet.querySelector('#sSc').value = '';
      sheet.querySelectorAll('button[data-scdate]').forEach((x) => x.classList.remove('cur'));
      effLine(); return;
    }
    const b = e.target.closest('button[data-scdate]');
    if (!b) return;
    sheet.querySelector('#sSc').value = b.dataset.scdate;
    sheet.querySelectorAll('button[data-scdate]').forEach((x) => x.classList.toggle('cur', x === b));
    effLine();
  });
  effLine();
  sheet.querySelector('#sSave').addEventListener('click', () => {
    const comment = sheet.querySelector('#sCmt').value.trim();
    const st = sheet.querySelector('#sSt').value;
    const want = { successCommitted: sheet.querySelector('#sSc').value || null, priority: sheet.querySelector('#sPr').value, status: st && st !== cur.status ? st : undefined };
    const eiSel = sheet.querySelector('#sEi');
    const eiWant = eiSel && eiSel.value !== ei.status ? eiSel.value : null;
    // The same changes editFr will write, worked out from the values read when the sheet opened.
    const local = [];
    if (want.successCommitted !== cur.successCommitted) local.push({ field: 'Success Committed', category: 'FR committed changed', label: 'Committed', before: cur.successCommitted, after: want.successCommitted });
    if (want.priority !== cur.priority) local.push({ field: 'Priority', category: 'FR priority changed', label: 'Priority', before: cur.priority, after: want.priority });
    if (want.status !== undefined) local.push({ field: 'Status', category: 'FR status changed', label: 'Status', before: cur.status, after: want.status });
    if (!local.length && !eiWant && !comment) { closeSheet(); return toast('Nothing changed.'); }
    closeSheet();
    // Shown at once.
    if (local.length) onDone?.({ changes: local, before: cur });
    if (eiWant) onIssueStatus?.(issue, eiWant);
    if (comment) onDone?.({ changes: local, commented: true, comment });
    inBackground(`"${cur.name || fr.title}"`, async () => {
      let r;
      try { r = await editFr(mcp, { fr, ...want, reason: comment }); } catch (err) { throw fail(`FR not saved: ${errText(err)}. Refresh to see Notion's values.`, err); }
      let eiChange = null;
      if (eiWant) {
        try {
          eiChange = (await setIssueStatus(mcp, { issue: { ...issue, name: ei.name || issue.name }, status: eiWant, reason: comment, updateId: r.updateId })).change;
        } catch (err) { throw fail(`${r.changes.length ? 'FR saved, but the' : 'The'} engineering issue status was not saved: ${errText(err)}. Refresh to see Notion's values.`, err); }
      }
      const all = eiChange ? [...r.changes, eiChange] : r.changes;
      if (!comment) return all.length ? 'Saved and logged. No comment posted (empty).' : 'Nothing changed in Notion.';
      await ownerP;
      const shown = all.map((c) => ({ ...c, before: c.field === 'Success Committed' ? fd(c.before) : c.before, after: c.field === 'Success Committed' ? fd(c.after) : c.after }));
      try {
        await adviseOwner(mcp, { fr: { ...fr, title: r.name || cur.name || fr.title }, owner, changes: shown, comment, updateId: r.updateId });
      } catch (err) { throw fail(`${all.length ? 'Saved and logged, but the' : 'The'} comment was not posted: ${errText(err)}`, err); }
      return `${all.length ? 'Saved. ' : ''}Comment posted${owner ? `, ${owner.name} tagged` : ' (no owner to tag)'}. Logged.`;
    });
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
  sheet.querySelector('#sSave').addEventListener('click', () => {
    const reason = sheet.querySelector('#sReason').value.trim();
    closeSheet();
    onDone?.({ reason }); // off the list at once
    inBackground(`"${fr.title || 'FR'}"`, async () => {
      try { await dismissPushback(mcp, { fr, issue, reason }); } catch (err) { throw fail(`Not logged: ${errText(err)}. It comes back on the next refresh.`, err); }
      return 'Logged as not a pushback.';
    });
  });
}

/**
 * Pick which "No estimate" issues to post (none ticked by default, Tom 2026-10-10), preview and
 * edit the text, then post to Slack as the viewer. groups: [{ label, entries: [{ issue, frs }] }].
 */
export function startEstimatePost({ mcp, groups, target = ESTIMATE_TARGETS.productFeature, preselect = [] }) {
  const ch = target.channel;
  if (!mcp) return toast('Posting needs the live page in claude.ai.', 'bad');
  const list = groups.filter((g) => g.entries.length).map((g) => `
    <div class="pickgrp"><div class="pickhead"><b>${esc(g.label)}</b> <span class="muted">(${g.entries.length})</span>
      <button type="button" class="chip" data-pickall="${esc(g.label)}">All</button><button type="button" class="chip" data-picknone="${esc(g.label)}">None</button></div>
      ${g.entries.map((e) => `<label class="pickrow" data-grp="${esc(g.label)}"><input type="checkbox" data-pick="${e.issue.id}"${preselect.includes(e.issue.id) ? ' checked' : ''}>
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
  if (preselect.length) rebuild();
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

/**
 * Post in #roadmap_product about one engineering issue (Tom, 2026-10-27): the viewer's message, tagged to
 * the team's responsible, always ending with the issue link, planned start and end, and committed date.
 * ctx: { mcp, issue, lead: { name, id } | null }
 */
export function startRoadmapPost({ mcp, issue, lead, onDone }) {
  if (!mcp) return toast('Posting needs the live page in claude.ai.', 'bad');
  const sheet = openSheet(`
    <h3>Post in ${esc(ROADMAP_CHANNEL.name)}</h3>
    <div class="srow muted">${esc(issue.name)} · posted as you, in the channel${lead ? `, tagging ${esc(lead.name)} (${esc(issue.team || '')})` : ', no team so no tag'}.</div>
    <label class="sfld">Your message <textarea id="sRm" rows="4" class="smsg" maxlength="2500" placeholder="e.g. This still sits on the Jan pot but is committed for 15/01. Can we plan a week for it?"></textarea></label>
    <div class="sfld">Always added at the end</div>
    <div class="squote" id="sRmPrev"></div>
    <div class="sact"><button data-sheet-close>Cancel</button><button class="primary" id="sSend" disabled>Post</button></div>`);
  const txt = sheet.querySelector('#sRm');
  const draw = () => {
    sheet.querySelector('#sRmPrev').textContent = roadmapMessage(txt.value, issue, lead, { preview: true });
    sheet.querySelector('#sSend').disabled = !txt.value.trim();
  };
  txt.addEventListener('input', draw); draw(); txt.focus();
  sheet.querySelector('#sSend').addEventListener('click', () => {
    const message = roadmapMessage(txt.value, issue, lead);
    closeSheet();
    inBackground(`post in ${ROADMAP_CHANNEL.name}`, async () => {
      let link;
      try { link = await postRoadmap(mcp, { issue, message }); } catch (err) {
        if (err?.code === 'audit_failed') { onDone?.({ link: null }); throw fail(`Posted in ${ROADMAP_CHANNEL.name}, but its link was not saved: ${errText(err)}`, err); }
        throw fail(`Not posted in ${ROADMAP_CHANNEL.name}: ${err?.code === 'tool_error' ? `Slack refused: ${err.message || 'no details'}` : explainError('Slack', err)}`, err);
      }
      onDone?.({ link, message });
      return `Posted in ${ROADMAP_CHANNEL.name}${lead ? `, ${lead.name} tagged` : ''}. Link shown next to the button.`;
    });
  });
}
