# Nanospec install

- Source: `https://stratofold.alexklingenbeck.de/apps/public/nanospec.zip`
  (the `http://` form returns 404; HTTPS serves the archive)
- Version: 1.0.1
- Archive SHA-256: `5c9081dd2c170a529dd806e956dfeab78492cbea5362f30a8dabf6b36b72b263`
- Installed: 2026-11-27

The `nsx-*` skill directories are installed as siblings of this directory under
`.agents/skills/`, where OpenCode discovers `<source>/<skill>/SKILL.md`. This
directory keeps the upstream README and `plugin.json` for provenance; the
upstream `plugin.json` `skills/` path refers to the original archive layout, not
to this repo's install layout. Line endings were normalized from CRLF to LF.

Start with `@nsx-init`.
