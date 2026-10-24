# Idle performance budgets and initial architecture guards

`check:server:performance` builds and measures the native API with an owned
DATA_DIR/HOME, explicit environment, no provider registrations and startup recovery
disabled. `--assert-budget` returns nonzero for violations; `--output` writes a
separate JSON artifact. Runner stdio handles are initialized before resource
counting; extra child pipes are still counted by multiplicity.

| Metric                           | Maximum |
| -------------------------------- | ------- |
| Import                           | 3000 ms |
| Module composition               | 1500 ms |
| HTTP listen                      | 1000 ms |
| 100 health requests, p95         | 50 ms   |
| Idle RSS                         | 256 MiB |
| Idle shutdown                    | 1000 ms |
| Unexpected resources after close | 0       |

These coarse limits apply to isolated Node 22 Linux CI. They are not provider
throughput, large-project, streaming or startup-recovery SLOs. The RSS allowance
uses the recorded approximately 193–198 MiB baseline with bounded growth. Limit
changes require a measured explanation, not automatic rebaselining or retries.

The dedicated `backend-performance.yml` workflow pins Node 22.22.3, uses locked
installs, has a ten-minute deadline and retains the report on failure. It is added
locally; no push or remote CI execution is claimed.

Local evidence before the combined final build: 10 budget tests passed. A real
piped benchmark exited 0 at RSS 208,691,200 bytes with no unexpected resources.
An owned preload retained 96 MiB: exit 1 at RSS 302,661,632, RSS violation reported,
application cleanup confirmed. Final measurements belong to the combined checkpoint.

ESLint now rejects static route/controller dependencies from services/providers
and direct filesystem/child-process imports from controllers. The remaining
Claude usage type import from `routes` moved into a transport-independent type file.
Five real ESLint fixture tests cover forbidden/permitted imports. The standard
test workflow runs these guards.

Still open: dynamic/computed dependency analysis, all module public-export rules,
framework-free domain/application extraction, remaining ambient env/getter/default
FS consumers and cycle governance. The initial guards do not certify those gates.
Large lists, sustained streams and repeated workflow resource tests remain separate
from the idle benchmark.
