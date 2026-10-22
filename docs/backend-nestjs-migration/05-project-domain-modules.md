# Этап 5. Проектные данные и workflow

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

- [ ] Зарегистрировать единственный `SettingsService` в Nest container.
- [ ] Разделить global settings, project settings, credentials и migrations.
- [ ] Ввести repositories для файлов настроек и секретов.
- [ ] Сохранить atomic writes, permissions и backup behavior.
- [ ] Перенести execution environments и model timeout settings.
- [ ] Перенести OpenAI-compatible endpoint settings.
- [ ] Перенести runtime log-level/request-logging reactions через domain event.
- [ ] Удалить прямое создание `SettingsService` в providers.
- [ ] Сохранить legacy Electron settings migration.
- [ ] Удалить settings routes из legacy bridge.

Секретные поля не входят в response DTO. Masked value никогда не считается новым
credential при update.

## 5.2. ProjectsModule

- [ ] Выделить `ProjectRegistry` и `ProjectOverviewService`.
- [ ] Нормализовать project identity отдельно от display path.
- [ ] Сохранить multi-project dashboard и recent project behavior.
- [ ] Валидировать allowed roots до чтения repository.
- [ ] Не выполнять implicit setup/Docker/SSH mutation при list/get.
- [ ] Перенести add/remove/update/overview routes.

## 5.3. FilesModule и ContextModule

- [ ] Разделить local controller filesystem и execution environment filesystem.
- [ ] Создать `ProjectFilePort` с read/write/list/stat/copy/move/delete/download.
- [ ] Сохранить limits, image handling и streaming downloads.
- [ ] Сохранить traversal/symlink protection.
- [ ] Перенести context Markdown/images и describe operations.
- [ ] Не смешивать remote authoritative path с controller alias.
- [ ] Добавить locks для конфликтующих writes.

## 5.4. FeaturesModule

- [ ] Разделить `FeatureRepository`, `FeatureApplicationService` и state transitions.
- [ ] Перенести list/get/create/update/delete/bulk routes.
- [ ] Централизовать допустимые status transitions.
- [ ] Сохранить description history, images, priorities и dependencies.
- [ ] Сохранить event emission и sync verified/completed в app spec.
- [ ] Перенести import/export/orphan recovery.
- [ ] Не переносить agent execution внутрь repository.
- [ ] Добавить optimistic/version check либо project-level serialization для writes.

Feature storage остаётся совместимым с существующим `feature.json` и дополнительными
файлами. Любое расширение должно быть читаемо предыдущим release до cutover.

## 5.5. SessionsModule

- [ ] Разделить persisted chat metadata и active provider session.
- [ ] Перенести create/list/get/update/delete routes.
- [ ] Зафиксировать owner cleanup активной session.
- [ ] Сохранить history ordering и restart behavior.
- [ ] Не сохранять raw secrets/provider clients.

## 5.6. Specification modules

- [ ] `AppSpecModule`: generate, parse, create features, sync.
- [ ] `BacklogPlanModule`: generate, apply и validation.
- [ ] Использовать `@automaker/spec-parser` как pure dependency.
- [ ] Вынести model query за provider port.
- [ ] Отделить parsing от filesystem mutation.
- [ ] Сохранить plan approval semantics.

## 5.7. Contracts package

- [ ] Shared schemas для migrated settings/projects/features/sessions/spec endpoints.
- [ ] UI client использует inferred types, но не Nest DTO classes.
- [ ] Добавить API contract version metadata.
- [ ] Генерацию OpenAPI выполнять из тех же schemas либо проверять на divergence.

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
