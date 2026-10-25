# Этап 2. Nest shell и legacy bridge

Статус: завершён 2026-10-23. Production composition root переведён на NestJS;
legacy HTTP/WS API работает через один общий native HTTP server.

## Сверка текущего прогресса — 2026-10-25

Этап создания Nest composition root завершён; временный legacy bridge уже
удалён последующим cutover вместе с `LegacyModule`, service container и всеми
route factories. Пункты 2.2/2.3 описывают выполненный промежуточный переход,
а не зависимости, которые нужно восстановить. См.
[cutover](artifacts/native-cutover-checkpoint.md) и
[окончательное route retirement](artifacts/legacy-retirement-logging-checkpoint.md).
Свежий packaging после последних production изменений остаётся gate этапа 10.

## Цель

Сделать NestJS production composition root, не меняя владельца бизнес-routes.
После этапа server process стартует и останавливается через Nest, но legacy routers
продолжают обслуживать текущий API.

## Зависимости и версии

- [x] Поднять `.nvmrc` и root `engines.node` минимум до `22.22.3` в линии Node 22.
- [x] Добавить согласованные версии `@nestjs/common`, `@nestjs/core`,
      `@nestjs/platform-express`, `@nestjs/testing`, `reflect-metadata`, `rxjs`.
- [x] Не использовать global Nest CLI как build dependency.
- [x] Зафиксировать все `@nestjs/*` packages на одном major.
- [x] Сохранить `type: module`, `module: NodeNext`, `.js` extensions в imports.
- [x] Включить `experimentalDecorators` и `emitDecoratorMetadata` либо принять
      явный constructor injection strategy, совместимый с Nest 12.

## Новый bootstrap

Создать:

```text
apps/server/src/main.ts
apps/server/src/app.module.ts
apps/server/src/legacy/legacy.module.ts
apps/server/src/legacy/legacy-router.middleware.ts
```

### 2.1. `main.ts`

- [x] Создаёт `NestFactory.create<NestExpressApplication>(AppModule)`.
- [x] Устанавливает global prefix `/api` только для Nest controllers.
- [x] Воспроизводит текущий CORS callback и credentials behavior.
- [x] Сохраняет JSON body limit `50mb`.
- [x] Подключает cookie parser.
- [x] Настраивает logger adapter.
- [x] Вызывает `enableShutdownHooks()`.
- [x] Слушает прежние `HOST`/`PORT` и сохраняет EADDRINUSE diagnostics.
- [x] Не содержит создание domain services через `new`.

### 2.2. Legacy bridge

- [x] Собрать оставшиеся Express route groups в один `Router`, а не второй server.
- [x] Подключить router как Nest middleware на прежних путях.
- [x] Сохранить порядок preview guard, content-type check, public routes и auth.
- [x] Legacy router вызывает `next()` для routes, уже принадлежащих Nest.
- [x] Один route group никогда не регистрируется одновременно в legacy и Nest.
- [x] Registry владельцев routes проверяется тестом.

Рекомендуется явный список legacy groups, а не wildcard discovery:

```ts
const legacyGroups = {
  features: createFeaturesRoutes(...),
  worktree: createWorktreeRoutes(...),
  // удаляется по мере миграции
};
```

### 2.3. Временная DI-обвязка

- [x] Зарегистрировать существующие service instances через `useFactory`/`useValue`.
- [x] Ввести injection tokens для event emitter, data directory и runtime paths.
- [x] Не добавлять decorators сразу во все legacy services.
- [x] Для каждого wrapper provider описать будущий owner module.
- [x] Запретить создание второй копии stateful service.

### 2.4. Startup tasks

Временно завернуть, а не переписывать:

- settings migration;
- loading global settings;
- runtime log-level update;
- AgentService initialization;
- feature state reconciliation;
- resume interrupted features;
- Codex model cache warm-up;
- stale validation cleanup.

Каждая задача получает имя, blocking/background policy, timeout и обработку ошибки.
Background task не должна стартовать до готовности обязательных dependencies.

### 2.5. Build и packaging

- [x] Обновить server scripts `dev`, `build`, `start`.
- [x] Проверить `dist/main.js` и sourcemaps.
- [x] Обновить Electron `prepare-server.mjs` и bundle `main` field.
- [x] Убедиться, что Nest dependencies попадают в production bundle.
- [x] Проверить native `node-pty` rebuild.
- [x] Проверить Dockerfile, entrypoint и Compose healthcheck.
- [x] Проверить отсутствие зависимости production server от Nest CLI.

## Тесты

- [x] Bootstrap test без listen.
- [x] Полный legacy HTTP contract suite через Nest shell.
- [x] Middleware order tests для public/protected routes.
- [x] CORS, cookies, 50 MB body limit и content-type tests.
- [x] Startup failure и partial initialization tests.
- [x] SIGINT/SIGTERM smoke.
- [x] Web, Docker и Electron packaged server smoke.
- [x] Сравнение performance baseline с допустимым порогом регрессии.

## Deployment

Первый Nest artifact не содержит перенесённых controllers. Его можно раскатить
отдельно, проверить health/UI/agent/terminal workflows и откатить обычной заменой
artifact. Не вводить per-request dual execution.

## Exit criteria

- Production server стартует из `main.ts` через Nest.
- Все старые contract tests проходят без изменения expected responses.
- Существует ровно один instance каждого stateful legacy service.
- WebSocket upgrades продолжают работать на том же HTTP server.
- Electron и Docker artifacts содержат новый bootstrap.
- Performance и shutdown не ухудшились за согласованные пределы.
- Полный checkpoint этапа 2, включая Web, Docker и Electron smoke, успешно выполнен
  до начала переноса core platform.

## Результат checkpoint

- `NestFactory` создаёт приложение без `listen`; production entrypoint —
  `dist/main.js`, а `dist/index.js` оставлен только как временная совместимость.
- Все 31 legacy route group имеют явного владельца, подключены одним middleware и
  проверены полным inventory защищённых endpoints.
- 18 существующих service instances и event emitter зарегистрированы в Nest DI как
  `useValue`; второй stateful graph не создаётся.
- HTTP и оба raw WebSocket endpoint используют один и тот же `http.Server`.
- Проверены CORS credentials, cookie login, лимит JSON `50mb`, content-type guard,
  public/protected порядок и cleanup после частичной ошибки startup.
- Успешны server build/lint, 218 contract tests, 2769 unit tests (40 skipped),
  1171 package/UI tests, 8 integration tests и UI typecheck/build. Provider browser
  E2E остался opt-in и в текущем окружении корректно пропущен.
- Electron server bundle собран с production dependencies и native rebuild,
  запущен из `dist/main.js`; health и graceful SIGINT/SIGTERM проверены.
- Docker target `server` собран, контейнер запущен, `/api/health` вернул `200`,
  Compose config проверен.
- Web artifact собран и отдан через Vite preview smoke.
- Nest-shell measurement: import `456.9 ms`, listen `3.1 ms`, health p50 `0.58 ms`,
  p95 `2.08 ms`, RSS `162.6 MiB`, shutdown `1.2 ms`. Регрессии относительно
  legacy baseline находятся в допустимых пределах.
