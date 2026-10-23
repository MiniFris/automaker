# Этап 4. Периферийные HTTP-модули

## Цель

Проверить migration conveyor на сравнительно изолированных route groups и удалить
первые legacy routers. Этап должен доказать, что controller, DTO, service, tests,
packaging, rollout и rollback работают как повторяемый шаблон.

## Порядок переноса

### Wave 4.1: Health

- [x] `HealthController` для legacy paths и новых live/ready probes.
- [x] Public metadata и detailed protected endpoint.
- [x] Удаление legacy health router.

### Wave 4.2: Models и workspace

- [x] `ModelsModule` с read-only catalog use case.
- [x] `WorkspaceModule` с явной path/security dependency.
- [x] Никакого provider process launch из model list request.
- [x] Удаление обоих legacy routers.

### Wave 4.3: Templates

- [x] У существующего templates API нет read endpoints; единственная clone mutation
      отделена в application service.
- [x] Clone выполняется application service, а не controller.
- [x] Path validation, conflict и cleanup при partial failure.
- [x] Удаление legacy templates router.

### Wave 4.4: Notifications и event history

- [x] Превратить singleton services в Nest providers.
- [x] Сохранить notification/event identifiers и ordering.
- [x] Перенести list/filter/replay/clear contracts.
- [x] Проверить bounded history и cleanup.
- [x] Удалить legacy routes и singleton factories.

### Wave 4.5: Auth endpoints

- [x] Перенести login/session/logout/token endpoints после стабилизации guard.
- [x] Сохранить cookie attributes и Electron/web различия.
- [x] Проверить brute-force store lifecycle и restart behavior.
- [x] Удалить legacy auth router, не меняя global guard.

## Шаблон миграции route group

Каждый route group проходит одинаковую последовательность:

1. Уточнить contract inventory и добавить недостающие characterization tests.
2. Создать module/controller/application service/DTO.
3. На первом шаге обернуть существующий service через DI без внутренней переписи.
4. Прогнать один contract suite против legacy и Nest implementation.
5. Переключить owner route group на Nest.
6. Удалить регистрацию старого router.
7. Удалить мёртвые handler factories/common helpers.
8. Проверить route inventory и UI smoke.
9. После production canary удалить временный compatibility wrapper.

## Требования к controllers

- Не более transport mapping, validation и вызова одного application use case.
- Не использовать `Request`/`Response`, кроме download/streaming случаев.
- Не читать `process.env`, filesystem или global singleton.
- Не ловить все ошибки вручную; domain errors обрабатывает filter.
- Не формировать provider/Git shell commands.
- Не менять legacy envelope без отдельной версии API.

## Проверки каждой wave

- HTTP contract parity.
- Auth/path/security parity.
- Module-level Nest TestingModule tests.
- No duplicate route ownership.
- UI smoke для связанного view.
- `build:server`, Docker smoke и Electron packaging smoke.
- Startup/shutdown без новых open handles.

## Последовательность коммитов и rollback

- Route groups переносятся последовательными тематическими коммитами в общей
  migration-ветке; отдельные ветки и обязательные PR не создаются.
- Mutating routes не выполняются одновременно в legacy и Nest.
- Read-only shadow comparison разрешён только в test/staging и без provider probes.
- Rollback выполняется предыдущим artifact; storage format не изменяется.
- Любая storage migration должна быть backward-readable до завершения cutover.
- После завершения всех waves этапа выполняется полный stage checkpoint. Только
  после него создаётся фиксирующий коммит завершения этапа.

## Exit criteria

- Не менее пяти route groups полностью удалены из legacy bridge.
- Migration template воспроизводим и отражён в stage checklist.
- Нет расхождений HTTP contracts и UI behavior.
- Команда измерила фактическую скорость migration и обновила оценки этапов 5–10.
- Полный checkpoint этапа 4 успешно выполнен после всех waves и зафиксирован
  завершающим коммитом в единственной migration-ветке.

## Результат выполнения

- Nest стал единственным владельцем 7 route groups и 23 endpoints: health, auth,
  models, workspace, templates, notifications и event history. Старые routers и
  handler factories удалены, дублирующего ownership в inventory нет.
- Notification и event-history instances теперь создаются один раз composition
  root, передаются в фоновые workflow явно и экспортируются Nest-модулями без
  module-level singleton getter.
- Characterization и module tests проверяют metadata-only model catalog, строгие
  DTO, безопасный template clone и cleanup, notification not-found mapping,
  ordering/limit/cleanup event history и restart semantics login limiter.
- Фактическая скорость conveyor: 23 endpoint в 7 группах за один этап; сложность
  оказалась определена не числом handlers, а количеством stateful dependencies и
  фоновых consumers. Поэтому оценки этапов 5–10 в README пересчитаны с повышающим
  коэффициентом для storage, execution, providers и WebSocket lifecycle.
- Stage checkpoint: 2798 server unit tests (40 skipped), 219 HTTP/WS contracts,
  8 integration tests и 1171 package/UI tests прошли; server/UI и упакованный
  Electron artifact с пересобранными native modules, typecheck, inventories и
  lockfile проверены. Docker smoke выполнен на локальном Node 22/Git image:
  11 daemon-backed tests прошли, 4 дополнительных сценария пропущены по отдельным
  opt-in feature flags.
