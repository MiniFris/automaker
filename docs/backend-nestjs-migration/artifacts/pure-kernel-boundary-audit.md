# Enforced pure-kernel dependency boundary

Date: 2026-10-25. This is a narrow architecture rule for existing pure kernels and
future domain code, not a claim that every application service is framework-free.

`apps/server/eslint.config.mjs` now applies the error-level
`domain-boundaries/pure-kernel` rule to:

- `src/modules/orchestration/feature-run-state-machine.ts`;
- `src/core/errors/domain-errors.ts`;
- every future `src/domain/**/*.ts` file.

Both current kernels have no imports and pass this rule unchanged. The state
machine evaluates states and transitions; domain errors construct and map error
values without importing Nest, transports or infrastructure adapters.

Static runtime imports and re-exports are allowed only between these guarded
kernels and helpers inside the guarded domain directory. Relative imports and
the existing `@/` source alias are resolved for this policy. There is no exception
for an unchecked neighboring helper or a barrel outside the guarded scope.
Type-only imports/re-exports from `@automaker/types` remain allowed, including
individual `type` specifiers. Runtime imports from that package require a future
explicit decision. Framework, filesystem, process, network, provider, service and
controller dependencies therefore fail at the guarded boundary.

Dynamic imports and TypeScript import-equals/require assembly fail even if their
target resembles a pure helper. The rule also rejects references to ambient
process/require globals, fetch/network clients, timers, browser scheduling,
`AbortSignal` timeout access, console IO and global runtime objects. Blocking
`globalThis`/`global`/`window`/`self` references prevents aliases and destructuring
from recovering those prohibited capabilities. Scope-aware identifier checks
allow an explicitly supplied business value named `process`; property names alone
are not mistaken for global capability use.

Existing core/module import restrictions, environment/cwd restrictions,
controller IO rules and services/provider rules remain in place. The new overlay
adds a separate rule instead of replacing their `no-restricted-syntax` or
`no-restricted-imports` configurations.

Validation uses the existing architecture test command:

```sh
node --test scripts/tests/server-architecture-rules.test.mjs
```

The suite now has **19 passing tests**. New fixtures run against both current
kernel paths and a future domain path. They reject framework/IO dependencies,
re-exports, unknown helpers, runtime shared-package imports, dynamic imports,
require, ambient calls, computed global access and aliases through global
objects. Positive fixtures retain type-only contracts and guarded pure helper
imports. A separate assertion proves that the prior core/module guards still
report errors on the two kernel paths. The actual source kernels are linted in
the same suite; any current domain directory is included when present.

Supporting local log: `/tmp/automaker-wave20-pure-kernels.log`. No application
source changed for this rule.

This is a syntactic dependency/capability boundary, not a formal proof that every
function is referentially transparent. It does not analyze arbitrary behavior
hidden in supplied values, establish a complete TypeScript dependency graph, or
make application orchestration services part of the domain layer. Compilation,
Nest module graph checks, provider composition tests and runtime acceptance
remain separate checks. Additional pure helpers belong under a guarded path or
require a deliberate scope extension with tests.
