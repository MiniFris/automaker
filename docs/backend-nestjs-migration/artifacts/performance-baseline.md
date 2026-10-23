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

## Stage 2 Nest shell

Повторное измерение выполнено той же программой с ключом `--nest` после production
build. Startup tasks отключены в обоих режимах, поэтому сравнение отражает стоимость
Nest composition root и legacy middleware bridge, а не внешнее восстановление.

| Metric                   | Nest shell | Изменение к baseline |
| ------------------------ | ---------: | -------------------: |
| Production module import |   456.9 ms |                +0.4% |
| Explicit HTTP startup    |     3.1 ms |                  ~0% |
| `/api/health` p50        |    0.58 ms |                +5.5% |
| `/api/health` p95        |    2.08 ms |               -11.9% |
| RSS after requests       |  162.6 MiB |                +5.6% |
| Heap used after requests |   61.4 MiB |               +13.7% |
| HTTP shutdown callback   |     1.2 ms |               +66.7% |

Абсолютное увеличение shutdown меньше `0.5 ms`; latency и RSS остаются ниже
порогов значимой регрессии для migration shell. Команда сравнения:
`npm run build:server && node scripts/measure-server-baseline.mjs --nest`.

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
