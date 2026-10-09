# vendor/capacity-engine.js

Sander De Wilde's capacity engine from the Lightdash Engineering Capacity Planner
(`bi-internal`, `lightdash/qargo/apps/engineering-capacity-planner/capacity-engine.js`).

- Used UNCHANGED so our capacity and load numbers match the planner by construction.
- Version: export of 27 Aug 2026, received from Sander via Slack on 9 Oct 2026.
- To update: replace the file with Sander's latest export, run `npm test`, commit.
  Never edit it here; ask Sander to change it upstream.
- Glue we supply ourselves (not in this file, see src/capacity.js):
  `config.teams`, `config.emailToName`, `settings`. Confirm with Sander how the
  planner builds these (open question in SPEC.md).
