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
- Write ONLY to the test issue "ROADMAP PLANNER TEST - ignore" until Tom explicitly approves writing to real issues.
- Every Notion write produces an audit entry: who, when, issue, before, after, reason.

## Working style
- Ask Tom when in doubt.
- Commit after every working step with a clear message.
- Stop at each build checkpoint and show screenshots or numbers before continuing.
