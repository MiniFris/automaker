# Nest module import graph acceptance

Date: 2026-10-25.

```sh
node scripts/check-server-module-graph.mjs
node --test scripts/tests/server-module-graph.test.mjs
```

Current result: **40 Nest module classes, 52 explicit import edges, five inspected
dynamic factories, zero module import cycles**. All 14 checker tests passed.
No production source change was needed.

The checker parses all `apps/server/src/**/*.module.ts` files using TypeScript's
AST. It resolves named import aliases and relative barrel re-exports, identifies
`@Module` and `forwardRef` by their imports from `@nestjs/common`, and follows
literal metadata imports. `forwardRef` remains an edge; it cannot excuse a cycle.
A repeated node in the active DFS path fails with a module/file cycle trace.

Dynamic assembly is inspected rather than skipped. In the current tree,
`AppModule.register`, `RuntimeConfigModule.register`,
`ObservabilityModule.register`, `SettingsModule.register` and
`ProvidersModule.register` return literal dynamic-module objects. The checker
verifies the returned module identity and reads every direct return branch's
literal imports. Nested provider factory callbacks are not mistaken for dynamic
module returns. Calls such as `SomeModule.register(...)` must resolve to a static
method whose return assembly can be inspected. Edges from static metadata and
all inspected dynamic return branches are combined conservatively.

Unknown import expressions, helper-generated metadata, metadata/array spreads,
computed imports arrays, unresolved or external module references, unrecognized
module files, malformed TypeScript, non-module targets and uninspectable dynamic
returns fail the check. Supporting a new assembly form requires an explicit
checker change and corresponding proof tests; there is no allow-all escape.

Tests cover the actual production graph and injected direct, indirect,
`forwardRef`, conditional-return and dynamic-factory cycles. Negative cases cover
unknown helpers, dynamic `import()`, spreads, computed metadata, duplicate imports,
wrong returned module identities, unknown factories, malformed syntax and
ambiguous barrels. Positive fixtures exercise renamed re-exports, star barrels,
inline dynamic module objects and aliased `forwardRef`.

This is a source-level check of explicit Nest module imports. It deliberately
fails closed for unsupported assembly rather than executing backend code. It
includes discovered modules even if a production option would leave one unused,
and unions conditional factory branches; a newly reported cycle may therefore
require an explicit architectural decision about configuration variants.

The result does not prove provider dependency injection visibility, runtime
factory behavior, global-module availability, arbitrary TypeScript import-cycle
freedom or the absence of deliberate runtime metadata mutation. Those concerns
remain separate from this narrow module-import rule and from the server's
compilation/bootstrap tests. Existing general source-dependency inventories are
not replaced by this checker.
