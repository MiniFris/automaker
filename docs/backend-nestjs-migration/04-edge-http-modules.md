# Этап 4. Периферийные HTTP-модули

## Цель

Проверить migration conveyor на сравнительно изолированных route groups и удалить
первые legacy routers. Этап должен доказать, что controller, DTO, service, tests,
packaging, rollout и rollback работают как повторяемый шаблон.

## Порядок переноса

### Wave 4.1: Health

- [ ] `HealthController` для legacy paths и новых live/ready probes.
- [ ] Public metadata и detailed protected endpoint.
- [ ] Удаление legacy health router.

### Wave 4.2: Models и workspace

- [ ] `ModelsModule` с read-only catalog use case.
- [ ] `WorkspaceModule` с явной path/security dependency.
- [ ] Никакого provider process launch из model list request.
- [ ] Удаление обоих legacy routers.

### Wave 4.3: Templates

- [ ] Разделить read operations и clone mutation.
- [ ] Clone выполняется application service, а не controller.
- [ ] Path validation, conflict и cleanup при partial failure.
- [ ] Удаление legacy templates router.

### Wave 4.4: Notifications и event history

- [ ] Превратить singleton services в Nest providers.
- [ ] Сохранить notification/event identifiers и ordering.
- [ ] Перенести list/filter/replay/clear contracts.
- [ ] Проверить bounded history и cleanup.
- [ ] Удалить legacy routes и singleton factories.

### Wave 4.5: Auth endpoints

- [ ] Перенести login/session/logout/token endpoints после стабилизации guard.
- [ ] Сохранить cookie attributes и Electron/web различия.
- [ ] Проверить brute-force store lifecycle и restart behavior.
- [ ] Удалить legacy auth router, не меняя global guard.

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
