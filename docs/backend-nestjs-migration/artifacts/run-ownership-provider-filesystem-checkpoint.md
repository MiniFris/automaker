# Run ownership, passive provider queries и filesystem: checkpoint

Исходная точка: `e8d3eb9d`, ветка `refactor/backend-nestjs-migration`.
Работы выполнялись параллельно по отдельным владельцам, без отдельных PR/веток.
Этот срез не объявляет полную миграцию завершённой.

## Реализовано

- Production FeatureRunCoordinator использует единственную ownership Map
  ConcurrencyManager. Leases имеют incarnation; releases, execution statuses,
  completion/summary и nested continuations привязаны к своему lease. Принятая
  status write сериализуется до допуска следующего запуска. Реальный offline
  provider contract проверяет A stop → B start → late A без освобождения/перезаписи B.
- Passive provider discovery не создаёт execution adapters и не запускает auth
  probes. Gemini usage не обновляет OAuth и не пишет vendor credentials. Claude
  usage не подтверждает trust dialog за пользователя. Public usage errors не
  содержат raw upstream messages. ZAI сначала сохраняет canonical credential,
  затем активирует runtime и отправляет событие через application bus; custom host
  явно остаётся session-only.
- Downloads, ZIP и prompt context используют application-scoped filesystem.
  Реальные read/write streams принадлежат очереди до закрытия descriptor; transfer
  scope работает даже с concurrency 1. ZIP не зависит от системного `zip`, не
  копирует symlink targets или private archives других download jobs; IO, metadata,
  количество entries, глубина и admission ограничены. Отмена и failed cleanup
  отражаются в lifecycle. Prompt query не вызывает legacy autorecovery writer.
- Standalone downgrade preflight проверяет явный DATA_DIR и target только на
  чтение. Ledgers/tombstones/quarantine блокируют несовместимый legacy target;
  неоднозначные данные дают unconfirmed. Whole snapshot restore проверен в свежем
  каталоге; overlay restore намеренно не проходит. Это не сертификация старого binary.
- Docker install/browser asset layers перенесены перед source copies. Повторная
  сборка после исправления source показала CACHED для npm ci и browser downloads.

Подробности: [run incarnation](stage-8-run-incarnation-audit.md),
[provider discovery/usage](stage-7-discovery-usage-audit.md),
[download/prompt FS](download-prompt-filesystem-audit.md),
[downgrade guard](downgrade-preflight-audit.md),
[операционная инструкция rollback](../../backend-storage-downgrade.md).

## Проверки

Все target/HTTP/provider fixtures offline, без настоящих model/auth calls.
Docker и SSH jobs завершены до Chromium/Electron.

| Набор                                    | Результат                                                                             |
| ---------------------------------------- | ------------------------------------------------------------------------------------- |
| Full backend units                       | 3789 passed, 40 skipped                                                               |
| Full HTTP/WS contracts                   | 381 passed                                                                            |
| Full package/UI units                    | 1525 passed                                                                           |
| Standalone downgrade tests               | 28 passed, 0 skipped                                                                  |
| Real SSH feature / terminal / worker     | 32 passed                                                                             |
| Managed Docker                           | 11 passed, 4 opt-in skipped                                                           |
| Production Docker build + isolated smoke | ready 200, protected 401, no TypeScript/legacy entry, actual ZIP extracted, SIGTERM 0 |
| Linux packaged Electron                  | renderer mounted, ready 200, protected 401, native PTY 0, backend closed              |
| Chromium regression                      | 18 passed, workers 1, retries 0, 1.5 min                                              |

Targeted provider checks: 139 unit / 1 existing skip + 6 native contracts;
incarnation checks: 251 units + 5 native contracts. Root stream/prompt checks:
16 platform units + 5 service units + 6 native contracts, включая western timezone,
старые/будущие mtime и 2000 empty-entry allocation workload.

Первый full unit прогон выявил один устаревший pipeline fixture без настоящего
lease; fixture переведён на реальный manager/context, endpoint assertions сохранены.
Full suite повторно прошёл. Peer review выявил retained per-entry compressor buffers
и ошибочный mtime clamp pinned ZIP library; использованы stored entries, bounded
metadata и local-calendar dates, добавлены workload/timezone regressions. Первый
Electron build в offline mode потребовал отсутствовавший npm packument нового
pinned fflate; после заполнения cache сборка снова выполнена offline.

Host signal smoke: SIGTERM exit 0 / 56.0 ms, SIGINT exit 0 / 66.6 ms. Production
Docker smoke также извлёк реальный ZIP response и проверил наличие runtime fflate.
Linux Electron запускался вне monorepo с отдельным HOME и с реальным bundled PTY;
оба GUI acceptance запускались только после завершения network-mutating jobs.

## Оставшиеся исходные gates

AgentExecutor planSpec/output ещё требуют incarnation-scoped ports; полные
planning/approval/testing transitions не объявлены закрытыми. Остаются legacy
Electron import, другие default/global filesystem consumers и cross-writer
coordination, оставшиеся route factories/getters, dependency rules, performance
budgets/CI, shared contracts/OpenAPI/client и остальные пункты этапа 11.

Gemini restricted normal chat/readOnly остаются явно unsupported до отдельного
доказанного adapter решения; passive usage fixes этот limitation не снимают.
Operational rollback со старым executable, real canary/release и platform smoke на
недоступных runners не подменяются fixture результатами и не выполнялись.
