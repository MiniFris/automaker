# Этап 5. Проектные данные и workflow

Статус: завершён 2026-10-23. Все unit-коммиты выполнены в общей ветке
`refactor/backend-nestjs-migration`; после каждого unit запускались целевые тесты,
после этапа — полный checkpoint.

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
