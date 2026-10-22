# Этап 11. Post-migration refactor

## Цель

После полного transport cutover уменьшить сложность крупных сервисов и закрепить
модульные границы. Этот этап не является условием запуска Nest, но является частью
полного backend refactor.

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
- [ ] Разбить большой UI HTTP client по domain modules.
- [ ] Добавить generated/verified OpenAPI artifact.
- [ ] Ввести deprecation policy и API versioning до intentional breaking changes.
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
