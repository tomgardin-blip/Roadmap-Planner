# Roadmap Planner: build spec

Oct 9, 2026 · Tom Gardin

## TL;DR

- **What:** a working tool to plan engineering issues into quarters and months against FE/BE/MOB capacity, for 4 teams, with instant write-back to Notion.
- **Why:** today the plan lives in Tom's head and a dozen Notion views. The Lightdash Engineering capacity planner shows the picture but you can't work in it.
- **Who:** Tom now, Product from 2027. Read-only view for product owners and COMs/AMs later.
- **Build path:** built in Claude Code with a repo and tests, visual style copied from Liam's Go Live Schedule artifact. Published as a claude.ai artifact with the `mcp` capability so it can read and write Notion through connectors (tested and confirmed on 2026-10-09).

## Goals and scope

The tool keeps every quarter full and on capacity per team and per skill, protects committed dates, and makes every planning decision visible.

- **Teams in scope:** Transport Planning, Order + Invoice, Trip Execution, Application Platform. All other teams (connectors, Integration Hub, PS, SRE, AI, BI) are out.
- **Skills in scope:** frontend, backend, mobile. AI and BI effort is ignored in the puzzle.
- **Horizon:** current quarter and next quarter kept tight; the quarter after is the pot.
- **End state:** the tool suggests and eventually optimises the plan, e.g. "move these 2 non-committed issues to Q2 and these 3 higher-demand issues fit in Q1".
- **Handover:** Product takes this over in 2027, so every rule in Tom's head must be explicit in the tool, not tribal knowledge.

## Planning rules

Committed dates drive the plan; GO LIVE dates never do directly.

**Committed dates**

- Committed date = deadline. Derived per FR: Success Committed date if set, else GO LIVE minus 1 week (Needed for go-live) or minus 1 month (Needed 1 month before).
- An eng issue's committed date = earliest committed date across its linked open FRs.
- Committed dates are non-negotiable unless the request is niche or unreasonable. Then the options are: priority to Needed after go-live, or the customer postpones GO LIVE (last resort).
- Top 3 FRs can also carry a committed date when we had to commit to a customer.

**Where an issue lands**

- No eng issue or no estimate = not plannable. It goes to the prep queues, never the grid.
- Placeholder dates: Start = End = last Friday of the month or quarter. Bank holidays don't matter. Engineers set real dates about 2 weeks before the quarter starts.
- No committed date: plan on a quarter (last Friday of the quarter).
- With committed date: plan on a month, 1 to 2 months before the commit where possible. Delivering 1 day before GO LIVE is a risk.
- Eng issue Priority (High / Medium / Low) on non-committed issues = early vs late in the quarter.

**Horizon**

- Current quarter: must not exceed capacity.
- Next quarter: stays near capacity because COMs/AMs share these dates with customers. No 500-day overbooking that gets dumped later.
- Quarter after: the pot. Everything that must happen lands there, then gets distributed. Pot is corrected to capacity about mid-quarter (last done mid September 2026).

**Capacity**

- Target 100% per team per skill. 1 to 2 days over or under is fine; 10 days is a problem.
- Capacity comes from the Lightdash planner's own engine (`vendor/capacity-engine.js`, Sander De Wilde), used unchanged. Decided 2026-10-09. What it does:
  - Per engineer per week: (5 working days × part-time % × ramp − holiday days that week) × 0.6. About 3 days per full-time engineer per week, about 13 per month. (This replaces the earlier "10 per month" assumption, which was wrong.)
  - Ramp for joiners: ⅓ in their first month, ⅔ in the second, then full. People who started before July 2026 count as fully ramped.
  - Team leads carry 0 capacity.
  - Engineers with several skills are split pro rata (FE 1 + MOB 1 = 50/50).
  - Holidays: planned "Holidays 🌴" issues in their week, plus the year's unspent allowance (default 26 days) spread over the remaining future months.
  - A week counts in the month of its Friday. The current quarter counts from the current week only.
  - Load goes to the assignee's team first; the Team property only routes unassigned issues. An issue with Team = Transport Planning assigned to a Connectors engineer counts against Connectors.
  - Issues with Start = End are the quarter "pot": they count at quarter level, never in a month, whether committed or not.
  - "TBD": committed issues with no Start and no End count in the quarter of their effective committed date (earliest of the issue's own date, its customer tasks' dates and the issues it blocks). Overdue ones count in the current quarter; ones beyond the 3 visible quarters are left out.
  - Firefighting without a skill is a team-level drain in the planner. It has no skill, so it is not in our per-skill cells.
- Capacity is a constant job: estimates grow mid-quarter (5 to 15 days happens), dependencies surface, issues move. The tool must make each change visible.

**Dependencies**

- An issue can't be planned before the issue in its "Blocked by" relation.

## Scoring and prioritisation

Each eng issue gets a score: demand from its linked FRs divided by FE+BE+MOB effort. The score ranks what to pull forward, what to push out, and which Top 3 issues to plan.

**Score formula (v1 default, tunable in the tool)**

- Demand = sum over linked open FRs of (priority weight × customer revenue multiplier).
- Score = demand ÷ (Effort FE + Effort BE + Effort MOB). No effort = unscored (not ranked). Effort but no weighted FRs = score 0.
- Feature development is free for customers, so there is no cost term. Customer revenue does count.

| FR priority | Weight |
| --- | --- |
| Needed 1 month before | 10 |
| Needed for go-live | 10 |
| Top 3 | 5 |
| High | 3 |
| Medium | 2 |
| Low | 1 |
| Needed after go-live, No longer needed, Won't do | 0 |

| Customer deal size (GBP) | Revenue multiplier |
| --- | --- |
| Under 25k | ×1 |
| 25k to 75k | ×1.5 |
| 75k and over | ×2 |

Needed 1 month before is more urgent than Needed for go-live, but the committed date already captures that. Both carry weight 10.

**Top 3 planning**

- Replaces the current "5+ linked FRs" rule.
- High score + low effort = quick-win fillers. These fill the last few days of a quarter and are first to move out when a quarter overbooks.
- Quick wins are shown as their own list, apart from the main ranking (decided 2026-10-10): a tiny issue with one go-live FR scores high by design, and whether it is worth doing needs Tom's judgment. Main ranking = scored issues above the effort cut-off, plus every score-0 issue at the bottom. Quick wins = score above 0 at or under the cut-off.

**Pushback candidates**

Committed FRs ranked by how easy they are to challenge with the COM/AM. Signals, strongest first:

- **In previous TMS** (Customer Tasks): "Not available in previous TMS" = a new wish, easier to push back. "Available in previous TMS" = likely a real blocker.
- Few other customers want it (low linked FR count on the eng issue).
- High effort.
- Smaller customer deal size.
- Niche wording or single-customer configuration.

The ranking is a suggestion. The planner overrides it, and every override is logged with a reason so Product can learn Tom's judgment.

## Features and screens

The main screen is the capacity puzzle; everything else feeds it or warns about it.

**1. Capacity grid (main screen)**

- Rows: 4 teams × FE / BE / MOB. Columns: current quarter, next quarter, pot, each split into its 3 months.
- Columns per quarter: 3 months, the pot, the quarter total. Matches the Lightdash planner exactly (decided 2026-10-09, replaces the earlier "spread ⅓ per month" decision).
  - Month: dated work (Start ≠ End) spread over its working days.
  - Pot: every issue with Start = End, at quarter level, including committed issues placed on a month's last Friday.
  - TBD: committed issues with no dates (see Capacity).
  - Total: months + pot + TBD against the quarter's capacity, as the planner's quarter cards.
- Each cell: planned days vs capacity. Quarter totals: green within ±2 days, amber to ±5, red beyond.
- Month cells are neutral (no colour): with pot work at quarter level, month load alone says little. Only quarter totals are coloured. Decided 2026-10-09, replaces the earlier "scaled month thresholds".
- Click a cell: the issues in it, sorted by committed date then score.
- Overbooked cell: suggested issues to push out (lowest score, no commit, quick-win fillers first). Underbooked cell: suggested issues to pull forward (highest score that fits).

**2. Date buttons on every issue**

- One button per month (Oct, Nov, Dec, Jan…) and per quarter (Q4, Q1, Q2).
- Sets Start = End = last Friday of that month or quarter and writes to Notion instantly.
- Disabled with a warning when the target is after the committed date or before a "Blocked by" issue.
- Every move asks for a short reason (one click for common ones: commit moved, estimate grew, capacity, dependency).

**3. Prep queues (per priority: Required for GO LIVE, Top 3)**

- No eng issue: FRs needing Product to create or link one.
- No estimate: eng issues without FE/BE/MOB effort. v2: a button that posts the list to #dev_effort_estimate.
- Not planned: estimated, not on the grid. The to-do list.

**4. At risk**

- Planned after the committed date.
- Committed date, not planned.
- Committed date, status Blocked/on hold.
- Effort grew 50% or more on a committed issue this quarter.
- Dependency planned in the wrong order ("Blocked by" issue ends later).
- No team set, so invisible in capacity.
- Effort is a Claude estimate not yet reviewed (status "Claude - to review"), especially with low confidence.

**5. Pushback candidates:** ranked list (see Scoring), with the COM/AM to contact.

**6. Change history**

- Every planner move: who, when, what, before/after, reason.
- Changes made directly in Notion: picked up from the daily snapshots and flagged "no reason given".
- Per quarter: what changed its load this week and by how much.

**7. Optimizer (v3)**

- Proposes a full set of moves that maximises total score within capacity, respecting commits and dependencies. The planner accepts or rejects each move.

**8. Read-only view (v2)** for product owners and COMs/AMs: priority list and planned month per issue.

## Data sources and field names

The Lightdash dataset behind the Engineering capacity planner already holds the full puzzle input; Notion is the live layer and the write target.

**Lightdash** (project `d4d21d1b-488b-4ff0-8a1e-a621c498c932`)

| Explore / field | What it holds | Used for |
| --- | --- | --- |
| `serve_engineering_capacity_features` | JSON array per open feature: id, title, url, type, status, team (29), effort FE (15), BE (14), MOB (30), start (24), end (25), committed_date (26), priority (33), blocked_by ids (11), customer task ids (12), _extracted_at (28) | Grid, scoring, at risk, dependencies |
| `serve_engineering_capacity_customer_tasks` | JSON array per open FR: id, url, title, type, priority (4), status, deals extract id (6), feature ids (7), committed_date (8) | Demand, committed dates, prep queues |
| `serve_engineering_capacity_engineering_team_allocations` | Per engineer: team, part_time_pct, capacity fractions per skill (FE 9, BE 7, MOB 11), start/end, holiday budget 2026/2027 | Capacity per team per skill |
| `serve_engineering_capacity_deals` | Per deal: id, company name, status, go_live_date | Customer names, GO LIVE |
| `serve_engineering_capacity_is_default` | TRUE row = planned or committed items; FALSE row = the rest | Fetch TRUE first, then FALSE |
| `deals_extract_onboarding_deal_size_gbp` | Deal size in GBP | Revenue multiplier |
| `int_engineering_features_committed_date` | Recomputed committed date per feature | Cross-check |

Numbers in brackets are positions in the JSON arrays as seen on 2026-10-09. Verify them against the live data before relying on them. Capacity math must match the existing Lightdash capacity planner so both tools show the same number.

**Notion**

| Data source | Collection | Fields used |
| --- | --- | --- |
| Bugs and Feature development | `collection://18fe3fdb-2a33-4c08-b93c-7fd34931ee01` | Name, Team, Status, Priority, Effort FE / BE / MOB, Start, End, Blocked by, All customer requests, Type, Sub-task |
| Customer Tasks | `collection://0d55b141-941e-473a-9240-4983e8790f92` | Task, Type, Priority, Status, Engineering feature, Company, Success Committed, In previous TMS |

Notion gotchas:

- "Committed", "Effort (days total)", "Nr cust requests", "Go-live" and "Deal size" are formulas or rollups and can't be queried via SQL. Take them from Lightdash.
- Parent tasks carry no effort; effort sits on sub-tasks. Use issues without sub-tasks for capacity, as the current Q views do.
- Exclude Type "Holidays" and "Capacity placeholder" from issue lists, but check how the Lightdash planner treats them in capacity.
- Write format for dates: `date:Start:start` and `date:End:start` as ISO dates (pattern proven in Liam's Go Live Schedule).

**Test issue**

- "Test Tom - ignore": https://app.notion.com/p/qargo/Test-Tom-ignore-3f4e32e8f8c880ef9c6dc3a0c44b1af1 (page ID `3f4e32e8-f8c8-80ef-9c6d-c3a0c44b1af1`), team Application Platform, no customer links, no effort.
- All write-back testing happens on this issue only, until Tom explicitly approves writing to real issues. Only Start and End are written; never effort, team or status.

**History**

- Daily dbt snapshots in `qargo-internal-bi.internal_bi_snapshots` (from 2026-10-06), used by Sander De Wilde's `roadmap-changes` skill. Daily cadence: same-day changes and reverts are invisible.
- Planner writes its own audit log (who, when, before, after, reason), same pattern as Liam's History database.

## Architecture and build path

Read the model from Lightdash, overlay live Notion, write to Notion, log every write.

**Data flow**

1. On open: load the full model from Lightdash (features, FRs, allocations, deals, deal size).
2. Then read live from Notion every issue edited since Lightdash's last sync (the latest `_extracted_at` in the loaded rows), and patch Start, End, Effort FE/BE/MOB, Team and Status onto the Lightdash rows before the engine runs. Lightdash is a synced copy and lags; Notion values win. Decided 2026-10-09: "edited since the sync" instead of "all issues in the 3 visible quarters", because unedited issues already match Lightdash and the edited set also catches issues moved into or out of the window.
   - An empty effort counts as 0 on both sides (Lightdash stores 0, Notion null).
   - Issues edited in Notion that the loaded Lightdash rows don't have (new since the sync) are added when they have a date, routed by their Team property.
   - Not overlaid: Assigned to (Notion returns user ids, the engine routes by email), committed dates and customer links (formulas and rollups, Lightdash only). Load routing follows Lightdash's assignees until the next sync.
   - Every changed issue shows a "Live from Notion" tag with before → after. If Notion fails, the grid stays on Lightdash with a banner naming the fix.
3. A date button writes Start/End to Notion, updates the grid immediately, and writes an audit row.
4. A failed write retries, then queues in the browser with a visible banner until it lands (Liam's pattern).

**Build path**

1. **No separate design step.** Copy colours, typography and components from Liam's Go Live Schedule (skill `success:go-live-schedule-artifact`), not its single-file structure. Start with a static grid on fake data and iterate on layout before wiring data.
2. **Claude Code:** source in a GitHub repo, scoring and capacity logic split into testable functions with tests against real data. Bundled into one HTML file only at publish time.
3. **Publish from Claude Code** as a claude.ai artifact with the `mcp` capability for Notion and Lightdash. Confirmed working on 2026-10-09 with a read-only test.
4. **Skill per release:** a planner skill (like `go-live-schedule-artifact`) that installs, updates and republishes, with a changelog.

**Reuse, don't rebuild**

- Capacity math: from the Lightdash capacity planner.
- Committed date logic: from `int_customer_tasks` / `int_engineering_features`.
- Change detection: from Sander's snapshots and `roadmap-changes` definitions (can defer, must pull forward, committed not planned).

## Phasing

v1 replaces the Notion views for weekly planning; v2 opens it to others; v3 suggests the plan.

| Phase | Scope | Done when | Owner | Date |
| --- | --- | --- | --- | --- |
| v1 | Capacity grid, date buttons with write-back, prep queues, at-risk panel, dependency check, planner audit log, scoring | Tom runs a full weekly planning session without opening the Notion Q views | Tom | TBD |
| v2 | Estimate button to #dev_effort_estimate, pushback candidates, history from snapshots, read-only view for Product and COMs/AMs | Product owners use the read-only priority list | Tom | TBD |
| v3 | Optimizer proposing move sets within capacity | Tom accepts most proposed moves in a weekly session | Tom, then Product | TBD |

## Open questions and risks

**Open questions**

- [x] Can Claude Code publish to the claude.ai artifact runtime with `mcp`? Yes, confirmed 2026-10-09.
- [ ] How often does the Lightdash capacity dataset refresh? Decides how much the live Notion overlay must cover.
- [x] Who owns the capacity planner's math? Sander De Wilde. We use his engine file unchanged and swap in each new export.
- [x] How does the planner app build `emailToName`, `settings` and `config.teams`? Confirmed from Sander's app export (9 Oct 2026): email → title, `{daysPerMonth: 10.2, horizon: 12, startMonth: '2026-07'}`, `buildTeams(allocation, TEAM_DISPLAY_ORDER)`. Copied into `src/capacity.js`.
- [x] Engine version: the app export of 9 Oct 2026 carries the same engine file as the 27 Aug export (byte-identical).
- [x] The default Lightdash row with customer tasks and deals is about 2.6 MB. Loads through the artifact's `mcp` capability (test publish, confirmed 2026-10-10).
- [x] Scoring decisions (2026-10-10): every task type counts as an FR; each FR counts, also several from one customer on the same issue; FRs on a parent do not count for its sub-tasks; a customer with no deal size counts ×1 (rare). Only issues of the 4 teams with FE/BE/MOB effort are scored.
- [x] The full backlog (non-default Lightdash rows, about 6 MB) loads on demand, not on open.
- [x] Quick wins: effort cut-off 2 days total (FE+BE+MOB), confirmed 2026-10-10. Option `quickWinMaxEffort`.
- [ ] Where does the planner audit log live: a new Notion database, or the artifact's own storage?
- [ ] Should a move of a committed issue past its commit be blocked, or allowed with a mandatory reason?

**Risks**

- **Unreviewed Claude estimates flood demand.** 29 of 31 effort changes on 6 to 8 Oct 2026 were first-time estimates, +134 days, many "Claude - to review". Low-confidence estimates are where 5 to 15 day blowups come from.
- **Edits outside the planner.** Others moving dates in Notion stay invisible until the next daily snapshot.
- **Issues with no team.** They carry effort but don't count in any team's capacity (example: Rates JSONata rework, 50 days, no team, committed 26 Oct 2026, planned to end 25 Dec 2026).
- **Single-person knowledge.** Pushback judgment is gut feel today; without logged reasons Product inherits a tool but not the judgment.
