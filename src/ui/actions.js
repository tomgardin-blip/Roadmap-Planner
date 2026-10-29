// Write flows in the UI: move an issue (date buttons), edit an FR (Success Committed, Priority),
// advise the FR's owner in Notion. All writes go through src/data/writer.js (test pages only).

import { formatDate, potQuarters, potMonths } from '../periods.js';
import { FR_PRIORITIES, FR_STATUS_DONE, FR_STATUS_WRITES, EI_STATUSES, REASONS, effectiveCommitted, goLiveDeadline, moveWarnings, isAllowed, TEST_FR } from '../notion/writes.js';
import { postEstimate, postRoadmap, askOwner, findSlackUser, moveIssue, editFr, readFrLive, readIssue, setIssueStatus, findOwner, adviseOwner, whoAmI, dismissPushback, postSlack } from '../data/writer.js';
import { ESTIMATE_TARGETS, estimateLines, estimatePosts } from '../estimate.js';
import { ROADMAP_CHANNEL, roadmapMessage, withMentions, askOwnerMessage } from '../roadmapPost.js';
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
  for (const m of potMonths(horizon)) h += b(m.lastFriday, m.label);
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
  const { mcp, fr, issue, golive, horizon = [], onDone, onIssueStatus, preset = null } = ctx;
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
      <select id="sSt"><option value="" selected>Keep current: ${esc(cur.status || 'none')}</option>${FR_STATUS_WRITES.filter((s) => s !== cur.status)
        .map((s) => `<option value="${esc(s)}">${esc(s)} (${s === FR_STATUS_DONE ? 'delivered' : 'close the FR'})</option>`).join('')}</select></label>
    ${ei ? `<label class="sfld">Engineering issue status <span class="muted">(${esc(ei.name || issue.name || 'the issue')} in Bugs &amp; Features)</span>
      <select id="sEi">${[ei.status && !EI_STATUSES.includes(ei.status) ? ei.status : null, ...EI_STATUSES].filter(Boolean)
        .map((st) => `<option ${st === ei.status ? 'selected' : ''}>${esc(st)}</option>`).join('')}</select></label>` : ''}
    <div class="srow muted" id="sEff"></div>
    <label class="sfld">Comment <span class="muted" id="sOwner">(posted on the FR in Notion; looking up the Responsible Success…)</span>
      <textarea id="sCmt" rows="3" class="smsg" maxlength="1500" placeholder="Optional. Posted on the FR as you write it, tagging the owner. Empty: no comment"></textarea></label>
    <div class="sact"><button data-sheet-close>Cancel</button><button class="primary" id="sSave">Save</button></div>`);
  // Data quality fixes open the sheet with the fix filled in (Tom, 2026-10-28); everything stays editable.
  if (preset) {
    if (preset.note) sheet.querySelector('h3').insertAdjacentHTML('afterend', `<div class="srow sfix">${esc(preset.note)}</div>`);
    if (preset.priority) sheet.querySelector('#sPr').value = preset.priority;
    if (preset.status && sheet.querySelector(`#sSt option[value="${CSS.escape(preset.status)}"]`)) sheet.querySelector('#sSt').value = preset.status;
    if (preset.comment) sheet.querySelector('#sCmt').value = preset.comment;
  }
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
export function startEstimatePost({ mcp, groups, target = ESTIMATE_TARGETS.productFeature, preselect = [], onPosted, posted = () => [] }) {
  const ch = target.channel;
  if (!mcp) return toast('Posting needs the live page in claude.ai.', 'bad');
  // Already posted? (Tom, 2026-10-29: to see whether the skill has run.) The latest post per channel, this channel first.
  const postedTag = (id) => {
    const latest = new Map();
    for (const p of posted(id)) if (!latest.has(p.channel)) latest.set(p.channel, p);
    if (!latest.size) return ' <span class="tag">Not posted yet</span>';
    return [...latest.values()].sort((a, b) => (b.channel === ch.name) - (a.channel === ch.name)).map((p) => {
      const t = `Posted ${p.channel === ch.name ? 'here' : `in ${esc(p.channel)}`} ${fd(String(p.at).slice(0, 10))}`;
      return ` <span class="tag ${p.channel === ch.name ? 'commit' : ''}">${p.link ? `<a href="${esc(p.link)}" target="_blank" rel="noopener" title="Open the Slack thread">${t} · open in Slack</a>` : t}</span>`;
    }).join('');
  };
  const list = groups.filter((g) => g.entries.length).map((g) => `
    <div class="pickgrp"><div class="pickhead"><b>${esc(g.label)}</b> <span class="muted">(${g.entries.length})</span>
      <button type="button" class="chip" data-pickall="${esc(g.label)}">All</button><button type="button" class="chip" data-picknone="${esc(g.label)}">None</button></div>
      ${g.entries.map((e) => `<label class="pickrow" data-grp="${esc(g.label)}"><input type="checkbox" data-pick="${e.issue.id}"${preselect.includes(e.issue.id) ? ' checked' : ''}>
        <span><b>${esc(e.issue.name)}</b><span class="muted"> · ${e.fr ? 'FR, no engineering issue yet' : `${esc(e.issue.team || 'No team')} · ${e.frs.length} FR${e.frs.length === 1 ? '' : 's'}`}${e.issue.committed ? ` · commit ${fd(String(e.issue.committed).slice(0, 10))}` : ''}</span>${postedTag(e.issue.id)}</span></label>`).join('')}
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
    // Each post is recorded on its issue or FR with the Slack link (Tom, 2026-10-29), found by the link in the line.
    const all = groups.flatMap((g) => g.entries);
    const itemOf = (msg) => { const en = all.find((x) => x.issue?.url && msg.includes(x.issue.url)); return en ? { id: en.issue.id, name: en.issue.name, fr: !!en.fr } : null; };
    // One message per issue, sent in order; stop at the first refusal and say how far it got.
    let unlogged = 0;
    for (let i = 0; i < posts.length; i++) {
      busy(e.target, true, `Posting ${i + 1}/${posts.length}…`);
      const item = itemOf(posts[i]);
      try {
        if (item) { const link = await postEstimate(mcp, { channel: ch, item, message: posts[i] }); onPosted?.({ item, link, channel: ch.name }); }
        else { await postSlack(mcp, ch.id, posts[i]); unlogged++; }
      } catch (err) {
        if (err?.code === 'audit_failed') { unlogged++; onPosted?.({ item, link: null, channel: ch.name }); continue; }
        busy(e.target, false, 'Post');
        const why = err?.code === 'tool_error' ? `Slack refused: ${err.message || 'no details'}` : explainError('Slack', err);
        return toast(`${i} of ${posts.length} posted. ${why}`, 'bad');
      }
    }
    closeSheet(); toast(`Posted ${posts.length} issue${posts.length === 1 ? '' : 's'} to ${ch.name}.${unlogged ? ` ${unlogged} without a saved link.` : ' Links shown on the cards.'}`);
  });
}

/**
 * Post in #roadmap_product about one engineering issue (Tom, 2026-10-27): the viewer's message, tagged to
 * the team's responsible, always ending with the issue link, planned start and end, and committed date.
 * ctx: { mcp, issue, lead: { name, id } | null }
 */
export function startRoadmapPost({ mcp, issue, lead, onDone, template = null, leads = [] }) {
  if (!mcp) return toast('Posting needs the live page in claude.ai.', 'bad');
  if (template != null) return startTemplatePost({ mcp, issue, onDone, template, leads });
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

/**
 * At risk dependency / blocked posts (Tom, 2026-10-28): the whole message is a template the viewer sees
 * and can edit before Send; "@Lead" names become real mentions. Logged like any #roadmap_product post.
 */
function startTemplatePost({ mcp, issue, onDone, template, leads }) {
  const who = leads.length ? leads.map((l) => esc(l.name)).join(' and ') : '';
  const sheet = openSheet(`
    <h3>Post in ${esc(ROADMAP_CHANNEL.name)}</h3>
    <div class="srow muted">Posted as you, in the channel${who ? `, tagging ${who}` : ', no team lead to tag'}. Edit the message if needed.</div>
    <label class="sfld">Message <textarea id="sRm" rows="11" class="smsg" maxlength="3500"></textarea></label>
    <div class="sact"><button data-sheet-close>Cancel</button><button class="primary" id="sSend">Send</button></div>`);
  const txt = sheet.querySelector('#sRm');
  txt.value = template;
  txt.addEventListener('input', () => { sheet.querySelector('#sSend').disabled = !txt.value.trim(); });
  sheet.querySelector('#sSend').addEventListener('click', () => {
    const message = withMentions(txt.value.trim(), leads);
    closeSheet();
    inBackground(`post in ${ROADMAP_CHANNEL.name}`, async () => {
      let link;
      try { link = await postRoadmap(mcp, { issue, message }); } catch (err) {
        if (err?.code === 'audit_failed') { onDone?.({ link: null }); throw fail(`Posted in ${ROADMAP_CHANNEL.name}, but its link was not saved: ${errText(err)}`, err); }
        throw fail(`Not posted in ${ROADMAP_CHANNEL.name}: ${err?.code === 'tool_error' ? `Slack refused: ${err.message || 'no details'}` : explainError('Slack', err)}`, err);
      }
      onDone?.({ link, message });
      return `Posted in ${ROADMAP_CHANNEL.name}${who ? `, ${leads.map((l) => l.name).join(' and ')} tagged` : ''}. Link shown next to the button.`;
    });
  });
}

/**
 * Pushback → "Ask COM/AM" (Tom, 2026-10-28): finds the FR's Responsible Success on Slack by email, shows the
 * friendly DM in full (editable), and sends it as the viewer on Send. ctx: { kind: 'over', quarterLabel, team } | { kind: 'late' }.
 */
export async function startAskOwner({ mcp, issue, fr, customer, email: emailIn, ctx, onDone }) {
  if (!mcp) return toast('Sending needs the live page in claude.ai.', 'bad');
  let sheet = openSheet('<h3>Ask the COM/AM</h3><div class="srow muted">Finding the Responsible Success…</div>');
  // The email can still be loading (Data quality looks it up on click).
  const email = await Promise.resolve(emailIn).catch(() => null);
  if (!email) { closeSheet(); return toast('This FR has no Responsible Success to ask.', 'bad'); }
  sheet = openSheet(`<h3>Ask the COM/AM</h3><div class="srow muted">Finding ${esc(email)} on Slack…</div>`);
  let user;
  try { user = await findSlackUser(mcp, email); } catch (err) {
    closeSheet();
    return toast(err?.code === 'not_in_manifest' || err?.code === 'approval_required' ? 'The page needs permission to look people up on Slack. Reload and allow it.' : `Slack lookup failed: ${explainError('Slack', err)}`, 'bad');
  }
  if (!user) { closeSheet(); return toast(`No Slack account found for ${email}.`, 'bad'); }
  const frLink = { name: fr.title || 'FR', url: fr.url, priority: fr.priority };
  sheet = openSheet(`
    <h3>Ask ${esc(user.name)}</h3>
    <div class="srow muted">A Slack DM to ${esc(user.name)} (${esc(email)}), as you. Edit it if needed.</div>
    <label class="sfld">Message <textarea id="sAsk" rows="7" class="smsg" maxlength="3000"></textarea></label>
    <div class="sact"><button data-sheet-close>Cancel</button><button class="primary" id="sSend">Send</button></div>`);
  const txt = sheet.querySelector('#sAsk');
  // ctx.kind 'text': a ready-made message (Data quality) with "@Owner" for the person.
  txt.value = ctx.kind === 'text' ? ctx.text.split('@Owner').join(`@${user.name}`) : askOwnerMessage({ ownerName: user.name, issue, fr: frLink, customer, ctx });
  txt.addEventListener('input', () => { sheet.querySelector('#sSend').disabled = !txt.value.trim(); });
  sheet.querySelector('#sSend').addEventListener('click', () => {
    const message = txt.value.trim();
    closeSheet();
    inBackground(`DM to ${user.name}`, async () => {
      let link;
      try { link = await askOwner(mcp, { user, issue, fr, message }); } catch (err) {
        if (err?.code === 'audit_failed') { onDone?.({ link: null }); throw fail(`Sent to ${user.name}, but its link was not saved: ${errText(err)}`, err); }
        throw fail(`Not sent to ${user.name}: ${err?.code === 'tool_error' ? `Slack refused: ${err.message || 'no details'}` : explainError('Slack', err)}`, err);
      }
      onDone?.({ link });
      return `Sent to ${user.name}. Link shown on the card.`;
    });
  });
}

/**
 * Data quality → Fix (Tom, 2026-10-28): the ways to solve one finding, as a list of choices. Each choice
 * opens the existing flow (FR edit, DM, post, status, dates), which writes and logs as usual.
 * options: [{ label, desc, run }]
 */
export function startChoice({ title, sub, options }) {
  const sheet = openSheet(`
    <h3>${esc(title)}</h3>
    ${sub ? `<div class="srow muted">${esc(sub)}</div>` : ''}
    <div class="fixopts">${options.map((o, i) => `<button type="button" class="fixopt" data-fixopt="${i}"><b>${esc(o.label)}</b>${o.desc ? `<span class="muted">${esc(o.desc)}</span>` : ''}</button>`).join('')}</div>
    <div class="sact"><button data-sheet-close>Cancel</button></div>`);
  sheet.addEventListener('click', (e) => {
    const b = e.target.closest('[data-fixopt]');
    if (!b) return;
    closeSheet();
    options[+b.dataset.fixopt].run();
  });
}

/** Set an engineering issue's Status on its own (Data quality, Tom 2026-10-28). Logged as "EI status changed". */
export async function startIssueStatus({ mcp, issue, note, onDone }) {
  if (!mcp) return toast('Writes need the live page in claude.ai.', 'bad');
  if (!isAllowed('issue', issue.id)) return toast('This issue has no Notion id.', 'bad');
  let sheet = openSheet(`<h3>${esc(issue.name)}</h3><div class="srow muted">Reading the live status from Notion…</div>`);
  let cur;
  try { cur = await readIssue(mcp, issue.id); } catch (err) { closeSheet(); return toast(errText(err), 'bad'); }
  sheet = openSheet(`
    <h3>${esc(cur.name || issue.name)}</h3>
    ${note ? `<div class="srow sfix">${esc(note)}</div>` : ''}
    <label class="sfld">Engineering issue status <span class="muted">(Bugs &amp; Features)</span>
      <select id="sEi">${[cur.status && !EI_STATUSES.includes(cur.status) ? cur.status : null, ...EI_STATUSES].filter(Boolean)
        .map((st) => `<option ${st === cur.status ? 'selected' : ''}>${esc(st)}</option>`).join('')}</select></label>
    <label class="sfld">Reason <span class="muted">(optional, audit log only)</span><input id="sReason" type="text" maxlength="200"></label>
    <div class="sact"><button data-sheet-close>Cancel</button><button class="primary" id="sSave">Save</button></div>`);
  sheet.querySelector('#sSave').addEventListener('click', () => {
    const status = sheet.querySelector('#sEi').value;
    const reason = sheet.querySelector('#sReason').value.trim();
    closeSheet();
    if (status === cur.status) return toast('Nothing changed.');
    onDone?.(issue, status); // shown at once
    inBackground(`"${issue.name}"`, async () => {
      try { await setIssueStatus(mcp, { issue, status, reason }); } catch (err) { throw fail(`Status not saved: ${errText(err)}. Refresh to see Notion's values.`, err); }
      return `Status set to ${status}. Logged.`;
    });
  });
}

/** Take an issue out of the plan: empty Start and End (Data quality, Tom 2026-10-28). Logged as a move. */
export function startClearDates({ mcp, issue, why, onDone }) {
  if (!mcp) return toast('Writes need the live page in claude.ai.', 'bad');
  if (!isAllowed('issue', issue.id)) return toast('This issue has no Notion id.', 'bad');
  const sheet = openSheet(`
    <h3>Take "${esc(issue.name)}" out of the plan</h3>
    <div class="srow">Clears Start and End (now ${fd(issue.start)} → ${fd(issue.end)}). It goes back to the unplanned backlog${issue.committed ? `; it stays committed for ${fd(String(issue.committed).slice(0, 10))}` : ''}.</div>
    ${reasonField()}
    <div class="sact"><button data-sheet-close>Cancel</button><button class="primary" id="sSave">Clear dates</button></div>`);
  wireReason(sheet);
  if (why) sheet.querySelector('#sReason').value = why;
  sheet.querySelector('#sSave').addEventListener('click', () => {
    const reason = sheet.querySelector('#sReason').value.trim();
    const was = { start: issue.start || null, end: issue.end || null };
    closeSheet();
    onDone?.({ before: was, after: { start: null, end: null } });
    inBackground(`"${issue.name}" out of the plan`, async () => {
      try { await moveIssue(mcp, { issue, start: null, end: null, reason }); } catch (err) {
        onDone?.({ before: { start: null, end: null }, after: was });
        throw fail(`"${issue.name}" not changed, put back: ${errText(err)}`, err);
      }
      return 'Dates cleared. Logged.';
    });
  });
}

/**
 * Bulk FR edit (Tom, 2026-10-29): the same edit as the FR sheet, applied to every ticked FR. Each field
 * starts on "Keep" so only what the viewer sets is written. One Notion write + audit rows per FR, and the
 * comment (when given) on each FR, tagging that FR's own Responsible Success. Runs in the background and
 * carries on past a failed FR, then says which failed.
 * ctx: { mcp, frs: [fr], horizon, onDone(fr, result), onFinished() }
 */
export function startBulkFrEdit({ mcp, frs, horizon = [], onDone, onFinished }) {
  if (!mcp) return toast('Writes need the live page in claude.ai.', 'bad');
  const list = frs.filter((f) => f && isAllowed('fr', f.id));
  if (!list.length) return toast('Nothing selected that can be edited.', 'bad');
  const sheet = openSheet(`
    <h3>Edit ${list.length} FR${list.length === 1 ? '' : 's'}</h3>
    <div class="picklist">${list.map((f) => `<div class="pickrow"><span><b>${esc(f.title || 'FR')}</b><span class="muted"> · ${esc(f.priority || 'No priority')}${f.committed ? ` · commit ${fd(String(f.committed).slice(0, 10))}` : ''}</span></span></div>`).join('')}</div>
    <div class="srow muted">Only the fields you change are written, the same on every FR. "Keep" leaves each FR as it is.</div>
    <label class="sfld">Priority
      <select id="bPr"><option value="" selected>Keep each FR's priority</option>${FR_PRIORITIES.map((p) => `<option>${esc(p)}</option>`).join('')}</select></label>
    <label class="sfld">Committed date <span class="muted">(writes Success Committed)</span>
      <select id="bScMode"><option value="keep" selected>Keep each FR's date</option><option value="set">Set to the date below</option><option value="clear">Clear it</option></select>
      <input id="sSc" type="date"></label>
    ${dateChips(horizon, null)}
    <label class="sfld">Feature request status
      <select id="bSt"><option value="" selected>Keep each FR's status</option>${FR_STATUS_WRITES.map((s) => `<option value="${esc(s)}">${esc(s)} (${s === FR_STATUS_DONE ? 'delivered' : 'close the FR'})</option>`).join('')}</select></label>
    <label class="sfld">Comment <span class="muted">(posted on each FR in Notion, tagging that FR's Responsible Success)</span>
      <textarea id="sCmt" rows="3" class="smsg" maxlength="1500" placeholder="Optional. Empty: no comment"></textarea></label>
    <div class="sact"><button data-sheet-close>Cancel</button><button class="primary" id="sSave">Save ${list.length}</button></div>`);
  const mode = sheet.querySelector('#bScMode');
  const date = sheet.querySelector('#sSc');
  date.addEventListener('input', () => { if (date.value) mode.value = 'set'; });
  sheet.addEventListener('click', (e) => {
    if (e.target.closest('button[data-scclear]')) { date.value = ''; mode.value = 'clear'; return; }
    const b = e.target.closest('button[data-scdate]');
    if (!b) return;
    date.value = b.dataset.scdate; mode.value = 'set';
    sheet.querySelectorAll('button[data-scdate]').forEach((x) => x.classList.toggle('cur', x === b));
  });
  sheet.querySelector('#sSave').addEventListener('click', () => {
    const want = {};
    const pr = sheet.querySelector('#bPr').value; if (pr) want.priority = pr;
    if (mode.value === 'set') { if (!date.value) return toast('Pick the committed date, or choose Keep.', 'bad'); want.successCommitted = date.value; }
    if (mode.value === 'clear') want.successCommitted = null;
    const st = sheet.querySelector('#bSt').value; if (st) want.status = st;
    const comment = sheet.querySelector('#sCmt').value.trim();
    if (!Object.keys(want).length && !comment) { closeSheet(); return toast('Nothing changed.'); }
    closeSheet();
    inBackground(`${list.length} FRs`, async () => {
      const failed = []; let changed = 0; let commented = 0;
      for (const fr of list) {
        try {
          const r = Object.keys(want).length ? await editFr(mcp, { fr, ...want, reason: comment }) : { changes: [] };
          if (r.changes.length) { changed++; onDone?.(fr, { changes: r.changes, before: r.before }); }
          if (comment) {
            const owner = await findOwner(mcp, fr.id).catch(() => null);
            await adviseOwner(mcp, { fr: { ...fr, title: r.name || fr.title }, owner, changes: r.changes || [], comment, updateId: r.updateId });
            commented++;
            onDone?.(fr, { changes: r.changes || [], commented: true, comment });
          }
        } catch (err) { failed.push(`${fr.title || 'FR'} (${errText(err)})`); }
      }
      onFinished?.();
      const done = `${changed} of ${list.length} FRs changed${comment ? `, ${commented} commented` : ''}. Logged.`;
      if (failed.length) throw fail(`${done} Failed: ${failed.join('; ')}. Refresh to see Notion's values.`);
      return done;
    });
  });
}
