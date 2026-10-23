# Этап 3. Core platform

## Цель

Перенести сквозные обязанности в Nest primitives до массового создания controllers.
Все последующие модули должны пользоваться одним config, auth, error, security,
logging, eventing и lifecycle layer.

## 3.1. ConfigModule

- [x] Создать schema всех runtime variables с defaults и ограничениями.
- [x] Валидировать `PORT`, `HOST`, `DATA_DIR`, CORS, auth, terminal и debug flags.
- [x] Ввести typed config namespaces: `server`, `auth`, `storage`, `terminal`,
      `providers`, `execution`, `preview`.
- [x] Создать `RuntimePathsService` вместо рассеянных `process.cwd()`.
- [x] Различить build-time UI env и server runtime env.
- [x] Запретить новые прямые `process.env` через ESLint restriction.
- [x] Мигрировать старые обращения постепенно; временно разрешить их только в legacy.

Config validation не должна требовать credentials невыбранного provider.

## 3.2. AuthModule

- [x] Перенести session/API-key проверку в глобальный guard.
- [x] Добавить metadata decorator `@Public()`.
- [x] Пометить health, auth и setup routes в соответствии с текущим поведением.
- [x] Сохранить cookie names, expiration и logout behavior.
- [x] Вынести rate limiting login attempts в injectable store.
- [x] Вынести WebSocket token issuance/validation в общий auth service.
- [x] Добавить timing-safe comparisons и redaction секретов в logs.

Не переносить connection-level WS auth в `handleConnection`: клиент не должен
успеть отправить сообщения до завершения проверки upgrade.

## 3.3. SecurityModule

- [x] Обернуть `initAllowedPaths`, `validatePath` и secure filesystem в providers.
- [x] Ввести `ProjectPathPipe`/`AllowedPathGuard` для body/query/params.
- [x] Сохранить отдельное доверие к `DATA_DIR`.
- [x] Не нормализовать remote SSH paths как локальные filesystem paths.
- [x] Добавить traversal, symlink, Windows drive и UNC tests.
- [x] Добавить audit logging для rejected destructive operations без утечки secrets.

## 3.4. Validation и contracts

- [x] Подключить schema-based global validation.
- [x] Включить rejection неизвестных полей на security-sensitive requests.
- [x] Не включать глобальное coercion без анализа query compatibility.
- [x] Создать reusable schemas для project path, feature id, provider id,
      execution selection и pagination.
- [x] Response validation включать сначала в tests, затем выборочно в production.

## 3.5. Exception handling

- [x] Создать domain errors: validation, not-found, conflict, forbidden,
      unavailable, timeout, cancellation, unknown-outcome.
- [x] Создать global exception filter с legacy-compatible envelope.
- [x] Добавить stable optional `errorCode` без удаления старого `error`.
- [x] Не возвращать stack, raw provider output, environment secrets и SSH details.
- [x] Сопоставить filesystem/Git/provider errors с текущими status codes.
- [x] Логировать unexpected errors один раз с correlation id.

## 3.6. Logging и observability

- [x] Адаптировать существующий `@automaker/utils` logger к Nest `LoggerService`.
- [x] Добавить request/correlation id для HTTP, WS session и background job.
- [x] Сохранить runtime change server log level.
- [x] Заменить `morgan` только после equivalence tests.
- [x] Добавить duration/status/module/errorCode к request logs.
- [x] Redact cookies, API keys, auth headers, target credentials и prompts по policy.
- [x] Подготовить metrics interface, не привязываясь к конкретному SaaS.

## 3.7. EventingModule

- [x] Определить typed `ApplicationEventMap` вместо `payload: unknown`.
- [x] Создать `EventBus` interface и in-process adapter.
- [x] Сохранить synchronous ordering там, где на него полагается код.
- [x] Изолировать ошибку одного subscriber.
- [x] Ввести unsubscribe/dispose lifecycle.
- [x] Создать compatibility adapter к текущему WebSocket broadcaster.
- [x] Не добавлять Redis/NATS до появления требования multi-instance.

## 3.8. LifecycleModule

- [x] Определить общий contract `start`, `stop`, `health` для supervisors.
- [x] Перевести startup orchestration на Nest lifecycle hooks.
- [x] Упорядочить shutdown: запрет новых jobs → mark interrupted → stop agents →
      stop tests/dev servers/PTY → close sockets → flush writes → close HTTP.
- [x] Сохранить общий deadline и логировать незавершённые resources.
- [x] Все intervals/timeouts регистрировать у owner service.
- [x] Проверить повторный shutdown и partial startup failure.

## 3.9. HealthModule

- [x] Разделить `/health/live` и `/health/ready`, сохранив `/api/health` alias.
- [x] Readiness учитывает обязательный startup, но не требует доступности всех
      необязательных AI providers.
- [x] Detailed health остаётся protected.
- [x] Не выполнять тяжёлый Docker/SSH/provider probe на каждый health request.

## Тесты

- Unit tests каждого guard/pipe/filter/provider.
- HTTP matrix public/protected × cookie/API-key/invalid token.
- Config schema tests для production/test/Electron/Docker.
- Security path matrix на POSIX и Windows semantics.
- Event ordering/unsubscribe/error isolation.
- Startup/shutdown с fake supervisors и fake timers.

## Exit criteria

- Новый controller не нуждается в legacy middleware для auth/error/path checks.
- Config, auth и security имеют один source of truth.
- Существует typed event bus с compatibility adapter.
- Lifecycle каждого долгоживущего ресурса может быть подключён через DI.
- Cross-cutting contract suite проходит до начала массового переноса routes.
- Полный checkpoint этапа 3 успешно выполнен; его результат и обновлённый checklist
  зафиксированы завершающим коммитом в единственной migration-ветке.

## Результат checkpoint

- Runtime configuration валидируется Zod до построения Nest graph; config и paths
  доступны через typed DI tokens, а новые Nest-модули защищены ESLint от прямого
  чтения `process.env` и `process.cwd()`.
- Глобальные auth guard и exception filter проверены на новом protected
  `/api/health/detailed`; public live/ready probes используют `@Public()`. Cookie,
  API key и invalid-token matrix сохраняет прежние коды ответа.
- Общий platform middleware применяет preview policy, CORS, content-type, JSON limit
  и cookie parsing до выбора Nest/legacy route owner.
- Security providers, strict Zod request schemas, stable domain error codes,
  correlation ids, redaction и metrics port готовы для следующих controllers.
- Typed synchronous EventBus оборачивает текущий broadcaster; subscriptions и auth
  cleanup timer имеют DI lifecycle. Supervisor coordinator проверен на обратный
  порядок, повторный shutdown и общий 30-секундный deadline.
- Route inventory теперь извлекает metadata как из Express routers, так и из Nest
  controllers: 307 endpoints, включая три Nest health endpoints.
- Успешны server build/lint, 2790 unit tests (40 skipped), 218 contract tests,
  8 integration tests, 1171 package/UI tests, UI typecheck и production Web/Electron
  build. Lockfile и generated route inventory прошли проверки.
