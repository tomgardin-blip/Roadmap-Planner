# Roadmap Planner

The live planner runs in **Qargo Artifacts** (Product › Roadmap Planner). Its code lives on the hub register row in Notion
(Shared Artifacts table, page `40ce32e8f8c881a7affdec5bb404510e`); `hub/` is a mirror of it.

- `hub/index.html`: the whole app (no build step). `hub/capabilities.json`: its connector grants.
- `hub/HUB_VERSION.json`: which hub version this mirror holds. Always sync before changing anything (CLAUDE.md).
- `tools/hub_decode.py`: turns the row's App code pages into `hub/` files.
- `legacy/`: the pre-hub modular planner (standalone artifact up to v118). Not built or published any more.
