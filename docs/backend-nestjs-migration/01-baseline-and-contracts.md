# Этап 1. Baseline и contract tests

## Цель

Зафиксировать наблюдаемое поведение текущего backend так, чтобы перенос route group
можно было проверять автоматически, а не сравнением кода.

## Предварительные условия

- Завершён этап 0.
- Route inventory принят командой.
- Определены обязательные платформы CI.

## Работы

### 1.1. Чистый baseline

- [ ] Исправить две существующие UI typecheck ошибки `branchName`.
- [ ] Проверить `build:packages`, `build:server`, UI typecheck и lint.
- [ ] Разделить быстрые и environment-dependent server tests.
- [ ] Исключить настоящий SSH/Docker/provider доступ из default unit command.
- [ ] Добавить timeout diagnostics и список незакрытых handles для зависаний.
- [ ] Зафиксировать ожидаемые skipped tests по платформам.

Целевые команды:

```text
npm run test:server:unit
npm run test:server:contract
npm run test:server:integration
npm run test:server:ssh
npm run test:server:docker
npm run test:server:e2e
```

### 1.2. Testable legacy application

- [ ] Извлечь создание Express app из `index.ts` в `createLegacyApplication()`.
- [ ] Не открывать TCP port при import.
- [ ] Передавать config и service instances явно.
- [ ] Возвращать объект с `app`, `server`, `start()` и `shutdown()`.
- [ ] Исключить фоновые migrations/resume из unit bootstrap.
- [ ] Сделать startup tasks явно включаемыми в integration tests.

Это подготовительный рефакторинг без Nest decorators и без изменения endpoint.

### 1.3. HTTP characterization tests

Для каждого route group:

- [ ] happy path;
- [ ] отсутствующие и неверные поля;
- [ ] auth failure;
- [ ] path sandbox rejection;
- [ ] not found/conflict/rate limit;
- [ ] internal error mapping;
- [ ] headers, cookies, content type и cache behavior;
- [ ] side effects и event emission;
- [ ] повторный запрос и idempotency там, где она обещана.

Не snapshot-ить случайные timestamps, абсолютные temp paths и порядок полей,
если UI от них не зависит. Важные legacy quirks фиксировать явно с пояснением,
сохраняются ли они до API v2 или должны быть исправлены отдельной последующей задачей.

### 1.4. Shared contract schemas

- [ ] Создать `libs/contracts` или эквивалентный workspace package.
- [ ] Перенести туда только transport schemas и inferred TypeScript types.
- [ ] Не перемещать server services и filesystem entities.
- [ ] Добавить error envelope, pagination и common path schemas.
- [ ] Вводить request schema сначала для переносимого route group.
- [ ] Добавить проверку совместимости UI client types со schemas.

### 1.5. WebSocket contract tests

- [ ] Events WS: upgrade auth, connect, broadcast, unsubscribe, invalid token.
- [ ] Terminal WS: connect, input, resize, ping/pong, multiple viewers, exit.
- [ ] Reconnect после разрыва сети.
- [ ] Cleanup после закрытия socket и после завершения PTY.
- [ ] Поведение после backend restart без replay опасной команды.
- [ ] Ограничения размера и malformed messages.

### 1.6. Storage fixtures

- [ ] Global settings текущего формата.
- [ ] Legacy Electron settings для migration.
- [ ] Project с features, context, sessions, pipelines и event history.
- [ ] Interrupted/running feature recovery.
- [ ] Concurrent writes и partially written file recovery.
- [ ] Windows/POSIX path variants без зависимости от машины разработчика.

### 1.7. Performance и resource baseline

- [ ] Startup time без активных проектов и с несколькими проектами.
- [ ] Memory after idle, active agent и terminal session.
- [ ] p50/p95 для частых read endpoints.
- [ ] Event throughput и slow-client behavior.
- [ ] Shutdown duration и список оставшихся child processes.

Цель — не performance optimization, а обнаружение регрессий после Nest bootstrap.

## Проверка этапа и CI gates

- Полный checkpoint этапа из основного плана обязателен перед фиксирующим коммитом.
- Unit и contract tests обязательны для stage checkpoint и рекомендуются после
  каждого существенного промежуточного коммита.
- Docker/SSH suites запускаются отдельно на подходящих runners.
- Electron smoke выполняется хотя бы в release pipeline.
- Изменение route inventory без обновления contract metadata блокирует CI.
- Изменение публичной schema требует явной отметки compatibility impact.

## Rollback

Этап не меняет production bootstrap. Каждый preparatory refactor обязан оставлять
старую команду `npm run dev:server` и production artifact работоспособными.

## Exit criteria

- Default server unit/contract suite проходит детерминированно.
- Legacy app поднимается в test process без реального listen.
- Critical HTTP и оба WS transport покрыты characterization tests.
- Существующие data fixtures читаются и записываются без потерь.
- Известны baseline startup, memory и shutdown показатели.
- Полный checkpoint этапа 1 успешно выполнен и зафиксирован завершающим коммитом
  в единственной migration-ветке.
