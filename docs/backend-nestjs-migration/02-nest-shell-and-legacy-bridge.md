# Этап 2. Nest shell и legacy bridge

## Цель

Сделать NestJS production composition root, не меняя владельца бизнес-routes.
После этапа server process стартует и останавливается через Nest, но legacy routers
продолжают обслуживать текущий API.

## Зависимости и версии

- [ ] Поднять `.nvmrc` и root `engines.node` минимум до `22.22.3` в линии Node 22.
- [ ] Добавить согласованные версии `@nestjs/common`, `@nestjs/core`,
      `@nestjs/platform-express`, `@nestjs/testing`, `reflect-metadata`, `rxjs`.
- [ ] Не использовать global Nest CLI как build dependency.
- [ ] Зафиксировать все `@nestjs/*` packages на одном major.
- [ ] Сохранить `type: module`, `module: NodeNext`, `.js` extensions в imports.
- [ ] Включить `experimentalDecorators` и `emitDecoratorMetadata` либо принять
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

- [ ] Создаёт `NestFactory.create<NestExpressApplication>(AppModule)`.
- [ ] Устанавливает global prefix `/api` только для Nest controllers.
- [ ] Воспроизводит текущий CORS callback и credentials behavior.
- [ ] Сохраняет JSON body limit `50mb`.
- [ ] Подключает cookie parser.
- [ ] Настраивает logger adapter.
- [ ] Вызывает `enableShutdownHooks()`.
- [ ] Слушает прежние `HOST`/`PORT` и сохраняет EADDRINUSE diagnostics.
- [ ] Не содержит создание domain services через `new`.

### 2.2. Legacy bridge

- [ ] Собрать оставшиеся Express route groups в один `Router`, а не второй server.
- [ ] Подключить router как Nest middleware на прежних путях.
- [ ] Сохранить порядок preview guard, content-type check, public routes и auth.
- [ ] Legacy router вызывает `next()` для routes, уже принадлежащих Nest.
- [ ] Один route group никогда не регистрируется одновременно в legacy и Nest.
- [ ] Registry владельцев routes проверяется тестом.

Рекомендуется явный список legacy groups, а не wildcard discovery:

```ts
const legacyGroups = {
  features: createFeaturesRoutes(...),
  worktree: createWorktreeRoutes(...),
  // удаляется по мере миграции
};
```

### 2.3. Временная DI-обвязка

- [ ] Зарегистрировать существующие service instances через `useFactory`/`useValue`.
- [ ] Ввести injection tokens для event emitter, data directory и runtime paths.
- [ ] Не добавлять decorators сразу во все legacy services.
- [ ] Для каждого wrapper provider описать будущий owner module.
- [ ] Запретить создание второй копии stateful service.

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

- [ ] Обновить server scripts `dev`, `build`, `start`.
- [ ] Проверить `dist/main.js` и sourcemaps.
- [ ] Обновить Electron `prepare-server.mjs` и bundle `main` field.
- [ ] Убедиться, что Nest dependencies попадают в production bundle.
- [ ] Проверить native `node-pty` rebuild.
- [ ] Проверить Dockerfile, entrypoint и Compose healthcheck.
- [ ] Проверить отсутствие зависимости production server от Nest CLI.

## Тесты

- [ ] Bootstrap test без listen.
- [ ] Полный legacy HTTP contract suite через Nest shell.
- [ ] Middleware order tests для public/protected routes.
- [ ] CORS, cookies, 50 MB body limit и content-type tests.
- [ ] Startup failure и partial initialization tests.
- [ ] SIGINT/SIGTERM smoke.
- [ ] Web, Docker и Electron packaged server smoke.
- [ ] Сравнение performance baseline с допустимым порогом регрессии.

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
