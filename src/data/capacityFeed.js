// Capacity feed (SPEC "Capacity math", Tom 2026-10-27): Sander's roadmap-changes-report skill runs the
// capacity planner's own engine daily and writes capacity per team × skill × week to a Notion table.
// The planner takes capacity from the latest run there, so it always matches the data app without
// engine exports. Demand stays with our engine copy (it matches). No feed, or a stale one: our own
// engine's capacity, with a warning.

// Notion data source of "Roadmap Planner Capacity" (created 2026-10-27 under "Roadmap Planner Audit logs").
export const CAPACITY_DS = 'f060b93c-ecf8-4254-9b1d-cf5fc55b4c2c';
export const FEED_MAX_AGE_DAYS = 3;
const SKILLS = new Set(['backend', 'frontend', 'mobile']);

export function feedQueryInput(ds = CAPACITY_DS) {
  const t = `collection://${ds}`;
  // Latest run only: every row whose Run equals the newest Run in the table.
  return { data: { data_source_urls: [t], params: [], query: `SELECT "Team", "Skill", "Weeks", "Engine", "date:Run:start" AS run FROM "${t}" WHERE "date:Run:start" = (SELECT MAX("date:Run:start") FROM "${t}")` } };
}

/** Query results → { run, engine, weeks: { teamId: { skill: { 'YYYY-MM-DD': days } } } } or null. */
export function parseFeed(results) {
  const rows = results || [];
  if (!rows.length) return null;
  const weeks = {};
  for (const r of rows) {
    const team = String(r.Team || '').trim();
    const skill = String(r.Skill || '').trim();
    if (!team || !SKILLS.has(skill)) continue;
    let w;
    try { w = JSON.parse(r.Weeks || '{}'); } catch { continue; }
    const clean = {};
    for (const [wk, d] of Object.entries(w)) if (/^\d{4}-\d{2}-\d{2}$/.test(wk) && Number.isFinite(+d)) clean[wk] = +d;
    (weeks[team] ||= {})[skill] = clean;
  }
  if (!Object.keys(weeks).length) return null;
  return { run: rows[0].run || null, engine: rows.find((r) => r.Engine)?.Engine || null, weeks };
}

export function feedAgeDays(feed, now = new Date()) {
  if (!feed?.run) return Infinity;
  return (now - new Date(feed.run)) / 86400000;
}

/**
 * Replace the run's capacity with the feed's, per team and skill present in the feed. Mutates and
 * returns run. Teams or skills the feed lacks keep our engine's numbers.
 */
export function applyFeed(run, feed) {
  if (!feed) return run;
  const cap = (run.computed.capWeekTeamSkill ||= {});
  for (const [team, skills] of Object.entries(feed.weeks)) {
    cap[team] ||= {};
    for (const [skill, weeks] of Object.entries(skills)) cap[team][skill] = { ...weeks };
  }
  run.capacitySource = { run: feed.run, engine: feed.engine };
  return run;
}
