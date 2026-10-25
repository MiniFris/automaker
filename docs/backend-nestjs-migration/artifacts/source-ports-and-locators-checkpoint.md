# Source ports and service locator retirement checkpoint

Branch: `refactor/backend-nestjs-migration`, after `825d31ee`.

## Implementation

- GitHub issue validation uses an explicit scoped filesystem, atomic replacement
  and canonical project transaction lanes. Producers drain before the repository,
  then the filesystem closes. Unknown IO/corruption is not absence; viewed events
  follow commit. See [validation audit](github-validation-filesystem-audit.md).
- Native agent discovery receives separate project and read-only host-profile
  ports. The profile source uses the configured home snapshot, checks canonical
  descendants and drains reads; missing HOME does not invoke ambient discovery.
  Worktree metadata cleanup uses the application filesystem and errors preserve
  feature/metadata bytes before feature mutation. Feature command lanes canonicalize
  aliases. See [discovery/metadata audit](stage-5-discovery-metadata-filesystem-audit.md).
- Local dev/test preflight receives native path policy and filesystem ports.
  Denied/ambiguous reads cannot start a process. Dev state retains its filename and
  shape, uses scoped atomic writes and drains accepted saves. Native cleanup also
  drains accepted starts, blocks late allocation/spawn and rejects late persistence
  admission. A complete successful snapshot before closing clears a transient write
  failure; a failed close remains cached.
  See [local process filesystem audit](local-process-filesystem-audit.md).
- Removed the last managed dev/test service locator functions and their module-level
  WeakMaps. Native factories already construct their instances explicitly. The
  remaining test-only worktree router now receives managed owners through its fixture
  context; fixtures explicitly share the intended instance and clean up their owners.
  No production module imports that characterization router.
- Architecture checks now reject `get*Service` function/arrow locators and direct
  module-level `new *Service` instances in services/providers, with negative and
  allowed application-factory fixtures. These checks supplement existing route,
  controller IO and production-artifact guards; they do not claim exhaustive dynamic
  dependency or framework-free domain analysis.

## Verification

| Check                                               | Result                                      |
| --------------------------------------------------- | ------------------------------------------- |
| Full server unit suite                              | 3858 passed, 40 existing skips              |
| Full server contract suite                          | 489 passed                                  |
| Full package/UI suite                               | 1549 passed                                 |
| Managed dev/test real SSH acceptance                | 15 passed, 1 opt-in skipped in base run     |
| Available Chromium/Vite preview opt-in              | 1 passed, 5 other cases filtered            |
| Server/shared production build                      | Passed                                      |
| Server/UI lint and UI typecheck                     | Passed                                      |
| Architecture / OpenAPI fixture checks               | 13 / 9 passed                               |
| Formatting/diff, lockfile and generated inventories | Passed                                      |
| Production SIGTERM/SIGINT lifecycle smoke           | Exit 0; 121.9 / 191.8 ms                    |
| Final idle performance budget                       | Passed; no unexpected resources after close |

All 16 distinct managed dev/test SSH cases ran successfully across the base and
focused opt-in runs. The opt-in executable was available locally, so the initial
skip was followed by the actual Chromium/Vite modules/HMR/API/WS/cookie isolation
case. Filtered cases in that run are not counted as extra passes. Private peer,
project, key and browser fixtures were cleaned up; native local-dev port killing
was not exercised. Other SSH feature/terminal cases and Docker/Electron artifacts
were not rerun by this intermediate source slice.

Build/lint/architecture finished before the isolated full unit run; contract and
package jobs followed it. No timeout/retry changes were made. Final idle sample:
import 558.7 ms, composition 74.3 ms, listen 3.02 ms, health p95 1.54 ms, RSS
205103104 bytes, shutdown 6.66 ms. This is the existing idle regression budget,
not a workload SLO. OpenAPI remains 318 operations, 22 incomplete context inputs,
18 runtime success responses and 300 unverified responses.

## Remaining original work

Native local process ownership still requires hardening. Existing DevServerService
port selection/related-port/stop paths call `killProcessOnPort` against occupants;
dev/test numeric PID-tree cleanup and early completion/pruning do not establish the
same ownership proof as terminal cleanup. This is a real original lifecycle gate,
not resolved by filesystem injection. Current local-native fixtures are negative or
held before allocation; no positive local dev start or host port kill was performed.

Remaining broader terminal platform/config IO, public response/context contracts,
state/use-case decomposition, dependency rules, workflow observability, workload
acceptance and final packaging/operational evidence retain the original plan scope.
Ninety-four characterization route files remain source cleanup work. Previous full
target/browser and Docker/packaged Linux Electron evidence at `cad18752` is historical;
the fresh selected SSH/preview evidence is scoped above, and fresh packaged artifacts
for these sources are not claimed. No paid model or vendor auth
calls, user listener/container changes, push or deployment occurred.
