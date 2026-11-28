# Project memory

Recurring, project-wide lessons only. Not a session log.

- Exo's top menus are `vscode-context-menu` custom elements with shadow-DOM items. Clicking the
  menu item host does not invoke the command; automated shell checks must click the item's
  inner `a` (or use keyboard navigation). Evidence: hosted-shell undo/redo check against Exo
  0.13.0, 2026-11-28; the Edit menu opened but the host click was a no-op, while the shadow
  anchor invoked Undo.
