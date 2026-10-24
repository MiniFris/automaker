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

- [x] Зафиксировать общий interface: installation/auth status, models, capabilities,
      start, stream, follow-up, cancel и dispose.
- [x] Разделить provider capability и model capability.
- [ ] Явно описать vision, tools, thinking/reasoning, MCP и remote execution.
- [ ] Не считать неизвестную capability автоматически доступной.
- [ ] Стандартизировать provider events до передачи в application event bus.
- [ ] Нормализовать cancellation и terminal reasons.

### Срез: managed provider execution scopes

`ProviderAdapter` явно включает `executeQuery`. У всех семи production adapters
public `executeQuery/start/followUp` проходят через общий `BaseProvider` template,
а SDK/CLI implementation вынесена в protected `execute`. OpenCode retries вызывают
protected CLI implementation, не создавая вложенные managed leases. Catalog,
aliases и fresh-instance factory semantics registry сохранены.

Каждый adapter владеет собственным `ProviderExecutionScope`; Nest `ProviderRegistry`
передаёт общий application owner всем выдаваемым adapters. Registry хранит только
живые/unconfirmed query leases, а не неограниченный список созданных idle instances.
Один provider instance нельзя передать двум application scopes. Новая registry
не получает controllers или active state другой Nest application.

Запрос получает дочерний AbortController с односторонним forwarding родительской
отмены. `return/throw` сначала abort-ят дочерний controller, затем закрывают iterator:
иначе `return` мог ждать бесконечно за pending `next`. Родительский controller не
отменяется при раннем закрытии stream, что сохраняет spec→features workflow.
Abort reasons не передаются в SDK. Direct provider сохраняет прежние cancellation
error/result packets; поздний content после отмены не публикуется.

Lease снимается после iterator finalization. `dispose` закрывает admission,
abort-ит все owned queries и ждёт cleanup с пятисекундным deadline. Повторный
dispose идемпотентен. Timeout не объявляется успехом, unconfirmed lease не
освобождается для замены; cleanup exception выдаёт безопасный
`ProviderCleanupError` без сырых SDK details. Registry завершает эти leases через
`OnApplicationShutdown`, после существующей before-shutdown последовательности.
Сам `return` ждёт iterator cleanup; bounded cancellation chat jobs по-прежнему
обеспечивает conversation coordinator, сохраняя lease при timeout.

`AgentService` не пишет terminal execution intent при `ProviderCleanupError`,
conversation cancellation не скрывает эту ошибку, queue не подтверждает consumption.
Boundary test проверяет настоящий queued run: после cleanup failure journal остаётся
running/claimed, recovery показывает paused/unknown, а replacement query не вызывает
provider. Обычная API/model error с подтверждённым iterator closure не блокирует
следующий query.

Copilot local adapter дополнительно исправлен по контракту установленного SDK:
abort будит callback/event bridge, event subscription снимается, cleanup выполняется
в `finally`, включая ранний return. `client.stop()` владеет уничтожением sessions;
отдельный предварительный `session.destroy()` не дублирует его работу. Non-empty
массив ошибок resolved `stop()` больше не считается успешным cleanup. Fake SDK
проверяет early return, отложенный destroy/stop, unsubscribe и три failure paths.

Проверки среза:

- 10 execution-scope tests и 2 AgentService/queue uncertainty boundary tests,
  включая совпадающую по времени отмену родительского run.
- 7 production adapters проверены на managed public entrypoint и отказ start/
  follow-up после dispose без SDK/CLI execution.
- Copilot suite: 49 passed, включая 5 новых lifecycle regressions.
- `npm run test:server:unit`: 3150 passed, 40 skipped.
- `npm run test:server:contract`: 258 passed. Новый native Nest contract доказывает,
  что shutdown ждёт delayed cleanup registry-owned stream вне AgentService.
- Spec→features contract использует настоящий managed BaseProvider и сохраняет
  cancellation state родительского workflow между фазами.
- `npm run test:packages`: 1194 passed; UI typecheck и lockfile check успешны.
- Server production build/lint, formatting, diff и три inventory checks успешны.
- Итоговый последовательный build → lint → lifecycle smoke: SIGTERM/SIGINT exit 0.
  Один ранний параллельный smoke завершился до readiness во время clean-build;
  последовательный повтор прошёл без изменения startup/shutdown deadlines.
- Выбранные SSH CLI/SDK/Direct chat/restart: 3 passed, 34 отфильтрованы.
- Docker acceptance: 11 passed, 4 opt-in skipped; cleanup owned resources успешен.
- Chromium send/stream/reload и held-chat Running Agents: 2 passed.

Граница: подтверждено завершение iterator/SDK cleanup API, не универсальная
гарантия OS-level termination всех SDK subprocesses. Полная capability matrix,
terminal reason normalization, transport-specific cancellation/process-exit
contracts для каждого SDK/CLI и общий shutdown deadline приложения ещё требуют
проверок. В частности, successful SDK stop API сам по себе не доказывает exit
каждого внешнего процесса. Этап 7 и вся миграция остаются незавершёнными.

### Срез: native adapter/model capability boundaries

`getCapabilities()` теперь описывает реализованные пути adapter, не делает
catalog/probe calls и не выводит grants из legacy `supportsFeature` или наличия
хотя бы одной богатой модели. Не объявленные feature flags закрыты по умолчанию.
Text/stream/follow-up/cancellation описывают общий managed stream contract.

| Adapter           | Vision path | Tools path | Reasoning controls | MCP path | Remote execution path |
| ----------------- | ----------- | ---------- | ------------------ | -------- | --------------------- |
| Claude            | да          | да         | да                 | да       | да                    |
| Codex             | да, CLI     | да         | да                 | да, CLI  | да                    |
| Cursor            | нет         | да         | нет                | нет      | да                    |
| Gemini            | нет         | да         | нет                | нет      | да                    |
| Copilot           | нет         | да         | нет                | нет      | да                    |
| OpenCode          | нет         | да         | нет                | нет      | да                    |
| OpenAI-compatible | нет         | да         | нет                | нет      | да                    |

Таблица указывает наличие реализованного пути, а не поддержку каждой возможности
во всех SDK/CLI modes или execution environments. Например, возможности Codex CLI
не означают те же возможности SDK path; проверка конкретного runtime остаётся
отдельной границей. Gemini model metadata получает `hasReasoning` из существующего
`supportsThinking`, но adapter не обещает поддержку reasoning controls.

`getModelCapabilities()` возвращает независимые model flags из каталога. Для lookup
разрешены только точный application ID, точный SDK ID и явные Claude aliases из
`CLAUDE_MODEL_MAP`/`CLAUDE_CANONICAL_MAP`. Fuzzy suffix matching удалён: version/date
suffix или произвольная часть ID больше не получает capabilities известной модели.
Точный application ID имеет приоритет; неоднозначный SDK ID получает пересечение
grants всех совпавших записей, а не первую запись в порядке каталога.

Внутренний `ProviderRegistry.modelCapabilities()` вычисляет adapter ∩ model.
`supportsVision()` использует это пересечение: text-only CLI paths не получают
vision только из metadata модели. AgentService tests проверяют отказ до чтения
attachments и provider execution; Gemini case намеренно использует vision-capable
модель с неподдерживаемым image transport.

Native chat и Auto Mode формируют tool-option list по capabilities выбранной
модели, а не по provider-wide флагу. Rich соседняя модель не выдаёт tools text-only
или неизвестному ID. Это фильтрация SDK options, **не** доказательство полного
runtime permission enforcement: например, Claude `allowedTools` и фактическая
регистрация доступных SDK tools — разные границы; их hardening остаётся в 7.5.

Compatibility boundary: настроенные Claude-compatible endpoints пока сохраняют
прежнюю SDK tool policy. В их model settings ещё нет отдельного explicit tool grant;
автоматическое отключение всех существующих GLM/MiniMax profiles этим срезом не
вводится. Эта legacy policy явно передаётся через provider selection, а не выводится
из `mapsToClaudeModel` budget mapping. Direct endpoint capabilities по-прежнему
проверяются в server-resolved connection/environment boundary; глобальный native
catalog не выдаёт grants произвольному Direct model ID.

Проверки: 22 capability tests покрывают все семь adapters, отсутствие catalog probes,
unknown/partial IDs, неоднозначные SDK IDs, Claude aliases и model-specific tool
options; отдельные tests покрывают Auto Mode, legacy endpoint compatibility и
два AgentService image отказа. Native tool filtering не закрывает общий tool policy.

Checkpoint среза:

- `npm run test:server:unit`: 3176 passed, 40 skipped.
- `npm run test:server:contract`: 258 passed.
- `npm run test:packages`: 1194 passed.
- Server production build/lint, UI typecheck, lockfile, formatting и
  `git diff --check`: успешно.
- Три generated inventory checks: успешно.
- Последовательный build → lint → `smoke-server-lifecycle.mjs`: SIGTERM/SIGINT exit 0.
- Выбранные SSH CLI/SDK/Direct chat/restart: 3 passed, 34 отфильтрованы.
- Полный Docker acceptance с локальным
  `MANAGED_DOCKER_TEST_BASE_IMAGE=automaker-nest-stage2-smoke:latest`: 11 passed,
  4 opt-in skipped; cleanup owned resources успешен.
- Chromium send/stream/reload и held-chat Running Agents: 2 passed.

Остаются explicit custom-endpoint grants, runtime/environment-specific capabilities,
проверки отсутствия silent option/image loss у каждого SDK/CLI path и применение
policy ко всем tools/MCP entrypoints. Поэтому пункты «не считать неизвестную
capability автоматически доступной» и полного tool policy пока не закрываются;
этап 7 не объявляется завершённым.

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
- [x] Отделить completion persistence/recovery.
- [x] Сохранить session identifiers и UI event order.

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
и на этом срезе ещё требует включения в retry-safe session-delete/tombstone cleanup
(закрыто следующим срезом ниже).

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

### Срез: retry-safe session deletion

`AgentSessionDeletion` — отдельный application-scoped Nest provider. DELETE
резервирует execution/queue barriers, дожидается остановки provider и атомарно
сохраняет `DATA_DIR/agent-session-deletions/<sessionId>.json` до удаления данных.
Маркер содержит только version, session ID, phase и timestamps; файл имеет mode
`0600`, каталог — `0700` при создании. Сначала фиксируется `deleting`, после
успешной очистки — `deleted`. Старый marker backup не используется для recovery.

После фиксации intent ID скрыт из metadata/list/history/queue, cached hydration
инвалидируется, новые writes и `agent/start` с этим ID отклоняются. Удаляются
messages, queue и delivery journal вместе с принадлежащими writer backups/temps.
Учитываются также temps атомарного scrubbing backup и вложенные temps после сбоя.
Чужие файлы с похожим префиксом не удаляются. Shared metadata snapshots очищаются
от tombstoned rows без удаления данных остальных сессий.

Частичный cleanup возвращает безопасный 503 и оставляет `deleting`. Повторный
DELETE, в том числе после перезапуска и уже удалённой metadata, продолжает очистку.
После завершения повторный DELETE сохраняет прежний 404/not-found контракт.
Уже начатые file/journal writes дожидаются settlement до успешного cleanup;
поздний delivery finish не может создать journal заново. Queue worker не публикует
ложный queue error для уже удалённой сессии.

Повреждённый tombstone блокирует чтение, а не трактуется как отсутствие.
Повреждённый shared snapshot оставляет cleanup незавершённым и требует исправления
этого snapshot перед повтором; весь файл с чужими recovery data не удаляется.
Tombstones сохраняются и после завершения, без автоматического GC или повторного
использования ID. Индекс рассчитан на один controller writer на DATA_DIR.

Проверки: 9 real-filesystem unit tests покрывают точную область cleanup, private
mode, сбои intent/unlink/metadata/completion, restart/retry, delayed writer,
stale/corrupt snapshots и запрет late delivery/reuse. Три child-process SIGKILL
contracts прерывают настоящий deletion coordinator после intent, после artifact
cleanup и перед terminal marker. Native Nest HTTP contract проверяет
DELETE 503 → GET 404/list без ID → start 409 → retry DELETE 200 → repeat DELETE 404,
а также сохранность другой сессии. Two-app contract подтверждает независимые
экземпляры deletion provider.

Checkpoint среза:

- `npm run test:server:unit`: 3102 passed, 40 skipped.
- `npm run test:server:contract`: 250 passed.
- `npm run test:packages`: 1185 passed.
- Server production build/lint, UI typecheck/lint, lockfile и formatting/diff checks.
- Три generated inventory checks.
- `node scripts/smoke-server-lifecycle.mjs`: SIGTERM/SIGINT exit 0.
- SSH Direct/CLI/SDK chat/restart: 3 passed, 34 отфильтрованы; команда выбора
  сценариев та же, что в предыдущем срезе.
- `MANAGED_DOCKER_TEST_BASE_IMAGE=automaker-nest-stage2-smoke:latest npm run
test:docker --workspace=apps/server`: 11 passed, 4 opt-in skipped.
- Chromium `start-new-chat-session.spec.ts`: 1 passed (send/stream/reload).

Rollback gate распространяется и на tombstones: старый backend, игнорирующий
deletion markers, не должен запускаться против DATA_DIR с незавершённой очисткой
или snapshots, способными восстановить удалённую сессию. Нужен проверенный
preflight/downgrade путь либо согласованный pre-migration snapshot. Этот gate
ещё не реализован; общий manual-run/completion recovery и полный provider adapter
contract также остаются незавершёнными. Этап 7 не закрывается этим срезом.

### Срез: durable execution и terminal intent

`AgentExecutionStore` выделен в application-scoped Nest provider и передаётся
явно в `AgentService`, loader и deletion coordinator. Обычные и queued запросы
получают внутренний UUID `runId`. До первого history save и provider preparation
атомарно записывается `DATA_DIR/agent-executions/<sessionId>.json`, phase `running`.
В journal нет provider clients, query options или credentials; pending record
содержит private user message, а terminal intent — snapshot history и SDK ID.
Файл имеет mode `0600`; старые backups и uncommitted temps не используются для
rollback текущего journal.

После завершения iterator cleanup записывается phase `completing` с terminal
status `completed`, `failed` либо `cancelled`. Только затем сохраняются history,
metadata timestamp и terminal queue consumption, после чего journal переходит в
`settled`. Публикация live completion происходит после этого commit. В settled
record не остаются prompt/history/SDK snapshot; явный clear не возвращает старую
history при последующей загрузке. Session/message IDs и HTTP endpoints сохранены,
`runId`/`executionStatus` в messages — additive fields, порядок UI events прежний.

Cold и cached hydration сначала восстанавливают execution intent, а затем queue
delivery. `completing` заканчивает interrupted persistence без вызова модели,
включая восстановление SDK ID и history из intent при повреждённом history main.
`running` без живого owner означает неизвестный terminal outcome: user message
сохраняется с `executionStatus: interrupted`, SDK resume ID очищается, добавляется
идемпотентное предупреждение. Запрос не запускается повторно. Для queued run
предупреждение и paused item создаёт существующий delivery recovery, без второго
execution warning и без ложного terminal delivery proof.

Handled initial history write failure, до которого provider не мог вызываться,
закрывает unstarted journal как failed и сохраняет прежний rollback RAM/history.
Если и эта запись не удалась, остаётся pending record для conservative recovery.
Повреждённый journal блокирует запуск безопасным 503; неизвестный результат нельзя
превратить в blank session или автоматический retry.

Terminal intent включает подтверждение queue ledger до освобождения execution
lease. Это закрывает воспроизведённую тестом гонку: clear history после execution,
но до внешнего `queue.finish`, раньше мог вернуть уже завершённый queued prompt
как paused после crash. Теперь queue consumption уже durable; ошибка этой записи
оставляет execution в `completing` и завершается recovery, без model replay.
Все queue entrypoints используют один порядок recovery через loader.

Session tombstone имеет приоритет над execution journal; session delete удаляет
его main/backups/owned temps вместе с остальными artifacts и fence-ит late writes.
Поддерживается один controller writer на DATA_DIR; это не distributed transaction,
не гарантия power-loss/fsync и не exactly-once выполнение внешних target effects.
Recovery ленивый, при hydration, а не автоматическое продолжение jobs при startup.

Проверки: 17 real-filesystem execution tests покрывают ownership, intent/history/
metadata/settlement/queue-consumption failures, partial recovery, clear/delete,
corrupt main и запрет backup rollback. Шесть native Nest SIGKILL contracts:
до первой history write, во время stream, после terminal intent, после history,
после settlement и перед terminal queue-ledger commit. Они проверяют отсутствие
model calls после restart, правильный outcome/SDK ID и отсутствие resurrection
после clear. SIGTERM/SIGINT contracts дополнительно проверяют settled/cancelled
journal без private snapshots после provider cleanup. Two-app contract проверяет
независимые store instances.

Model mutation через `/sessions/:id` сначала завершает pending intent внутри
mutation barrier, а затем меняет модель и сбрасывает SDK ID. Отдельный regression
test воспроизводит и закрывает восстановление старого SDK ID на новой модели
при последующей hydration.

Checkpoint среза:

- `npm run test:server:unit`: 3120 passed, 40 skipped.
- `npm run test:server:contract`: 256 passed.
- `npm run test:packages`: 1185 passed.
- `npm run build --workspace=apps/server`, `npm run lint:server:errors`,
  `npm run typecheck`, `npm run lint:errors`, `npm run lint:lockfile`: успешно.
- `npm run inventory:server-deps:check`, `npm run inventory:server:check`,
  `npm run inventory:api-consumers:check`, formatting и `git diff --check`: успешно.
- `node scripts/smoke-server-lifecycle.mjs`: SIGTERM/SIGINT exit 0.
- Выбранные SSH Direct/CLI/SDK chat/restart сценарии: 3 passed, 34 отфильтрованы.
- Полный `test:docker` с локальным
  `MANAGED_DOCKER_TEST_BASE_IMAGE=automaker-nest-stage2-smoke:latest`: 11 passed,
  4 opt-in skipped, cleanup owned resources успешен. Пробный `-t` только для chat
  оказался невалиден: suite использует bindings/image из предшествующих сценариев.
  Проверка повторена целиком; оставшийся временный каталог невалидного прогона
  удалён отдельно, production/user resources не затронуты.
- Chromium `start-new-chat-session.spec.ts`: 1 passed (send/stream/reload).

Это закрывает decomposition completion persistence/recovery, но не весь этап 7:
полный provider capability/dispose contract, tool policy, setup/usage границы,
Running Agents read model и cutover/downgrade gates ещё требуют реализации и
проверок. Старый backend нельзя запускать против pending execution journals без
проверенного downgrade preflight либо согласованного pre-migration snapshot.

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

На момент lease-среза оставались общий durable execution/completion recovery
journal, полный provider dispose/terminal contract и cleanup session artifacts.
Execution journal и session-delete cleanup закрыты последующими срезами выше;
полный provider dispose/terminal contract ещё не закрыт.
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
- [x] Перенести Claude/Codex/Gemini/ZAI usage endpoints: `ProviderUsageController`
      и native usage factories; HTTP cutover не закрывает оставшиеся consent,
      adapter redaction и platform cleanup gates.
- [x] Перенести model discovery/cache refresh.
- [ ] Status не должен выполнять дорогую авторизацию без явного запроса.
  - [x] Cursor setup status: passive host key/file hints, без token reads,
        auth/version fallback и WSL auth probes; separate connection marker (API v13).
  - [x] Gemini/Copilot setup status: passive application hints, без auth commands
        и без продвижения file/token presence в verified authentication (API v11/v10).
  - [x] GitHub setup status: пассивный GET без API/auth probes, отдельный confirmed
        native check с hostname/CLI/host target, protocol gate и явным UI действием (API v8).
- [ ] Setup mutation требует подтверждения и возвращает фактический target.
  - [x] Disconnect всех шести CLI providers: shared schema, явное подтверждение,
        instance/provider/path target и native application-scoped command.
  - [x] Reconnect всех шести CLI providers: confirmed target, FIFO connection
        changes, read-only protocol gate и отдельное credential evidence.
  - [x] Read-only install guidance Claude/Codex: native service, явное отсутствие
        установки, фактический application target и отсутствие ложного UI success.
  - [x] Cursor permissions: native read/profile/custom/delete/example, host-file
        target preview, confirmation, FIFO writes и UI dialog (API v4).
  - [x] Cursor project model config: native read/default-model/models, known-model
        validation, host-file target, confirmation и protocol gate (API v5).
  - [x] Claude verification: native runtime, explicit billable-query consent,
        endpoint/model/method target, isolated environment и protocol gate (API v6).
  - [x] Codex verification: native auth-only CLI RPC и tool-free Responses probe,
        CLI/API-key separation, confirmed endpoint/model/profile и protocol gate (API v7).
  - [x] Key store/delete: native commands, private storage target/confirmation,
        durable activation, protocol gate и removal setup handler bridge (API v9).
  - [ ] Единый setup/credential-consumer policy; настоящий host
        installer, если потребуется, проектируется отдельно с confirmation.

### Срез: native Gemini/Copilot/Cursor setup status

GET `/api/setup/gemini-status`, `/api/setup/copilot-status` и
`/api/setup/cursor-status` переведены с Express-handler bridge на native методы
`SetupController` и application-scoped `ProviderSetupStatusService`. Сервис получает
`ProviderRegistry` и `ProviderConnectionRepository` через Nest DI; конкретные
provider classes, `process.cwd()` и marker paths в HTTP/application layer больше
не используются. CLI setup port проверяется явно: отсутствующий или несовместимый
адаптер даёт безопасный 500, а не fallback на другой provider.

Сохранены public access policy, успешные HTTP payloads, install/login commands и
различия disconnected responses: Gemini/Copilot не создают адаптер, Cursor сообщает
installation/version, но не проверяет auth. Изменения connection marker видны уже
следующему запросу, без stale cache. Вместо `detectInstallation()` с последующим
повторным `checkAuth()` выполняется одна auth-проверка на запрос. Сырые исключения
и `auth.error` адаптера заменяются безопасными сообщениями, чтобы не возвращать
credentials/CLI output в API. Три прежних route implementation удалены.

Проверки среза:

- 19 новых unit cases: injected adapter, однократный auth, payload metadata,
  missing installation, disconnect/reconnect, отсутствие credential probes при
  disconnect, missing/incompatible port и безопасные ошибки.
- Новый HTTP contract использует настоящий Nest application и внедрённые test
  adapters: три public endpoints, два одновременно работающих приложения с разными
  working directories, независимые markers, reconnect и error response.
- `npm run test:server:unit`: 3195 passed, 40 skipped.
- `npm run test:server:contract`: 259 passed.
- `npm run test:packages`: 1194 passed.
- Server production build/lint, UI typecheck/lint и lockfile check успешны.
- Route/dependency inventories обновлены; все три inventory checks успешны.
- Startup/shutdown smoke: SIGTERM/SIGINT exit 0.
- Chromium chat/Running Agents smoke: 2 passed.

Граница: это не завершение пункта 7.6 или этапа 7. Оставшиеся setup/status routes,
model discovery/cache и native ownership usage implementations ещё требуют переноса.
CLI detection/version/auth внутри самих adapters пока используют прежние runtime
источники и subprocess helpers. В частности, Copilot `checkAuth()` может запускать
дорогой `gh auth status`; требование дешёвого passive status без явного auth request
ещё не выполнено. Live provider login, SSH/Docker и packaged Electron acceptance
этот срез не проверяет и не объявляет пройденными.

### Срез: native Codex/OpenCode status и application-owned model discovery

Перенесены ещё девять endpoints: Codex/OpenCode status, GET models / POST refresh /
POST clear для Copilot и OpenCode, GET OpenCode providers. `SetupController`
возвращает native Nest responses; POST сохраняет HTTP 200. Два status handlers и
два catalog route modules удалены вместе с module-level provider singletons.
Прежние реализации доступны в истории Git.

`ProviderSetupStatusService` получает Codex/OpenCode из внедрённого registry,
не создаёт providers самостоятельно. Codex disconnected response не вызывает
installation/auth probes. OpenCode environment-key hints читаются из `RUNTIME_CONFIG`,
а не `process.env` в route. Сохранены install commands, OAuth/key hints,
missing-installation recommendation и существующая public access policy.
Сырые исключения не выдаются клиенту.

`ProviderModelCatalogService` владеет отдельными discovery adapter generations
для каждого приложения и provider name. Повторные reads используют кеш;
параллельные initial/forced refresh объединяются. Clear отсоединяет поколение:
его уже запущенный запрос может получить старый результат, но завершившийся refresh
не восстанавливает кеш для следующих запросов. Новый read получает новый adapter
из registry. Это опирается на production registrations с fresh-instance factories,
а не на provider singleton. Отказ refresh не оставляет зависший promise и не мешает
повторной попытке. При Nest shutdown закрывается admission (503) и ожидаются все
начатые discovery operations, включая auth discovery и отсоединённые поколения.

OpenCode `getAvailableModels()` теперь всегда offline, даже для expired snapshot.
`hasCachedModels()` учитывает expiry; сервис явно ожидает обновление просроченного
каталога вместо запуска background CLI process из synchronous metadata getter.
Copilot сохраняет существующую cache lifetime policy. Authenticated providers
возвращаются отдельным отфильтрованным списком, как раньше.

Пункт переноса model discovery/cache refresh отмечен выполненным на уровне
HTTP/application ownership: Copilot/OpenCode обслуживает новый native сервис,
Codex catalog уже обслуживается `ProviderUsageController`/`ProviderUsageService`
с внедрённым `CodexModelCacheService`, общий catalog — `ModelsCatalogService`.
Это не означает завершения transport-specific CLI/SDK acceptance или usage refactor.

Проверки среза:

- 17 catalog unit cases: lazy cache, expiry, forced refresh, coalescing, clear races,
  два приложения/provider names, retry, безопасные ошибки, shutdown и auth discovery.
- 10 дополнительных status cases для Codex/OpenCode и 2 regression cases,
  доказывающих offline OpenCode getter и явный expiry check.
- Новый HTTP contract проверяет все девять endpoints, POST 200, независимые кеши и
  environment hints двух Nest apps, Codex disconnect и реальный Nest shutdown,
  ожидающий delayed refresh уже очищенного поколения.
- `npm run test:server:unit`: 3224 passed, 40 skipped.
- `npm run test:server:contract`: 260 passed.
- `npm run test:packages`: 1194 passed.
- Server production build/lint, UI typecheck/lint и lockfile check успешны.
- Route/dependency inventories обновлены, три inventory checks успешны.
- Startup/shutdown smoke: SIGTERM/SIGINT exit 0.
- Chromium chat/Running Agents smoke: 2 passed.

Границы: низкоуровневые CLI helpers, settings/credential sources внутри adapters и
общий application shutdown deadline ещё требуют работы. Ожидание discovery promise
не является доказательством OS-level exit всех внешних процессов. Live login,
SSH/Docker и packaged Electron acceptance для этого среза не запускались. На момент
среза Claude/GH status, setup mutations и usage implementations оставались в работе. OpenCode status
сохраняет прежнюю интерпретацию auth indicators независимо от local disconnect marker;
согласование этого поведения и дешёвый passive status ещё не закрыты. Этап 7 и вся
миграция не объявляются завершёнными.

### Срез: native host status и application-scoped setup credential cache

Claude/GitHub CLI status, platform info и API-key availability переведены на native
`SetupController` / `HostSetupStatusService`. Удалены четыре Express route handlers
и route-owned `get-claude-status` helper; прежние версии доступны в Git. Сохранены
public access policy, успешные payloads, Claude auth flags/priority, disconnected
masking, GitHub version/user parsing и platform flags. В частности, Claude flags
`oauthTokenValid`/`apiKeyValid` сохраняют прежнюю эвристику наличия credentials,
а не становятся доказательством успешной network verification.

`SetupStatusRuntime` отделяет application logic от OS/CLI/filesystem inspection.
Node adapter ищет CLI, запускает именно найденный executable с vector arguments,
`shell: false`, timeout 10 seconds и bounded output 128 KiB. Ошибка version probe
не отменяет installation evidence. GitHub API user probe и fallback auth status
используют тот же найденный path, включая common-path fallback. Windows PATH casing
нормализуется; Windows `.cmd` version probe остаётся best-effort, без включения
shell execution ради metadata. При shutdown adapter закрывает admission и ожидает
уже принятые операции целиком, включая цепочки нескольких subprocess calls.

`HOST_ENVIRONMENT` — неизменяемый bootstrap snapshot для host subprocesses.
Production bootstrap и test composition передают его явно через `AppModule` /
`RuntimeConfigModule`; environment не пересылается в legacy application options
и не возвращается в HTTP. Runtime использует snapshot и injected working directory,
а не module-level environment. OS user-profile inspection остаётся за platform port.

Route-global API-key map заменён application-scoped `SetupCredentialCache`.
Оставшиеся store/delete/verify factories получают его явно из Nest composition,
без default singleton или самостоятельного создания кеша. Native Claude/API-key
status читает тот же кеш. App-owned availability overrides сохраняют видимые
store/delete effects относительно bootstrap environment, не считывая изменения
process-global environment другого приложения. В E2E composition host runtime
подменяется только явно зарегистрированным test fixture; production bootstrap
не содержит mock flags или успешных fake auth paths.

Проверки среза:

- 25 host status cases: auth priority/evidence, disconnect, missing CLI, platform,
  API-key booleans, app isolation и safe errors.
- 14 runtime cases: resolved binary, empty/fallback detection, bounded shell-free
  execution, metacharacters/spaces in executable path, injected environment,
  Windows PATH/where, API/auth fallback и shutdown drain.
- 3 bridge cases доказывают общий injected cache для legacy mutations/native
  status; `.env` persistence в них заменена spy и не затрагивает user files.
- Новый native HTTP contract использует реальные локальные CLI fixtures в owned
  temporary directories: два приложения, независимые PATH/cwd/environment,
  immutable bootstrap snapshot, четыре endpoints, credential cache и disconnect.
  Реальные пользовательские credential files и GitHub API не читаются: auth
  indicators заменены fixture. Дополнительно настоящий CLI child удерживается
  owned filesystem gate; Nest close ждёт его завершения, закрывает admission,
  второе приложение продолжает обслуживать запросы. Это не live provider login.
- Connection-test timeout contracts для обоих verify factories сохранены.
- `npm run test:server:unit`: 3266 passed, 40 skipped.
- `npm run test:server:contract`: 261 passed.
- `npm run test:packages`: 1194 passed.
- Server production build/lint, UI typecheck/lint, lockfile и три inventory checks
  успешны; generated inventories обновлены.
- Startup/shutdown smoke: SIGTERM/SIGINT exit 0.
- Chromium chat/Running Agents smoke: 2 passed.

Границы: credential cache isolation не означает завершения credential/runtime
refactor. Legacy setup mutations всё ещё меняют `process.env`, пишут `.env` через
прежний cwd-based helper и не стали атомарными native commands с подтверждением
target. Другие provider adapters/verify helpers пока также имеют global runtime
effects; их изоляция и profile-target consistency требуют отдельного переноса.
GitHub GET status по-прежнему может выполнять API/auth probes; дешёвый passive
status ещё не реализован. Общий shutdown deadline, subprocess-tree termination,
live login, SSH/Docker и packaged Electron/Windows acceptance этот срез не закрывает.
Этап 7 и вся миграция остаются незавершёнными.

### Срез: confirmed native provider disconnect / API v2

Шесть POST `deauth-{claude,codex,cursor,gemini,copilot,opencode}` переведены из
Express-handler bridge в `ProviderConnectionCommandService`. Шесть прежних route
implementations и неиспользуемые Copilot disconnect/read helpers удалены; версии
доступны в Git. Remaining Copilot reconnect helper пока legacy и не считается
перенесённым.

`GET /api/setup/connection-target?provider=...` возвращает read-only target:
`kind: host-application`, provider, working directory и instance UUID. Нужен
строгий body `{ confirmed: true, target }`; wrong provider/path/instance получает
409 до filesystem mutation. Restart создаёт новый instance UUID, поэтому старое
подтверждение не переиспользуется. Empty/unconfirmed/ambiguous body получает 400.
Успех сохраняет прежние `success`/`message`, добавляя `connected: false` и фактически
использованный target. Admission закрывается при shutdown, начатые writes дожидаются
завершения. Обоснование breaking request change и coordinated client upgrade —
ADR-009; общий API contract version повышен до 2, error envelope сохранён.

`ProviderConnectionRepository` теперь владеет и чтением, и записью markers в
injected application working directory. Exclusive `wx` creation с mode 0600
создаёт пустой marker: persisted state — его наличие, JSON payload не требуется.
Повторные/concurrent disconnects идемпотентны и не перезаписывают прежний marker.
Существующие обычные text/JSON markers продолжают читаться. Symlink/необычный тип
marker или `.automaker`, а также недоступное состояние дают безопасный 503, а не
fallback в connected state или запись через ссылку. Проверки не заявляют полной
защиты от hostile filesystem TOCTOU или power-loss durability.

OpenCode status исправлен отдельным safety behavior этого среза: application
disconnect теперь маскирует host credential hints и не вызывает adapter probes,
как уже делалось для Codex/Gemini/Copilot. Provider selection через registry
отказывает после disconnect. Уже принятые executions не останавливаются; CLI
credentials не удаляются — это явно объясняется в UI.

Для существующих Claude/Codex/Cursor status cards введён общий confirmation button.
Первый click только читает target и показывает directory/instance; Cancel не
посылает mutation. Повторное открытие повторяет inspect. POST отправляется только
после подтверждения, двойная отправка блокируется; success/refresh происходят после
подтверждённого ответа. HTTP client проверяет shared request/response schemas и
совпадение возвращённого target, включая compatibility methods `deauth*`; они
также требуют body и не подставляют confirmation автоматически. Generic client
поддерживает все шесть providers, bounded route set остаётся явным для inventory.

E2E application теперь использует owned temporary data directory как working
directory и настоящий connection repository с test-only model execution adapters.
Native disconnect smoke не создаёт marker в repository/user profile и не
маскируется fixture `isDisconnected: false`.

Проверки среза:

- 23 repository/command unit cases: все providers, instance restart, idempotency,
  concurrent initial creation, legacy marker preservation, symlinks, safe errors,
  wrong target, confirmation и shutdown drain; отдельный OpenCode status regression.
- Shared schema: 11 cases для confirmation/target/response.
- UI component: 7 cases, включая русскую локализацию; HTTP client: 15 cases, включая все шесть endpoints и
  отказ compatibility methods без body.
- Новый native HTTP contract: шесть operations в двух Nest apps, отсутствие
  mutation при 400/409, persistence, disconnected status и registry refusal.
- `npm run test:server:unit`: 3290 passed, 40 skipped.
- `npm run test:server:contract`: 262 passed.
- `npm run test:packages`: 1227 passed.
- Contracts package/server production build, server/UI lint, UI typecheck,
  lockfile и три generated inventory checks успешны.
- UI production build и Electron main/preload собраны; Vite предупреждает о крупных
  chunks. Это не packaged Electron acceptance.
- Startup/shutdown smoke: SIGTERM/SIGINT exit 0.
- Chromium: 3 passed — chat/Running Agents и новый inspect/cancel/confirm/reload
  provider disconnect workflow. Перед POST проверяется owned temporary target;
  тест удаляет только свой пустой marker в finally, не оставляя provider отключённым
  для других сценариев. Сам E2E profile удаляется при shutdown.
- Выбранные SSH CLI/SDK/Direct chat/restart cases: 3 passed, 34 отфильтрованы.
- Полный Docker fixture acceptance с локальным
  `MANAGED_DOCKER_TEST_BASE_IMAGE=automaker-nest-stage2-smoke:latest`: 11 passed,
  4 opt-in skipped. Проверки cleanup owned containers/image/volume в afterAll
  успешно выполнены; user resources не удалялись.

Граница: общий setup mutation gate остаётся незавершённым — auth/reconnect,
install, key persistence и Cursor config пока требуют переноса/confirmation.
Public setup policy, active-run cancellation policy, generic provider status,
дорогие passive probes и единый application shutdown deadline также ещё в работе.
Этот срез не является live CLI login/logout или packaged Electron/Windows acceptance
и не завершает этап 7 или всю миграцию.

### Срез: native confirmed reconnect / API v3

Шесть прежних `auth-*` handlers и оставшийся Copilot connection helper удалены;
source versions доступны в Git. `SetupController` теперь направляет их в native
`ProviderConnectionCommandService.reconnect`. Требуется shared
`ProviderReconnectRequestSchema` с `confirmed: true` и точным target; success
содержит `connected: true` и фактический target. Read-only preview также возвращает
`protocolVersion: 3`. API contract version повышен до 3; compatibility decision,
coordinated client rollout и исключение safety gate из compatibility-first
sequencing описаны в ADR-010.

Reconnect удаляет только известный обычный marker через repository в injected
working directory. Missing state — idempotent success без создания directories;
permission/type/symlink/unlink failure не превращается в connected success.
Auth/account credentials не записываются и не удаляются. Локальные Claude/Codex
indicators, Cursor credential-file evidence и configured environment hints вынесены
за host runtime/config ports. Отклонённый evidence read сохраняет marker. Эти reads
не запускают CLI login, не делают model query и не выполняют network verification.
Gemini/Copilot сохраняют marker-only поведение без credential inspection.

Success messages и `wasAlreadyAuthenticated` / `requiresManualAuth` сохраняются
по прежним coarse heuristics. Чтобы не выдавать их за proof of authentication,
новый обязательный `credentialStatus` различает `present-unverified`, `not-detected`
и `not-inspected`. Underlying platform indicators остаются эвристиками и могут
агрегировать inaccessible/absent files; это не завершение общего credential/profile
runtime refactor. Cursor port признаёт только nonempty token strings, а ошибки
доступа к файлу не подменяет отсутствием credentials.

Connection commands имеют application-scoped FIFO по provider: поздний reconnect
не обгоняет disconnect, поздний disconnect не теряется за evidence read. Разные
providers не блокируют друг друга. Failure освобождает очередь для retry. В
`BeforeApplicationShutdown` admission закрывается и все accepted jobs дожидаются
завершения до `SetupStatusRuntime.onApplicationShutdown`; общий deadline и
cross-process synchronization этим не вводятся.

Web/Electron HTTP client перед обоими POST повторяет read-only preview, проверяет
protocol 3 и точное совпадение user-approved target. Это предотвращает запись через
API v1/v2 handlers, которые могли игнорировать новый body, и не позволяет незаметно
переключить approval после restart. Compatibility methods `auth*` тоже требуют
confirmed body; server response target проверяется через shared schemas.

Claude/Codex/Cursor cards используют общий `ProviderConnectionButton` с отдельными
disconnect/reconnect modes. Удалены дублирующиеся signin handlers и ложный toast
«успешно авторизован»: UI сообщает о подключении к Automaker и, при необходимости,
о самостоятельном CLI login. Есть target confirmation, cancel, duplicate-send
guard, отдельный pending state и русская локализация. Браузерный smoke теперь
проверяет disconnect/reload/reconnect/reload без реального CLI login.

Проверки среза:

- 24 новых reconnect repository/command cases: шесть providers, idempotency,
  selected-marker-only deletion, symlinks, unlink/read errors, stale target,
  evidence flags и оба порядка FIFO без блокировки другого provider.
- 4 новых host runtime cases: Codex evidence, известные Cursor paths, malformed
  tokens/JSON и отказ при unreadable evidence без CLI subprocess.
- Native HTTP contract расширен до всех двенадцати connection mutations в двух
  Nest apps. Отдельно проверен реальный Nest before-shutdown: delayed hint и
  следующий queued disconnect завершаются до host runtime shutdown, новый job — 503.
- 15 reconnect HTTP-client cases, 2 дополнительных disconnect protocol cases,
  2 component cases и 2 shared contract cases. Смешанные API versions проверены
  именно на отсутствие POST, не только на последующий отказ парсинга ответа.
- `npm run test:server:unit`: 3318 passed, 40 skipped.
- `npm run test:server:contract`: 262 passed.
- `npm run test:packages`: 1248 passed.
- Contracts/server production build, UI typecheck/lint, server lint, lockfile,
  formatting/diff и generated inventories проверены.
- UI production и Electron main/preload build успешны с прежним Vite chunk warning;
  packaged Electron acceptance не заявляется.
- Startup/shutdown smoke: SIGTERM/SIGINT exit 0.
- Chromium chat/Running Agents и полный connection workflow: 3 passed.
- Выбранные SSH CLI/SDK/Direct chat/restart: 3 passed, 34 отфильтрованы.
- Полный Docker fixture acceptance с локальным
  `MANAGED_DOCKER_TEST_BASE_IMAGE=automaker-nest-stage2-smoke:latest`: 11 passed,
  4 opt-in skipped; afterAll проверил cleanup owned containers/image/volume.

Граница: install/key/config/verify implementations, expensive passive status,
общий tool policy/capability/runtime contract и application shutdown deadline ещё
требуют работы. Profile sources внутри legacy platform helpers, полноценная
account authentication, Windows/packaged Electron acceptance этим срезом не закрыты.
Public setup policy остаётся прежней; confirmation/instance UUID не заменяют auth
и CSRF hardening. Этап 7 и вся миграция остаются незавершёнными.

### Срез: native manual installation guidance

POST `/api/setup/install-claude` и `/api/setup/install-codex` перенесены из
Express bridge в `ProviderInstallGuidanceService`. Старые handler-файлы удалены;
они доступны в Git. Сохранены HTTP 200 и прежние значения `success/error/message`:
Claude возвращает `success: false`, Codex — `success: true`. Ни одно из них не
означает, что CLI установлен: обе реализации и раньше возвращали только инструкции.

Shared `ProviderInstallGuidanceSchema` требует `requiresManualInstall: true`,
`installationPerformed: false`, непустую команду и concrete application target.
Сервис только читает identity из connection service: не запускает npm/CLI, не
проверяет credentials, не меняет connection markers или environment. После закрытия
admission новые запросы отклоняются. Target показывает экземпляр и working directory
бэкенда, а не npm global prefix и не доказательство области установки.

HTTP client проверяет schema и provider ответа и передаёт AbortSignal. Wizard
показывает постоянные ручные инструкции и кнопку «Show installation instructions»
вместо «Auto Install». Manual response, включая legacy Codex `success: true`, не
вызывает installed-success toast и не меняет detected status. Для потенциального
performed response успех требует одновременно явного `installationPerformed: true`
и положительного detection после ожидаемого status refresh. Hook защищён от двойного
запуска, поздних событий предыдущего запроса и update после unmount; подписки
освобождаются при success/error/unmount, запрос отменяется при unmount. Добавлены
русские строки. Remote SDK installer остаётся отдельным workflow без изменений.

Версии API и connection protocol остаются 3: это read-only additive metadata, не
новая mutation. Клиент отклоняет старый неоднозначный payload и не сообщает успех.
Автоматическая установка, настоящий CLI login и проверка account auth этим срезом
не реализуются. Key persistence, Cursor config/permissions и verify endpoints всё
ещё требуют удаления legacy bridge и отдельной target/confirmation policy; passive
status/usage, общий capability/tool policy и этапы 8–11 также остаются открытыми.

Проверки среза:

- Новый service test проверяет отсутствие записи в working directory и обращения
  к runtime/secrets, а также запрет новых запросов после shutdown admission.
- Native Nest HTTP contract проверяет обе команды, точные legacy success/error
  semantics, application target и отсутствие вызова bridge/connection mutations.
- 7 shared schema cases, 5 HTTP-client cases, 8 hook cases и card rendering case
  проверяют metadata, cancellation, retry, cleanup, stale events и честный UI.
- `npm run test:server:unit`: 3319 passed, 40 skipped.
- `npm run test:server:contract`: 263 passed. Первый запуск нового теста выявил
  отсутствие обязательного JSON Content-Type в fixture request; после исправления
  полный набор повторён успешно, production JSON gate не ослаблен.
- `npm run test:packages`: 1269 passed.
- Contracts/server production build, UI typecheck/lint, server lint и lockfile:
  успешно. Три generated inventories обновлены, их checks успешны.
- UI production и Electron main/preload build успешны с прежним chunk warning;
  это не packaged Electron acceptance.
- Lifecycle smoke: SIGTERM/SIGINT exit 0. Formatting и `git diff --check` успешны.
- Chromium wizard guidance и прежние chat/Running Agents/connection workflows:
  4 passed. Новый сценарий получает инструкции от реального Nest endpoint; только
  initial settings и missing-Claude status подменены в браузере. Начальный exact
  text selector исправлен с учётом отображаемого `$`, затем повторён весь набор.
- Выбранные SSH CLI/SDK/Direct chat/restart: 3 passed, 34 отфильтрованы.

- Полный Docker fixture acceptance с
  `MANAGED_DOCKER_TEST_BASE_IMAGE=automaker-nest-stage2-smoke:latest`: 11 passed,
  4 opt-in skipped. AfterAll успешно проверил очистку owned containers/image/volume.

### Срез: native confirmed Cursor permissions / API v4

Пять Cursor permissions endpoints удалены из Express-handler bridge и перенесены
в `CursorPermissionsService` / `CursorPermissionsRepository`: GET permissions,
POST profile/custom, DELETE project permissions и GET example. Старые permission
handler factories удалены из `cursor-config.ts`; model-config endpoints пока остаются
в legacy bridge. Исходный код удалённых фабрик доступен в Git.

GET `/api/setup/cursor-permissions/target?scope=global|project&projectPath=...`
возвращает read-only preview с `protocolVersion: 1` и target вида
`host-cursor-permissions`: provider, instance UUID, backend working directory,
scope, canonical config path и project root для project scope. Global config root
вычисляется из bootstrap `HOST_ENVIRONMENT` (`CURSOR_CONFIG_DIR`, Linux XDG override
или host home), не из меняющегося `process.env` на каждом запросе. Global target
намеренно является файлом профиля на хосте; это не SSH/Docker execution target.
Project scope проверяется относительно application-owned allowed root с canonical
resolution и не следует project `.cursor` symlink.

Все три mutation требуют strict shared DTO с `confirmed: true` и исходным target;
custom/delete допускают только project scope. Server повторно вычисляет target
перед записью, stale instance/root/file отклоняется. Старое тело запроса без
confirmation больше не принимается. API header повышен до `4`; connection protocol
по-прежнему `3`. Client перед любой mutation повторно проверяет permissions preview
protocol и совпадение target, не подставляет свежий target в старое approval и
проверяет target ответа. Отсутствующий preview на старом backend означает отказ
до POST/DELETE, а не только ошибку парсинга после потенциальной записи.

Repository ограничивает чтение JSON 1 MiB, проверяет permissions arrays и обычный
single-link файл, отклоняет повреждённый JSON, symlink/hardlink и небезопасный путь.
Запись использует owned exclusive temporary file (0600) и rename в том же каталоге;
temporary cleanup выполняется только для файла, успешно созданного этой операцией.
Прочие поля global/project JSON сохраняются. DELETE удаляет только permissions:
permissions-only файл удаляется, остальные настройки сохраняются. `hasProjectConfig`
означает наличие permissions override, а не просто любого project JSON. Missing
project при read допускает global fallback без создания директорий; write preview
в отсутствующий project возвращает 404.

Application-scoped FIFO сериализует все три mutation по config path; ошибка не
отравляет очередь. Shutdown закрывает admission и дожидается принятых записей,
включая queued writes. Нет distributed lock, сравнения ревизии с внешним редактором,
гарантии power-loss durability или защиты от hostile filesystem TOCTOU. Общая
auth/CSRF политика setup не менялась; UUID target не заменяет авторизацию.

UI показывает scope, конкретный файл, backend root и UUID перед применением профиля,
объясняет host-only действие и не пишет при Cancel. Повторные confirms блокируются;
ошибка не вызывает автоматическую запись/retry. В location card показываются
фактические backend paths, а не безусловный `~/.cursor`. Global changes инвалидируют
весь permissions cache; project changes — cache подтверждённого project. E2E
composition направляет global Cursor config только в owned temporary profile.

Проверены service/repository, strict schemas, native HTTP в двух Nest apps,
client отсутствие POST на старом protocol, stale-target/response mismatch,
UI confirmation/cancel/error/unmount и cache invalidation. Браузерный regression
выявил stale missing-project read; исправлен fallback, ограничение write preview
не ослаблено. Остальные provider capabilities/tool policy, keys/model-config/verify,
usage и этапы 8–11 остаются открытыми; срез не завершает этап 7.

Результаты проверок:

- 19 новых repository/service cases: immutable per-app locations, fallback,
  preservation, strict confirmation, invalid JSON/size/path, symlink/hardlink,
  FIFO/recovery/shutdown drain. 8 shared schema cases, 11 HTTP-client cases,
  5 UI confirmation cases, 2 cache invalidation cases и native two-app HTTP contract.
- `npm run test:server:unit`: 3338 passed, 40 skipped.
- `npm run test:server:contract`: 264 passed.
- `npm run test:packages`: 1295 passed.
- Contracts/server production build, UI typecheck/lint, server lint, lockfile,
  formatting и diff checks: успешно. Три inventory обновлены, checks успешны.
- UI production и Electron main/preload build: успешно; прежний Vite chunk warning
  остаётся. Packaged Electron и Windows acceptance этим не подтверждены.
- Lifecycle smoke после завершения server build: SIGTERM/SIGINT exit 0.
- Chromium: 5 passed (permissions preview/cancel/confirm/reload, connection cycle,
  manual install guidance и два agent/Running Agents сценария). Global permission
  fixture создан и удалён только внутри verified owned E2E root.
- Один дополнительный полный browser run дал startup timeout setup-view на общем
  `Loading` до вызова install endpoint (4 passed / 1 failed). Следующий полный
  запуск с `--trace=on` дал 5 passed без изменений production auth или timeout.
  Причина единичного startup timeout не доказана; стабильность cold startup
  остаётся обязательной проверкой hardening, этот срез её не объявляет решённой.
- Выбранные SSH CLI/SDK/Direct chat/restart: 3 passed, 34 отфильтрованы.
- Полный Docker acceptance с локальным
  `MANAGED_DOCKER_TEST_BASE_IMAGE=automaker-nest-stage2-smoke:latest`: 11 passed,
  4 opt-in skipped; проверка cleanup owned containers/image/volume успешна.

### Срез: native confirmed Cursor project model config / API v5

GET `/api/setup/cursor-config` и POST `/api/setup/cursor-config/default-model`,
`/api/setup/cursor-config/models` переведены в `CursorModelConfigService`.
Оставшийся legacy `routes/setup/routes/cursor-config.ts` удалён (восстанавливается
из Git). Setup bridge теперь содержит только store/delete API key и две verify
операции. Старый `CursorConfigManager` остаётся exported legacy utility с отдельными
тестами, но больше не создаётся из HTTP endpoints и не является native persistence port;
его окончательная очистка относится к post-migration refactor.

Место хранения сохранено: `<project>/.automaker/cursor-config.json`. Это отдельный
host project artifact, не `~/.cursor/cli-config.json` и не remote execution config.
Видимые global Cursor model controls в settings tab используют общий settings store,
а не эти endpoints. Они намеренно не переподключены к project file; global preferences
и фактический runtime selection этим срезом не меняются.

GET `/api/setup/cursor-config/target?projectPath=...` возвращает read-only
`protocolVersion: 1`, kind `host-cursor-model-config`, provider, scope `project`,
application instance UUID, backend directory, canonical project root и config path.
Shared DTO требует `confirmed: true` и исходный target. Server проверяет target
повторно перед записью; missing project допускает только read defaults, не write
preview. Обе mutation проверяют catalog membership через own property, не `in`;
`constructor`/`__proto__`, неизвестные IDs и пустой список отвергаются. Invalid list
не фильтруется молча до подмножества valid models. Это намеренное ужесточение input
contract; API header повышен до `5`.

Web/Electron HTTP client разбирает shared schemas, проверяет отдельный model-config
preview protocol перед POST, сравнивает уже подтверждённый target и проверяет target
и применённую model/list в ответе. Backend API v4 не имеет model-config preview:
новый client не отправит ему mutation с body, который старый handler игнорировал бы.
Connection protocol остаётся `3`, Cursor permissions protocol — `1`.

Новый injectable `HostSetupJsonFiles` переиспользуется permissions repository и
model-config service: immutable allowed-root policy, canonical path validation,
запрет project config-directory symlink и shared/symlink файлов, bounded JSON read
до 1 MiB, owned exclusive temporary file (0600), rename и cleanup. Поведение
permissions подтверждается прежними native tests и browser cycle после extraction.
При отсутствующем model config сохранены defaults (`cursor-auto`, все models).
Повреждённый JSON/структура не скрывается defaults и не перезаписывается.
MCP/rules/неизвестные metadata сохраняются read-modify-write; legacy model strings
при чтении не мигрируются автоматически. Фактический model catalog содержит
`supportsVision`, не выдуманный обязательный `tier`; shared read schema отражает
данные. Оба model commands имеют file-scoped FIFO и shutdown drain/reject admission.

Нет distributed file lock, external-editor revision check, гарантии против hostile
filesystem race или power-loss durability. Общая setup auth/CSRF policy не менялась.
Этап 7 остаётся открыт: keys/verify, usage, capability/tool policy и остальные
невыполненные пункты не закрываются этим переносом; этапы 8–11 также не завершены.

Проверки среза:

- 18 новых model-config service/file cases; 19 прежних permissions cases после
  extraction проходят через тот же `HostSetupJsonFiles`. Проверены defaults,
  preservation/restart, strict confirmation, prototype names, corrupt JSON/size,
  allowed root, symlink/hardlink, FIFO/error recovery и shutdown drain.
- Native two-app HTTP contract проверяет оба commands, API v5, target conflict,
  реальный disk/read round trip и неизменность global model preferences.
- 9 shared schema cases и 14 HTTP-client cases проверяют actual catalog metadata,
  отсутствие POST на backend без поддерживаемого preview, stale-target и applied
  model/list mismatch. После финального форматирования client tests повторены.
- `npm run test:server:unit`: 3356 passed, 40 skipped.
- `npm run test:server:contract`: 265 passed.
- `npm run test:packages`: 1318 passed.
- Contracts/server build, UI typecheck/lint, server lint, lockfile, formatting/diff
  checks: успешно. Три generated inventories обновлены, checks успешны.
- UI production и Electron main/preload build успешны с прежним chunk warning;
  packaged Electron/Windows acceptance не заявляется.
- Lifecycle после завершения server build: SIGTERM/SIGINT exit 0.
- Chromium с `--trace=on`: 5 passed (два chat/Running Agents сценария, permissions
  preview/cancel/confirm/reload, connection cycle, install guidance). Ранее отмеченный
  единичный startup timeout в этом запуске не повторился; его root cause по-прежнему
  не доказан, hardening gate остаётся открытым.
- Выбранные SSH CLI/SDK/Direct chat/restart: 3 passed, 34 отфильтрованы.

- Полный Docker fixture acceptance с
  `MANAGED_DOCKER_TEST_BASE_IMAGE=automaker-nest-stage2-smoke:latest`: 11 passed,
  4 opt-in skipped; afterAll успешно проверил cleanup owned containers/image/volume.

### Срез: native confirmed Claude verification / API v6

POST `/api/setup/verify-claude-auth` переведён из handler bridge в
`ClaudeVerificationService` / `ClaudeVerificationRuntime`. Legacy handler удалён,
восстанавливается из Git. Bridge теперь содержит store/delete API key и Codex verify.
Ключи и provider runtime нельзя переносить простой заменой `process.env` на cache:
должны оставаться согласованы действительные источники credentials. Их native
persistence/activation и Codex verify ещё не закрыты.

GET `/api/setup/claude-verification-target?authMethod=cli|api_key` — read-only preview
с `protocolVersion: 1`, kind `host-claude-verification`, provider, instance UUID,
backend working directory, method, model `claude-sonnet-4-6` и фактический endpoint
из immutable `HOST_ENVIRONMENT` (по умолчанию Anthropic). URL с embedded credentials,
query/hash или не-HTTP protocol отклоняется до раскрытия metadata или SDK call.
Это host application probe, не SSH/Docker verification. Preview не читает ключи,
не запускает query и не является доказательством валидности credentials.

Mutation требует strict shared DTO с `confirmed: true` и исходным target. CLI mode
не принимает supplied API key. Server повторно сравнивает instance/root/model/
method/endpoint перед admission; неверные запросы не запускают SDK. API header
повышен до `6`. Client проверяет supported preview до POST и сравнивает исходный
approval с preview и response. Новый target не подставляется автоматически. API v5
не получает старый verification POST лишь из-за наличия типизированного body.
Прочие capability versions не меняются (connection 3, Cursor permissions/models 1).

API-key mode выбирает supplied key, application setup cache, managed settings key
или bootstrap key; последнее учитывает application tombstone legacy delete.
CLI mode явно исключает API-key/token overrides. Каждому SDK query передаётся
собственный environment, очищены альтернативные cloud-provider flags/custom auth
headers, endpoint задан явно. `process.env`, `.env`, SetupCredentialCache и managed
credentials этой операцией не изменяются. Native code не создаёт глобальных auth
sessions и не передаёт key в confirmation text/response/log. Возможные внутренние
credential refresh/cache effects самого vendor CLI этим не объявляются запрещёнными
или полностью проверенными.

Runtime запускает один turn без built-in tools/MCP, с `settingSources: []`,
`strictMcpConfig: true`, `persistSession: false` и `dontAsk`; stdout messages не
накапливаются и не логируются, stderr callback не пересылает raw diagnostics.
Проверяются пределы 100 messages / 128 KiB одного сериализованного сообщения.
Успех требует terminal `result/subtype: success`, явного `is_error: false` и
непустого result. Partial text, empty/error result, billing/rate-limit/auth error
и поздний результат после abort не становятся authenticated success. Ошибки
нормализованы; metadata вроде `billingMethod` не классифицируется как error text.

Сервис имеет application-scoped rate limit (5 attempts/client/60 s, bounded map),
не более четырёх active probes, shared saved connection-test timeout с верхним
пределом SDK wait 120 s. Shutdown сначала закрывает admission, abort-ит активные
controller и ждёт завершения принятых операций; повторные/reentrant callers получают
один drain promise. SDK abort вызывает `Query.close()` и завершает ожидание hung
iterator. Это не доказательство OS process-tree reap на всех SDK/OS, не общий
shutdown deadline, не sandbox, не remote/provider parity и не live account acceptance.
Общая public setup auth/CSRF policy не изменена и остаётся hardening gate.

UI использует read-only inspection и нативный Web/Electron confirmation dialog:
стоимость запроса, method, model, endpoint, backend root и UUID видны до POST, ключ
не показывается. Отмена не делает query. Mount/refresh Claude setup больше не
запускают paid verification автоматически; есть отдельная кнопка. Старый SDK auth
source не выдаётся за доказанный OAuth/subscription account. Desktop mock и E2E
composition обновлены: native schemas/service сохраняются, только runtime port
явно заменён offline fixture; production flags не включают успешные mocks.

Проверки:

- 21 service cases и 13 SDK-adapter cases: target/credential modes, isolation,
  rate/concurrency limits, timeout, reentrant shutdown, close и normalized outcomes.
- 9 shared schema, 10 HTTP-client, 3 consent cases; проверено отсутствие POST
  старому backend и отсутствие supplied secret в dialog text.
- Native HTTP двух apps проверяет 400/409 до probe, разные endpoints/environments,
  отсутствие persistence и реальный Nest close с delayed in-flight runtime.
- Старый E2E composition contract был обновлён с unconfirmed body на новый DTO;
  production input gate не ослаблен. В новом concurrency unit fixture короткий
  timeout отделён от lifecycle case, чтобы deadline не подменял shutdown evidence.
- `npm run test:server:unit`: 3390 passed, 40 skipped.
- `npm run test:server:contract`: 266 passed.
- `npm run test:packages`: 1340 passed.
- Contracts/server build, UI typecheck/lint, server lint, lockfile: успешно.
- UI production + Electron main/preload build успешны с прежним chunk warning;
  packaged Electron и Windows acceptance не заявляются.
- Lifecycle smoke после server build: SIGTERM/SIGINT exit 0.
- Chromium `--trace=on`: 6 passed, включая отсутствие auto-Claude POST,
  cancel/confirm/target evidence и пять прежних workflows. Probe offline, без
  upstream charges или использования настоящих account credentials.
- Выбранные SSH CLI/SDK/Direct chat/restart: 3 passed, 34 отфильтрованы.
- Полный Docker fixture acceptance с
  `MANAGED_DOCKER_TEST_BASE_IMAGE=automaker-nest-stage2-smoke:latest`: 11 passed,
  4 opt-in skipped; cleanup owned containers/image/volume проверен.

На момент Claude checkpoint Codex verify оставался legacy; следующий срез ниже
переносит его отдельно. Setup key writes ещё имеют
process-env/.env effects; usage, passive GH auth, общий capability/tool policy и
остальные незавершённые пункты требуют работы. Этапы 8–11 не объявляются завершёнными.

### Срез: native confirmed Codex verification / API v7

POST `/api/setup/verify-codex-auth` обслуживается `CodexVerificationService`,
`CodexCredentialRuntime` и `CodexVerificationRuntime`. Legacy handler удалён;
`SetupHandlersService` теперь содержит только store/delete API key. Их глобальные
environment/.env effects и согласованная native credential activation остаются
отдельной незавершённой задачей, а не заменяются cache-only поведением.

GET `/api/setup/codex-verification-target?authMethod=cli|api_key` возвращает strict
shared preview с `protocolVersion: 1`: host instance UUID, backend directory,
method, credential kind, CLI profile directory (только CLI), endpoint и фиксированную
модель `gpt-5.2-codex`. API header повышен до `7`; остальные capability versions
сохранены. API-key preview не читает ключи и не запускает CLI. CLI preview получает
только auth metadata без токена и без refresh. Preview не является authentication proof.

Confirmed POST повторно сверяет весь target до paid query; другой instance/root,
endpoint/profile или смена credential kind требуют нового approval. Client до POST
проверяет capability и не подменяет approved target новым preview. Native confirmation
показывает endpoint/model/method/root/UUID/profile, стоимость и возможность CLI
credential refresh; секреты туда не попадают. Cancel не делает model query.

Выбор транспорта основан не на предположении о `allowedTools: []`. Offline contract
с настоящим закреплённым Codex SDK/CLI 0.98.0 доказывает, что даже ограниченный exec
всё ещё предлагает `apply_patch` и `view_image`. Поэтому verification не создаёт
SDK thread/turn и не использует agent execution loop. CLI запускается только для
JSONL initialize/initialized/getAuthStatus, с bounded stdout и drained private stderr.
Metadata запрашивается с `includeToken: false, refreshToken: false`; token/refresh
допустимы только для confirmed CLI probe. Параметры legacy RPC проверены настоящим
bundled CLI с fake auth.json в owned temporary profile, а не перенесены из текущей
документации нового app-server. Поддержка других CLI versions этим не утверждается.

API-key mode использует supplied unsaved key, setup cache, managed settings или
bootstrap key с application tombstone. Он никогда не запускает CLI. CLI mode
исключает OPENAI_API_KEY/CODEX_API_KEY overrides, не принимает supplied API key и
не подменяется API-key mode при ошибке. Endpoint API-key: OPENAI_BASE_URL или
`https://api.openai.com/v1/responses`; ChatGPT: CODEX_VERIFY_CHATGPT_BASE_URL или
`https://chatgpt.com/backend-api/codex/responses`. Endpoints без embedded credentials,
query/hash и только HTTP(S); redirects запрещены. Managed credentials, `.env`,
process.env и application connection markers этой операцией не меняются.

HTTP/SSE request содержит `tools: []`, `tool_choice: none`, `store: false`,
`stream: true`; tool calls никогда не dispatch-ятся. JWT account claim нужен только
для ChatGPT account header и не считается proof. Неподдерживаемый/opaque credential
отклоняется без успешной authentication. Успех требует terminal response.completed,
completed status, непустой message output и отсутствия tool output/error. Partial,
incomplete, billing/rate-limit/auth errors и поздний result после abort не становятся
verified. Response size/event count ограничены, raw upstream/CLI errors не раскрываются.

Application-scoped admission: 5 attempts/client/minute, bounded client map, максимум
4 probes и один CLI probe для исключения параллельного refresh в одной app. Timeout
берётся из сохранённого connectionTestTimeoutMs с пределом 120 s; auth RPC отдельно
ограничен 10 s. Shutdown закрывает admission, abort-ит и drain-ит принятые операции;
CLI child после SIGTERM при необходимости получает SIGKILL, runtime ждёт actual close.
Real child fixtures проверяют malformed/flood/hung peers и ignore-SIGTERM. Это не
глобальный filesystem shutdown deadline, cross-process refresh lock или гарантия
process-tree reaping на всех OS. Public setup auth/CSRF policy не закрыта UUID/consent.

OpenAI Docs использован для разделения app-server и Responses/SSE contracts:
[app-server](https://developers.openai.com/codex/app-server),
[streaming Responses](https://developers.openai.com/api/docs/guides/streaming-responses).
Текущие docs не являются доказательством legacy getAuthStatus 0.98.0: его форма
проверена локальным CLI contract. Live account, paid upstream, packaged Electron,
Windows и remote verification parity не заявляются.

Проверки среза:

- 19 service, 16 HTTP/SSE runtime и 9 real-child auth runtime cases: credentials
  isolation, stale target/profile/kind, bounded admission, timeout, abort/drain/reap.
- 9 shared schema, 12 client и 3 consent cases: capability gate, отсутствие POST
  старому backend/после смены CLI profile, отсутствие secret в dialog text.
- 3 новых HTTP/runtime contracts: настоящий bundled CLI auth RPC; отрицательная
  проверка SDK tools; native HTTP двух apps с 400/409 до probe, без bridge/persistence
  и с реальным Nest shutdown при незавершённом query.
- `npm run test:server:unit`: 3434 passed, 40 skipped (существующие skips).
- `npm run test:server:contract`: 269 passed.
- `npm run test:packages`: 1364 passed.
- `npm run build --workspace=libs/contracts`, server production build, UI production
  и Electron main/preload build, `npm run typecheck`, оба lint:errors и lockfile —
  успешно. Прежнее предупреждение UI chunk size остаётся; packaged Electron не проверен.
- `node scripts/smoke-server-lifecycle.mjs`: SIGTERM/SIGINT exit 0 после server build.
- Chromium с `--trace=on`: 7 passed, включая новый Codex unsaved-key cancel/confirm
  и шесть прежних workflows. Verification ports в E2E явно offline; production
  schemas/controller/service остаются настоящими. Paid upstream/account не проверялись.
- `npm run test:ssh --workspace=apps/server --` для real chat CLI/SDK/Direct сценариев:
  3 passed, 34 filtered; сохранён pinned binding после restart/default change.
- `MANAGED_DOCKER_TEST_BASE_IMAGE=automaker-nest-stage2-smoke:latest npm run test:docker
--workspace=apps/server`: 11 passed, 4 opt-in skipped; owned cleanup проверяется
  afterAll, пропущенные live opt-in проверки не считаются пройденными.
- Route/dependency/API-consumer inventories обновлены; все три inventory:\*:check
  подтверждают актуальность. Форматирование и `git diff --check` выполнены.

Этап 7 и этапы 8–11 остаются открытыми.

### Срез: per-query Codex credentials и environment transport

Подготовка native key commands выявила действительную runtime-зависимость:
обычный Codex SDK query получал managed key через `createTempEnvOverride`, который
менял process.env на всё время исполнения и даже удержания первого yielded output.
Параллельные запросы могли видеть чужой ключ; восстановление полного environment
могло также откатить несвязанные изменения. Этот helper больше не используется и
удалён, а не оставлен как способ активации ключей для нового command service.

`CodexProvider` принимает необязательный environment context и снимает его копию
до асинхронной query preparation. Выбранный credential передаётся в SDK helper
явным `CodexSdkExecutionContext`; helper больше не читает ключ из process.env.
SDK получает собственный `env` и согласованные OPENAI_API_KEY/CODEX_API_KEY.
Таким образом managed keys параллельных SDK queries не требуют process-wide writes.
Существующий порядок выбора environment/managed credentials и CLI-native auth
в этом подготовительном срезе не меняется.

В общем `spawnProcess`/`spawnJSONLProcess` добавлен opt-in `inheritEnv: false`:
при нём используется только переданный environment. По умолчанию старое merge
поведение сохранено. Codex CLI execution и login-status subprocess используют
явный context без скрытого позднего наследования глобального environment. Обычный
SDK transport также получает полный снимок, сохраняя прежние HOME/PATH/config/base
URL переменные; это не allow-list секретов и не sandbox. CLI discovery/auth-file
helpers и default composition ещё не объявляются полностью application-isolated.

Реальный SDK 0.98.0 дополнительно выявил late-abort проблему: после turn.failed
`Thread.run()` может вернуть error до actual child close, а его cleanup уже удаляет
child listeners. Последующий abort исходного сигнала вызывал unhandled AbortError.
Теперь SDK получает отдельный controller, связанный с caller только пока run pending;
forwarding снимается до публикации output/error. Pending cancellation сохранена,
поздняя отмена закрытого consumer не направляется уже завершённому SDK run.
Это не доказательство reap дерева процессов или bounded SDK cleanup на всех OS.

Использован OpenAI Docs: [Codex SDK](https://developers.openai.com/codex/sdk).
Форма `apiKey`/`env` и замена ambient inheritance дополнительно проверены по
установленному SDK 0.98.0 и настоящим child processes. Отдельный offline contract
держит одновременно два SDK/CLI query до получения обоих запросов локальным HTTP
сервером: Authorization headers различаются согласно context; чужие bootstrap
значения заменены только в child env; process.env не меняется. После fixture error
оба caller controllers отменяются без unhandled errors. Внешнего upstream нет.

Проверки среза:

- Codex provider suite: 32 passed, включая 5 новых cases: concurrent managed keys,
  удержание первого output/early return без env override, pending cancellation,
  snapshot до async preparation и CLI context без ambient merge. Оба key names
  дочернего CLI согласуются с credential, выбранным execution plan.
- Actual pinned SDK/CLI contract: два параллельных запроса только к локальному
  fixture upstream и late abort после error, без настоящих credentials/charges.
- 4 real-child platform cases: collect/JSONL transports, default inheritance
  сохранено, opt-out действительно исключает ambient PATH из child environment.
- `npm run test:server:unit`: 3439 passed, 40 существующих skips.
- `npm run test:server:contract`: 270 passed; первоначальная версия real-SDK
  contract выявила 2 unhandled AbortError. После исправления повторный полный
  прогон проходит без этих ошибок; они не подавляются test runner listener-ом.
- `npm run test:packages`: 1368 passed; platform и server production builds,
  typecheck, UI/server lint:errors и lockfile check успешны.
- UI production и Electron main/preload build успешны с прежним chunk-size warning;
  packaged Electron и Windows acceptance этим не объявляются выполненными.
- Production lifecycle smoke после server build: SIGTERM/SIGINT exit 0.
- Chromium `--trace=on`: 7 passed; app-scoped setup consent и реальные chat
  send/stream/stop/reload workflows. E2E model ports явно offline.
- Выбранные real SSH CLI/SDK/Direct chat/restart scenarios: 3 passed, 34 filtered.
- Docker acceptance с `MANAGED_DOCKER_TEST_BASE_IMAGE=automaker-nest-stage2-smoke:latest`:
  11 passed, 4 opt-in skipped; cleanup owned containers/image/volume проверен.
- Dependency inventory обновлён; route/dependency/API-consumer inventory checks
  подтверждают актуальность. Форматирование и diff check выполнены.

Это необходимая runtime-часть переноса ключей, но не его завершение: setup
store/delete всё ещё legacy и меняют environment/.env. Native persistence,
durable bootstrap deletion policy, общий resolver для Claude/Codex/status/verify,
confirmation target и protocol gate key writes ещё обязательны. Этап 7 открыт.

### Срез: passive GitHub setup status и explicit authentication / API v8

GET `/api/setup/gh-status` больше не запускает `gh api user` или `gh auth status`.
Он выполняет только installation/path/version lookup и возвращает
`authenticationChecked: false`, `authenticated: false`, `user: null`. Это unknown
credential evidence, не logout и не доказательство невалидности аккаунта. UI
показывает «Аутентификация не проверена», а mount и refresh не выполняют auth probe.
Refresh сбрасывает прежний verification result, не подтверждая его по старому cache.

Native `GithubAuthenticationService` предоставляет GET
`/api/setup/github-authentication-target` с protocol 1 и POST
`/api/setup/verify-github-auth` со strict shared `{ confirmed: true, target }`.
Target включает application UUID/backend directory, resolved CLI path и GH_HOST
(по умолчанию github.com); CLI absence отражается null path. Application identity
выделена отдельным read-only методом repository, без использования чужого provider
connection marker. POST заново сверяет target перед network check; stale
instance/root/path/hostname отклоняются до auth call. API header повышен до `8`;
новый client не делает POST backend без protocol-1 preview и не заменяет approval.

Explicit check выполняет одну `gh api user --jq .login` через host runtime с
immutable environment и backend cwd. Success требует успешного command и
непустого ограниченного account login. Пустой/malformed/null output, network или
auth failure не становятся authenticated; UI пишет «Аутентификация не подтверждена»,
не объявляя сетевую ошибку logout. Raw errors/diagnostics и tokens не выдаются.
Резервный `gh auth status` удалён: его exit 0 без проверенного user больше не
объявляется успешной аутентификацией. Login/logout/switch/refresh команды не запускаются.
Внутренний token refresh самого vendor CLI не объявляется исключённым; consent
предупреждает о сетевом обращении и возможном refresh credentials.

Решение сверено с [GitHub CLI api](https://cli.github.com/manual/gh_api) и
[auth status](https://cli.github.com/manual/gh_auth_status). Актуальная документация
отдельно предупреждает об автоматическом refresh и особенностях JSON exit codes;
это не основание предполагать наличие новых flags в любой установленной версии.
Новые version-specific flags не требуются. В tests используется owned executable
fixture, не пользовательский GH_TOKEN или реальный GitHub account.

Admission ограничен четырьмя concurrent checks и пятью attempts/client/minute
с bounded per-app map. Before-shutdown закрывает admission и drain-ит принятые
операции; runtime track сохраняет владение реальным child до callback. Существующие
10 s execFile timeout и 128 KiB maxBuffer сохранены. Это не общий shutdown deadline,
не гарантия SIGKILL/process-tree reap, не sandbox и не remote verification parity.
Public setup auth/CSRF hardening остаётся отдельным открытым gate; UUID не является
авторизацией. Hostname/path/UUID approval не доказывает неизменность бинарника или
идентичность CLI account между preview и check.

Проверки среза:

- 17 command-service cases: strict input, stale UUID/root/path/hostname, no CLI,
  invalid account evidence, safe unexpected errors, per-app limits и shutdown drain.
- 43 host-status/runtime cases: installed/missing GET не вызывает auth, один API
  query без fallback, safe failures и сохранённое lifecycle владение.
- 7 shared schema, 9 HTTP-client и 3 consent cases: confirmation/capability gate,
  отсутствие POST старому backend или после смены target, cancel/inspection failure.
  В первом package run обнаружен ошибочный return mock-функции из нового beforeEach:
  runner принимал её за cleanup; fixture исправлена блоком без return, повторный
  полный прогон успешен без ослабления production gate.
- Native HTTP двух apps использует owned executable CLI fixtures. Отдельный
  файловый counter доказывает отсутствие API command после GET. Confirmed POST,
  400/409, immutable host environment, account attribution и real Nest close с
  pending child проверены. Tests не обращаются к реальному GitHub.
- `npm run test:server:unit`: 3456 passed, 40 существующих skips.
- `npm run test:server:contract`: 270 passed; повторён после усиления CLI counter.
- `npm run test:packages`: 1387 passed.
- Contracts/server production builds, UI typecheck/lint, server lint и lockfile
  check успешны. UI production и Electron main/preload builds успешны с прежним
  chunk-size warning; packaged Electron/Windows acceptance не заявляются.
- Production lifecycle smoke после server build: SIGTERM/SIGINT exit 0.
- Chromium `--trace=on`: 8 passed; дополнительно повторён GitHub scenario с двумя
  installation refresh и проверкой сброса verification result без лишнего POST.
- Выбранные real SSH CLI/SDK/Direct chat/restart: 3 passed, 34 filtered.
- Docker acceptance с `MANAGED_DOCKER_TEST_BASE_IMAGE=automaker-nest-stage2-smoke:latest`:
  11 passed, 4 opt-in skipped; owned containers/image/volume cleanup проверен.
- Route/dependency/API-consumer inventories regenerated после форматирования,
  все три inventory:\*:check успешны; format и diff checks выполнены.

Native key
persistence/activation, usage ownership и оставшиеся capability/lifecycle пункты
этапа 7 всё ещё обязательны. Этапы 8–11 не объявляются завершёнными.

### Срез: durable credential policy и application-owned runtime resolver

`ApplicationCredentialsService` подключён через Nest к production provider factory:
Claude/Codex получают environment callback конкретной application, а не общий mutable
process.env. Context читается заново для каждого query; managed key имеет приоритет
над bootstrap key. Codex callback snapshot авторитетен: отсутствие ключа не вызывает
повторное чтение credentials с более поздним состоянием. Raw legacy constructors
сохранены для compatibility composition и не объявляются application-owned transport.
Inline/profile credentials остаются самостоятельными явными источниками и не
отзываются удалением application key.

Общий `resolveApplicationKey` учитывает managed key, immutable bootstrap environment
и `disabledBootstrapApiKeys`. Эти optional metadata и отдельный `anthropicOAuthToken`
хранятся только в private credentials record, не в global settings или masked
credentials response. Secret передаётся SDK через per-query environment;
subscription token не выдаётся за Anthropic API key. Setup mode переключается с
очисткой competing managed value и отключением его bootstrap fallback. Temporary
wizard cache пока сохраняется для legacy commands, но API-key/token entries в нём
теперь взаимоисключающие.

`SettingsService.setSetupCredential` выполняет credential + deletion-policy update
одним atomic private write на той же FIFO, что и обычный updateCredentials. Delete
очищает managed value и сохраняет запрет bootstrap fallback; новый store снимает
соответствующий запрет. Другие provider keys сохраняются. Primary credentials file
имеет mode 0600 на Unix. Это не secure erase backups, bootstrap `.env` или vendor
CLI logins, не revocation удалённого token и не межпроцессная блокировка нескольких
приложений с одним DATA_DIR.

`ApplicationCredentialsService.change` сериализует persistence + activation и
очищает stale wizard values только после успешного durable commit. Ошибка записи
не активирует новый key. Before-shutdown закрывает mutation admission и ждёт FIFO;
read snapshots остаются доступны для cleanup уже принятых provider jobs. HTTP-level
limits и confirmed target будут принадлежать native command boundary при cutover.

Credentials читаются строго: ENOENT означает defaults, но malformed JSON, permission
или другие read errors не превращаются в пустой record. Иначе повреждение файла
могло бы потерять deletion policy и снова включить bootstrap secret. Private parse/
read errors не логируются и заменяются статическим сообщением. Malformed policy
отвергается при resolve и до overwrite при update; после отказа FIFO работает.
Старый backend может игнорировать metadata: автоматический downgrade/rollback
по-прежнему запрещён до cutover preflight этапа 10. Additive schema сама по себе
не является downgrade protection.

Claude/Codex API-key verification используют тот же resolver и учитывают durable
deletion с новым пустым wizard cache. Supplied unsaved verification key остаётся
отдельным opt-in источником без persistence. Native model queries этого среза
не активируют credentials через process.env mutation.

OpenAI Docs использован для SDK environment boundary:
[Codex SDK](https://developers.openai.com/codex/sdk). Реальная форма apiKey/env
проверяется по установленной 0.98.0 и ранее добавленным offline CLI contracts,
не предполагается из более новой документации. Новых SDK parameters или upgrade нет.

Проверки среза:

- 15 credential-policy cases с real-filesystem и controlled lifecycle ports: managed precedence, restart после
  delete, private primary mode, переключение token/API-key, concurrent FIFO с
  обычным credential update, app isolation и legacy-cache mode transition.
  Corrupt file не перезаписывается и не возвращает bootstrap key; malformed
  policy update не повреждает valid record и не ломает следующую FIFO operation.
  Дополнительно проверены post-commit cache activation, failed write без активации
  и shutdown drain/rejection нового write.
- Реальная Nest composition двух applications использует production registry,
  provider factories, settings и resolver. Только vendor SDK calls и CLI auth
  discovery явно заменены offline ports: видны разные credentials в настоящих
  adapter options, а после restart удалённый key отсутствует и новый Codex SDK
  query не запускается. Это не live authentication/account acceptance.
- Claude/Codex verification tests проверяют durable deletion с новым cache;
  Codex adapter test запрещает second credential read после пустого snapshot.
- `npm run test:server:unit`: 3474 passed, 40 существующих skips.
- `npm run test:server:contract`: 271 passed.
- `npm run test:packages`: 1387 passed.
- Types/server builds, UI typecheck/lint, server lint и lockfile check успешны.
  UI production и Electron main/preload build успешны с прежним chunk warning;
  packaged Electron и Windows acceptance не заявляются.
- Production lifecycle smoke: SIGTERM/SIGINT exit 0 после server build.
- Chromium с trace: 8 passed, включая consent/refresh и реальные chat workflows.
- Выбранные real SSH CLI/SDK/Direct chat/restart: 3 passed, 34 filtered.
- Docker fixture acceptance с `MANAGED_DOCKER_TEST_BASE_IMAGE=automaker-nest-stage2-smoke:latest`:
  11 passed, 4 opt-in skipped; owned cleanup проверен. Внешних paid probes нет.
- Dependency inventory обновлён; route/dependency/API-consumer inventory checks,
  форматирование и diff check успешны.

Это ещё не перенос setup key endpoints: store/delete handler bridge пока пишет
process.env/.env. До его удаления обязательны confirmed key target/protocol gate,
native command admission/drain, согласованный masked/status read model и проверка
остальных credential consumers, включая другие CLI adapters/remote paths.
Full credential isolation, status evidence policy, native key mutation checklist
и этап 7 не объявляются завершёнными только по этому resolver checkpoint.

### Срез: native confirmed setup key commands / API v9

POST `/api/setup/store-api-key` и `/api/setup/delete-api-key` переведены на
`SetupCredentialsService` / `ApplicationCredentialsService.change`. Setup handler
bridge, старые store/delete handlers и helper записи `.env` удалены; исходники
доступны в Git. В актуальном setup transport нет Express-handler forwarding и
key mutations через process.env, process.cwd() или `.env` persistence.

GET `/api/setup/credential-target?provider=...` — protocol-1 preview для anthropic,
openai и anthropic_oauth_token. Он не читает ключи и не создаёт storage; target
содержит application UUID/backend directory, provider и фактический private
credentials.json path в DATA_DIR. Store/delete принимают только strict shared DTO
с literal confirmed и исходным target. Store дополнительно требует валидный
немаскированный secret; delete не принимает secret fields. Stale UUID/root/file
отклоняются до writer. API header повышен до `9`; старый request body не поддержан.

Web/Electron используют один HTTP transport. Публичные client method signatures
storeApiKey(provider, key)/deleteApiKey(provider) сохранены, но реализация делает
inspection, native confirmation и повторный preview до POST. Dialog показывает
операцию, provider, UUID/root/private file, но не secret. Новые metadata не
подставляются в старое approval. Старый backend без capability не получает POST.
Response проверяется по target и operation; success означает committed configured
state, а не подтверждённую upstream authentication. Cancel не пишет и не выдаёт
success. Missing API и desktop mocks также больше не сообщают фиктивный save/delete.

Command admission ограничен 16 pending mutations и 10 attempts/client/minute с
bounded per-app map. Accepted commands передаются сериализованному writer; shutdown
закрывает admission и drain-ит их. Writer активирует state после durable commit.
Неизвестные persistence errors превращаются в статическое безопасное сообщение,
не возвращают secret/path diagnostics и не считаются success. Общий filesystem
shutdown deadline и межпроцессное владение DATA_DIR остаются отдельными gates.

GET api-keys и Claude application-key hints читают тот же persisted resolver,
поэтому clear bootstrap fallback учитывается после restart, без wizard cache.
CLI file/activity heuristics в полном auth response пока сохранены для compatibility:
это не новый live credential proof, их общая normalization ещё обязательна.
Удаление не означает vendor logout/revocation, secure erase backups или изменение
operator bootstrap config; dialog прямо предупреждает об этом. Credential policy
остальных CLI adapters/remote execution и protected settings update routes ещё
нужно согласовать до завершения всего этапа 7.

Браузерная проверка выявила настоящий reload bug: settings delete controls зависели
только от пустого local browser state, хотя key был сохранён backend. Теперь они
учитывают server presence, refresh после delete и не требуют загрузки plaintext
secret обратно в браузер. По тем же flags доступен explicit Test сохранённого key
с пустым input, без передачи apiKey в verification body и с отдельным paid-query
consent. UI storage/security notice описывает plaintext private backend file,
не выдаёт его за browser-only storage или encrypted secret vault.

Settings Save Anthropic/OpenAI также использует этот native command path, не
выдаёт один setApiKeys в браузере за persistence. Пустой input после reload не
удаляет backend key: для этого остаётся отдельная confirmed Delete операция.

Проверки среза:

- 12 command-service cases: старый/неподтверждённый body, stale target, secret-free
  result, persistence failure, per-app rate/concurrency limits и shutdown drain.
  6 shared DTO и 9 HTTP-client cases проверяют invalid/masked input, protocol gate,
  cancel и отсутствие POST после смены approved identity/storage path.
- Native HTTP двух apps выполняет реальные private-file writes, api-key/token
  store/delete, restart и status read без настоящих upstream accounts. Проверены
  400/409 до write, отсутствие secret в response, неизменность process.env и `.env`,
  подавление bootstrap после restart и настоящий durable commit pending HTTP
  command до завершения Nest shutdown (контролируемо задержан только write port).
- Старые bridge spy assertions удалены вместе с самим bridge, не заменены успешным
  production mock. Старый bridge-only unit suite заменён native service/HTTP tests.
- 2 token-save hook cases: missing API и cancel/failure не вызывают local success.
- `npm run test:server:unit`: 3483 passed, 40 существующих skips.
- `npm run test:server:contract`: 272 passed.
- `npm run test:packages`: 1404 passed.
- Contracts/server/UI production и Electron main/preload builds, typecheck,
  server/UI lint:errors и lockfile check успешны. Прежний chunk-size warning остаётся;
  packaged Electron и Windows acceptance не заявляются.
- Production lifecycle smoke после server build: SIGTERM/SIGINT exit 0.
- Chromium с trace: 9 passed в повторном полном прогоне. Новый scenario включает
  cancel/store, переход из setup в settings с reload, test backend key с пустым
  input без secret в body, Settings Save replacement и confirmed delete. Browser
  models/probes — offline fixtures; key commands/storage — настоящие native.
- Первые прогоны выявили setup-precondition test issue и настоящий reload UI bug;
  test state и production presence controls исправлены отдельно. Один общий прогон
  поймал прежний intermittent loading timeout при переходе в Agent view (до chat
  send); полный повтор пройден без skip/увеличения timeout. Loading flakiness не
  объявляется исправленной этим key-command срезом и остаётся hardening evidence.
- Выбранные real SSH CLI/SDK/Direct chat/restart: 3 passed, 34 filtered.
- Docker acceptance с `MANAGED_DOCKER_TEST_BASE_IMAGE=automaker-nest-stage2-smoke:latest`:
  11 passed, 4 opt-in skipped; owned cleanup проверен.
- Route/dependency/API-consumer inventories обновлены, все три checks актуальны;
  форматирование и diff check успешны.
  Setup auth/CSRF, общий credential-consumer policy, usage ownership, provider
  capabilities/lifecycle и этапы 8–11 остаются открытыми; UUID/confirmation не заменяют
  авторизацию и этот срез не завершает всю миграцию.

## 7.7. Agent routes

- [x] Start/query/follow-up/cancel.
- [x] Session list/history интеграция.
- [x] Running agents read model.
- [x] Streaming через EventBus compatibility layer.
- [x] Request завершение не отменяет долгоживущий agent job.
- [ ] Shutdown отмечает jobs interrupted до закрытия provider processes.

### Срез: Running Agents и chat execution leases

`ChatExecutionReadModel` — отдельный application-scoped Nest provider. Он добавляет
chat-записи в native `GET /api/running-agents`, сохраняя прежние feature/backlog/spec
rows и их относительный порядок. Additive fields: `kind: chat`, `sessionId`,
`workingDirectory`; совместимый `featureId` имеет вид `chat:<sessionId>`.
В список не попадают prompts, history, images, credentials и SDK resume IDs.

Активность определяется выбранным input и живым `AgentExecutionCoordinator` lease,
а не ранним сбросом `session.isRunning`. Chat виден во время preparation, streaming,
cancel cleanup и terminal persistence до settlement lease. Не выбранный no-op
queue lease не отображается. После metadata I/O выполняется повторная проверка
активных leases, чтобы завершившийся run не остался из-за старого snapshot.
При отсутствии живых chats storage не читается; GET не выполняет hydration,
recovery, provider probes или target commands. Persisted/interrupted sessions
после restart не выдаются за работающие jobs.

UI различает chat и feature: Stop использует `agent.stop(sessionId)`, Open Chat
выбирает проект, рабочий каталог и сохранённую session selection перед переходом
в Agent view. Feature stop/log actions не изменены. Если проект удалён из local
UI store, chat всё ещё можно остановить; невозможный переход отключён.
Ошибка stop показывается явно и не превращается в успешное удаление карточки.
Ошибка read model также не показывает ложное «нет работающих агентов».

Sidebar и Running Agents используют общий query-cache. Stream lifecycle events
debounce-ят invalidation на 300 ms; независимый пятисекундный polling обновляет
lease status, даже если stop не отправил terminal frame или другой WS traffic
подавил бы smart polling. Поддержан старый API без optional `totalCount`.
Новые UI labels имеют русский перевод.

Проверки: 6 read-model unit tests; mixed feature/backlog/spec/chat aggregation;
native HTTP cancellation с отложенным provider cleanup; UI stop/open/worktree/
failure/legacy-feature tests; fake-timer polling и subscription cleanup.
Chromium использует отдельный test-only hold scenario в E2E composition: реальный
chat остаётся активным при навигации, появляется в Running Agents, открывается и
останавливается через native API. Production providers и config не получают
test flags или prompt-dependent поведения.

Checkpoint среза:

- `npm run test:server:unit`: 3126 passed, 40 skipped; дополнительный повтор
  read-model/aggregation tests после обновления mixed rows: 7 passed.
- `npm run test:server:contract`: 257 passed.
- `npm run test:packages`: 1194 passed, включая 6 card/action/error tests и
  3 polling/cache compatibility tests.
- Server production build/lint, UI typecheck/lint, lockfile, formatting и
  `git diff --check`: успешно.
- `npm run build --workspace=apps/ui`: Web UI и Electron main/preload собраны;
  Vite сообщает о крупных chunks. Это не packaged Electron acceptance.
- Три generated inventory checks: успешно.
- `node scripts/smoke-server-lifecycle.mjs`: SIGTERM/SIGINT exit 0.
- Выбранные SSH Direct/CLI/SDK chat/restart: 3 passed, 34 отфильтрованы.
- Полный Docker acceptance с локальным
  `MANAGED_DOCKER_TEST_BASE_IMAGE=automaker-nest-stage2-smoke:latest`: 11 passed,
  4 opt-in skipped; cleanup owned resources успешен.
- Chromium `start-new-chat-session.spec.ts`: 2 passed, held-chat Running Agents
  workflow и обычный send/stream/reload.

Граница среза: legacy backlog/spec aggregation пока импортирует route-owned
registries; перенос их ownership остаётся задачей этапа 8. Общий provider
capability/dispose contract, tool policy и оставшиеся setup/usage modules ещё
не закрыты. Этот checkpoint не завершает этап 7 или всю миграцию.

## Application-owned environment для оставшихся локальных CLI (2026-10-24)

Production factories Cursor, Gemini, OpenCode и Copilot теперь получают тот же
application-scoped reader `ApplicationCredentialsService.environment()`, что Claude
и Codex. Общий `CliProvider` разрешает новый снимок непосредственно перед локальным
запуском, сохраняет provider-specific overrides и передаёт `inheritEnv: false`.
Удалённые SSH/Docker paths не читают host application credentials и продолжают
использовать credentials целевой среды. Общий экземпляр adapter не хранит снимок
между запросами; изменение или удаление ключа действует на следующий запуск.

Copilot SDK получает отдельный `env` при создании каждого client. В установленном
`@github/copilot-sdk` 0.1.16 `options.env` заменяет, а не дополняет `process.env`
(`dist/client.js`, constructor и startCLI). Новые тесты проверяют передачу через
mock SDK; реальный платный Copilot upstream в этих проверках не вызывается.

`cli-environment.test.ts` запускает настоящие Node subprocesses через общий путь
Cursor/Gemini/OpenCode: две параллельные application contexts, отсутствие пропущенных
host secrets, повторный запуск после удаления, immutable snapshots, provider
overrides и fail-closed при ошибке reader. Отдельно проверяются все четыре
production factories и issued remote runtime без чтения/передачи host environment.
Это не проверка наличия или авторизации реальных vendor CLI.

Проверки среза:

- `npm run test:server:unit`: 3500 passed, 40 existing skipped, включая
  16 environment/factory/remote checks и новый Copilot SDK environment case.
- `npm run test:server:contract`: 272 passed.
- `npm run test:packages`: 1404 passed.
- Server production build, UI typecheck, server lint, lockfile, Prettier,
  `git diff --check` и три inventory checks: успешно.
- `node scripts/smoke-server-lifecycle.mjs`: SIGTERM/SIGINT exit 0.
- Выбранные real-SSH Direct/CLI/SDK chat/restart cases: 3 passed,
  34 отфильтрованы (`uses real chat|uses the real chat service|runs Direct chat/model tools`).
- `MANAGED_DOCKER_TEST_BASE_IMAGE=automaker-nest-stage2-smoke:latest npm run test:docker --workspace=apps/server`:
  11 passed, 4 opt-in skipped; owned cleanup checks в afterAll успешны.
- Chromium `tests/agent/start-new-chat-session.spec.ts --workers=1 --trace=on`:
  2 passed, Running Agents stop и chat send/stream/reload. Upstream providers
  в browser fixtures не вызываются; это Web workflow smoke, не live vendor proof.

Граница: raw/manual constructors сохраняют совместимый default reader
`process.env`. CLI discovery, status/auth heuristics, vendor login files и
Windows/WSL forwarding ещё требуют отдельного аудита; этот срез не доказывает
полной credential isolation этих путей и не завершает этап 7.

## Passive Copilot setup status и отдельное application connection (2026-10-24)

Удалены вызовы `gh auth status` и `copilot auth status` из `CopilotProvider.checkAuth()`.
Проверка читает application environment snapshot и только stat-ит `hosts.yml`:
`GITHUB_TOKEN` не выдаётся наружу, содержимое config-файла вообще не читается.
Путь использует `GH_CONFIG_DIR`, затем `XDG_CONFIG_HOME`/home context. Директория
с именем `hosts.yml` не считается config-файлом, а filesystem failure возвращает
только статическое безопасное сообщение. Version/model CLI subprocesses также
получают application environment вместо неявного process.env.

Native GET `/api/setup/copilot-status` всегда возвращает
`auth.authenticationChecked: false` и `auth.authenticated: false`. `hasEnvToken` и
`hasConfigFile` — только hints, не identity, валидность credentials или entitlement.
Normalizer не доверяет даже прежнему adapter result с `authenticated: true`.
Независимый `connected` отражает application disconnect marker: reconnect не
производит upstream login и не превращает hints в подтверждённую авторизацию.

Общий strict контракт и HTTP client отвергают старые/некорректные auth claims,
identity/token fields и произвольный error text. API header повышен до `10`;
server/client обновляются вместе. Capability/protocol versions других commands
не меняются. UI setup/settings явно показывает «Authentication not checked»,
не poll-ит успешный login после копирования команды и отдельно предлагает
confirmed application disconnect/reconnect в settings. Добавлены русские тексты.

Новые проверки: actual production Nest factories в двух приложениях, реальные
environment snapshots и stat/file hints; installation/version в HTTP test явно
подменены fixtures. Unit проверяет отсутствие auth commands/file-content reads,
directory и filesystem errors. Contracts/client отвергают invented identity и
secrets. Chromium проверяет setup, settings refresh и подтверждённые
disconnect/reconnect без ложной авторизации. Это не live Copilot account test.

Проверки среза:

- `npm run test:server:unit`: 3502 passed, 40 existing skipped.
- `npm run test:server:contract`: 273 passed, включая новый production-factory
  HTTP test в двух applications и обновлённый reconnect invariant.
- `npm run test:packages`: 1419 passed, включая strict passive schema/client и
  settings notice/reconnect component tests.
- Types/contracts/server production builds, Web UI и Electron main/preload build,
  UI typecheck, server/UI lint, lockfile, formatting, `git diff --check` и три
  inventory checks: успешно. Packaged Electron этим не проверяется.
- Lifecycle smoke: SIGTERM/SIGINT exit 0.
- Выбранные real-SSH Direct/CLI/SDK chat/restart: 3 passed, 34 отфильтрованы.
- Docker acceptance с `MANAGED_DOCKER_TEST_BASE_IMAGE=automaker-nest-stage2-smoke:latest`:
  11 passed, 4 opt-in skipped, cleanup owned resources успешен.
- Chromium: Copilot passive setup/settings/disconnect/reconnect, GitHub confirmed
  auth, Cursor disconnect/reload и два Agent chat workflows — итоговый полный
  повтор 5 passed (`--workers=1 --trace=on`). Предыдущий прогон: 3 passed,
  2 failed. В новом тесте исправлен URL filter, ошибочно считавший
  `deauth-copilot` как `auth-copilot`. Независимый Cursor reload упёрся в общий
  `Loading…`; trace показывает незавершённые Vite module requests при завершении
  теста. Таймаут не увеличен; этот startup/loading flake не объявляется
  исправленным. Сохранённые локальные traces:
  `/tmp/automaker-copilot-passive-cursor-loading-trace.zip` и
  `/tmp/automaker-copilot-passive-url-filter-trace.zip`.

Границы: passive Copilot не доказывает entitlement; поддерживаемый environment
hint здесь только `GITHUB_TOKEN`. Прочие vendor credential sources не объявляются
валидными или отсутствующими по этому flag. Legacy disconnected installation
fallback, CLI discovery/runtime lifecycle и остальные providers' auth evidence
ещё требуют аудита. Этап 7 и миграция остаются незавершёнными.

## Срез Gemini / Google credentials (2026-10-24, API v11)

`GeminiProvider.checkAuth()` теперь читает application environment snapshot и
stat-ит settings-файл в home context, не разбирая token/selected auth type и не
запуская auth query. Status/install hints не объявляют authorization success.
Version subprocess также получает application snapshot. Native status normalizer
не доверяет legacy adapter `authenticated: true`; strict shared DTO и HTTP client
возвращают unverified hints и отдельное application `connected`.

Google provider добавлен в native confirmed store/delete, private credential FIFO
и persisted bootstrap-deletion policy. Managed key попадает в `GEMINI_API_KEY`,
а competing `GOOGLE_API_KEY` исключается. Без application policy исходные Gemini/
Vertex переменные оператора не объединяются и не переименовываются. Delete
подавляет оба key bootstrap paths и после restart, но не удаляет vendor OAuth/ADC,
CLI files, operator `.env` или backups и не отзывает key у Google. Credentials
принимаются как bounded opaque value; upstream проверка при сохранении не делается.
Режимы сверены с [официальным описанием Gemini CLI authentication](https://geminicli.com/docs/get-started/authentication/).

Setup form больше не вызывает отсутствующий `saveApiKey`, не пишет plaintext в
frontend store и не выставляет auth success после сохранения. Native consent
с target instance/root/private path обязателен для save/delete. После reload
показываются только hints и Delete, не сам backend key. Login command копируется
без polling якобы успешной авторизации. Setup и Gemini settings используют общую
native key форму; общий Settings Save не вызывает native Google command для
скрытого legacy value. Legacy credentials settings transport и его consumer policy
ещё требуют отдельного аудита.
Прежний fake success у Test Gemini connection заменён явным
сообщением, что реальный verifier недоступен. Этот verifier остаётся незакрытым.

Добавлены real-Nest production-factory HTTP tests в двух приложениях и после
restart: actual private record, stat/config hints и реальные локальные Node child
processes с разрешённым per-app environment. Только installation/version adapter
ports заменены fixtures; платные vendor CLI/queries не запускаются. Browser E2E
composition использует real Gemini passive hints/application credential reader,
но mock execution и owned temporary home; bootstrap Google/Vertex vars очищены
только в test host snapshot, не в process.env оператора.

Проверки среза:

- Финальный `npm run test:server:unit`: 3511 passed, 40 existing skipped.
  Более ранний полный запуск: 3510 passed, 1 failed, 40 skipped; lifecycle race
  описана ниже и не объявляется исправленной последующим повтором.
- `npm run test:server:contract`: 274 passed.
- Финальный `npm run test:packages`: 1438 passed, включая Google opaque DTO,
  private-field rejection, native consent, passive notices и cancellation form.
- Types/contracts/server builds и Web UI/Electron main/preload build: успешно.
  Packaged Electron и Windows acceptance этим не доказываются.
- UI typecheck, server/UI lint, Prettier, lockfile, `git diff --check` и три
  generated inventory checks: успешно.
- Lifecycle smoke: SIGTERM/SIGINT exit 0.
- Real SSH Direct/CLI/SDK chat/restart выборка: 3 passed, 34 отфильтрованы.
- Docker с `MANAGED_DOCKER_TEST_BASE_IMAGE=automaker-nest-stage2-smoke:latest`:
  11 passed, 4 opt-in skipped, owned cleanup checks успешны.
- Финальный Chromium набор: 11 passed, `--workers=1 --reporter=line --trace=on`.
  Gemini cancel/store/reload и Delete через обычные Gemini settings проходят
  без false auth и без выдачи сохранённого key в форму. Остальные scenarios:
  Copilot status, native setup keys, GitHub auth, Codex/Claude verification,
  Cursor permissions/disconnect, install guidance и два Agent chat workflows.

## Local exec lifecycle regression: обнаружение и исправление (2026-10-24)

Первый полный server unit run упал в неизменённом
`local-execution-environment.test.ts`:
`cancels the shell and ordinary child/grandchild processes before returning`.
После возврата `PROCESS_INTERRUPTED` `/proc/<fixture-pid>/status` ещё показывал
`R (running)` с pending SIGKILL. Последующий read подтвердил отсутствие этого PID;
изолированный recheck файла — 17 passed. Это не доказательство исправления.
На момент обнаружения Linux branch `LocalExecutionEnvironment.exec().stop()`
ждала отправку SIGKILL, но не отдельно quiescence process group после root `close`.

Исправление: Local exec после сигнала ждёт новый read-only platform probe
`waitForLinuxProcessGroupExit` для уже принадлежащей ему detached process group.
Успешное подтверждение возможно после исчезновения группы либо terminal states
всех наблюдаемых members/tasks. Linux stat fields сверены с
[proc_pid_stat(5)](https://man7.org/linux/man-pages/man5/proc_pid_stat.5.html).
Zombie leader не означает завершения остальных threads; недоступная task metadata
при существующей группе считается неопределённостью, не успешным cleanup — см.
[proc_pid_task(5)](https://man7.org/linux/man-pages/man5/proc_pid_task.5.html).

Существующий двухсекундный watchdog теперь остаётся включённым до завершения
observation, а не снимается при parent `close`. Deadline отменяет observer и
возвращает `PROCESS_CLEANUP_FAILED`, не нормальный success/interrupted ack.
Monotonic deadline проверяется и перед outcome, поэтому задержанный event-loop
callback watchdog нельзя обойти поздним успешным observation.
Root close по-прежнему обязателен; при успешно подтверждённом abort сохраняется
`PROCESS_INTERRUPTED`. Ошибки observer не раскрывают command/process metadata.

Probe посылает только signal 0 для проверки исходного group ID, не сигналит
найденные PID. Numeric group 0/1 и invalid IDs отвергаются. Metadata reads идут
batch-ами до 32, со stop signal между batch-ами и явными пределами enumeration.
Пустое или недоступное наблюдение существующей группы не считается terminal.
Обычные zombie members допустимы: reaping их новым родителем не принадлежит этому
command owner. Никакой PID из прошлого упавшего запуска не используется для kill.

Детерминированные tests отдельно держат observation после real shell close,
проверяют обе ветви result/abort и сохранение watchdog после close. Unit fixtures
покрывают живой thread при zombie leader, недоступные tasks, disappearing group,
malformed stat, invalid group и отмену observation. Исходный real child/grandchild
test не изменён и не получил дополнительного timeout/skip.

Проверки исправления:

- Targeted core/lifecycle/real Local exec: 41 passed (19 probe, 5 lifecycle,
  17 исходных real filesystem/process cases).
- Полный server unit run: 3535 passed, 40 existing skipped.
- HTTP/WS contract run: 274 passed.
- Shared/platform/UI packages: 1438 passed.
- Production server build/lint, UI typecheck/lint и lifecycle SIGTERM/SIGINT smoke:
  успешно. API version остаётся `11`, transport/protocol schemas не менялись.
- Real SSH выборка Direct/CLI/SDK chat/restart: 3 passed, 34 отфильтрованы.
- Docker acceptance с `automaker-nest-stage2-smoke:latest`: 11 passed,
  4 opt-in skipped; owned cleanup checks успешны.
- Chromium Agent chat / Running Agents stop / send-stream-reload: 2 passed.
- Исходный тест реальных child/grandchild дополнительно запущен 25 раз без
  изменения assertion/timeout; каждый запуск выбирает 1 case, 16 отфильтрованы.

Первые прогоны новых fixture tests выявили ошибки именно тестового scheduler/model:
Vitest fake timers не управляли `node:timers/promises`, а one-shot mock queue
не вызывала нужный observation gate. Они заменены явным observation gate и
исправленной очередью. Production test не ослаблен. Lint также потребовал явный
Node `perf_hooks` import вместо неописанного ESLint global `performance`;
сборка и targeted tests перепроверены после исправления.

Граница: исправляется найденный Linux Local exec race для обычных потомков в
принадлежащей command process group на читаемом procfs. Это не sandbox, не
доказательство containment для deliberate setsid/process-group/privilege escapes
и не complete provider/terminal cancellation audit. Windows/macOS реализация
group termination этим Linux probe не сертифицируется. Этап 7 и вся миграция
остаются незавершёнными по остальным gates.

## Bulk credentials transport retirement / explicit browser import (2026-10-24, API v12)

Проверено по фактическим callers: обычный `useSettingsSync` не включает apiKeys
в синхронизируемые поля и сам не восстанавливал ключи. Обход находился в native
settings PUT с loose record DTO и в server-side localStorage migration. Оба могли
обойти target confirmation и заменить private metadata/ключи.

Native `PUT /api/settings/credentials` теперь authenticated HTTP 410 tombstone с
static `CREDENTIAL_WRITE_RETIRED`, без body inspection/private I/O. Express
compatibility handler тоже не имеет writer dependency и возвращает 410.
Неиспользуемые frontend bulk hook/sync helper и write method в HTTP/Electron API
удалены, как и shared loose write DTO/OpenAPI entry. Masked GET сохранён.
API header повышен до `12`, остальные setup command protocol versions не меняются.

`SettingsService.migrateFromLocalStorage` продолжает мигрировать обычные settings,
но не пишет credentials: `migratedCredentials: false`, с отдельным
`credentialImportRequired`. Существующие credentials/deletion policy не меняются,
даже при повторном импорте старого browser record. Parse/project failure details
не включают raw legacy body/path. Общий JSON parser также больше не отражает
фрагменты credential-bearing malformed bodies в ошибке.

В Settings API Keys добавлен отдельный `LegacyCredentialImport`. Он не выполняет
inspection/import на mount. После Inspect перечисляет только known provider names;
raw values остаются в ограниченном ref, не в DOM/status/toasts. Import каждого
anthropic/google/openai key использует existing native preview/confirmation/
preflight и FIFO. Cancellation оставляет кандидат доступным и не показывает
success. После commit UI говорит «authentication not checked». Никакого fallback
на bulk writer и автоматического import после reload нет. Исходная localStorage
backup остаётся нетронутой; её наличие не означает безопасность downgrade.

Проверки включают два реальных Nest apps, byte-for-byte unchanged private file
после retired PUT и повторного settings migration, отсутствие stale keys в global
settings file, suppressed bootstrap после restart и допустимый новый confirmed
native import. JSON parse failures не отражают secret input. Unit проверяет
compatibility tombstone без body access, bounded/whitelisted/prototype-safe browser
inspection и отсутствие read/write на mount. Chromium проверяет mount, Inspect,
cancel, confirm, отсутствие plaintext в DOM и неизменность browser backup.

Проверки среза:

- `npm run test:server:unit`: 3536 passed, 40 existing skipped.
- `npm run test:server:contract`: 275 passed, включая новый реальный HTTP/restart
  test и сохранение authentication на retired PUT.
- `npm run test:packages`: 1449 passed. Inspector не читает storage на mount,
  не показывает keys, не активируется после cancel и игнорирует inherited fields.
- Production contracts/server и Web UI/Electron main/preload builds, UI typecheck,
  server/UI lint, formatting, lockfile и три inventory checks: успешно.
- Lifecycle smoke: SIGTERM/SIGINT exit 0.
- Real SSH Direct/CLI/SDK chat/restart выборка: 3 passed, 34 отфильтрованы.
- Docker acceptance с локальным `automaker-nest-stage2-smoke:latest`: 11 passed,
  4 opt-in skipped; cleanup owned resources успешен.
- Финальный Chromium набор: 6 passed (`--workers=1 --trace=on`), explicit legacy
  import, native setup keys, Gemini/Copilot status и два Agent chat workflows.
  Сохранённый old browser key не восстанавливается при mount/cancel, появляется
  в backend только после native confirmation; ни один bulk PUT не отправлен.

Граница: это не полный аудит всех endpoint-specific secret types, credential
profiles, z.ai/Direct ownership, public setup auth/CSRF или downgrade/secure erase.
Этап 7 и миграция остаются незавершёнными по этим и остальным gates.

### Срез: native usage composition и lifecycle Codex model cache

Шесть stateful services — `ClaudeUsageService`, `CodexAppServerService`,
`CodexUsageService`, `CodexModelCacheService`, `GeminiUsageService` и
`ZaiUsageService` — теперь создаются фабриками `ProvidersModule`. Их legacy tokens,
поля `LegacyServiceOverrides`, ручные legacy factories и зависимости application
facade от этих tokens удалены, а не заменены aliases. Usage facade получает
class-token dependencies. Codex usage и model cache используют один app-server
instance в пределах приложения; `DATA_DIR` кэша берётся из `RuntimePathsService`.

`ProvidersModule.register(runStartupTasks)` регистрируется один раз в composition
root. Повторный статический import из `ModelsModule` удалён: model consumers
получают экспортированный registry через существующий global module. Contract
проверяет ровно одну регистрацию каждого из шести class tokens в контейнере,
разные instances между двумя приложениями и отсутствие старых полей в legacy
service bag.

Прежний optional background warmup вынесен из legacy startup в
`CodexModelWarmup`. Он не блокирует bootstrap, не запускается при
`runStartupTasks: false`, запускается не более одного раза и дожидается своего
promise при shutdown. Ошибка warmup логируется статическим сообщением без raw
adapter details. Сам model cache отслеживает принятые get/metadata/refresh/clear
операции; его shutdown закрывает admission и ждёт завершения этих операций,
включая disk I/O. Уже принятая операция не отклоняется повторной внутренней
проверкой admission. Refresh deduplication и прежний disk format сохранены.

Новые tests проверяют delayed warmup, synchronous/rejected adapter errors,
disabled startup, повторные hooks, shutdown сразу после admission и отказ новых
операций. Native container contract с настоящим кэшем удерживает model response
и доказывает, что Nest shutdown не завершается до записи cache file. Отдельный
two-application/restart contract проверяет изоляцию файлов, instance token z.ai,
public usage facade, общую Codex dependency и чтение persisted cache после restart
без CLI probe. Vendor CLI/network в этих tests заменены явными offline fixtures.

Проверки среза:

- `npm run test:server:unit`: 3543 passed, 40 existing skipped; 7 новых lifecycle
  unit tests.
- `npm run test:server:contract`: финальный полный запуск 277 passed; 2 новых
  contracts на native ownership/restart и ожидание warmup/file write.
- `npm run test:packages`: 1449 passed.
- Server production build/lint и SIGTERM/SIGINT lifecycle smoke: успешно, exit 0.
- Web UI/Electron main/preload build, UI typecheck, lockfile, formatting, diff и
  три inventory checks: успешно.
- Real SSH Direct/CLI/SDK chat/restart выборка: 3 passed, 34 отфильтрованы.
- Docker acceptance с локальным `automaker-nest-stage2-smoke:latest`: 11 passed,
  4 opt-in skipped; suite проверяет cleanup собственных ресурсов.
- Chromium Agent/Running Agents: повтор без изменений 2 passed. В первом запуске
  второй сценарий остановился на HTML `Loading…` до появления agent view и до
  создания чата, а не на проверке восстановления истории. Trace сохранён вне
  repository: `/tmp/automaker-usage-owner-chat-reload-trace.zip`. Причина loading
  остаётся открытой; успешный повтор не объявляется её исправлением.
- Первые container checks выявили повторную static/dynamic module registration;
  import исправлен, добавлен assertion ровно одной регистрации. Новый lifecycle
  test первоначально ошибочно ожидал одновременный вызов обоих shutdown hooks:
  Nest завершает зависимый warmup перед cache hook. Тест проверяет фактический
  порядок; drain assertion и production deadlines не ослаблялись.

Граница: native ownership не означает завершённый аудит usage adapters.
Claude/Codex/Gemini usage ещё используют ambient CLI discovery, environment/auth
file paths; z.ai fallback ещё читает `process.env`. Сохранены legacy usage/auth
heuristics, error mapping и model metadata (включая старое предположение о vision
в динамическом Codex cache). Политика consent для usage/network refresh, redaction
всех adapter errors и actual child-process termination app-server ещё требуют
работы. Await cache promise не доказывает exit внешнего процесса. Этап 7 и этапы
8–11 не объявляются завершёнными этим срезом; публичный API остаётся версии 12.

### Срез: application-owned usage environment и POSIX PTY argv

Native factories usage-сервисов больше не используют ambient constructors для
Claude/Gemini/z.ai. Claude discovery, PTY и старый неиспользуемый expect helper
получают новый snapshot из `ApplicationCredentialsService` перед каждым запуском.
Сохранённый managed API key отключает competing OAuth через существующую policy;
после native удаления API/OAuth следующий процесс не получает suppressed bootstrap
values. Ошибка чтения credentials не запускает CLI с host fallback. Child получает
явные environment и application working directory; parent `process.env` не меняется.

На POSIX PTY запускает `claude` напрямую с argv `['--add-dir', workingDirectory]`,
без `/bin/sh -c`. Кавычки, `$()` и прочие символы в пути остаются данными. Windows
cmd/winpty path сохранён и не объявляется сертифицированным Linux acceptance.
Неиспользуемый Electron environment heuristic удалён; public PTY path, parser,
таймауты и существующий Windows fallback сохраняются.

Gemini usage получает immutable `HOST_ENVIRONMENT` и application cwd. Его OAuth
paths и home-relative binary candidates используют HOME, затем USERPROFILE, затем
OS homedir только при отсутствии обоих. `which`/`where` и secondary `find` получают
тот же snapshot, а не ambient child inheritance. z.ai instance получает собственный
snapshot bootstrap key, host и quota URL; environment другого приложения и поздняя
мутация объекта caller не меняют его. Existing instance-token/host precedence не
меняется этим срезом.

Добавлены 6 unit и 2 native contracts. Два реальных приложения используют разные
HOME и z.ai endpoints; локальный HTTP server проверяет usage/verify authorization.
Network guard запрещает выход этих fixtures за owned loopback origins. Реальный
Linux PTY запускает offline Node CLI из собственного PATH, проверяет managed key,
deletion, независимость второй инстанции и буквальное argv/cwd с `$()`/кавычками.
Child сохраняет только hashes fake credentials; assertions не печатают raw operator
environment или неизвестный Authorization при регрессии. Остальные unit проверяют
snapshot immutability, USERPROFILE fallback, explicit omission и fail-closed reader.

Проверки среза:

- `npm run test:server:unit`: финальный полный запуск 3549 passed, 40 existing
  skipped. После portable path assertions повтор целевых suites: 47 passed,
  1 existing skipped.
- `npm run test:server:contract`: финальный полный запуск 279 passed; native usage
  tests включают реальный PTY child и локальные HTTP requests, без vendor calls.
- `npm run test:packages`: 1449 passed.
- Production server и UI/Electron main/preload builds, server lint, UI typecheck,
  lockfile, formatting, diff и три inventory checks: успешно.
- SIGTERM/SIGINT lifecycle smoke: exit 0.
- Docker acceptance: 11 passed, 4 opt-in skipped; owned resources удалены suite.
- Real SSH Direct/CLI/SDK chat/restart выборка: 3 passed, 34 отфильтрованы.
- Chromium Agent/Running Agents/Gemini: повтор без изменений 3 passed. Первый
  запуск: 2 passed и timeout Agent view до создания чата. Snapshot показывает HTML
  `Loading…`; trace содержит незавершённые загрузки JS-модулей и Gemini status.
  `/tmp/automaker-usage-env-chat-loading-trace.zip` сохранён вне repository.
  Причина не доказана; этот срез не объявляется исправлением loading instability
  и не меняет browser deadlines/retry settings.

Граница: Codex usage/app-server ещё требуют собственного environment/discovery
переноса. Gemini usage по-прежнему реализует старый OAuth refresh/write-back и TTL,
а не native Google API-key verifier. z.ai configure/delete policy, consent на
usage/network probes, upstream redaction, PTY trust auto-approval и подтверждённый
process-tree exit не закрываются environment seam. Legacy/manual constructor
defaults всё ещё разрешают `process.env` для compatibility callers; production
Nest factories передают context явно. API version остаётся 12; этапы 7–11 не
объявляются завершёнными.

### Follow-up browser acceptance: failed bootstrap modules

Сохранённый `Loading…` trace разобран: в нём есть `net::ERR_NETWORK_CHANGED`
при JS loading. Отсутствовавший до React bootstrap error path исправлен и проверен
детерминированными module abort tests и production artifact smoke. Подробности,
границы и checkpoints — в срезе bootstrap recovery этапа 10. Это не claim, что
устранены все возможные network failures, dev-server delays или все gates этапа 7.

### Срез: Codex usage context и owned app-server cleanup

Native Codex usage и app-server используют общий `CodexUsageRuntime`, создаваемый
Nest из `ApplicationCredentialsService` и `RuntimePathsService`. Каждый RPC получает
fresh immutable environment: managed OpenAI key и canonical CODEX_API_KEY следуют
существующей durable credential policy; удаление подавляет bootstrap для следующего
процесса, не меняя parent environment. CLI discovery не запускает команды: PATH,
home-relative/system candidates, NVM/fnm/Volta/pnpm/Yarn и Windows context paths
проверяются явно. Relative PATH/CODEX_HOME разрешаются от application cwd, не
ambient cwd. Default auth path — HOME/USERPROFILE `.codex/auth.json`, explicit
CODEX_HOME имеет приоритет. Auth read ограничен 1 MiB и regular file; handle
закрывается и при ошибке. Legacy/manual defaults вынесены в отдельный compatibility
helper, native factories их не используют.

Протокол сохранён по [OpenAI Docs app-server](https://learn.chatgpt.com/docs/app-server):
stdio JSONL, initialize → initialized → model/list либо account/read/rateLimits.
Конфигурация state root сверена с [official environment reference](https://learn.chatgpt.com/docs/config-file/environment-variables).
Это не новая версия CLI/SDK и не live-vendor acceptance. Поверхность этого owner
не отправляет thread/turn/login/tool/approval commands; account/read по-прежнему
передаёт refreshToken false. Это не обещание, что vendor process никогда не пишет
собственные logs/cache или не выполняет startup behavior из своей config.

RPC owner ограничивает admission четырьмя queries. Deadline включает discovery
и protocol; cancellation предотвращает поздний spawn после отложенного snapshot.
Native discovery проверяет AbortSignal между filesystem operations. JSONL decoder
поддерживает split UTF-8; bounded input (1 MiB total, 131072 chars pending buffer,
1000 messages) и malformed/server-request failures не отражают raw diagnostics.
Child/stdin errors обработаны, stderr дренируется без сохранения или логирования.

Result не возвращается до cleanup. POSIX child имеет собственную detached group;
TERM эскалируется до KILL через 500 ms, cleanup ограничен 2 s с monotonic deadline.
Linux ждёт child close и quiescence исходной owned group через общий procfs probe
этапа 6. Probe failure/timeout не объявляется успешным RPC: статический
`CodexAppServerCleanupError` закрывает admission owner. Usage и model cache не
подменяют эту неопределённость auth-file/cache fallback. Before-shutdown закрывает
admission, abort-ит accepted queries и дожидается cleanup до поздних cache/warmup
shutdown hooks; повторный shutdown идемпотентен. Обычная unavailable/protocol
ошибка с подтверждённым cleanup сохраняет старый null/fallback contract.

Удалены raw JWT claim dump и произвольные account-type strings из fallback logs.
Сам JWT fallback всё ещё показывает unverified local plan metadata, не является
проверкой authentication или текущего subscription/usage. Этот debt не закрывается
переездом auth path.

Новые проверки включают 18 unit и 2 native contracts: delayed close, timeout,
UTF-8 chunks, malformed/oversized/approval/early-exit, spawn failure, deferred
discovery, admission limit, observer failure/timeout, запрет fallback при cleanup
uncertainty и обычный same-group descendant. Два реальных Nest apps используют
собственные offline CLI, credentials и CODEX_HOME; HTTP catalog проверяет fresh
managed key/delete и буквальный cwd с кавычками/`$()`. CLI capture сохраняет hashes,
не plaintext keys. Отдельный native test удерживает RPC и проверяет actual child
exit после Nest close. Fixtures не загружают vendor SDK и не делают vendor calls.

Проверки среза:

- `npm run test:server:unit`: финальный полный запуск 3567 passed, 40 existing
  skipped; 18 новых runtime/RPC/fallback tests.
- `npm run test:server:contract`: финальный полный запуск 281 passed. Native
  context/ownership tests повторены отдельно на финальном source.
- `npm run test:packages`: 1457 passed.
- Production server и UI/Electron main/preload builds, server lint, UI typecheck,
  lockfile, formatting/diff и три inventory checks: успешно.
- Последовательный server build → SIGTERM/SIGINT lifecycle smoke: exit 0.
- Docker acceptance: 11 passed, 4 opt-in skipped; owned resources cleanup успешен.
- Real SSH Direct/CLI/SDK chat/restart выборка: 3 passed, 34 отфильтрованы.
- Chromium после завершения Docker/SSH: 4 passed, Agent/Running Agents, confirmed
  setup credentials и explicit Codex verification; без browser retry/timeout changes.
- Первое добавление native shutdown test ошибочно вложило его в другой test;
  collection failure исправлен в harness, shutdown assertion сохранён. Первый lint
  также потребовал отделить ambient compatibility default от core runtime и
  выразить cleanup-error precedence без throw в finally. Финальные проверки зелёные.

Граница: Windows cmd transport и macOS требуют своей acceptance; Linux group probe
не доказывает containment намеренного setsid/group/privilege escape. Нельзя переносить
эти доказательства на все Codex SDK/CLI execution paths, credential runtime или PTY.
Consent на usage/model probes, vendor startup behavior, строгая response schema,
динамическое vision metadata, passive status policy всех providers и общий deadline
приложения остаются gates этапа 7. API version остаётся 12; этапы 7–11 не завершены.

### Срез: API v13 passive Cursor status и единый setup UI

Удалён ложный Cursor auth fallback: успешный `--version` больше не означает login,
а наличие CURSOR_API_KEY или credentials file не становится verified account.
`checkAuth()` не вызывает discovery, native/WSL auth commands или version и не
читает содержимое credential files. Он читает fresh application environment и
только stat известных host paths: explicit CURSOR_CONFIG_DIR, либо HOME/USERPROFILE
`.cursor` и XDG_CONFIG_HOME/default `.config/cursor`. Файл должен быть regular;
не-ENOENT metadata error выдаётся статической строкой без path/token details.
Отдельный native version probe теперь получает application environment.

Shared strict `CursorSetupStatusSchema` требует `auth.authenticated: false`,
`authenticationChecked: false`, `scope: host`, booleans hasEnvApiKey и
hasCredentialsFile, method api_key/none. Legacy adapter true/login/identity не
продвигаются native normalizer в auth proof. Root connected — только Automaker
connection marker. Disconnect скрывает hints и не вызывает checkAuth, но сохраняет
Cursor installation probe; это не logout и не отзыв vendor credentials.
HTTP/Electron clients валидируют schema и отвергают old/private/verified claims.
Общий API header повышен до `13`; server и client должны обновляться совместно.

Settings всегда показывает «Authentication not checked», а Disconnect/Reconnect
следуют marker, не auth boolean. Два старых setup implementations заменены общим
`CursorSetupPanel`: Copy login command копирует команду, не запускает CLI, auth
POST или polling. Refresh читает passive status, ошибок чтения не выдаёт за
отсутствующую installation. Global setup store сохраняет passive fields/marker,
provider summary не показывает Cursor как verified. Board model-selection notice
использует installed + explicit connected; unknown/false marker считается
недоступным transport context, но отсутствие authentication proof не выдаётся
за доказательство неработающего CLI. Исполнение query остаётся отдельным действием.

Это соответствует разделению version и auth status в
[Cursor authentication docs](https://prod.cursor.com/docs/cli/reference/authentication)
и [installation verification](https://prod.cursor.com/docs/cli/installation). Новый
vendor auth verifier этим срезом не реализован. Сохранены существующие
cursor-agent/IDE command names; это не переход на новую версию/alias vendor CLI.
Текущие vendor docs показывают `agent`; его discovery/alias compatibility нужно
проверить отдельно, а не считать доказанным этим status-only срезом.

Проверки включают 6 новых provider unit (no token reads, no commands, WSL flag,
directory/error cases, fail-closed reader, version env), strict HTTP client tests,
UI settings/shared setup и model-notice tests. Native HTTP contract использует два
реальных приложения и real credential readers/files; только installation/version
заменены fixtures. Проверены независимые hints, отсутствие private contents и
disconnect/reconnect. E2E composition использует реальный passive Cursor reader
на собственном profile, без bootstrap CURSOR_API_KEY оператора. Chromium проверяет
setup/settings, содержимое clipboard, отсутствие GET polling при продвижении
browser clock, refresh и confirmed disconnect/reconnect без auth success.

Проверки среза:

- `npm run test:server:unit`: 3573 passed, 40 existing skipped.
- `npm run test:server:contract`: финальный полный запуск 282 passed; новый native
  two-app contract и сохранённые connection/permissions/credential contracts.
- `npm run test:packages`: финальный полный запуск 1473 passed; 16 новых UI/client/
  model-notice tests и 6 новых provider tests покрывают новый passive contract.
- Shared types/contracts, server и UI/Electron main/preload builds, UI typecheck,
  server/UI lint, lockfile, formatting/diff и три inventory checks: успешно.
- Последовательный server build → SIGTERM/SIGINT lifecycle smoke: exit 0.
- Docker acceptance: 11 passed, 4 opt-in skipped; cleanup owned resources успешен.
- Real SSH Direct/CLI/SDK chat/restart выборка: 3 passed, 34 отфильтрованы.
- Chromium после завершения Docker/SSH: 4 passed; финальный повтор включает
  clipboard verification и clock-driven проверку отсутствия Cursor status polling.
- Первый typecheck нашёл obsolete result.error branch после strict success schema;
  он удалён, protocol errors теперь приходят из parser. Первые contracts нашли
  два старых ожидания Cursor=true от fixture; они заменены assertions passive
  normalization, connection isolation и их проверки сохранены.

Граница: installation discovery ещё содержит ambient paths и WSL/version command
branches; host hints не описывают auth profile внутри WSL или remote environment.
Cursor key storage/deletion и explicit account verifier не добавлены. Остальные
providers ещё требуют status/evidence audit; public setup auth/CSRF, version-output
redaction, tool policy, универсальный process cleanup и остальные gates этапов
7–11 остаются открытыми.

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

- Versioned connection contract (API v6, connection protocol 3) проверен совместно с Web/Electron HTTP clients:
  без confirmation — 400, при другом instance/provider/path — 409 до записи,
  фактический target возвращается в success response и показан в UI confirmation.
- Client не отправляет connection POST на server без поддерживаемого read-only
  protocol preview и не подставляет новый target в старое confirmation.
- Provider registration полностью явная и управляется Nest DI.
- Нет создания `SettingsService` внутри provider.
- Agent routes удалены из legacy bridge.
- Все providers проходят общий adapter contract suite.
- Active sessions корректно завершаются или помечаются interrupted при shutdown.
- Полный stage checkpoint пройден для fake providers и всех доступных
  environment-specific integration suites; результат зафиксирован отдельным
  завершающим коммитом в общей migration-ветке.
