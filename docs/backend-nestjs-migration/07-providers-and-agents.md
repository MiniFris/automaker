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
- [x] Отделить prompt/context construction.
- [x] Отделить provider selection.
- [x] Отделить execution environment preparation.
- [x] Отделить stream normalization/event publication.
- [x] Отделить follow-up/cancel.
- [ ] Отделить completion persistence/recovery.
- [ ] Сохранить session identifiers и UI event order.

На первом migration commit этого блока существующий `AgentService` допустимо зарегистрировать целиком как
Nest provider. Его деление выполняется после переноса routes и contract coverage.

### Срез: prompt/context builder

`AgentPromptBuilder` зарегистрирован отдельным provider в `AgentStateModule` и
передаётся в `AgentService` явно. Он собирает system prompt, историю и attachments,
сохраняет SDK preset при добавлении target context и перечитывает custom prompts
между сообщениями. Выбор provider и подготовка runtime в builder не перенесены.
Для managed execution controller context/memory не читаются; Direct сохраняет
CLAUDE.md, тогда как SDK-managed CLAUDE.md исключается из дублирующего контекста.
Отмена проверяется до и после асинхронного чтения контекста и изображений.

Проверки среза: 2973 unit tests (40 skipped), включая 12 отдельных builder tests;
241 HTTP/WS contract; server production build/lint и UI typecheck; три inventory
checks. Три выбранных реальных SSH сценария Direct/CLI/SDK подтвердили отсутствие
controller context и сохранение binding после restart/default change (34 остальных
теста отфильтрованы). Chromium smoke проверил send/stream/reload истории.
Production lifecycle smoke завершился с exit 0 для SIGTERM и SIGINT.
Это проверка среза, а не завершение этапа 7: оставшаяся декомпозиция и полный
provider/environment acceptance checkpoint остаются обязательными.

### Срез: execution environment preparation

`AgentEnvironmentPreparer` получает `AgentPromptBuilder` через Nest factory и
явно передаётся в `AgentService`. Он определяет необходимость managed context по
сохранённой конфигурации/binding, подготавливает execution options, дожидается
сохранения binding и только затем читает target context через выданный runtime.
При отмене во время подготовки полученный binding сохраняется, но последующее
чтение context и запуск provider прекращаются. Запись статистики target memory
остаётся best-effort без повторного выполнения и controller fallback.

17 component tests проверяют порядок сохранения/чтения, отмену до и во время
подготовки, ошибки конфигурации и persistence, отсутствие replay/fallback и
сохранение SDK preset. Контракт двух приложений проверяет независимые экземпляры
preparer. Проверки среза:

- `npm run test:server:unit`: 2990 passed, 40 skipped.
- `npm run test:server:contract`: 241 passed.
- `npm run build --workspace=apps/server`, `npm run lint:server:errors`,
  `npm run typecheck`: успешно.
- Три inventory checks и `node scripts/smoke-server-lifecycle.mjs`: успешно;
  production SIGTERM/SIGINT завершаются с exit 0.
- Выбранные SSH chat/restart/default-change сценарии Direct/CLI/SDK: 3 passed,
  34 отфильтрованы.
- Chromium `tests/agent/start-new-chat-session.spec.ts`: 1 passed, включая
  send/stream/reload истории.
- `npm run test:packages`: 1181 shared package/UI tests passed;
  `npm run lint:lockfile`: успешно.
- `npm run test:docker --workspace=apps/server` с переменной
  `MANAGED_DOCKER_TEST_BASE_IMAGE=automaker-nest-stage2-smoke:latest`:
  11 passed, 4 opt-in skipped. Расширенный
  Direct сценарий проходит через настоящий `AgentService`: tools, stream/complete,
  повторная загрузка persisted history и сохранение Docker binding после смены
  project environment на Local. Набор проверяет очистку принадлежащих fixture
  контейнеров, образа и тома. Первый прогон обнаружил ошибку новой тестовой
  проверки (`getHistory` возвращает объект с `messages`); после исправления
  весь Docker-набор повторно прошёл.

Полный этап 7 остаётся незавершённым: adapter-level contracts и completion/recovery
всё ещё требуют отдельной работы и общей приёмки.

### Срез: provider selection и query options

`AgentProviderSelector` получает `ProviderRegistry` и `ToolPolicyService` через
Nest factory. Он владеет разрешением custom endpoint, routing/bare model IDs,
проверкой vision, применением tool capability policy и controller disconnection
policy для Local против pinned Docker/SSH. `AgentService` больше не импортирует
registry, tool policy или settings helpers для выбора provider.

`AgentQueryOptionsBuilder` отдельно собирает SDK options, skills/subagents/MCP,
setting sources, credentials, thinking/reasoning и max turns. Настройки не
кэшируются между сообщениями; при отмене дальнейшие шаги подготовки прекращаются.
Mapped Claude model управляет SDK-настройками, но custom endpoint получает свой
исходный model ID. Completion persistence и запуск adapter не входят в builder.
Оба компонента зарегистрированы в `AgentStateModule`; two-app contract проверяет
независимость их экземпляров. В unit/SSH/Docker callers используется явная
композиция через `createTestAgentProviders`, без скрытого production fallback.

33 component tests проверяют selector/options отдельно. Дополнительные два
сценария с реальными SettingsService, SDK options и файловыми сессиями проверяют
explicit/model-only endpoint selection, смену mapped Claude model/max turns,
повторную загрузку сессии и сохранение API model ID и истории. Только исполнение
модели в этих двух сценариях заменено offline adapter.

Checkpoint среза:

- `npm run test:server:unit`: 3025 passed, 40 skipped, включая все 35 новых tests.
- `npm run test:server:contract`: 241 passed.
- `npm run build --workspace=apps/server`, `npm run lint:server:errors`,
  `npm run typecheck`: успешно.
- Три inventory checks и production SIGTERM/SIGINT lifecycle smoke: успешно.
- Выбранные реальные SSH chat/restart/default-change сценарии Direct/CLI/SDK:
  3 passed, 34 отфильтрованы.
- Docker acceptance с локальным base image `automaker-nest-stage2-smoke:latest`:
  11 passed, 4 opt-in skipped, включая real chat/restart и cleanup owned resources.
- Chromium send/stream/reload smoke: 1 passed.
- `npm run test:packages`: 1181 passed; `npm run lint:lockfile`: успешно.

Это не завершение этапа 7. Durable completion/recovery и полный provider capability/lifecycle contract ещё
не закрыты; этапы 8–11 также не объявляются завершёнными по этому checkpoint.

### Срез: stream normalization и EventBus publication

`AgentStreamNormalizer` — singleton factory query-local `AgentStreamState`:
накопленный текст, assistant message ID и tool-ID map не разделяются между
запросами. Нормализатор формирует cumulative stream/tool events и отдельный draft
completion без I/O и без публикации. `AgentService` по-прежнему владеет порядком
операций: запись SDK session ID → обработка chunk → iterator cleanup → запись
истории → публикация completion. Persistence/recovery пока не вынесены целиком.

`AgentEventPublisher` получает application `EVENT_BUS` через Nest factory.
Все chat events, включая queue/error/interruption, идут через него в тот же
совместимый envelope `agent:stream`. В `AgentService` больше нет прямого обращения
к legacy EventEmitter. Native HTTP contracts проверяют одинаковые события на
application bus и legacy wire, без дублирования, для обычного stream, result-only
ответа и native SDK tool-use/user-result shape, включая restart/follow-up и IDs.

В этом срезе также исправлены выявленные пограничные случаи:

- Result-only success создаёт assistant message, stream event и persisted history.
- Native SDK `tool_use.id` связывается с `user` tool results; user text echoes
  и user tool-use не публикуются как assistant output.
- SDK ID меняется в active state только после успешной записи metadata. После
  ожидания этой записи повторно проверяется cancellation; поздний chunk не выходит.
- Structured tool results с text/image/null/scalar parts приводятся к строке;
  missing text block не добавляет буквальный `undefined` к ответу.
- ANSI/Error-prefix cleanup, stale session detection и rate-limit hint используют
  общий helper; неизвестная форма ошибки даёт непустой fallback.

28 component tests покрывают нормализатор и publisher; четыре дополнительные
storage/lifecycle регрессии — result-only persistence, failed SDK-ID write,
iterator cleanup перед completion и cancellation во время metadata write.
Этот срез не заменяет полный terminal/capability/cancel contract каждого adapter.

Проверки среза:

- `npm run test:server:unit`: 3057 passed, 40 skipped.
- `npm run test:server:contract`: 243 passed, включая три native chat/restart
  варианта (chunks, buffered, native-tools) и isolation двух Nest applications.
- `npm run build --workspace=apps/server`, `npm run lint:server:errors`,
  `npm run typecheck`: успешно.
- Три inventory checks и production lifecycle smoke: успешно; SIGTERM/SIGINT exit 0.
- Выбранные реальные SSH Direct/CLI/SDK chat/restart/default-change сценарии:
  3 passed, 34 отфильтрованы.
- Docker acceptance с локальным base image `automaker-nest-stage2-smoke:latest`:
  11 passed, 4 opt-in skipped, включая real chat/restart, CLI/SDK и cleanup
  принадлежащих fixture контейнеров/образа/тома.
- Chromium send/stream/reload smoke: 1 passed.
- `npm run test:packages`: 1181 passed; `npm run lint:lockfile`: успешно.

### Срез: session loading, follow-up queue и cancellation

`AgentSessionLoader` отдельно восстанавливает сообщения, metadata, SDK resume ID
и очередь через application-owned registry. Missing storage и storage failure
не смешиваются. Fallback working directory приходит из `RuntimePathsService`;
`AgentService` больше не читает `process.cwd()` даже при создании новой сессии.

`AgentConversationCoordinator` владеет admission callback, отменой/cleanup,
stop/clear и shutdown interruption. Lease остаётся у предыдущего run до завершения
его callback/iterator cleanup; сохранённый SDK ID не сбрасывается обычным stop.
Interruption по-прежнему записывается перед abort, а ошибка записи не отменяет
обязательный abort/drain. `AgentService` сохраняет публичные compatibility методы.

`AgentPromptQueue` владеет сериализацией add/remove/clear, pinning model/provider,
durable queue writes, publication и выбором следующего follow-up. Execution lease
резервируется до dequeue. После async hydration повторно проверяется admission:
если начался shutdown или session mutation, новая queue mutation не записывается.
Публичные queue/control методы сохраняют rejected-Promise semantics; только send
admission conflict остаётся синхронным, как требует native HTTP 409 contract.

Все три компонента зарегистрированы отдельными Nest factory providers. Two-app
contract проверяет независимые экземпляры; тестовая композиция явно передаёт тот
же event publisher, repository, registry и execution coordinator каждому owner.
17 новых component tests дополняют existing native/service lifecycle regressions:
coalesced hydration, restart/SDK identity, injected directory, failed read/write,
concurrent admission, delayed selection/cleanup, clear без потери queue, pinning,
queue serialization, dequeue failure и shutdown во время hydration.

На этом срезе crash recovery ещё не был закрыт. Последующий queue delivery journal
защищает handoff между dequeue и user message без автоматического replay.
Также остаются общий execution journal для manual runs и completion persistence/recovery,
полный adapter dispose/terminal contract и hard shutdown deadline этапа 10.

Checkpoint среза:

- `npm run test:server:unit`: 3074 passed, 40 skipped, включая 17 новых component tests.
- `npm run test:server:contract`: 243 passed; native stop/lease и три
  chat/restart варианта сохраняют IDs, event order и history.
- Server production build/lint, UI typecheck, три inventory checks и production
  SIGTERM/SIGINT lifecycle smoke: успешно.
- Выбранные реальные SSH Direct/CLI/SDK chat/restart/default-change сценарии:
  3 passed, 34 отфильтрованы.
- Docker acceptance с локальным base image `automaker-nest-stage2-smoke:latest`:
  11 passed, 4 opt-in skipped, включая real chat/restart и cleanup owned resources.
- Chromium send/stream/reload smoke: 1 passed.
- `npm run test:packages`: 1181 passed; `npm run lint:lockfile`: успешно.

### Срез: durable queue handoff и quarantine после сбоя

`AgentQueueDeliveryStore` зарегистрирован отдельным Nest provider с собственным
application-local owner map и сериализацией на session ID. Перед dequeue он
атомарно записывает выбранный prompt, pinned model/provider и delivery UUID в
`DATA_DIR/agent-queue-deliveries/<sessionId>.json` с mode `0600`. Старый settled
backup не используется вместо повреждённого journal: такой read блокируется safe
storage error, а не трактуется как отсутствие незавершённой работы.

Для queued run `AgentService` сохраняет `deliveryId`, `queuedPromptId` и terminal
`deliveryStatus` вместе с историей. Это позволяет распознать committed terminal
history даже при аварии до settlement journal и не выполнять запрос снова.
Terminal proof публикуется только после iterator cleanup; streamed provider error
тоже дожидается cleanup до записи terminal failure. Последующие queued runs
планируются owner-ом очереди после settlement, чтобы отложенная запись journal
не обрывала цепочку follow-up или не запускала её повторно.

Если terminal proof отсутствует, recovery возвращает исходный prompt в queue с
`deliveryStatus: interrupted`, добавляет идемпотентный warning в history и очищает
SDK resume ID. Приостановленный head блокирует auto-processing; удалить его или
явно отправить новый запрос должен пользователь после проверки target effects.
Recovery проверяется и для cached session. Старый queue backup не может снять
quarantine или вернуть completed queued prompt в выполнение; явное удаление
приостановленного prompt уважается. Отсутствие metadata не позволяет journal
восстановить удалённую session.

Consumed IDs и quarantine IDs сохраняются в journal независимо от message history
и переносятся между deliveries. Поэтому очистка history и последующие queued runs
не снимают защиту при восстановлении старого queue backup. Ledger пока не compact-ится
и требует включения в retry-safe session-delete/tombstone cleanup.

UI загружает server queue при открытии session, показывает локализованное
предупреждение/Paused и обновляет очередь после queue error. Revision guard не
даёт запоздалому hydration response перезаписать более новый stream update.
Новые поля additive; HTTP endpoints и исходные IDs queued prompts сохранены.

Проверки среза:

- 18 delivery tests: claim-before-dequeue, quarantine/no replay, terminal proof,
  stale/corrupt backups, partial recovery, claim/settlement failure и реальные
  последовательные follow-up через `AgentService` без повторного model execution.
- Дополнительная storage regression: error-stream cleanup завершается до
  terminal persistence/publication.
- Три child-process SIGKILL contracts: после claim, после dequeue, после terminal
  history до journal settlement. Unknown runs не replay-ятся и теряют старый SDK
  resume ID; completed run сохраняет ответ и SDK identity без повторного запуска.
- `npm run test:server:unit`: 3093 passed, 40 skipped.
- `npm run test:server:contract`: 246 passed.
- `npm run test:packages`: 1185 passed, включая 4 новые UI recovery/hydration tests.
- Server production build/lint, UI typecheck/lint и lockfile check: успешно.
- Три inventory checks и production SIGTERM/SIGINT smoke: успешно.
- Выбранные SSH Direct/CLI/SDK chat/restart сценарии: 3 passed, 34 отфильтрованы.
- Docker acceptance: 11 passed, 4 opt-in skipped; cleanup owned resources успешен.
- Chromium send/stream/reload smoke: passed. Один параллельный прогон остановился
  на общем loading screen после reload с 5-секундным assertion timeout; повторный
  отдельный прогон прошёл без изменения timeout или ослабления assertion.

Границы: проверен сбой controller process, а не power-loss/fsync guarantee.
Поддерживается один controller writer на DATA_DIR, не distributed coordination.
Общий journal manual runs, transactional completion intent/recovery, cleanup
journal/queue/backups при полном session delete и полный adapter lifecycle
contract ещё не завершены. Этап 7 и вся миграция не объявляются завершёнными.

Rollback gate: нельзя запускать старый backend, который игнорирует
`deliveryStatus: interrupted`, против DATA_DIR с quarantined queue entries.
Перед таким rollback необходим preflight и перенос quarantine в отдельное
неисполняемое хранилище либо восстановление согласованного pre-migration snapshot.
Проверка этого rollback сценария ещё обязательна на cutover-этапе; additive HTTP
fields сами по себе не доказывают безопасный rollback формата очереди.

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

Остаются общий durable execution/completion recovery journal, полный provider
dispose/terminal contract и удаление queue/backups/journal вместе с session.
Queue handoff уже защищён последующим delivery journal, описанным выше.
Prompt/context, environment preparation, provider selection, stream normalization/
publication и follow-up/cancel уже выделены последующими срезами, описанными выше.
Общий deadline всей shutdown-последовательности, включая зависший
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
- [x] Streaming через EventBus compatibility layer.
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
