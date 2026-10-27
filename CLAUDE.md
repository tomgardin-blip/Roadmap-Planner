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
  - Issues (Bugs and Features): Start and End only. Never effort, team, status.
  - FRs (Customer Tasks): "Success Committed" and "Priority " only. Never the "Committed" formula or anything else.
  - Comments on an FR that tag its Responsible Success, only when Tom clicks Send.
  - Rows in the Roadmap Planner Audit Log (`collection://9b4b26f2-ea33-4578-89c2-252389cd5564`).
  - Rows in the Roadmap Planner Effort Baseline (`collection://62afe97a-fdaf-4007-af81-5d1e1498661e`), written automatically on open; no audit row (they are the record).
- Roadmap Planner Capacity (`collection://f060b93c-ecf8-4254-9b1d-cf5fc55b4c2c`): read-only for the planner. Only Sander's roadmap-changes-report skill writes it (capacity per team × skill × week, daily).
- Every write produces an audit row: who, when, issue or FR, field, before, after, reason, warning. "Not a pushback" is an audit row of its own (category "Pushback override").
- Read-only viewers (cannot edit the artifact) write nothing: no buttons, no baseline rows.

## Other writes
- Slack: only the "No estimate" issues the viewer ticks, as the viewer, after an editable preview, when they click Post. One post per issue, in the channel (no thread, never grouped); no other tags. Two buttons, both kept (Tom, 2026-10-26 / 2026-10-27):
  - #product-create-ei-skill-trigger (`C0CC87L21GW`): "@claude_code run the product-feature skill on <issue link>" (claude_code = `U0BKLA7U9EW`).
  - #dev_effort_estimate (`C0C1CPJKZKK`, the old flow): "@Qai estimate <issue link>" (Qai = `U0C0Y7E5SQ4`).

## Working style
- Ask Tom when in doubt.
- Commit after every working step with a clear message.
- Stop at each build checkpoint and show screenshots or numbers before continuing.
