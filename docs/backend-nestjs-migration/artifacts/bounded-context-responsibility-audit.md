# Ответственность крупных backend owners

Срез исходников: 25 октября 2026, ветка `refactor/backend-nestjs-migration`, после
изменений wave19 в Local execution и EventHooks. Это статический аудит constructors,
групп публичных методов, полей состояния, native factories и существующих проверок.
Новые тесты в рамках этого аудита не запускались. Размеры файлов — ориентир поиска,
а не критерий завершения этапа 11.

## Границы аудита

Проверены девять кандидатов этапа 11. `PipelineOrchestrator` содержит 923 строки;
отдельный `PipelineService` — 289, поэтому их нельзя считать одним большим store.
Наличие scoped filesystem, shared schema или Nest DI само по себе не доказывает
правильное разделение обязанностей. Ниже отдельно указаны уже существующие границы,
обоснованные причины сохранить owner и конкретные оставшиеся проблемы.

Исходная база доказательств:

- [Agent storage/recovery](agent-storage-recovery-session-checkpoint.md),
  [state/execution](state-execution-contract-checkpoint.md).
- [Ideation lifecycle и conversion](stage-8-ideation-lifecycle-conversion-audit.md),
  [planning/ideation composition](planning-ideation-singletons-checkpoint.md).
- [Settings filesystem](settings-filesystem-audit.md),
  [native stores](native-stores-terminal-cleanup-checkpoint.md).
- [Scoped source ports](source-ports-and-locators-checkpoint.md),
  [terminal host config](terminal-host-configuration-audit.md),
  [confirmed terminal stop](terminal-confirmed-stop-audit.md).
- [Отказ от singleton composition](service-singleton-retirement-audit.md),
  [workload acceptance](workload-acceptance.md).

## Карта owners

### 1. IdeationService — 1988 строк

**Ответственность.** Диалог ideation, генерация suggestions и project analysis;
CRUD идей, истории сессий и cache; сбор контекста и каталог prompt presets.
Это один продуктовый контекст, но несколько независимо изменяемых обязанностей.

**Состояние и границы.** `activeSessions` хранит историю, controller и actual task;
`IdeationJobs` владеет admission, accepted work и drain. Передаются ProviderRegistry,
SettingsService, FeatureLoader, directory validator, scoped filesystem и captured
host environment. Native factory в `IdeationModule` передаёт все зависимости явно.
Durable conversion уже вынесен в `IdeaConversionStore` и native application service;
повторять это выделение не нужно.

**Проверки.** `tests/contract/ideation-native.contract.test.ts`,
`tests/unit/modules/ideation-jobs.test.ts`,
`tests/unit/services/ideation-service.test.ts`; response coverage отдельно от lifetime.

**Решение.** Сохранить session/provider lifetime в одном owner. Реальное место для
последующего уменьшения связанности — чистый prompt catalog и project context reader:
сейчас они находятся рядом с долговременным session state и файловыми mutations.
Не создавать отдельные service для каждой функции. Nullable settings/features дают
standalone constructors урезанные возможности; native composition не имеет этой
неполноты. Это не повод объявлять отсутствующие native dependencies найденной ошибкой.

### 2. SettingsService — 1389 строк

**Ответственность.** Global/project settings и credentials: чтение с defaults,
миграция версий, проверка provider/environment конфигурации и согласованные mutations.
Это persistence/configuration boundary, а не HTTP controller.

**Состояние и границы.** `SettingsMutationQueue` сериализует mutations;
`SettingsFileRepository` владеет scoped read/write и initialization barrier.
Legacy import имеет явные requested/initialized/pending states. Native
`SettingsModule` передаёт repository, importer и режим automatic import; query,
command, Direct settings и runtime effects уже отдельные классы.
`beforeApplicationShutdown` закрывает mutation queue.

**Проверки.** `tests/contract/settings-filesystem.contract.test.ts`,
`tests/unit/services/settings-mutation-queue.test.ts`,
`settings-import-barrier.test.ts`, `settings-service.test.ts`.

**Решение.** Сохранить единый mutation owner: global settings содержат связанные
provider и execution preferences, поэтому механическое разделение записи файла
создало бы конкурирующие transactions. Defaults/migrations и provider parsers могут
быть чистыми collaborators при самостоятельном изменении их правил. Optional
legacy importer здесь обозначает отключённую import capability, а не скрытый service
locator. Runtime effects уже отделены и не должны возвращаться в store.

### 3. AgentService — 708 строк

**Ответственность.** Conversation use cases: start/send/history/session changes,
model selection, deletion и queue API. Это facade над уже выделенными owners.

**Состояние и границы.** Session registry, repository, execution coordinator/store,
queue, deletion, loader, conversation coordinator, prompt/environment/provider/query
builders и stream normalizer передаются явно. Собственное mutable state ограничено
publisher/config references и deduplication ошибок (`WeakSet`). Actual execution
ownership находится в `AgentExecutionCoordinator`, не в транспортном обработчике.
Native `agent-service.provider.ts` передаёт settings и validator явно.

**Проверки.** `agent-active-shutdown.contract.test.ts`,
`agent-session-state.contract.test.ts`, `agent-execution-lease.contract.test.ts`,
`agent-execution-crash.contract.test.ts` в `tests/contract/`; unit coordinator,
queue/deletion/store tests дополняют эти сценарии.

**Решение.** Дальнейшее деление facade только ради числа методов не обосновано:
repository, run и queue state уже имеют самостоятельных владельцев. Nullable settings
сохраняет standalone compatibility, но native factory не оставляет его отсутствующим.
Не создавать второй registry или вторую очередь под отдельный endpoint.

### 4. AgentExecutor — 1028 строк

**Ответственность.** Выполнение одного feature run: planning/task loop,
provider stream, task markers, approval и сохранение summary. Это execution
application coordinator, а не чистая domain state machine.

**Состояние и границы.** Event bus, feature state, approval, settings,
ExecutionFilesystem и captured host environment заданы constructor. Per-run
options/callbacks несут execution identity; записи проходят через `stateFor`/`write`.
Provider execution и Direct preparation остаются конкретными infrastructure helpers.

**Проверки.** `tests/unit/services/agent-executor.test.ts`,
`agent-executor-summary.test.ts`, `agent-execution-lifecycle.test.ts` и
`tests/contract/execution-filesystem.contract.test.ts`.

**Решение.** Общий lifetime provider stream, отмены и финальной записи оправдывает
единый coordinator. Выделять task parsing/summary formatting разумно как чистые
функции; часть parsing уже выделена. Конкретный вызов Direct execution из coordinator
остаётся coupling application→provider adapter; выделение узкого execution port
обосновано, если требуется строгая независимость application от infrastructure.
Само отсутствие Nest decorator этого требования не закрывает.

### 5. DevServerService — 1620 строк

**Ответственность.** Local dev process: admission, port reservation, запуск,
лог/URL detection, replay, persisted state и подтверждённая остановка. Managed
Docker/SSH preview уже отдельный `ManagedDevServerService`.

**Состояние и границы.** `runningServers`, accepted/starting sets, allocated ports,
output timers, save queue и cleanup uncertainty принадлежат одному process owner.
Native runtime передаёт scoped files, path policy и data directory;
`OwnedLocalChild` отделяет Linux process-tree supervision. Shutdown закрывает
admission и ожидает accepted starts и owned cleanup.

**Проверки.** `tests/contract/native-local-process-ownership.contract.test.ts`,
`local-process-filesystem.contract.test.ts`; unit
`native-local-process-ownership.test.ts`, `dev-server-persistence.test.ts`,
`dev-server-event-types.test.ts` и `dev-server-service.test.ts`.

**Исправлено в wave20.** Native Dev/Test factories передают captured host environment;
child spawn и compatibility cleanup используют snapshot. Dev сохраняет assigned PORT,
Test — CI и color flags; backend transport variables исключены. Actual два приложения
проверены private PATH executable после ambient/input mutations и закрытия соседа:
[общий checkpoint](fsm-direct-policy-process-checkpoint.md),
`tests/contract/local-process-host-environment.contract.test.ts`.
Windows source wiring не заменяет OS acceptance.

**Решение по размеру.** Не разносить reservation и process lifetime. State-file codec
и output/URL parser можно выделить без создания новых process registries; это
структурное улучшение, не замена указанному env fix.

### 6. TerminalService — 1189 строк

**Ответственность.** PTY session API, shell/WSL selection, RC setup, output subscribers,
resize/write и session close. Все они связаны lifetime одного terminal session.

**Состояние и границы.** Session/lifecycle maps, pending creations, configuration
updates, callbacks, stopping/shutdown state. Native factory передаёт max sessions,
`TerminalHostPort`, RC-files adapter, scoped filesystem, directory/home policy.
`TerminalSessionLifecycle` владеет подтверждением завершения. Прямые constructor
fallbacks на ambient env и platform helpers сохранены для совместимости; native
host branch не следует приравнивать к этим fallback paths.

**Проверки.** `tests/contract/terminal-stop.contract.test.ts`,
`terminal-host-configuration.contract.test.ts`, unit
`terminal-session-lifecycle.test.ts`; фактический packaged PTY smoke — отдельный gate.

**Решение.** Сохранить один session owner. Shell discovery и RC writing уже за ports;
повторное выделение этих responsibilities не требуется. Импорт shared terminal limit
constants — runtime policy reuse, а не протекание Express/Nest request DTO.
Non-Linux process ownership остаётся отдельной OS acceptance границей.

### 7. PipelineOrchestrator — 923 строки

**Ответственность.** Исполнение/возобновление pipeline, step agents, tests и merge.
`PipelineService` и configuration repository отдельно владеют CRUD/transactions.

**Состояние и границы.** Run identity берётся из `ConcurrencyManager`;
`requireCurrent`/`writeStatus` защищают superseded execution. Зависимости — feature
state, executor, test runner, worktree resolver, settings, config store, scoped FS
и явные callbacks для продолжения feature execution. Собственной второй таблицы
активных runs у orchestrator нет. Host environment передаётся snapshot.

**Проверки.** `tests/unit/services/pipeline-orchestrator.test.ts`,
`pipeline-orchestrator-provider-id.test.ts`, `pipeline-orchestrator-status-provider.test.ts`,
`pipeline-orchestrator-prompts.test.ts`, `pipeline-summary-accumulation.test.ts`;
`tests/contract/pipeline-repository.contract.test.ts` проверяет другой, storage boundary.

**Решение.** Один coordinator для run/step completion оправдан. Конкретные
`performMerge`, Direct shell и FeatureWorkspace adapters внутри orchestration —
настоящая dependency-direction работа для строгого application port слоя. Test-line
parser можно сделать чистой функцией. Ни parser extraction, ни config-store tests
не доказывают drain всех pipeline execution branches.

### 8. FeatureStateManager — 777 строк

**Ответственность.** Durable feature status/plan/task/summary mutations,
reconciliation и error notifications. FeatureLoader владеет serialized файловыми
transactions; pipeline задаёт допустимые workflow status names.

**Состояние и границы.** References на loader/events/optional notifier и одна event
subscription. `commitStatus` выполняет durable write до публикации. Чистая таблица
переходов отдельно находится в `modules/orchestration/feature-run-state-machine.ts`.

**Проверки.** `tests/contract/native-feature-state.contract.test.ts`,
`tests/unit/services/feature-state-manager.test.ts`,
`tests/unit/modules/feature-run-state-machine.test.ts`.

**Проблема среза wave19; исправлена в wave20.** См.
[FSM notification ownership](fsm-notification-ownership-audit.md): actual native
repro подтвердил три notifications от одного error после двух facades и late
pre-storage lookup после close. Shared application FSM и accepted-job drain
устраняют эти два дефекта. Ниже сохраняется исходное наблюдение аудита.

Constructor подписывал asynchronous notification handler,
не сохраняя его promise; `destroy()` только отписывается. Нет самостоятельного
notification drain/admission boundary. Facade создаёт свой FeatureStateManager, но
его shutdown path не вызывает `destroy()`. Это источник возможных оставшихся
listeners и поздней notification работы; данный статический аудит не выдаёт это
за воспроизведённую потерю данных. Проверить повторные facades и held notification
на actual shutdown; затем дать subscriber явного owner/drain либо вынести
notification subscription в один application lifecycle collaborator.

### 9. AutoModeServiceFacade — 1488 строк

**Ответственность.** Per-project AutoMode API, выполнение/verify/commit/merge,
plan approval и recovery/status. Основные loops/execution/recovery уже отдельные
collaborators; это не прежний единый монолитный AutoModeService.

**Состояние и границы.** Собственные project identity/stopping и ссылки на
collaborators. Shared concurrency/loop/worktree services приходят через explicit
FacadeOptions. Native `ProjectRunContextRegistry` владеет canonical project contexts,
лимитами admission и accepted command promises, затем recovery drain.

**Проверки.** `tests/contract/auto-mode-native.contract.test.ts`,
`auto-mode-responses.contract.test.ts`, `tests/unit/services/auto-mode-facade.test.ts`,
`tests/unit/services/auto-mode/facade-agent-runner.test.ts` и native run-state tests.

**Решение и остаток.** Facade как project capability API допустим, но `create()`
одновременно является большим composition root: создаёт FSM, executor, approval,
test runner, pipeline и callbacks с поздним связыванием `facadeInstance`. Это
обоснованный кандидат на отдельную factory/composition class, без второго run owner.
Важнее закрыть жизненный цикл FSM subscription из пункта 8. Метод `analyzeProject()`
по-прежнему намеренно throws «use AutoModeService instead»; не считать его готовым
use case. **Исправление этого вывода в wave22:** прежняя фраза о готовом отдельном
HTTP analysis path была ошибкой аудита. AutoMode endpoint реально вызывал этот
stub; отдельный Ideation analysis его не заменял. Native workflow, сохранение
`project-analysis.md`, events и accepted-job ownership теперь восстановлены,
stub/forwarding удалены после переключения маршрута. См.
[реальные HTTP/SSH и no-start proofs](project-analysis-restoration-audit.md).

## Framework-free правила и shared DTO

Различаются три уровня:

1. `feature-run-state-machine.ts` — чистые states/transitions/mapping, без Nest,
   файлов, provider execution и transport requests. Это реальный domain kernel.
2. `@Injectable`/`@Inject` на native application adapters и repositories задают
   composition metadata. Они не означают наличие HTTP request object или Zod
   transport validation в business methods. Но такие классы **не являются**
   буквально framework-free; для строгого правила нужны factory providers вокруг
   plain classes или документированная граница `modules` как composition/application
   adapters. Одного переименования папки недостаточно.
3. `PipelineApplicationService` и `IdeationApplicationService` используют
   **type-only** `*Request` aliases из `*.schemas.ts`, где разделяются shared
   contracts. Это compile-time coupling wire shapes, не runtime зависимость на
   controller/Express. Его нельзя ни объявлять runtime service locator, ни считать
   полностью transport-independent port. Для сильного exit criterion определить
   use-case input types рядом с application port и map boundary DTO в controller;
   делать это там, где wire semantics действительно отличаются от use case.

У девяти рассмотренных service/facade файлов нет прямых Nest imports, но это не
доказывает транзитивную независимость: SettingsService импортирует конкретный
`SettingsFileRepository` с `@Injectable`; Ideation использует runtime `IdeationJobs`
из `modules`; execution coordinators вызывают конкретные provider adapters.
Аналогично barrel `core/errors/index.ts` экспортирует Nest filter/module вместе с
plain domain errors. Dependency rules должны различать runtime graph и type-only
edges, а чистый domain может импортировать узкий `domain-errors.ts` напрямую.

## Конкретный оставшийся объём

1. Native Dev/Test child environment закрыт отдельным actual-child proof в wave20;
   это не было засчитано за счёт LocalExecutionEnvironment или EventHooks.
2. FSM notification subscription lifetime закрыт в wave20; actual native
   duplicate/held-lookup/held-write/two-app и standalone close proofs описаны
   [отдельно](fsm-notification-ownership-audit.md). Не повторять это выделение
   как незавершённую работу над крупным facade.
3. Для строгого application→ports слоя определить узкие execution/merge/context
   ports в AgentExecutor/PipelineOrchestrator, вынести facade composition из API,
   затем закрепить runtime dependency rules. Уже разделённые agent storage/queue,
   settings transactions и pipeline configuration не делить повторно.
4. Чистый prompt catalog/context readers Ideation и test/output parsers — кандидаты
   после lifetime correctness. Не превращать их в обязательные отдельные runtime
   services без независимого state/lifecycle.

Это результаты аудита и приоритеты, а не автоматическое закрытие этапа 11. Общие
machine-readable errors, correlation, OS/artifact/upgrade/rollback gates оцениваются
отдельно; здесь они не объявляются выполненными за счёт архитектурных исключений.
