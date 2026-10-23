# Этап 1. Baseline и contract tests

Статус: завершён 2026-10-23. Детерминированный checkpoint отделён от opt-in
SSH/Docker/browser suites; результаты и известные lifecycle handles зафиксированы
в [`artifacts/performance-baseline.md`](artifacts/performance-baseline.md).

## Цель

Зафиксировать наблюдаемое поведение текущего backend так, чтобы перенос route group
можно было проверять автоматически, а не сравнением кода.

## Предварительные условия

- Завершён этап 0.
- Route inventory принят командой.
- Определены обязательные платформы CI.

## Работы

### 1.1. Чистый baseline

- [x] Исправить две существующие UI typecheck ошибки `branchName`.
- [x] Проверить `build:packages`, `build:server`, UI typecheck и lint.
- [x] Разделить быстрые и environment-dependent server tests.
- [x] Исключить настоящий SSH/Docker/provider доступ из default unit command.
- [x] Добавить timeout diagnostics и список незакрытых handles для зависаний.
- [x] Зафиксировать ожидаемые skipped tests по платформам.

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

- [x] Извлечь создание Express app из `index.ts` в `createLegacyApplication()`.
- [x] Не открывать TCP port при import.
- [x] Передавать config и service instances явно.
- [x] Возвращать объект с `app`, `server`, `start()` и `shutdown()`.
- [x] Исключить фоновые migrations/resume из unit bootstrap.
- [x] Сделать startup tasks явно включаемыми в integration tests.

Это подготовительный рефакторинг без Nest decorators и без изменения endpoint.

### 1.3. HTTP characterization tests

Для существующих route-handler suites и как обязательная матрица для каждого
переносимого route group:

- [x] happy path;
- [x] отсутствующие и неверные поля;
- [x] auth failure, включая inventory-wide проверку всех protected endpoints;
- [x] path sandbox rejection;
- [x] not found/conflict/rate limit;
- [x] internal error mapping;
- [x] headers, cookies, content type и cache behavior;
- [x] side effects и event emission;
- [x] повторный запрос и idempotency там, где она обещана.

Не snapshot-ить случайные timestamps, абсолютные temp paths и порядок полей,
если UI от них не зависит. Важные legacy quirks фиксировать явно с пояснением,
сохраняются ли они до API v2 или должны быть исправлены отдельной последующей задачей.

### 1.4. Shared contract schemas

- [x] Создать `libs/contracts` или эквивалентный workspace package.
- [x] Перенести туда только transport schemas и inferred TypeScript types.
- [x] Не перемещать server services и filesystem entities.
- [x] Добавить error envelope, pagination и common path schemas.
- [x] Вводить request schema сначала для переносимого route group.
- [x] Добавить проверку совместимости UI client types со schemas.

### 1.5. WebSocket contract tests

- [x] Events WS: upgrade auth, connect, broadcast, unsubscribe, invalid token.
- [x] Terminal WS: connect, input, resize, ping/pong, multiple viewers, exit — полный
      сценарий находится в выделенном SSH suite, deterministic contract фиксирует
      upgrade и close codes.
- [x] Reconnect после разрыва сети.
- [x] Cleanup после закрытия socket и после завершения PTY.
- [x] Поведение после backend restart без replay опасной команды.
- [x] Ограничения размера и malformed messages.

### 1.6. Storage fixtures

- [x] Global settings текущего формата.
- [x] Legacy Electron settings для migration.
- [x] Project fixture с feature/context/pipeline; sessions и event history покрываются
      существующими service tests и расширяются при переносе их module owner.
- [x] Interrupted/running feature recovery.
- [x] Concurrent writes и partially written file recovery.
- [x] Windows/POSIX path variants без зависимости от машины разработчика.

### 1.7. Performance и resource baseline

- [x] Startup time без активных проектов; проекты с recovery измеряются в opt-in
      environment suites.
- [x] Memory after idle; active agent и terminal принадлежат opt-in runner baseline.
- [x] p50/p95 для частого `/api/health` read endpoint.
- [x] Event throughput и slow-client behavior зафиксированы WS contract и лимитом
      backpressure; нагрузочная цифра снимается повторно на этапе 9.
- [x] Shutdown duration и список оставшихся handles/process resources.

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

## Checkpoint этапа 1

Выполнен 2026-10-23:

- `test:server:unit` — 98 файлов успешно, 2 ожидаемо skipped; 2769 тестов успешно,
  40 skipped (shell/MCP opt-in);
- `test:server:contract` — 19 файлов и 210 тестов успешно, включая inventory-wide
  auth, HTTP lifecycle, Events/Terminal WS и storage recovery;
- `test:server:integration` — 3 файла и 8 тестов успешно;
- server build/lint, UI typecheck, contracts build/tests и inventory checks — успешно;
- `test:server:ssh`, `test:server:docker`, `test:server:e2e` выделены в отдельные
  команды и не притворяются успешными без соответствующего runner/environment.
