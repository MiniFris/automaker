# Этап 11. Post-migration refactor

## Цель

После полного transport cutover уменьшить сложность крупных сервисов и закрепить
модульные границы. Этот этап не является условием запуска Nest, но является частью
полного backend refactor.

## Текущий статус и границы оставшейся работы

Source checkpoint wave22 — `67948aa8`; wave23 добавил публичные AutoMode ports,
постоянный барьер неопределённого результата execution/pipeline, captured agent
output policy и разделение Ideation collaborators. Девятнадцать application/query/
command классов стали plain classes: 61 dependency собирается в module-local
factories, 101 вход описан независимыми interfaces. Полный совместный checkpoint
wave23 и завершающий коммит ещё не подменяются targeted результатами.

[Матрица завершения этапа](artifacts/stage-11-completion-matrix.md) сопоставляет
каждый ранее незакрытый пункт и Exit criterion с исходниками/contracts. Она также
фиксирует причины превышения рекомендованных размеров transport/use-case файлов.
Старый исторический срез ниже не описывает текущие legacy adapters: bridge,
service locators, composition и test-only route files уже удалены.

Ещё шесть semantic auth/credential/verification/GitHub use cases также перенесены
на plain classes/factories и явные parsing ports; они не переименованы в adapters
ради исключения. Всего 25 use-case owners, 82 прежние DI dependencies и четыре
обязательных validation ports. Services-wide runtime Nest/Express guard сохраняет
прежние route/controller restrictions. Конкретный остаток — финальный совместный
checkpoint/commit; operational/artifact gates остаются в
[этапе 10](10-cutover-and-hardening.md).

## Исторический срез: удаление legacy service composition

Последние четыре сервиса получили native owners: `AutoModeServiceCompat` создаётся
factory provider в AutoModeModule; `TerminalRuntimeModule` владеет TerminalService;
`LocalProcessRuntimeModule` — DevServerService и TestRunnerService. Тонкие runtime
modules экспортируют только сервисы, без global terminal controllers/guards.
AutoModeModule экспортирует только compatibility service, не handler registry.
Native consumers используют class tokens; импортов legacy tokens в modules больше нет.

`legacy/application-service.providers.ts`, `APPLICATION_SERVICE_TOKENS`,
`LEGACY_SERVICES`, `LegacyServiceOverrides` и возвращаемое `legacy.services`
удалены. Root bootstrap и AppModule не принимают `services` в TypeScript options.
Защитная проверка старых JavaScript callers отклоняет даже пустой, undefined,
inherited или accessor service container до создания ресурсов, не вычисляя getter
и не переключая mocks незаметно на production defaults. Та же проверка действует
при прямом вызове AppModule/LegacyModule registration. Явные data-only provider
registrations и Nest testing overrides остаются поддерживаемой test composition.

LegacyModule больше не создаёт services или aliases: он получает native instances
и передаёт узкие `LegacyLifecycleResources` в оставшийся startup/shutdown adapter.
Порядок migration/reconciliation и cleanup сохранён. Новый native contract вызывает
реальный `app.close()` и проверяет последовательность agent interruption → feature
interruption → AutoMode stop → terminal → test runner → dev server → provider close,
не затрагивая другое приложение. Ошибка interruption/persistence по-прежнему
не отменяет остальные cleanup attempts; повторный legacy shutdown не дублирует их.

Terminal factory теперь передаёт `RuntimeConfig.terminal.maxSessions` в constructor:
раньше explicit factory environment мог задавать один limit в config, а constructor
читать другой из ambient `process.env`. Contract запускает два native applications
с разными limits и проверяет их независимость. Остальная terminal environment/
platform discovery и OS-level PTY/process-group cleanup этим исправлением не закрыты.

Это удаление legacy DI composition, а не завершение этапа 11: remaining lifecycle
adapter/descriptor, AutoMode compatibility facade/cache, legacy route helpers и
module-level execution registries ещё подлежат переносу/удалению. В частности,
idle-runtime ordering test не доказывает drain активных PTY/process trees.
API v13, wire contracts, persisted formats и execution bindings не меняются.

Проверки среза:

- Целевые bootstrap/error-cleanup unit tests: 9 passed; native runtime/provider/
  Nest shell contracts: 42 passed. Повтор после добавления проверок конкретных
  модулей-владельцев также успешен.
- `npm run test:server:unit`: 3588 passed, 40 skipped.
- `npm run test:server:contract`: 312 passed.
- `npm run test:packages`: 1473 passed.
- Server/UI production build (Electron main/preload включены), server/UI lint,
  UI typecheck, lockfile, formatting/diff и три inventory checks: успешно.
- Production SIGTERM/SIGINT lifecycle smoke: exit 0.
- Docker acceptance с `automaker-nest-stage2-smoke:latest`: 11 passed,
  4 opt-in skipped; owned container/image/volume cleanup проверен.
- Выбранные реальные SSH CLI/SDK/Direct chat/restart cases: 3 passed,
  34 отфильтрованы.
- Chromium после Docker/SSH: 17 passed — chat/Running Agents/reload, feature
  add/edit, hooks/endpoint persistence, passive provider status и confirmed
  credentials/import. Во время chat reload Vite дважды записал WS proxy
  `ECONNRESET`; UI workflow и остальные cases прошли без retries. Причина reset
  отдельно не установлена; log не скрывался и timeout/retries не менялись.
  Это не доказательство всех WS/PTY shutdown gates или packaged Electron.
- SDK/CLI execution использует offline fixtures; paid/live vendor authentication
  и внешние MCP/Ntfy этим срезом не проверялись.

## Приоритетные кандидаты

- `IdeationService`;
- `SettingsService`;
- Auto Mode facade/coordinator;
- `AgentService` и `AgentExecutor`;
- `DevServerService`;
- `TerminalService`;
- крупные CLI/SDK providers;
- execution Docker/SSH adapters;
- pipeline orchestrator;
- feature state manager.

Размер файла сам по себе не является достаточным основанием для разделения. Разрез
выбирается по ответственности, lifecycle, данным и направлению зависимостей.

## 11.1. Application use cases

- [x] Заменить широкие facade APIs узкими use cases. Семь native consumers
      используют [публичные capability/query/lifecycle ports](artifacts/auto-mode-public-ports-audit.md), сохраняя одного владельца.
- [x] Commands и queries оформить отдельными классами там, где это уменьшает
      зависимости. Feature/Settings/Files разделены; 19 классов используют
      обычные constructors и explicit module factories, без CQRS framework.
- [x] Убрать transport DTO из domain/application layer. 25 plain use cases
      получают независимые Input/Result/Target values; четыре raw-input consumers
      используют обязательный plain validation port, а shared Zod schemas остаются
      в composition adapter. AutoMode HTTP400 shaping находится в controller,
      rate-limit failures — plain domain errors. См.
      [точный semantic boundary proof](artifacts/stage-11-completion-matrix.md#final-semantic-application-boundary).
- [x] Ввести явные transaction/lock boundaries для файловых mutations:
      [Feature transactions](artifacts/stage-5-feature-state-transactions-audit.md),
      [agent/recovery](artifacts/agent-storage-recovery-session-checkpoint.md),
      [Ideation concurrent HTTP](artifacts/ideation-collaborators-audit.md) и
      [execution intents](artifacts/feature-execution-uncertainty-audit.md).
- [x] Удалить optional dependencies, скрывающие неполную native composition.
      Explicit factories передают все 82 прежние DI dependencies и четыре
      обязательных validation ports этих 25 use cases;
      actual composition/alias contracts проверяют владельцев. Явные standalone
      defaults и optional credentials не считаются отсутствующим native owner.

## 11.2. Domain state machines

- [x] Feature lifecycle: explicit FeatureRun transitions, transaction guards и
      [native state contract](../../apps/server/tests/contract/native-feature-state.contract.test.ts).
- [x] Agent session lifecycle: execution/queue/deletion journals и
      [session state contract](../../apps/server/tests/contract/agent-session-state.contract.test.ts).
- [x] Pipeline run lifecycle: ordered/excluded/resumed steps, Local merge/conflict
      и [durable uncertainty/restart gate](artifacts/feature-execution-uncertainty-audit.md).
- [x] Terminal/test/dev-server lifecycle: explicit admission/closing/unknown guards,
      [confirmed PTY stop](artifacts/terminal-confirmed-stop-audit.md) и
      [owned Local process tests](artifacts/native-local-process-ownership-audit.md).
- [x] Execution environment preparation lifecycle: pinned binding, consent,
      preflight, abort и [captured preparation proof](../../apps/server/tests/contract/provider-preparation-host-environment.contract.test.ts).
- [x] Явные transition errors и recovery states. Unknown cleanup сохраняет owner
      и durable barrier; confirmed cancellation не превращается в unknown.
      Все state owners и negative proofs перечислены в матрице; единый FSM
      framework не требуется для независимых protocol/session owners.

## 11.3. Infrastructure adapters

- [x] SecurityService/AllowedPathGuard/SECURE_FILESYSTEM используют application
      policy; ambient lifecycle init удалён. Два приложения, canonical/symlink/
      relative paths, DATA_DIR и закрытие A при работающем B проверяют
      [native path contract](../../apps/server/tests/contract/native-path-policy.contract.test.ts),
      [FS lifecycle](artifacts/filesystem-lifecycle-audit.md) и
      [Direct policy checkpoint](artifacts/fsm-direct-policy-process-checkpoint.md).
      Native helpers получают captured policy/environment; standalone compatibility
      defaults остаются явно отделены от native composition.
- [x] Filesystem repositories: FeatureLoader, settings/agent/auth/notification
      stores и [Ideation repository](artifacts/ideation-collaborators-audit.md)
      имеют scoped IO, mutation lanes и ordered drain.
- [x] Git local/remote adapters: ProjectGitService/FeatureWorkspace ports;
      три native WorktreeResolver query paths используют один captured owner,
      bounded deadline/admission и confirmed drain, сохраняя SSH authority.
      [Actual two-app/status/held-child proof](artifacts/stage-11-completion-matrix.md#final-native-worktreeresolver-boundary);
      [actual Local custom pipeline merge](../../apps/server/tests/contract/native-custom-pipeline.contract.test.ts)
      и [отдельный remote acceptance checkpoint](artifacts/state-execution-contract-checkpoint.md).
- [x] Process/PTY supervisor: [owned process checkpoint](artifacts/owned-process-response-checkpoint.md)
      и confirmed-stop/unknown-cleanup contracts сохраняют identity и admission.
- [x] Docker/SSH transports: issued bindings, explicit runtime interfaces и
      [отдельные actual adapter acceptance](artifacts/state-execution-contract-checkpoint.md).
- [x] Provider SDK/CLI transports: scoped execution leases, native factories,
      [CLI discovery и controlled diagnostics](artifacts/native-cli-discovery-audit.md).
- [x] GitHub/MCP/notification transports: repository/runtime boundaries,
      [bounded MCP protocol fixtures](artifacts/mcp-bounded-transport-ownership-audit.md)
      и [notification confidentiality contract](../../apps/server/tests/contract/notification-transport-confidentiality.contract.test.ts).

Application services проверяются на explicit fake ports, adapters — отдельными
actual Local/private protocol/managed transport contracts. Эти доказательства
не объявляют paid vendor или external infrastructure acceptance.

## 11.4. Contracts и клиент

- [x] Shared schemas покрывают transport inputs/normalized contexts и ответы всех
      318 operations: 316 JSON и 2 binary. Исторические opaque business maps и
      default middleware/global errors сохраняют явно описанные ограничения.
      Это не закрывает отдельный пункт stable error codes.
- [x] Разбить большой UI HTTP client по domain modules. 29 namespaces вынесены
      в typed factories; root сохраняет auth/fetch/WS ownership и Electron/filesystem
      compatibility bridges. См. [domain audit](artifacts/shared-inputs-openapi-client-audit.md)
      и [setup extraction](artifacts/setup-client-extraction-audit.md).
- [x] Добавить generated/verified OpenAPI artifact. Проверяются все 318 native
      operations и ссылки на shared inputs; 0 incomplete inputs, 316 runtime
      JSON response schemas и 2 shared binary responses (0 unverified) явно отмечены (включая typed
      non-2xx envelopes в числе runtime schemas).
      Это не закрывает отдельный пункт полной coverage.
      См. [актуальный checkpoint](artifacts/transport-context-terminal-observability-checkpoint.md).
- [x] Ввести deprecation policy и API versioning до intentional breaking changes.
      [API policy](../backend-api-contracts.md) сохраняет текущую v13 и требует
      явного решения о версии/переходе до нарушения совместимости.
- [x] Добавить stable machine-readable error codes. Native global HTTP errors
      получают additive `errorCode`; существующие domain/infrastructure codes
      сохраняются. Исторические HTTP-200 business envelopes не унифицируются
      скрытым breaking change. См. [API policy](../backend-api-contracts.md).

## 11.5. Observability

- [x] Structured logs с request/job/session ids: [operation correlation](artifacts/feature-execution-correlation-audit.md). Исторические diagnostic logs не объявляются полностью нормализованными.
- [x] Metrics startup, active jobs, queue depth, provider errors и retained
      process/cleanup ownership: [workflow gauges](artifacts/transport-context-terminal-observability-checkpoint.md).
      Это loaded/owned-resource diagnostics, не OS-wide census.
- [x] Traces через HTTP → orchestration → provider/execution:
      [actual feature/verification/MCP contract](../../apps/server/tests/contract/feature-execution-correlation.contract.test.ts)
      проверяет correlation id и parent operation identity. External exporter не требуется.
- [x] Health не подменяет metrics и не выполняет destructive probes.
      Health/live/ready и protected passive metrics проверены раздельными contracts.
- [x] Alerting thresholds документированы отдельно от framework:
      [operational thresholds](../backend-observability.md#initial-operational-thresholds).

## 11.6. Масштабирование — только при необходимости

До horizontal scaling потребуется:

- shared/distributed session and job ownership;
- distributed locks для project mutations;
- durable event/job transport;
- sticky или shared WebSocket delivery;
- distributed cancellation;
- leader election для reconciliation/schedulers;
- отказ от process-local Maps как источника истины.

Не вводить Redis/queue только ради абстрактной «готовности к масштабу».

## 11.7. Quality targets

- Нет production services с несколькими несвязанными lifecycle responsibilities.
- Controllers обычно меньше 150 строк, application services — меньше 400 строк;
  исключения обоснованы архитектурой, а не механическим лимитом.
- Нет circular module dependencies. Явный Nest import graph автоматически проверяется:
  [audit](artifacts/nest-module-import-graph-audit.md); provider DI cycles требуют
  самостоятельной проверки.
- Нет framework imports в domain layer. Два текущих pure kernels и будущий
  `src/domain` защищены [enforced rules](artifacts/pure-kernel-boundary-audit.md);
  это не объявление всех application adapters framework-free.
- Mutation use cases имеют negative/recovery/concurrency tests.
- Adapter contract suites работают для Local/Docker/SSH/provider variants.
- Test setup не зависит от сети и внешних credentials по умолчанию.

## Exit criteria

- [x] Крупные сервисы разделены по согласованным bounded contexts. Ideation имеет
      отдельные repository/analysis/context/prompt/stream collaborators; остальные
      owners и размерные исключения зафиксированы в матрице.
- [x] Dependency rules автоматически проверяются: plain application/public ports,
      pure kernels, core/module/controller IO и conservative Nest module graph.
      Guards охватывают 25 plain use cases и service runtime imports; module
      metadata и настоящие HTTP/infrastructure adapters остаются в своих слоях.
- [x] Shared contracts покрывают публичный API: 318 operations, 316 JSON и две
      binary responses с documented opaque compatibility payloads.
- [x] Observability позволяет расследовать native HTTP, agent, feature и execution
      workflow по correlation id; actual contracts проверяют эту цепочку.
- [x] Новая архитектура описана в contributor documentation; обязательные guards
      и contracts проверяют соблюдение заявленных границ в следующих изменениях.
- [ ] Полный checkpoint этапа 11 успешно выполнен после глубокого рефакторинга и
      зафиксирован завершающим коммитом в единственной migration-ветке. Targeted
      counts не заменяют этот gate; его результат записывает основной агент.

## Остаток после wave23 source freeze

Три конкретные source-задачи wave22 закрыты: публичные AutoMode ports,
[captured debug policy](artifacts/agent-output-configuration-audit.md) и
[pipeline uncertainty с restart barrier](artifacts/feature-execution-uncertainty-audit.md).
Недостижимый generic test-step helper не возвращался для этих проверок.

Остаётся финальный совместный checkpoint/commit. Строгая semantic application
граница закрыта реальным переносом 25 use cases, independent inputs и parsing
ports. Это не новый security/vendor/OS audit и не требование механически дробить
каждый большой файл. [Матрица](artifacts/stage-11-completion-matrix.md)
содержит доказательства для каждого ранее незакрытого пункта и текущие ограничения.
