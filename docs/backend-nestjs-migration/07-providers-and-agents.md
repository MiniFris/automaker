# Этап 7. AI providers и agents

## Цель

Заменить side-effect provider registry и ручную композицию агентских сервисов на
явные Nest providers, сохранив модели, streaming, tools, permissions, attachments,
usage accounting и execution environment bindings.

## Целевая модель

```text
ProvidersModule
├── ProviderRegistry
├── ModelCatalogService
├── ClaudeProviderAdapter
├── CodexProviderAdapter
├── CopilotProviderAdapter
├── CursorProviderAdapter
├── GeminiProviderAdapter
├── OpenCodeProviderAdapter
└── OpenAICompatibleProviderAdapter

AgentsModule
├── AgentApplicationService
├── AgentSessionRegistry
├── AgentSessionRepository
├── AgentExecutionCoordinator
├── AgentExecutor
├── ToolPolicyService
└── AgentRecoveryService
```

## 7.1. Provider interface

- [ ] Зафиксировать общий interface: installation/auth status, models, capabilities,
      start, stream, follow-up, cancel и dispose.
- [ ] Разделить provider capability и model capability.
- [ ] Явно описать vision, tools, thinking/reasoning, MCP и remote execution.
- [ ] Не считать неизвестную capability автоматически доступной.
- [ ] Стандартизировать provider events до передачи в application event bus.
- [ ] Нормализовать cancellation и terminal reasons.

## 7.2. ProviderRegistry

- [x] Удалить module-import registration side effects.
- [x] Удалить static методы `ProviderFactory`.
- [x] Зарегистрировать adapters явным factory provider.
- [x] Сохранить aliases и model matching priorities.
- [x] Вынести disconnected markers в provider connection repository.
- [x] Ввести duplicate alias/model ownership checks при startup.
- [x] Поддержать mock provider только через test module override.

Nest не предоставляет неявный multi-binding, поэтому registry должен получать
явный массив provider tokens или собираться factory с перечисленными dependencies.

### Промежуточный срез: обязательная зависимость registry

`AgentService`, `IdeationService`, `ExecutionService` и Auto Mode facade больше
не импортируют `ProviderFactory`: `ProviderRegistry` обязателен в их constructors
или factory options. Application composition передаёт один registry, содержащий
явные registrations и connection repository. Remote CLI/SDK execution сохраняет
явный `throwOnDisconnected: false` для target-side авторизации; Local execution
проверяет connection state. Vision проверяется по model capabilities registry.

Unit tests передают registry mocks напрямую. Transport acceptance создаёт явный
registry с реальными adapters через `tests/helpers/provider-registry.ts`, включая
restart/default-change сценарии. Следующий срез удалил сам `ProviderFactory`, его
barrel export и последние fallback в simple-query, backlog planning, Codex auth и
legacy worktree text handlers. Все source/test callers передают registry явно.
45 routing/catalog/alias tests сохранены в `provider-registrations.test.ts`.

Spec → feature generation передаёт тот же registry и abort controller во вторую
фазу. Contract с fake provider и реальным файловым хранилищем проверяет сохранение
spec, создание backlog feature и отмену между фазами без второго model call.

Checkpoint удаления factory: server build и lint, 2900 unit-тестов (40 skipped),
230 HTTP/WS contracts, 34 managed SSH/Git/preview теста (1 skipped), 11 реальных
Docker acceptance тестов (4 opt-in skipped) и три выбранных remote CLI/SDK/SSH
chat/restart сценария. SSH suite использует отдельный preview port range
43200–43219, чтобы не конкурировать с production listeners. Все три inventory
checks актуальны. Production process smoke по SIGTERM/SIGINT завершился с кодом 0.
Пропущенные opt-in проверки не доказывают завершение этапа 7 целиком.

### Проверка владельцев моделей

`ProviderRegistry.onModuleInit()` проверяет каталоги до открытия HTTP listener.
Пустые model ID, ID с пробелами по краям и повторяющиеся ID (без учёта регистра)
отклоняются, в том числе повтор внутри одного provider. Bare `modelString` не
является глобальным ключом: разные providers могут обращаться к одной SDK-модели
через разные application-facing ID. `allModels()` повторяет проверку для refreshed
catalogs; приоритеты predicate matching и aliases не меняются.

Конструкторы Cursor/Gemini/Copilot больше не вызывают CLI detection: он остаётся
в явных status/execution methods. Unit test с production registrations запрещает
CLI probes при startup validation. Nest contract проверяет отказ запуска при
конфликте каталогов. Checkpoint: build, lint, 2906 unit tests (40 skipped),
231 HTTP/WS contracts, dependency inventory check и production SIGTERM/SIGINT smoke.

### Test-only providers и Playwright composition

`MockProvider` перенесён из production source в `tests/helpers`. Отдельный entrypoint
`npm run dev:e2e --workspace=apps/server` собирает `AppModule` через Nest testing
module и явно переопределяет registry и две auth probes. Каталоги, aliases и
приоритеты production registrations сохраняются; AI execution заменён fake adapter.
Playwright и E2E workflow используют этот entrypoint, а не production mock flag.

`AUTOMAKER_MOCK_AGENT` больше не влияет на production config, login rate limit или
Claude/Codex auth verification. Успешный login сбрасывает счётчик ошибок; после пяти
неудачных попыток действует rate limit независимо от старого флага. Setup handlers
явно сохраняют прежний HTTP 200 вместо стандартного Nest POST 201.

Standalone test entrypoint создаёт собственный временный `DATA_DIR` до импорта
legacy readers, слушает только loopback, запрещён при `NODE_ENV=production` и
удаляет хранилище при shutdown. Последующий auth cutover устранил общий module-level
auth store и для in-process fixtures; детали и проверки — в документе этапа 3.
Background startup tasks в E2E composition отключены, поэтому этот harness не
заменяет production lifecycle или live-provider acceptance.

Checkpoint: 2907 unit tests (40 skipped), 235 HTTP/WS contracts, server build/lint,
UI typecheck, все три inventory checks и production SIGTERM/SIGINT smoke. Contract
запускает настоящий test server process и проверяет readiness, exit 0 и удаление
его временного хранилища после SIGTERM. Chromium smoke создания Agent Chat Session
пройден с новым test composition; полный UI suite ещё не подтверждён.

## 7.3. Перенос providers

Рекомендуемый порядок:

1. Mock provider как test reference.
2. Claude как текущий default/fallback.
3. Codex и model cache/app-server integration.
4. Gemini.
5. Cursor и OpenCode CLI adapters.
6. Copilot.
7. OpenAI-compatible agent loop и local tools.

Для каждого provider:

- [ ] installation/auth detection;
- [ ] model catalog;
- [ ] local and supported remote execution;
- [ ] event normalization;
- [ ] cancel/cleanup;
- [ ] credentials redaction;
- [ ] usage endpoint;
- [ ] contract tests с fake SDK/CLI;
- [ ] optional live acceptance test вне обычного CI.

## 7.4. AgentService decomposition

- [x] Отделить persisted session repository от active session registry.
- [ ] Отделить prompt/context construction.
- [ ] Отделить provider selection.
- [ ] Отделить execution environment preparation.
- [ ] Отделить stream normalization/event publication.
- [ ] Отделить follow-up/cancel.
- [ ] Отделить completion persistence/recovery.
- [ ] Сохранить session identifiers и UI event order.

На первом migration commit этого блока существующий `AgentService` допустимо зарегистрировать целиком как
Nest provider. Его деление выполняется после переноса routes и contract coverage.

### Срез: persisted state и active registry

`AgentStateModule` регистрирует отдельные `AgentSessionRepository` и
`AgentSessionRegistry`; `AgentService` получает оба как обязательные зависимости.
Production factory и все unit/remote acceptance callers переведены на явную
композицию. Storage paths, JSON messages/queues, metadata fields и три backups
сохранены. В AgentService остаются compatibility methods, делегирующие repository.

Repository владеет file I/O и сериализует metadata read-modify-write, включая
создание, обновление, timestamp и очистку SDK session ID. Одновременные изменения
разных сессий больше не теряют друг друга. Messages/queues сохраняются snapshot-ами
через отдельные per-file очереди. DI shutdown дожидается pending writes. Поддержан
один активный repository writer на data directory, не distributed coordination.

Registry объединяет concurrent hydration одного ID и возвращает один active object.
Удаление/shutdown инвалидирует незавершённую hydration, чтобы она не восстановила
сессию обратно в память. Contracts двух Nest applications проверяют разные экземпляры
обоих state providers. Shared `SessionIdSchema` запрещает path traversal, prototype
keys и suffix `-queue`, конфликтующий с legacy queue filename.

Native HTTP contract проверяет start/send без optional workingDirectory/images,
queue add/list/clear, event order `started → message → stream → complete`, стабильные
message/session IDs, history и follow-up после restart. Он выявил и закрыл regression
в `AllowedPathFields`: optional fields больше не обязательны для start/send/queue-add.

Checkpoint: contracts package build и 14 tests, server build/lint, 2928 unit tests
(40 skipped), 237 HTTP/WS contracts, три реальных remote CLI/SDK/Direct SSH chat/restart
сценария, UI typecheck, Chromium Agent Chat Session smoke, три inventory checks и
production SIGTERM/SIGINT smoke.

Этап 7 целиком не завершён. Последующий срез ниже устранил legacy read/save fallback.
Следующий срез добавил execution leases для send/cancel и проверку active shutdown.
Удаление queue/backups с session и общий cleanup contract всех adapters ещё требуют работы.
Prompt/context, execution и stream processing
пока остаются в AgentService; legacy SessionAdapter также ещё не удалён.

### Срез: ошибки хранения и подтверждённый completion

Repository возвращает пустое состояние только при `ENOENT` основного файла. Ошибки
I/O не маскируются и не переключаются на backup. Повреждённый JSON или неверная
структура проверяются по committed `.bak1`–`.bak3`; metadata требует согласованных
record IDs, messages/queues — соответствующих массивов и основных полей. Невалидный
backup пропускается, I/O failure при чтении backup останавливает восстановление.
Если валидной копии нет, возвращается безопасный `AgentSessionStorageError` / HTTP 503
`UNAVAILABLE`, без JSON snippets, содержимого prompts и сырых filesystem errors.

Чтение backup не переписывает основной файл. Отсутствующий main file не воскрешается
из старых backups (это может быть результат удаления); uncommitted temp files также
не используются. Corrupt metadata без recovery блокирует read-modify-write, поэтому
новая сессия не затирает файл пустым metadata. Hydration error больше не создаёт
пустую active session. Общие best-effort recovery helpers не используются, поскольку
они могут читать temp files и возвращать пустое состояние после I/O errors.

Первое сообщение сохраняется до provider call. Если эта запись не удалась, сообщение
убирается из RAM и model не запускается. `complete` отправляется только после финальной
записи messages и metadata timestamp. При сбое этой записи после model execution приходит
`errorType: persistence`, running flag сбрасывается, следующий queued prompt не
запускается и model не повторяется автоматически. RAM может содержать ответ, который
не удалось сохранить; ошибка просит проверить history/storage перед ручным retry.
HTTP send по-прежнему возвращает acceptance ACK, а не подтверждение завершения job.

Queue add/remove/clear/dequeue сериализованы отдельно на session ID; новая RAM queue
и `queue_updated` публикуются только после успешной записи. Неудачная mutation не
исполняет неподтверждённый prompt и не теряет прежнюю очередь. Active model также
меняется после persistence metadata. Clear history теперь загружает persisted session
и работает после restart без предварительной активации.

Checkpoint: 2942 unit tests (40 skipped), 238 HTTP/WS contracts, server build/lint,
UI typecheck, три inventory checks и production SIGTERM/SIGINT smoke. Три выбранных
реальных remote CLI/SDK/Direct SSH chat/restart сценария пройдены. Chromium scenario
теперь проверяет не только создание сессии, но и отправку через UI, streamed reply,
снятие processing state и восстановление тех же сообщений после page reload.

Этот checkpoint ещё не завершал execution recovery: следующий срез добавляет lease
для concurrent send/cancel/clear и ожидание provider task. Полный UI suite, остальные
environment acceptance suites и финальный stage checkpoint ещё обязательны.

### Срез: execution leases, admission и active shutdown

`AgentExecutionCoordinator` — отдельный application-scoped Nest provider. Он
резервирует session ID синхронно до hydration, смены модели, image/context loading
и других `await`. Duplicate send отклоняется HTTP 409 до acceptance ACK и не
публикует error в stream уже выполняющегося job. Разные session IDs и разные Nest
applications имеют независимое владение. Canonical ID проверяется и в coordinator,
и в repository: пробельные/path aliases не могут получить разные leases одного файла.

Stop/clear/delete резервируют mutation barrier, запрашивают abort и ждут settlement
старого task. При истечении drain timeout (5 секунд) mutation не выполняется,
возвращается `UNAVAILABLE`, а lease остаётся занятой до реального settlement. Abort
проверяется до provider call, при чтении stream и перед final persistence/completion;
поздние chunks после отмены не попадают в history. Частичный ответ сохраняется при
отмене. Clear/delete также сериализованы с queue mutations, чтобы старый handler
не записал history обратно после успешного ответа на mutation.

Model change через `/agent/model` и `/sessions/:id` не отменяет активный запрос:
он получает 409 до изменения metadata/RAM. Новая модель при send preparation также
публикуется в RAM только после metadata persistence. Automatic queue processing
сначала резервирует run и лишь затем dequeue-ит prompt — конкурирующий manual send
не может забрать execution после удаления queued prompt с диска. Stop/delete barriers
блокируют новый start и queue mutation; shutdown закрывает admission новых jobs,
сессий, queue и metadata mutations.

Shutdown сначала записывает interruption marker, затем abort-ит и дожидается active
task; ошибка записи не пропускает abort/drain. Legacy lifecycle теперь пытается
очистить остальные owned resources даже после ошибки agent/test cleanup, сообщает
aggregate failure и не повторяет terminal shutdown автоматически. Timeout не
объявляется успешным cleanup. Новые process contracts отправляют SIGTERM и SIGINT
реальному Nest child process с активным fake provider: его async finalizer проверяет,
что marker уже на диске, и завершается до exit 0. Это дополняет обычный production
idle lifecycle smoke, но не заменяет cleanup contracts реальных SDK/CLI adapters.

Checkpoint: 2961 unit tests (40 skipped), 241 HTTP/WS contracts, три выбранных реальных
remote CLI/SDK/Direct SSH chat/restart сценария, server build/lint, UI typecheck,
Chromium send/stream/reload scenario, три inventory checks и production lifecycle smoke.
Unit/native HTTP tests покрывают concurrent preparation, delayed cleanup, поздний
chunk, cancel→новый run, clear/delete, обе model mutation paths, timeout без замены
старого run, interruption write failure и idempotent resource cleanup attempts.

Остаются durable execution/queue recovery journal, полный provider dispose/terminal
contract, удаление queue/backups вместе с session и decomposition prompt/execution/
stream logic. Общий deadline всей shutdown-последовательности, включая зависший
filesystem I/O и ошибки Nest hooks, также требует hardening этапа 10. Этап 7 не
отмечается завершённым по одному успешному lease checkpoint.

## 7.5. Tool policy

- [ ] Единый policy для read/write/search/shell/delete tools.
- [ ] Учитывать provider capability и execution environment capability.
- [ ] Сохранить plan/read-only ограничения.
- [ ] Не полагаться только на название tool от внешнего SDK.
- [ ] Нормализовать tool calls и usage events.
- [ ] Проверить command wrappers, redirects и destructive detection.

## 7.6. Models/setup/usage routes

- [ ] Перенести provider status и setup endpoints, отложенные на этапе 4.
- [ ] Перенести Claude/Codex/Gemini/ZAI usage endpoints.
- [ ] Перенести model discovery/cache refresh.
- [ ] Status не должен выполнять дорогую авторизацию без явного запроса.
- [ ] Setup mutation требует подтверждения и возвращает фактический target.

## 7.7. Agent routes

- [x] Start/query/follow-up/cancel.
- [x] Session list/history интеграция.
- [ ] Running agents read model.
- [ ] Streaming через EventBus compatibility layer.
- [x] Request завершение не отменяет долгоживущий agent job.
- [ ] Shutdown отмечает jobs interrupted до закрытия provider processes.

## Тесты

- Registry priority/aliases/duplicate detection.
- Capability matrix всех providers.
- Fake provider stream/follow-up/cancel/error.
- Agent session restart/recovery.
- Remote binding tests без controller fallback.
- Tool policy adversarial cases.
- Usage parsing fixtures.
- UI Agent и Running Agents smoke.

## Exit criteria

- Provider registration полностью явная и управляется Nest DI.
- Нет создания `SettingsService` внутри provider.
- Agent routes удалены из legacy bridge.
- Все providers проходят общий adapter contract suite.
- Active sessions корректно завершаются или помечаются interrupted при shutdown.
- Полный stage checkpoint пройден для fake providers и всех доступных
  environment-specific integration suites; результат зафиксирован отдельным
  завершающим коммитом в общей migration-ветке.
