# vendor/capacity-engine.js

Sander De Wilde's capacity engine from the Lightdash Engineering Capacity Planner
(`bi-internal`, `lightdash/qargo/apps/engineering-capacity-planner/capacity-engine.js`).

- Used UNCHANGED so our capacity and load numbers match the planner by construction.
- Version: export of 27 Aug 2026, received from Sander via Slack on 9 Oct 2026. The full app export of 9 Oct 2026 carries the identical file.
- To update: replace the file with Sander's latest export, run `npm test`, commit.
  Never edit it here; ask Sander to change it upstream.
- Glue (teams, emailToName, settings) is copied from the planner's App.jsx and
  config.js into src/capacity.js. Keep it in sync when Sander changes them.
