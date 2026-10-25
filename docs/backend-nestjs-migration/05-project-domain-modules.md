# Этап 5. Проектные данные и workflow

Статус: завершён 2026-10-23. Все unit-коммиты выполнены в общей ветке
`refactor/backend-nestjs-migration`; после каждого unit запускались целевые тесты,
после этапа — полный checkpoint.

## Сверка текущего прогресса — 2026-10-25

Project-domain transport cutover завершён. Native storage и atomic mutation
boundaries усилены после первоначального checkpoint:
[state/FS](artifacts/state-execution-contract-checkpoint.md),
[agent stores/recovery](artifacts/agent-storage-recovery-session-checkpoint.md),
[planning/ideation](artifacts/planning-ideation-singletons-checkpoint.md).
Все 318 operations уже имеют shared input/context и response contracts;
[coverage checkpoint](artifacts/transport-context-terminal-observability-checkpoint.md).
Broad service decomposition, remaining opaque business maps и полный error review
не объявляются завершёнными этим транспортным этапом.

## Цель

Перенести modules, которые владеют настройками и файловым состоянием проектов,
не изменяя формат данных и пользовательские workflows.

## Порядок

```text
Settings -> Projects -> Files/Context -> Features -> Sessions
         -> App Spec/Backlog Plan -> Ideation persistence
```

Settings переносится первым, потому что сейчас является зависимостью десятков
routes и services. Сначала меняется способ получения instance через DI, затем
внутренняя структура сервиса.

## 5.1. SettingsModule

- [x] Зарегистрировать единственный `SettingsService` в Nest container.
- [x] Разделить global settings, project settings, credentials и migrations.
- [x] Ввести repositories для файлов настроек и секретов.
- [x] Сохранить atomic writes, permissions и backup behavior.
- [x] Перенести execution environments и model timeout settings.
- [x] Перенести OpenAI-compatible endpoint settings.
- [x] Перенести runtime log-level/request-logging reactions через domain event.
- [x] Удалить прямое создание `SettingsService` в providers.
- [x] Сохранить legacy Electron settings migration.
- [x] Удалить settings routes из legacy bridge.

Секретные поля не входят в response DTO. Masked value никогда не считается новым
credential при update.

## 5.2. ProjectsModule

- [x] Выделить `ProjectRegistry` и `ProjectOverviewService`.
- [x] Нормализовать project identity отдельно от display path.
- [x] Сохранить multi-project dashboard и recent project behavior.
- [x] Валидировать allowed roots до чтения repository.
- [x] Не выполнять implicit setup/Docker/SSH mutation при list/get.
- [x] Перенести add/remove/update/overview routes.

## 5.3. FilesModule и ContextModule

- [x] Разделить local controller filesystem и execution environment filesystem.
- [x] Создать `ProjectFilePort` с read/write/list/stat/copy/move/delete/download.
- [x] Сохранить limits, image handling и streaming downloads.
- [x] Сохранить traversal/symlink protection.
- [x] Перенести context Markdown/images и describe operations.
- [x] Не смешивать remote authoritative path с controller alias.
- [x] Добавить locks для конфликтующих writes.

## 5.4. FeaturesModule

- [x] Разделить `FeatureRepository`, `FeatureApplicationService` и state transitions.
- [x] Перенести list/get/create/update/delete/bulk routes.
- [x] Централизовать допустимые status transitions.
- [x] Сохранить description history, images, priorities и dependencies.
- [x] Сохранить event emission и sync verified/completed в app spec.
- [x] Перенести import/export/orphan recovery.
- [x] Не переносить agent execution внутрь repository.
- [x] Добавить optimistic/version check либо project-level serialization для writes.

Feature storage остаётся совместимым с существующим `feature.json` и дополнительными
файлами. Любое расширение должно быть читаемо предыдущим release до cutover.

## 5.5. SessionsModule

- [x] Разделить persisted chat metadata и active provider session.
- [x] Перенести create/list/get/update/delete routes.
- [x] Зафиксировать owner cleanup активной session.
- [x] Сохранить history ordering и restart behavior.
- [x] Не сохранять raw secrets/provider clients.

## 5.6. Specification modules

- [x] `AppSpecModule`: generate, parse, create features, sync.
- [x] `BacklogPlanModule`: generate, apply и validation.
- [x] Использовать `@automaker/spec-parser` как pure dependency.
- [x] Вынести model query за provider port.
- [x] Отделить parsing от filesystem mutation.
- [x] Сохранить plan approval semantics.

## 5.7. Contracts package

- [x] Shared schemas для migrated settings/projects/features/sessions/spec endpoints.
- [x] UI client использует inferred types, но не Nest DTO classes.
- [x] Добавить API contract version metadata.
- [x] Генерацию OpenAPI выполнять из тех же schemas либо проверять на divergence.

## Тесты

- Golden fixtures старых settings/project data.
- Atomic write и concurrent update tests.
- Feature transition property tests.
- Import/export round trip.
- Interrupted state fixtures.
- Context image/download size limits.
- UI settings, board, context, spec и session smoke.
- Windows/POSIX paths и read-only filesystem failures.

## Rollout

Settings и Features не переносить одним неделимым коммитом. Все units выполняются
последовательно в общей migration-ветке:

1. Settings provider ownership.
2. Read-only settings endpoints.
3. Settings mutations/migrations.
4. Projects.
5. Files/context read.
6. Files/context write.
7. Features read.
8. Features mutations/transitions.
9. Sessions.
10. Spec/backlog.

После десятого unit выполняется полный checkpoint этапа, включая storage fixtures,
UI smoke и production server build. Следующий этап до успешной проверки не начинается.

## Exit criteria

- Project data routes удалены из legacy bridge.
- Ни один migrated module не обращается к storage из controller.
- Старые fixtures читаются без migration-on-read side effects.
- Write operations атомарны и сериализованы там, где требуется.
- UI workflows не требуют изменения public API.
- Полный checkpoint этапа 5, включая storage compatibility и UI workflow smoke,
  успешно выполнен и зафиксирован завершающим коммитом.

## Результат checkpoint

- Route inventory schema v2 содержит только фактически смонтированные endpoints:
  308 маршрутов, без дублей; у project-domain groups нет legacy owners.
- Полный server unit suite: 112 test files, 2825 tests passed, 40 skipped.
- Полный server contract suite: 20 test files, 219 tests passed; storage fixtures:
  2 tests passed.
- Production build успешно собран для packages, server, web UI и Electron main/preload.
- UI smoke на Chromium: 16 tests passed для settings, projects/board, context,
  features и sessions.
- `@automaker/contracts` содержит общие Zod schemas и API contract version header;
  server и UI используют один источник transport types.
- Inventories routes/dependencies/API consumers регенерированы и проходят `--check`.

## Дополнительный cutover: native project storage ownership

`FeatureStorageModule` владеет одним `FeatureLoader` на application. Это отдельный
global storage module: feature controllers/application services не становятся
global. `FeaturesModule` использует `FileFeatureRepository` поверх этого native
loader; прежнее имя `LegacyFeatureRepository` и зависимость от legacy token удалены.
Projects, worktrees, prompt enhancement, feature commands/queries и integrations
инжектируют тот же class token.

`NotificationsModule` и `EventHistoryModule` теперь сами создают и экспортируют
свои сервисы; экспортируемые storage services доступны transitional consumers
через native DI. Notification factory получает `APPLICATION_EVENTS` своего
application до выдачи сервиса потребителям. AutoMode, app-spec workflow и
background integrations больше не используют legacy aliases для этих зависимостей.
Три legacy tokens/factories/service-bag fields и bootstrap overrides удалены;
retired override keys отклоняются до создания сервисов.

При проверке изоляции обнаружена и воспроизведена утечка между проектами:
notifications/history readers возвращали общие mutable defaults при отсутствии
файла; запись добавляла в константу записи одного проекта, и новый проект без
файла видел чужие notifications/event summaries. Оба новых regression tests
первоначально упали на этом поведении. Fallback теперь возвращает отдельный
`globalThis.structuredClone` defaults, в том числе при parse/read error; последующие mutations
не меняют общие константы. Legacy fallback policy при повреждённом файле этим
срезом не заменяется fail-closed policy. Ранее записанные файлы не очищаются:
надёжно отличить исторически примешанные записи от пользовательских здесь нельзя.

Новый native contract проверяет actual Nest wrapper cardinality, identity storage
потребителей, raw/typed notification delivery только своему application, работу
второго приложения после shutdown первого и сохранность feature/notification/event
files после restart. Данные остаются project-scoped: два приложения, явно получившие
один project path, читают те же файлы, а не скрытую DATA_DIR partition. Изоляция
разных проектов не означает multi-writer coordination одного проекта.

HTTP API остаётся v13; persisted formats, IDs и event payloads не меняются.
Оставшаяся legacy composition, lifecycle orchestration, конкурентные записи,
recovery/error hardening и остальные gates этапов 7–11 не объявляются завершёнными.

Проверки среза:

- Исходные два regression cases с реальными файлами воспроизвели обе утечки.
  Финальный набор из 4 cases проверяет missing/malformed files, чистоту shared
  defaults и изоляцию нескольких проектов/instances без сброса defaults в тесте.
- Целевые native project/provider composition и Nest shell contracts: 34 passed.
- `npm run test:server:unit`: 3577 passed, 40 skipped.
- `npm run test:server:contract`: 301 passed; оба полных server-набора повторно
  прошли после квалификации `structuredClone` через `globalThis`, потребовавшейся
  для текущей ESLint globals configuration. Подавления правил не добавлялись.
- `npm run test:packages`: 1473 passed.
- Server/UI production build (включая Electron main/preload), server/UI lint,
  UI typecheck, lockfile и три inventory checks: успешно.
- Production SIGTERM/SIGINT lifecycle smoke: exit 0.
- Docker acceptance с `automaker-nest-stage2-smoke:latest`: 11 passed,
  4 opt-in skipped; cleanup owned containers/image/volume проверен.
- Выбранные реальные SSH CLI/SDK/Direct chat/restart cases: 3 passed,
  34 отфильтрованы.
- Chromium после завершения Docker/SSH: 10 passed — добавление/редактирование
  feature, Agent chat/Running Agents, Cursor status/permissions, Gemini/Copilot
  status, confirmed credentials и explicit legacy credential import.
- Финальные formatting/diff checks успешны. После форматирования нового native
  contract его отдельный повтор также прошёл. Vendor execution использует offline
  fixtures; paid/live authentication и packaged Electron этим срезом не проверялись.
