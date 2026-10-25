# Local runtime configuration and HTTP error categories

Date:2026-10-25. Branch:`refactor/backend-nestjs-migration`.

Native Local execution, immutable binding preparation/reopening, Git, feature
workspaces, AutoMode, pipeline, agent preparation, provider preparation/query ports
and EventHooks now receive an application-owned environment snapshot. Commands do
not consult a later ambient environment. Native children exclude backend
`PORT`, `DATA_DIR`, `AUTOMAKER_API_KEY` and `NODE_PATH`; dev servers' own assigned
PORT is a separate pending process-runner boundary. Standalone compatibility
constructors capture their defaults once. Windows COMSPEC/taskkill paths use the
captured environment; Windows behavior has unit evidence, not an actual OS run.

See the [configuration audit](local-execution-environment-audit.md) for explicit
plumbing and tests. Native two-app contracts execute actual private tools/hooks,
prepare and reopen real pinned Local worktrees, change ambient variables and the
original input objects, and confirm the original owner's environment. The provider
proof also checks consent before dispatch and isolation after closing another app.
Gemini's local policy helper is filesystem-only and now explicitly constructs its
port with an empty child environment; CLI probes use their separate explicit port.
The provider setup configuration-only compatibility constructor does not execute
Local commands or read the captured host environment in its configuration query.

Native global errors now include a stable additive `errorCode`. Status, safe
messages, historical fields, specific domain codes and infrastructure `code` stay
compatible. Parser400, content-type415, preview403, auth401/403, Nest404, controlled
409/429 and unexpected500/502 are exercised through actual HTTP. Intentional
nonempty HTTP error codes are preserved. Unexpected errors and malformed JSON do
not expose tested secrets. See [API policy](../../backend-api-contracts.md).
Historical controller-owned HTTP200 business failures keep their existing shapes;
this does not claim a completely uniform error envelope.

## Completed verification

| Check                                   | Result                                                                                                          |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Server/packages build                   | Passed                                                                                                          |
| Server unit                             | 4028passed,40skipped                                                                                            |
| Native contract                         | 735passed,1opt-in skipped                                                                                       |
| Package/UI unit projects                | 1751passed                                                                                                      |
| Complete SSH tier with Chromium         | 136passed across11files                                                                                         |
| Architecture / module import graph      | 27passed;40modules,52edges,5dynamicfactories,0cycles                                                            |
| OpenAPI ownership/context/binary proofs | 21passed                                                                                                        |
| Route/schema coverage                   | 318operations;0incomplete inputs;316JSON+2binary responses;0unverified                                          |
| UI typecheck / server error-only lint   | Passed                                                                                                          |
| Workload                                | 100features,300mutations,100WS events,11PTY cycles;FD24 throughout,children0,11observed process identities gone |
| Shutdown                                | SIGTERM209.8ms / SIGINT175.8ms;exit0                                                                            |
| Idle performance budget                 | Passed;import641.0ms,composition90.7ms,listen2.65ms,healthp95 2.07ms,RSS220737536bytes,close5.46ms              |
| Resources after close                   | No unexpected active resources                                                                                  |

The first full unit run exposed two stale consent fixtures that changed container
mode after constructing the store. Fixtures now create the owner with its intended
mode and prove that later ambient changes do not reconfigure it or transfer consent
to a different host owner. The second full run passed. Formatting found one chain
layout in preview policy; it was corrected without behavior changes.

The work partition was also relieved by removing eight exact unused cache records
from our prior build chain, checked against cache metadata and removed by explicit
ID. No general Docker prune, operator container/image/volume removal or live profile
change was performed. Selected prior/current acceptance images remain available.

Logs use `/tmp/automaker-wave19-`: `build.log`, `unit2.log`, `contract.log`,
`packages.log`, `ssh-all.log`, `architecture.log`, `openapi.log`, `uitype.log`,
`lint.log`, `workload.log`, `lifecycle.log`, `baseline.json`. Final source formatting
and generated inventories are checked before the checkpoint commit.

## Remaining work

The [nine-owner architecture audit](bounded-context-responsibility-audit.md) records
responsibilities, state, existing ports/tests and actual remaining boundaries.
Native DevServerService/TestRunnerService still inherit ambient env at spawn. Legacy
Direct workspace fallback still uses platform path globals, needing explicit native
path/data policy. FSM error-event subscribers created per project currently duplicate
notifications; a private native reproduction produced three durable notifications
for one event after two project facades. A held pre-store lookup also outlived
successful app.close and then failed against closed notification storage. Those fixes belong to the next source slice;
a reproduction file is deliberately not included in this checkpoint.

Execution/feature correlation, stronger dependency rules and remaining use-case
boundaries still need completion. The last verified Docker/Linux Electron and
private selected-artifact upgrade/rollback checkpoint is
[the preceding source version](current-artifact-acceptance-checkpoint.md); packaging
must be refreshed after final production changes. External rollout and conditional
Windows/macOS acceptance are separate from these local proofs. The goal remains active.
