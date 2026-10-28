# Roadmap Planner: standing rules

A claude.ai artifact (published with the `mcp` capability) for planning engineering issues into months and quarters against FE/BE/MOB capacity for 4 teams, with instant write-back to Notion.

## Source of truth
- `SPEC.md` is the source of truth. Read it fully before any work.
- When a decision changes, update `SPEC.md` in the same commit.
- If `SPEC.md` is unclear, wrong or silent on something, ask Tom. Never fill a gap with a plausible assumption.

## Visual style
- Copy colours, typography and components from Liam's Go Live Schedule (skill `success:go-live-schedule-artifact`).
- Do NOT copy its single-file structure.

## Code structure
- Separate modules: data loading, capacity math, scoring, at-risk rules, Notion writes, UI.
- Bundle into one HTML file only at publish time.

## Capacity math
- Must match the Lightdash Engineering capacity planner exactly.
- Verify per team and per skill (FE/BE/MOB) against Lightdash before trusting our numbers.

## Notion writes
- All issues and FRs are writable since Tom approved it on 2026-10-10 ("unlock all"), within the field limits below. Test pages for trying things: issue "Test Tom - ignore" (`3f4e32e8-f8c8-80ef-9c6d-c3a0c44b1af1`), FR "Test Tom - ignore FR" (`3f5e32e8-f8c8-81d6-927b-d504b6f10e54`).
- When Claude Code itself writes to Notion (not the published page), it still uses only the test pages unless Tom names the page.
- Allowed writes (Tom, 2026-10-10), nothing else:
  - Issues (Bugs and Features): Start and End, and "Priority" (Urgent / High / Medium / Low / Not assigned) from the Quarter plan (Tom, 2026-10-27), and "Status" (any option) from the FR edit sheet when opened from an issue card (Tom, 2026-10-27). Never effort or team.
  - FRs (Customer Tasks): "Success Committed" and "Priority " (any option, incl. "No longer needed" and "Won't do"), and "Status" only to "Won't do" (Tom, 2026-10-27) or "Done" (Tom, 2026-10-28, Data quality "issue Done, FR still open"). Never the "Committed" formula or anything else.
  - Comments on an FR: one per Save in the FR edit sheet when the Comment box has text (Tom, 2026-10-27, replaces the separate Send step): tags its Responsible Success (no tag when there is none, never a fallback), then only Tom's text, no list of changes (Tom writes those himself). Empty comment: nothing posted. A comment with no field change is allowed.
  - Rows in the Roadmap Planner Audit Log (`collection://9b4b26f2-ea33-4578-89c2-252389cd5564`).
  - Rows in the Roadmap Planner Effort Baseline (`collection://62afe97a-fdaf-4007-af81-5d1e1498661e`), written automatically on open; no audit row (they are the record).
- Roadmap Planner Capacity (`collection://f060b93c-ecf8-4254-9b1d-cf5fc55b4c2c`): read-only for the planner. Only Sander's roadmap-changes-report skill writes it (capacity per team × skill × week, daily).
- Every write produces an audit row: who, when, issue or FR, field, before, after, reason, warning. "Not a pushback" is an audit row of its own (category "Pushback override").
- Read-only viewers (cannot edit the artifact) write nothing: no buttons, no baseline rows.

## Other writes
- Slack: only the "No estimate" issues and "No engineering issue" FRs the viewer ticks, as the viewer, after an editable preview, when they click Post. One post per issue, in the channel (no thread, never grouped); no other tags. Two buttons, both kept (Tom, 2026-10-26 / 2026-10-27):
  - #product-create-ei-skill-trigger (`C0CC87L21GW`): "@claude_code run the product-feature skill on <issue link>" (claude_code = `U0BKLA7U9EW`).
  - #dev_effort_estimate (`C0C1CPJKZKK`, the old flow): "@Qai estimate <issue link>" (Qai = `U0C0Y7E5SQ4`).
- Slack post to #roadmap_product (`C0A32B4JQS1`) from any issue card or Quarter plan row (Tom, 2026-10-27): one post per click, as the viewer, in the channel (no thread), after the viewer writes the message and sees the preview. Starts with a tag of the team's responsible (Order + Invoice: Sam Persoon `U01MKAWUTV4`; Transport Planning: Sam Buysse `U02SD5QCSSH`; Trip Execution: Jone Hoong `U041Z01AKFC`; Application Platform: Wim Onderbeke `U0421DD1LLC`; no team: no tag), then the viewer's text, and always ends with the engineering issue link, the planned start and end (a pot: the pot date only, e.g. "29/01/2027 (Jan pot)"), and the committed date with what sets it ("04/01/2027 (set by Tyneside Express)", or the issue it blocks). Each post writes an audit row (category "Roadmap post", field "Slack", After = the Slack message link); the card then shows "Posted <date> · open in Slack" next to the button (now "Post again"), read from the audit log on open. At risk "Dependency in the wrong order" and "Committed, status Blocked/on hold" (Tom, 2026-10-28): the button opens a ready-made message instead, shown in full and editable before Send. Format (Tom, 2026-10-28, more concise): the question with the tags, one line per issue "**Blocked:** <link> · team · planned · commit <date> (<customer> / via <linked issue> / inherited from it)", the clash in one line (dependency), then one ask: "Could u have a look and advise so we can amend accordingly?" (Tom, 2026-10-28, replaces the Correct / Not correct options). Every issue named is a link. Dependency: tags the leads of both issues' teams (once if the same) and asks whether the dependency is correct, listing both issues (link, team, planned dates, committed date with what sets it); if it is, the planning has to change, if not, the "Blocked by" link should go. Blocked/on hold: tags the team's lead (and the leads of its blockers' teams) and asks whether it is really blocked; lists its "Blocked by" issues the same way (link, team, planned, committed), or says none is linked and asks which issue blocks it so it gets linked there.
- Slack DM to the COM/AM (an FR's Responsible Success) from Pushback → "Ask COM/AM" (Tom, 2026-10-28): one DM per click, as the viewer, after an editable preview; the owner is looked up in Slack by email (slack_search_users). Audit row category "COM/AM asked", field "Slack", After = message link.
- Slack DM to Qai (`U0C0Y7E5SQ4`) from At risk → "No team" (Tom, 2026-10-27): only the issues the viewer ticks, as the viewer, after an editable preview, one DM per issue: "Please set the missing Team on this engineering issue (decide-issue-team skill): <issue link>".

## Working style
- Ask Tom when in doubt.
- Commit after every working step with a clear message.
- Stop at each build checkpoint and show screenshots or numbers before continuing.
