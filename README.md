# Tenon

**Compose worlds from entities.**

Tenon is a browser-based, schema-driven 3D entity and scene editor. It keeps authoring data separate from engine-specific runtime builds.

The editor defines entities, composes them into reusable scenes, and produces a baked runtime world. Game behavior lives in engine classes; the editor stays generic and data-only.

## Documents

- [Editor concept](docs/editor-concept.md) — how Tenon works and how entities and scenes are created.
- [Technical decisions](docs/technical-decisions.md) — the data model, formats, pipeline, and editor stack.
- [Roadmap](docs/roadmap.md) — MVP-driven milestones with demos and acceptance criteria.

## Status

Design phase. This repository currently contains the concept and technical design. There is no implementation yet.

## Repository layout

```text
tenon/
├─ README.md
└─ docs/
   ├─ editor-concept.md
   ├─ technical-decisions.md
   └─ roadmap.md
```
