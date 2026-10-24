# Этап 11. Post-migration refactor

## Цель

После полного transport cutover уменьшить сложность крупных сервисов и закрепить
модульные границы. Этот этап не является условием запуска Nest, но является частью
полного backend refactor.

## Срез: удаление legacy service composition

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

- [ ] Заменить широкие facade APIs узкими use cases.
- [ ] Commands и queries оформить отдельными классами только там, где это уменьшает
      зависимости; полноценный CQRS framework не обязателен.
- [ ] Убрать transport DTO из domain/application layer.
- [ ] Ввести явные transaction/lock boundaries для файловых mutations.
- [ ] Удалить optional dependencies, скрывающие неполную композицию.

## 11.2. Domain state machines

- [ ] Feature lifecycle.
- [ ] Agent session lifecycle.
- [ ] Pipeline run lifecycle.
- [ ] Terminal/test/dev-server session lifecycle.
- [ ] Execution environment preparation lifecycle.
- [ ] Явные transition errors и recovery states.

## 11.3. Infrastructure adapters

- [ ] Перевести SecurityService/AllowedPathGuard и secure-fs с legacy platform
      path globals на единый application-owned config/policy; удалить ambient
      initAllowedPaths из lifecycle. Проверить два одновременных приложения с разными
      allowed/data roots, symlink/relative paths и снятие ограничений без stale state.
      Native GitHub repository boundary не заменяет этот общий exit criterion этапа 3.
      Native guard/policy, SECURE_FILESYSTEM и Files adapter уже переведены в ADR-041;
      остаются legacy init, SDK helpers, settings/atomic writer, download/prompt
      adapters, bounded FS queue shutdown/admission и filesystem coordination.
      Последующие срезы реализовали bounded FS queue, удаление ambient init и
      native SDK validators, scoped settings/atomic writer normal path:
      [filesystem audit](artifacts/filesystem-lifecycle-audit.md),
      [lifecycle cutover](artifacts/native-lifecycle-cutover-audit.md),
      [settings audit](artifacts/settings-filesystem-audit.md).
      Download/prompt и legacy Electron import затем получили scoped ports;
      agent stores/recovery — ordered drain и atomic state transactions.
      См. [agent/recovery checkpoint](artifacts/agent-storage-recovery-session-checkpoint.md).
      Остальные unscoped consumers (notification/history, auth storage, provider
      cache, validation storage) и coordination ещё требуют переноса;
      общий checkbox пока не закрывается.
- [ ] Filesystem repositories.
- [ ] Git local/remote adapters.
- [ ] Process/PTY supervisor.
- [ ] Docker/SSH transports.
- [ ] Provider SDK/CLI transports.
- [ ] GitHub/MCP/notification transports.

Application services тестируются на in-memory/fake ports; adapter contract tests
проверяют, что fake и real implementations соблюдают одну семантику.

## 11.4. Contracts и клиент

- [ ] Завершить shared schema coverage всех endpoints.
- [x] Разбить большой UI HTTP client по domain modules. 29 namespaces вынесены
      в typed factories; root сохраняет auth/fetch/WS ownership и Electron/filesystem
      compatibility bridges. См. [domain audit](artifacts/shared-inputs-openapi-client-audit.md)
      и [setup extraction](artifacts/setup-client-extraction-audit.md).
- [x] Добавить generated/verified OpenAPI artifact. Проверяются все 318 native
      operations и ссылки на shared inputs; 22 incomplete inputs, 18 runtime
      success response schemas и 300 unverified responses явно отмечены.
      Это не закрывает отдельный пункт полной coverage.
      См. [актуальный checkpoint](artifacts/agent-storage-recovery-session-checkpoint.md).
- [x] Ввести deprecation policy и API versioning до intentional breaking changes.
      [API policy](../backend-api-contracts.md) сохраняет текущую v13 и требует
      явного решения о версии/переходе до нарушения совместимости.
- [ ] Добавить stable machine-readable error codes.

## 11.5. Observability

- [ ] Structured logs с request/job/session ids.
- [ ] Metrics startup, active jobs, queue depth, provider errors, process leaks.
- [ ] Traces через HTTP -> orchestration -> provider/execution boundaries.
- [ ] Health не подменяет metrics и не выполняет destructive probes.
- [ ] Alerting thresholds документированы отдельно от framework.

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
- Нет circular module dependencies.
- Нет framework imports в domain layer.
- Mutation use cases имеют negative/recovery/concurrency tests.
- Adapter contract suites работают для Local/Docker/SSH/provider variants.
- Test setup не зависит от сети и внешних credentials по умолчанию.

## Exit criteria

- Крупные сервисы разделены по согласованным bounded contexts.
- Dependency rules автоматически проверяются.
- Shared contracts покрывают публичный API.
- Observability позволяет расследовать HTTP, agent и execution workflow по одному id.
- Новая архитектура описана в contributor documentation и соблюдается во всех
  последующих коммитах.
- Полный checkpoint этапа 11 успешно выполнен после глубокого рефакторинга и
  зафиксирован завершающим коммитом в единственной migration-ветке.
