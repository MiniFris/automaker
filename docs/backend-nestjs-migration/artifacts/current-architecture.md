# Current backend architecture inventory

Зафиксировано: 2026-10-23. Источник истины — текущая ветка
`refactor/backend-nestjs-migration`.

## Автоматически проверяемые артефакты

- [`http-routes.json`](http-routes.json) — 305 фактических HTTP endpoints,
  включая routes, созданные циклами, и protected `/api/health/detailed`.
- [`server-dependencies.json`](server-dependencies.json) — 454 server source files,
  1 372 внутренних import edges, process/runtime signals и dependency cycles.
- [`api-consumers.json`](api-consumers.json) — 290 статически обнаруженных UI
  references; все references сопоставлены с server inventory, 274 endpoints имеют
  обнаруженного UI consumer.

Перегенерация и проверка:

```bash
npm run inventory:server
npm run inventory:server:check
npm run inventory:server-deps
npm run inventory:server-deps:check
npm run inventory:api-consumers
npm run inventory:api-consumers:check
```

`--check` не меняет файлы и завершается с ошибкой, если артефакт устарел.

## Composition root

После этапа 1 `apps/server/src/index.ts` — тонкий executable wrapper, а
`apps/server/src/legacy-application.ts` пока владеет:

- загрузкой environment variables;
- CORS, cookies, request logging и JSON body parser;
- path/security initialization;
- созданием service graph через `new` и singleton factories;
- startup migrations/reconciliation/resume;
- регистрацией 31 HTTP route groups;
- HTTP server и двумя raw WebSocket servers;
- terminal connection state;
- process error handlers;
- graceful shutdown.

Фабрика legacy application уже отделяет import от `listen()` и production startup
tasks. Это главная точка bridge этапов 2–3; она не удаляется до тех пор, пока
contract tests не подтвердят эквивалентность Nest bootstrap.

## Route ownership

| Legacy group     | Endpoints | Target Nest module                |
| ---------------- | --------: | --------------------------------- |
| `health`         |         3 | `HealthModule`                    |
| `auth`           |         4 | `AuthModule`                      |
| `setup`          |        42 | `ProvidersModule` / `SetupModule` |
| `fs`             |        18 | `FilesModule`                     |
| `agent`          |        10 | `AgentsModule`                    |
| `sessions`       |         6 | `SessionsModule`                  |
| `features`       |        17 | `FeaturesModule`                  |
| `auto-mode`      |        16 | `OrchestrationModule`             |
| `enhance-prompt` |         1 | `AgentsModule`                    |
| `worktree`       |        59 | `WorktreeModule`                  |
| `git`            |         6 | `GitModule`                       |
| `models`         |         2 | `ProvidersModule`                 |
| `app-spec`       |         6 | `SpecificationModule`             |
| `running-agents` |         1 | `AgentsModule`                    |
| `workspace`      |         2 | `WorkspaceModule`                 |
| `templates`      |         1 | `TemplatesModule`                 |
| `terminal`       |        10 | `TerminalModule`                  |
| `settings`       |        39 | `SettingsModule`                  |
| `claude`         |         1 | `ProvidersModule`                 |
| `codex`          |         2 | `ProvidersModule`                 |
| `zai`            |         4 | `ProvidersModule`                 |
| `gemini`         |         2 | `ProvidersModule`                 |
| `github`         |        12 | `GitHubIntegrationModule`         |
| `context`        |         2 | `ContextModule`                   |
| `backlog-plan`   |         5 | `PlanningModule`                  |
| `mcp`            |         2 | `McpModule`                       |
| `pipeline`       |         6 | `PipelineModule`                  |
| `ideation`       |        16 | `IdeationModule`                  |
| `notifications`  |         4 | `NotificationsModule`             |
| `event-history`  |         5 | `EventingModule`                  |
| `projects`       |         1 | `ProjectsModule`                  |

Количество endpoint проверяется из JSON, а не поддерживается вручную. Таблица
фиксирует target ownership и меняется только архитектурным решением.

## Middleware order

Фактический порядок, который необходимо сохранить в legacy bridge:

1. request logger;
2. preview API guard на `/api`;
3. CORS;
4. JSON parser с limit 50 MB;
5. cookie parser;
6. JSON content-type check для mutations;
7. public `health`, `auth`, `setup` routers;
8. global authentication;
9. protected detailed health и остальные routers;
10. HTTP server upgrade routing.

## Dependency facts

Автоматический inventory обнаружил:

- 65 files с `process.env`;
- 41 files с `process.cwd()`;
- 5 files с `process.on()`;
- 58 files с imports child process APIs;
- 47 files с timers;
- 10 singleton getter factories;
- 3 exported service instances;
- 2 strongly connected components.

Циклы:

1. `index.ts` → settings routes → update-global → `index.ts` из-за runtime setter
   request logging.
2. Settings/execution bindings/Docker/SSH/provider execution — крупный
   инфраструктурный цикл, который разрывается typed config и execution ports.

## Migration ownership rules

- В каждый момент endpoint имеет ровно одного владельца: legacy или Nest.
- `http-routes.json.owner` меняется только в том коммите, который переключает route.
- Route удаляется из legacy registration в том же этапе.
- Services не импортируют controllers/routes.
- Domain/application code не импортирует Nest или Express.
- Stateful service получает ровно один lifecycle owner.

## Известные ограничения inventory

- `potentialMutation` основан на HTTP method и требует подтверждения contract test;
  legacy API использует POST и для некоторых reads.
- Middleware хранится как исходный expression summary, а не как исполняемая модель.
- Request/response schemas добавляются поэтапно в `@automaker/contracts` на этапе 1+.
- Отсутствие detected UI consumer не доказывает, что endpoint не используется:
  остаются Electron, tests и внешние API consumers.
- Middleware dispatchers для remote execution не создают дополнительные URLs и
  поэтому отражены через route, который они перехватывают, а не отдельной записью.
