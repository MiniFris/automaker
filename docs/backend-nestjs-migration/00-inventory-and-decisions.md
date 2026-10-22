# Этап 0. Инвентаризация и архитектурные решения

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

- [ ] Создать единственную ветку `refactor/backend-nestjs-migration` от актуальной
      основной ветки.
- [ ] Все последующие этапы и коммиты выполнять только в этой ветке.
- [ ] Не создавать обязательные PR или отдельные ветки для этапов и route groups.
- [ ] Зафиксировать шаблон stage checkpoint из основного плана.
- [ ] Следующий этап начинать только после успешного checkpoint и фиксирующего
      коммита предыдущего этапа.

## Работы

### 0.1. Каталог HTTP API

- [ ] Автоматически собрать method, full path, source file и route group для всех
      `router.get/post/put/patch/delete`.
- [ ] Для каждого route указать public/protected, content type, path validation,
      request source (`body`, `query`, `params`) и response envelope.
- [ ] Отметить streaming/download routes и handlers, работающие напрямую с `res`.
- [ ] Отметить mutation routes и необратимые внешние effects.
- [ ] Сопоставить routes с методами `apps/ui/src/lib/http-api-client.ts` и Electron API.
- [ ] Найти API, которое вызывается только тестами или уже не используется.
- [ ] Сохранить каталог в machine-readable JSON и человекочитаемой таблице.

Рекомендуемый артефакт: `apps/server/contracts/http-routes.json` с CI-проверкой,
которая обнаруживает неучтённое добавление или удаление endpoint.

### 0.2. Каталог WebSocket

- [ ] Описать upgrade authentication для `/api/events`.
- [ ] Описать upgrade authentication и session token для `/api/terminal/ws`.
- [ ] Зафиксировать client/server message schemas, heartbeat, reconnect и cleanup.
- [ ] Перечислить event types и payload shapes из `@automaker/types`.
- [ ] Отметить binary/text frames, backpressure и максимальные размеры сообщений.
- [ ] Зафиксировать порядок событий при reconnect, cancel, exit и backend restart.

### 0.3. Dependency graph

- [ ] Построить граф imports для `routes`, `services`, `providers`, `lib`.
- [ ] Отдельно отметить imports из service/provider в route layer.
- [ ] Найти циклы и связки, опирающиеся на barrel side effects.
- [ ] Найти ручные `new Service()`, static state, module-level instances,
      `WeakMap` service caches и `get*Service()`.
- [ ] Для каждого stateful service определить owner и ожидаемый lifecycle.

Особое внимание:

- `SettingsService` как наиболее широко используемой зависимости;
- provider registry и прямому созданию `SettingsService` внутри providers;
- terminal/dev-server/test-runner singleton factories;
- auto-mode facade cache;
- event hooks, notifications, history и pipeline singleton instances.

### 0.4. Карта процессов и ресурсов

- [ ] Для каждого `spawn`, `exec`, PTY, Docker exec и SSH channel указать owner.
- [ ] Зафиксировать cancel semantics и unknown-outcome behavior.
- [ ] Зафиксировать timers/heartbeats и место их очистки.
- [ ] Описать startup reconciliation и resume interrupted features.
- [ ] Описать graceful shutdown sequence и 30-second force-exit policy.
- [ ] Найти ресурсы, которые могут пережить закрытие HTTP request.

### 0.5. Хранилище

- [ ] Описать global `DATA_DIR` и все файлы в нём.
- [ ] Описать project `.automaker/`, atomic writes, locks и backup behavior.
- [ ] Зафиксировать legacy migrations settings и feature formats.
- [ ] Определить, какие операции требуют сериализации по project/path.
- [ ] Создать fixtures старых поддерживаемых версий данных.

### 0.6. Packaging matrix

- [ ] Standalone dev (`tsx watch`).
- [ ] Standalone production (`tsc` + `node dist`).
- [ ] Web + server.
- [ ] Docker Compose и production Dockerfile.
- [ ] Electron server bundle, workspace package copy и native `node-pty` rebuild.
- [ ] Linux/macOS/Windows expectations и WSL-specific paths.

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

- [ ] `http-routes.json` и route ownership table.
- [ ] WS protocol specification.
- [ ] Dependency graph и список cycles.
- [ ] Resource/lifecycle inventory.
- [ ] Storage compatibility matrix.
- [ ] Packaging matrix.
- [ ] Принятые ADR-001 — ADR-006.
- [ ] Backlog migration units с owner и rough estimate.

## Exit criteria

- Для каждого endpoint и background resource известен будущий Nest module.
- Нет route или WS message, не включённого в compatibility plan.
- Согласованы non-goals и запрещено параллельное изменение API.
- Риски и rollback рассмотрены до добавления Nest dependencies.
- Выполнен checkpoint этапа 0: проверены generated inventories, ссылки,
  форматирование документации и отсутствие незапланированных code changes;
  результат зафиксирован завершающим коммитом в единственной migration-ветке.
