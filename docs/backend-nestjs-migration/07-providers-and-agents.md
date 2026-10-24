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
- [ ] Перенести Claude/Codex/Gemini/ZAI usage endpoints.
- [x] Перенести model discovery/cache refresh.
- [ ] Status не должен выполнять дорогую авторизацию без явного запроса.
- [ ] Setup mutation требует подтверждения и возвращает фактический target.
  - [x] Disconnect всех шести CLI providers: shared schema, явное подтверждение,
        instance/provider/path target и native application-scoped command.
  - [x] Reconnect всех шести CLI providers: confirmed target, FIFO connection
        changes, read-only protocol gate и отдельное credential evidence.
  - [ ] Install/key/config/verify mutations и единый setup target policy.

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

- Versioned connection contract API v3 проверен совместно с Web/Electron HTTP clients:
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
