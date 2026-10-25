# FSM notification ownership, Direct workspace policy and native process environment

Date:2026-10-25. Branch:`refactor/backend-nestjs-migration`.

## Corrected behavior

One error event previously produced three durable notifications after two project
facades were created. A separate held FSM lookup could outlive successful app.close
and then fail against closed notification storage. Native project facades now share
the application FSM. Its subscriber closes admission synchronously, snapshots and
tracks accepted jobs before asynchronous lookup, and drains all accepted work before
the notification storage barrier. Unknown cleanup remains a cached failure. Known
notification I/O errors retain their previous best-effort semantics. Standalone
facades close their own FSM. The 256-job admission bound logs overflow; it is not a
durable or exactly-once event queue. See the
[FSM proof](fsm-notification-ownership-audit.md).

The default native Direct provider's legacy workspace previously consulted platform
path globals, despite native applications owning different root/data policies.
`DirectWorkspaceAccess` now supplies the application's SecurityService authority to
the provider factory and legacy Docker shell fallback. Canonical allowed roots and
protected DATA_DIR apply before any model request; DATA_DIR nested inside a project
is hidden from listing and unavailable to file tools. Existing descriptor checks,
protected metadata, hard-link/symlink guards and file-write preconditions remain.
Standalone compatibility construction retains its explicitly documented fallback.
Two actual default provider instances used private offline HTTP tool fixtures to
prove allowed own-project reads, foreign-root/data denial, isolation from hostile
ambient/global lookups and continued use of B after closing A. No request-shaped
policy field, global application registry or extra approval flow was introduced.

Native DevServerService/TestRunnerService now capture injected host environment.
Native composition excludes PORT/DATA_DIR/AUTOMAKER_API_KEY/NODE_PATH; the dev
runner deliberately sets its own allocated PORT, while tests retain CI=true and
existing color flags. Both children use their owner's PATH/HOME/user variables
after ambient/input-object mutation. Windows shell selection and compatibility
cleanup commands use the captured environment/COMSPEC; this is source/unit evidence,
not actual Windows process acceptance. An actual Linux two-app child test checks
private executables, test completion, dev server startup/stop and continued B use
after A closes. Existing Linux owned-process cancellation/shutdown tests passed.

## Verification

| Check                                  | Result                                                                                                                     |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Server/packages build                  | Passed                                                                                                                     |
| Complete server unit                   | 4034passed,40skipped                                                                                                       |
| Complete native contract               | 744passed,1opt-in skipped                                                                                                  |
| Package/UI unit projects               | 1751passed                                                                                                                 |
| Complete real SSH tier with Chromium   | 136passed across11files                                                                                                    |
| Architecture                           | 33passed:19boundary proofs+14module graph proofs                                                                           |
| Nest module graph                      | 40modules,52edges,5dynamicfactories,0cycles                                                                                |
| OpenAPI source proofs                  | 21passed;318inputs/no-input,316JSON+2binary responses,0unverified                                                          |
| Server error-only lint/UI typecheck    | Passed                                                                                                                     |
| Repository formatting/diff/inventories | Passed                                                                                                                     |
| Workload                               | 100features,300mutations,100WS events,11PTY cycles;FD24,children0,11observed child identities gone                         |
| Signals                                | SIGTERM215.6ms/SIGINT132.9ms;exit0                                                                                         |
| Idle budget                            | Passed:import583.1ms,composition73.0ms,listen2.59ms,healthp95 4.03ms,RSS222277632bytes,close6.08ms;no unexpected resources |

No retries, larger timeouts, vendor authentication or paid model requests were used
to obtain these results. The private MCP/model/SSH fixtures exercise explicit offline
protocols, not external production services.

Pure-kernel rules now enforce two existing kernels and future `src/domain/**/*.ts`:
framework/infrastructure imports and re-exports, dynamic loading and ambient
process/network/timer access are rejected. Pure guarded helpers and declared type
imports remain allowed; existing controller/module guards remain in place. This
is a concrete guarded scope, not a declaration that every application service is
framework-free. See [the boundary audit](pure-kernel-boundary-audit.md).

Stages00–09 have also been reconciled with completed source/tests:41stale checklist
items were marked with exact references. Historical bridge descriptions remain
historical; unproven OS/live-vendor/rollout requirements were not marked complete.

Logs: `/tmp/automaker-wave20-{build,unit,contract,packages,ssh-all,architecture-final,
openapi,lint-final,uitype,format,workload,lifecycle,baseline}.log`; performance JSON
is `/tmp/automaker-wave20-baseline.json`. Focused evidence is linked in the audits.

## Remaining scope

MCP now has seven real stdio contract cases, but SSE/HTTP and pre-parse bounds,
confirmed process/connection cleanup and accepted-operation shutdown remain concrete
next work. The Direct checkpoint store still needs a scoped persistence audit.
Execution correlation, remaining application→ports/Compat/decomposition boundaries
and final artifact refresh remain open. The previous
[artifact/upgrade checkpoint](current-artifact-acceptance-checkpoint.md) refers to its
named earlier source; it does not verify the current unbundled source automatically.
Conditional Windows/macOS and external rollout evidence remain distinct.
