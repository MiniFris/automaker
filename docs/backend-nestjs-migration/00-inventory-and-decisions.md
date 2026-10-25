# Этап 0. Инвентаризация и архитектурные решения

Статус: завершён 2026-10-23. Проверяемые результаты находятся в
[`artifacts/`](artifacts/current-architecture.md).

## Сверка текущего прогресса — 2026-10-25

Инвентаризация завершена. Текущий native inventory содержит 318 operations;
`src/routes` удалён, генератор читает только controllers. Исходные числа ниже —
baseline до миграции, а не оставшийся объём. См.
[retirement checkpoint](artifacts/legacy-retirement-logging-checkpoint.md).
Актуальность route/dependency/API-consumer artifacts проверяется генераторами;
полнота всех architectural restrictions остаётся задачей этапа 11.

## Цель

Получить проверяемую карту backend до начала структурных изменений. Результатом
этапа должны стать не общие диаграммы, а данные, по которым можно определить
владельца каждого route, stateful resource и внешнего процесса.

## Scope

- HTTP routes и middleware order;
- WebSocket upgrade paths и форматы сообщений;
- service/provider dependency graph;
- файловое хранение и миграции форматов;
- дочерние процессы, timers, sockets и in-memory registries;
- Electron, Docker и standalone server packaging;
- тестовые наборы и внешние prerequisites;
- ADR по целевой Nest-архитектуре.

## Организация работ

- [x] Создать единственную ветку `refactor/backend-nestjs-migration` от актуальной
      основной ветки.
- [x] Все последующие этапы и коммиты выполнять только в этой ветке.
- [x] Не требовать отдельные PR для этапов, route groups или завершения миграции;
      не создавать дополнительные ветки.
- [x] Зафиксировать обязательное тестирование после каждого этапа 0–11 по шаблону
      stage checkpoint из основного плана, с записью команд и результатов.
- [x] Следующий этап начинать только после успешного checkpoint и фиксирующего
      коммита предыдущего этапа.

Это общий порядок для всех этапов 0–11, а не только для подготовки:
изменения → тестирование после этапа → запись результатов → завершающий коммит
в `refactor/backend-nestjs-migration`. Отдельный PR для сдачи этапа не требуется.
Полный состав проверок определён в [основном плане](README.md#git-workflow-и-тестовые-checkpoints).

## Работы

### 0.1. Каталог HTTP API

- [x] Автоматически собрать method, full path, source file и route group для всех
      `router.get/post/put/patch/delete`.
- [x] Для каждого route указать access, handler/middleware expression, path validation
      и source location; точные request/response schemas фиксируются contract tests этапа 1.
- [x] Отметить streaming/download candidates и handlers, работающие напрямую с `res`.
- [x] Отметить non-GET routes как potential mutations; необратимые effects дополнительно
      перечислены в execution/Git/provider migration scopes.
- [x] Сопоставить routes с 290 обнаруженными UI/Electron HTTP references.
- [x] Сформировать список endpoints без обнаруженного UI consumer; не считать его
      доказательством неиспользования до проверки tests/external clients.
- [x] Сохранить каталог в machine-readable JSON и человекочитаемой ownership table.

Артефакт: `artifacts/http-routes.json` с `npm run inventory:server:check`, который
обнаруживает неучтённое добавление или удаление endpoint.

### 0.2. Каталог WebSocket

- [x] Описать upgrade authentication для `/api/events`.
- [x] Описать upgrade authentication и session token для `/api/terminal/ws`.
- [x] Зафиксировать client/server message schemas, heartbeat, reconnect и cleanup.
- [x] Зафиксировать canonical `EventType` source и отсутствие типизации payload
      (`unknown`) как обязательный долг этапа 3.
- [x] Отметить text JSON frames, backpressure и максимальные размеры сообщений.
- [x] Зафиксировать порядок событий при reconnect, cancel, exit и backend restart.

### 0.3. Dependency graph

- [x] Построить граф imports для `routes`, `services`, `providers`, `lib`.
- [x] Отдельно отметить cross-layer imports, включая service/provider → route.
- [x] Найти cycles и связки, опирающиеся на import side effects.
- [x] Найти ручные `new Service()`, static state, module-level instances,
      `WeakMap` service caches и `get*Service()`.
- [x] Для каждого класса stateful resources определить target owner и lifecycle.

Особое внимание:

- `SettingsService` как наиболее широко используемой зависимости;
- provider registry и прямому созданию `SettingsService` внутри providers;
- terminal/dev-server/test-runner singleton factories;
- auto-mode facade cache;
- event hooks, notifications, history и pipeline singleton instances.

### 0.4. Карта процессов и ресурсов

- [x] Найти все source files с child process APIs и назначить target module owner.
- [x] Зафиксировать cancel semantics и unknown-outcome invariants.
- [x] Зафиксировать timers/heartbeats и требование lifecycle cleanup.
- [x] Описать startup reconciliation и resume interrupted features.
- [x] Описать graceful shutdown sequence и 30-second force-exit policy.
- [x] Найти ресурсы, которые переживают закрытие HTTP request.

### 0.5. Хранилище

- [x] Описать global `DATA_DIR` и классы данных в нём.
- [x] Описать project `.automaker/`, atomic writes, locks и backup behavior.
- [x] Зафиксировать legacy migrations settings и feature formats.
- [x] Определить операции, требующие сериализации по project/path.
- [x] Зафиксировать отсутствие полных legacy storage fixtures и перенести их создание
      в обязательные работы этапа 1.

### 0.6. Packaging matrix

- [x] Standalone dev (`tsx watch`).
- [x] Standalone production (`tsc` + `node dist`).
- [x] Web + server.
- [x] Docker Compose и production Dockerfile.
- [x] Electron server bundle, workspace package copy и native `node-pty` rebuild.
- [x] Linux/macOS/Windows expectations и WSL-specific paths.

## ADR, которые надо принять

### ADR-001: Express adapter

Выбрать `@nestjs/platform-express`. Fastify не даёт достаточной выгоды, чтобы
одновременно менять transport semantics, raw response handling и middleware.

### ADR-002: Modular monolith

Сохранить один процесс и один deployment unit. Текущее in-memory состояние делает
горизонтальное масштабирование отдельным проектом, требующим распределённых locks,
shared session storage и event transport.

### ADR-003: Schema-first contracts

Использовать Zod/Standard Schema для новых request/response contracts. Схемы,
которые нужны UI, размещать в новом `@automaker/contracts`, а не импортировать
server domain classes в frontend.

### ADR-004: Compatibility-first errors

До отдельной версии API Nest exceptions отображаются в существующие status codes
и `{ success: false, error }`. Stable error codes можно добавлять только как
необязательное поле.

### ADR-005: WebSocket transport

Сначала сохранить raw `ws` protocol и подключить его к Nest lifecycle. Решение о
стандартном `WsAdapter` или custom adapter принимается после contract tests.

### ADR-006: Storage

Файловое хранение остаётся источником истины. Repository interfaces вводятся для
границ и тестируемости, а не как скрытая подготовка к БД.

## Выходные артефакты

- [x] `http-routes.json` и route ownership table.
- [x] WS protocol specification.
- [x] Dependency graph и список cycles.
- [x] Resource/lifecycle inventory.
- [x] Storage compatibility matrix.
- [x] Packaging matrix.
- [x] Принятые ADR-001 — ADR-008.
- [x] Backlog migration units с owner и rough estimate.

## Exit criteria

- Для каждого endpoint и background resource известен будущий Nest module.
- Нет route или WS message, не включённого в compatibility plan.
- Согласованы non-goals и запрещено параллельное изменение API.
- Риски и rollback рассмотрены до добавления Nest dependencies.
- Выполнен checkpoint этапа 0: проверены generated inventories, ссылки,
  форматирование документации и состав code changes;
  результат зафиксирован завершающим коммитом в единственной migration-ветке.

## Checkpoint этапа 0

Выполнен 2026-10-23 в ветке `refactor/backend-nestjs-migration`:

- `npm run inventory:server:check` — 305 HTTP endpoints, успешно;
- `npm run inventory:server-deps:check` — 452 TypeScript-файла и 1370 внутренних
  import edges, успешно;
- `npm run inventory:api-consumers:check` — 290 UI/Electron references, успешно;
- `npm run typecheck`, `npm run build:packages`, `npm run build:server` — успешно;
- `npm run test:packages` — 73 файла, 1167 тестов, успешно;
- `npm run lint:lockfile`, Prettier и `git diff --check` — успешно.

Для восстановления зелёного baseline исправлены два уже существовавших type errors
в `BoardView`: обязательное строковое поле `branchName` больше не получает
`undefined`.

Исходный `test:server` нельзя использовать как быстрый checkpoint: его каталог
`tests/unit` запускает реальные SSH/SFTP, remote CLI и process-heavy scenarios и не
укладывается в защитный таймаут 120 секунд. Это не замалчивается как успешный тест:
разделение deterministic unit, component/contract и opt-in integration suites —
первый обязательный результат этапа 1.
