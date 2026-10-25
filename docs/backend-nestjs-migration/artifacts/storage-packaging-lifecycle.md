# Storage, packaging and lifecycle inventory

Зафиксировано: 2026-10-23.

## Storage boundaries

### Project-local

Источник истины: `{projectPath}/.automaker/`.

Основные данные:

- `features/{featureId}/feature.json`, output и images;
- `context/`;
- worktree metadata;
- GitHub validation results;
- ideation analysis/data;
- board/project images;
- `settings.json`;
- `app_spec.txt`;
- `active-branches.json`;
- `execution-state.json`;
- runtime-specific binding/memory data, добавленное execution environment modules.

Правила переноса:

- файловый формат не меняется только ради Nest;
- reads не выполняют скрытую migration/mutation;
- writes сохраняют atomic writer/backup/file-mode semantics;
- project path проходит allowed-root validation до I/O;
- remote authoritative path не передаётся local filesystem APIs;
- concurrent writes одного logical document сериализуются.

### Global `DATA_DIR`

Default: `./data` относительно server root.

Основные данные:

- global settings и profiles;
- credentials;
- session metadata и agent histories;
- event/notification state;
- provider caches;
- migrations из legacy Electron userData location.

Credentials не входят в normal DTO/log и сохраняют private permissions.

## Stateful resources and future owners

| Current resource                           | Current lifetime            | Target owner            |
| ------------------------------------------ | --------------------------- | ----------------------- |
| auth sessions / WS tokens / login attempts | module-level Maps + timer   | `AuthModule`            |
| `AgentService.sessions`                    | process                     | `AgentsModule`          |
| terminal sessions/callbacks                | singleton factory           | `TerminalModule`        |
| terminal connection/resize Maps            | `index.ts`                  | `TerminalGateway`       |
| legacy dev servers                         | singleton factory           | `ExecutionModule`       |
| managed dev sessions                       | per SettingsService WeakMap | `ExecutionModule`       |
| legacy test sessions                       | singleton factory           | `ExecutionModule`       |
| managed test sessions                      | per SettingsService WeakMap | `ExecutionModule`       |
| auto-loop project state                    | service Map                 | `OrchestrationModule`   |
| pending plan approvals                     | service Map                 | `PlanningModule`        |
| ideation active sessions                   | service Map                 | `IdeationModule`        |
| event subscribers                          | closure Set                 | `EventingModule`        |
| event hooks/timers                         | exported instance           | `EventingModule`        |
| pipeline service                           | exported instance           | `PipelineModule`        |
| notifications/history                      | singleton factories         | соответствующие modules |
| Docker/SSH locks/jobs                      | module-level Maps/Sets      | `ExecutionModule`       |
| provider registry/model caches             | module/global state         | `ProvidersModule`       |

Каждый target owner обязан реализовать init/stop/health и очищать timers,
subscriptions, processes, sockets и temporary state.

## Startup sequence

Текущая последовательность, которую нельзя случайно переставить:

1. load `.env`;
2. configure logging defaults;
3. initialize allowed paths;
4. create Express/middleware/event emitter/services;
5. initialize dev-server, notifications, tests и event hooks;
6. migrate legacy settings;
7. load global settings;
8. apply log/request logging settings;
9. initialize agent service;
10. reconcile stale feature states;
11. asynchronously resume interrupted features;
12. warm Codex model cache;
13. start stale validation cleanup timer;
14. mount routes/WS and listen.

На Nest этапе blocking/background policy фиксируется явно для каждого шага.

## Shutdown sequence

Текущая последовательность:

1. receive `SIGTERM`/`SIGINT`;
2. start 30-second force-exit deadline;
3. mark running features interrupted;
4. cleanup terminal service;
5. cleanup managed tests;
6. cleanup managed dev servers;
7. close HTTP server;
8. clear deadline and exit.

Целевой Nest lifecycle дополнительно прекращает новые jobs/upgrades, закрывает
providers/event subscriptions и сообщает о resources, не завершившихся до deadline.

## Packaging matrix

### Development

- `tsx watch src/index.ts` — текущий server entry;
- Electron dev напрямую указывает на `apps/server/src/index.ts`;
- Vite UI получает server URL через web config или Electron IPC.

### Standalone production

- `tsc` пишет `apps/server/dist`;
- `node dist/index.js` — текущий production entry;
- local workspaces собираются раньше server.

### Docker

- production Dockerfile/Compose запускают server и UI в заданной topology;
- `PORT` default 3008, UI default 3007;
- health endpoint `/api/health` используется readiness/startup consumers;
- SIGTERM обязан уложиться в container stop timeout.

### Electron

`apps/ui/scripts/prepare-server.mjs`:

1. собирает server;
2. копирует `dist`;
3. копирует семь local workspace packages;
4. создаёт minimal ESM `package.json`;
5. устанавливает production dependencies;
6. заменяет workspace symlinks реальными directories;
7. rebuild native dependencies, включая `node-pty`.

Packaged Electron ожидает `resources/server/index.js`, а development —
`apps/server/src/index.ts`. При переходе на `main.ts` оба пути и bundle `main`
меняются атомарно на этапе 2 и проверяются smoke test.

## Platform matrix

| Mode            |                 Linux |            macOS |          Windows |      WSL |
| --------------- | --------------------: | ---------------: | ---------------: | -------: |
| Standalone web  |              required |         required |         required | required |
| Electron        |              required |         required |         required | required |
| Local execution |              required |         required |         required | required |
| Managed Docker  |              required |   Docker Desktop |   Docker Desktop | required |
| SSH target      | Linux target required | controller smoke | controller smoke | required |
| Native PTY      |              required |         required |         required | required |

Environment-dependent suites запускаются на подходящих runners после каждого
этапа, который меняет соответствующий adapter или packaging path.
