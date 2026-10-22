# Этап 3. Core platform

## Цель

Перенести сквозные обязанности в Nest primitives до массового создания controllers.
Все последующие модули должны пользоваться одним config, auth, error, security,
logging, eventing и lifecycle layer.

## 3.1. ConfigModule

- [ ] Создать schema всех runtime variables с defaults и ограничениями.
- [ ] Валидировать `PORT`, `HOST`, `DATA_DIR`, CORS, auth, terminal и debug flags.
- [ ] Ввести typed config namespaces: `server`, `auth`, `storage`, `terminal`,
      `providers`, `execution`, `preview`.
- [ ] Создать `RuntimePathsService` вместо рассеянных `process.cwd()`.
- [ ] Различить build-time UI env и server runtime env.
- [ ] Запретить новые прямые `process.env` через ESLint restriction.
- [ ] Мигрировать старые обращения постепенно; временно разрешить их только в legacy.

Config validation не должна требовать credentials невыбранного provider.

## 3.2. AuthModule

- [ ] Перенести session/API-key проверку в глобальный guard.
- [ ] Добавить metadata decorator `@Public()`.
- [ ] Пометить health, auth и setup routes в соответствии с текущим поведением.
- [ ] Сохранить cookie names, expiration и logout behavior.
- [ ] Вынести rate limiting login attempts в injectable store.
- [ ] Вынести WebSocket token issuance/validation в общий auth service.
- [ ] Добавить timing-safe comparisons и redaction секретов в logs.

Не переносить connection-level WS auth в `handleConnection`: клиент не должен
успеть отправить сообщения до завершения проверки upgrade.

## 3.3. SecurityModule

- [ ] Обернуть `initAllowedPaths`, `validatePath` и secure filesystem в providers.
- [ ] Ввести `ProjectPathPipe`/`AllowedPathGuard` для body/query/params.
- [ ] Сохранить отдельное доверие к `DATA_DIR`.
- [ ] Не нормализовать remote SSH paths как локальные filesystem paths.
- [ ] Добавить traversal, symlink, Windows drive и UNC tests.
- [ ] Добавить audit logging для rejected destructive operations без утечки secrets.

## 3.4. Validation и contracts

- [ ] Подключить schema-based global validation.
- [ ] Включить rejection неизвестных полей на security-sensitive requests.
- [ ] Не включать глобальное coercion без анализа query compatibility.
- [ ] Создать reusable schemas для project path, feature id, provider id,
      execution selection и pagination.
- [ ] Response validation включать сначала в tests, затем выборочно в production.

## 3.5. Exception handling

- [ ] Создать domain errors: validation, not-found, conflict, forbidden,
      unavailable, timeout, cancellation, unknown-outcome.
- [ ] Создать global exception filter с legacy-compatible envelope.
- [ ] Добавить stable optional `errorCode` без удаления старого `error`.
- [ ] Не возвращать stack, raw provider output, environment secrets и SSH details.
- [ ] Сопоставить filesystem/Git/provider errors с текущими status codes.
- [ ] Логировать unexpected errors один раз с correlation id.

## 3.6. Logging и observability

- [ ] Адаптировать существующий `@automaker/utils` logger к Nest `LoggerService`.
- [ ] Добавить request/correlation id для HTTP, WS session и background job.
- [ ] Сохранить runtime change server log level.
- [ ] Заменить `morgan` только после equivalence tests.
- [ ] Добавить duration/status/module/errorCode к request logs.
- [ ] Redact cookies, API keys, auth headers, target credentials и prompts по policy.
- [ ] Подготовить metrics interface, не привязываясь к конкретному SaaS.

## 3.7. EventingModule

- [ ] Определить typed `ApplicationEventMap` вместо `payload: unknown`.
- [ ] Создать `EventBus` interface и in-process adapter.
- [ ] Сохранить synchronous ordering там, где на него полагается код.
- [ ] Изолировать ошибку одного subscriber.
- [ ] Ввести unsubscribe/dispose lifecycle.
- [ ] Создать compatibility adapter к текущему WebSocket broadcaster.
- [ ] Не добавлять Redis/NATS до появления требования multi-instance.

## 3.8. LifecycleModule

- [ ] Определить общий contract `start`, `stop`, `health` для supervisors.
- [ ] Перевести startup orchestration на Nest lifecycle hooks.
- [ ] Упорядочить shutdown: запрет новых jobs → mark interrupted → stop agents →
      stop tests/dev servers/PTY → close sockets → flush writes → close HTTP.
- [ ] Сохранить общий deadline и логировать незавершённые resources.
- [ ] Все intervals/timeouts регистрировать у owner service.
- [ ] Проверить повторный shutdown и partial startup failure.

## 3.9. HealthModule

- [ ] Разделить `/health/live` и `/health/ready`, сохранив `/api/health` alias.
- [ ] Readiness учитывает обязательный startup, но не требует доступности всех
      необязательных AI providers.
- [ ] Detailed health остаётся protected.
- [ ] Не выполнять тяжёлый Docker/SSH/provider probe на каждый health request.

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
