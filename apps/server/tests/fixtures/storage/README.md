# Storage compatibility fixtures

- `global-settings-current.json` represents current global settings.
- `legacy-electron-settings.json` preserves Windows path and legacy settings fields.
- `project/.automaker/` represents project-local context, pipeline and an interrupted
  feature that startup reconciliation must retain/recover.

Fixtures intentionally contain stable timestamps and synthetic paths. Tests must copy
them into a temporary directory before writes; the checked-in source is read-only.
