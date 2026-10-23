# Legacy backend performance baseline

Measured 2026-10-23 with Node `v22.22.2` on the migration workstation using
`npm run baseline:server`. The command builds the production server, imports the
legacy factory, starts it on an ephemeral loopback port without startup recovery,
performs 100 sequential `/api/health` requests, records memory and shuts it down.

| Metric                   | Baseline |
| ------------------------ | -------: |
| Production module import |   455 ms |
| Explicit HTTP startup    |   3.1 ms |
| `/api/health` p50        |  0.55 ms |
| `/api/health` p95        |  2.36 ms |
| RSS after requests       |  154 MiB |
| Heap used after requests |   54 MiB |
| HTTP shutdown callback   |  0.72 ms |

These are local reference values, not release SLOs. CI compares only for large
regressions because hardware and filesystem caches materially affect them.

## Resource finding

After `server.close()` and one event-loop turn, the process still reports two
`PipeWrap`, one `TCPServerWrap`, two `TCPSocketWrap` and three `Timeout` resources.
Some TCP resources are attributable to the local undici keep-alive pool used by the
measurement; the timers and process-level listeners are legacy singleton lifecycle
debt. The measurement process exits explicitly after reporting this list. Nest
cutover must make application-owned timers/processes disposable and the final
shutdown smoke test must distinguish them from client-side keep-alive resources.

Active-agent, real PTY, SSH and Docker measurements remain runner-specific and are
collected by their opt-in suites rather than the deterministic stage checkpoint.
