# Этап 8. Оркестрация и интеграции

## Цель

Перенести сервисы, которые координируют несколько доменов: Auto Mode, pipelines,
planning, ideation, GitHub, MCP, notifications и hooks. Этот этап начинается только
после стабилизации Features, Execution, Git и Agents modules.

## 8.1. OrchestrationModule

- [ ] Ввести явный `FeatureRunCoordinator`.
- [ ] Перенести concurrency manager и project queues.
- [ ] Зафиксировать state machine feature execution.
- [ ] Перенести planning/approval lifecycle.
- [ ] Перенести execution/pipeline orchestration.
- [ ] Перенести resume/recovery и stale-state reconciliation.
- [ ] Разделить commands и emitted events.
- [ ] Обеспечить idempotent handling повторного completion event.

State machine должна явно описывать допустимые переходы:

```text
backlog -> queued -> preparing -> planning -> awaiting_approval
        -> executing -> testing -> awaiting_review -> completed/failed/interrupted
```

Фактические legacy statuses отображаются в эту модель compatibility mapper, пока
UI contract не будет версионирован отдельно.

## 8.2. AutoModeModule

- [ ] Заменить facade cache на project-scoped state внутри singleton coordinator.
- [ ] Разделить global scheduler и per-project run context.
- [ ] Явно инжектировать Features, Agents, Execution, Git, Settings и EventBus ports.
- [ ] Сохранить dependency blocking и максимальную concurrency.
- [ ] Запретить два одновременных owner одного feature.
- [ ] Сохранить stop/pause/restart semantics.
- [ ] Удалить compatibility facade после переноса всех callers.

## 8.3. PipelineModule

- [ ] Отделить pipeline configuration repository.
- [ ] Отделить template expansion и validation.
- [ ] Каждый step выполняется через закреплённый execution binding.
- [ ] Сохранить exclusions, retries и failure summaries.
- [ ] Не повторять unknown-outcome mutation.
- [ ] Прерывание pipeline очищает child jobs с bounded deadline.
- [ ] Перенести pipeline routes после service boundary.

## 8.4. PlanningModule

- [ ] Plan approval как отдельный application service.
- [ ] Pending approvals принадлежат lifecycle-managed registry.
- [ ] Restart превращает неподтверждённое выполнение в безопасное состояние.
- [ ] Backlog plan/spec generation использует provider port.
- [ ] Approval token привязан к feature/run/version плана.

### Промежуточная проверка approval workflow

Approval ticket содержит одноразовый token, случайный run id и версию плана.
Registry регистрирует ожидание синхронно до публикации события и потребляет ticket
до первой асинхронной mutation. Повторный запрос и устаревшая версия не запускают
выполнение второй раз. После потери registry сохранённый `generated`-план требует
явного resume; старый ticket не восстанавливается автоматически.

Для повторного открытия диалога и reconnect UI запрашивает текущий ticket через
защищённый `POST /api/auto-mode/pending-plan-approval`. Endpoint возвращает ticket
только для активного ожидания и совпадающей сохранённой версии. Схемы request/response
находятся в `@automaker/contracts`. Закрытие диалога не отменяет server-side ожидание.

Проверены 27 unit-тестов approval service и 14 Nest HTTP/WS contract-тестов,
server build и UI typecheck. Полный этап 8 остаётся незавершённым: lifecycle registry,
restart/resume workflow и остальные integration gates требуют дальнейшей работы.

## 8.5. IdeationModule

- [ ] Разделить ideation session, analysis и idea repository.
- [ ] Использовать общий provider selection и EventBus.
- [ ] Удалить дублирование agent streaming logic.
- [ ] Сохранить conversion idea -> feature как транзакционно понятную операцию.
- [ ] Разбить крупный legacy service после transport parity.

## 8.6. GitHubIntegrationModule

- [ ] Обернуть `gh`/GitHub operations за port.
- [ ] Перенести issues, PRs, comments, review threads и validation.
- [ ] Разделить read-only discovery и mutation.
- [ ] Ввести rate/error mapping без утечки command output.
- [ ] Cleanup stale validations сделать lifecycle task.
- [ ] PR creation использует Git/Worktree modules, а не shell из controller.

## 8.7. MCPModule

- [ ] Перенести server config lookup в SettingsModule.
- [ ] Разделить list tools и test connection.
- [ ] Ограничить timeout/output и redaction.
- [ ] Не сохранять live clients между несвязанными requests без owner lifecycle.
- [ ] Добавить fake MCP server integration tests.

## 8.8. Hooks и notifications

- [ ] Event hooks подписываются через EventBus при module init.
- [ ] Отписываются и очищают timers при shutdown.
- [ ] Защитить от event loops и повторной обработки feature.
- [ ] Notification channels не блокируют основной workflow.
- [ ] Ntfy/desktop/audio failures не меняют результат feature run.

## Тесты

- State-machine transition table.
- Concurrency и dependency ordering.
- Duplicate event/idempotency.
- Restart в каждой активной фазе.
- Approval stale token/replay.
- Pipeline cancel/unknown outcome.
- GitHub/MCP fake transports.
- End-to-end feature от backlog до waiting approval без реальной модели.
- Live provider acceptance только в отдельном защищённом job.

## Rollout

Orchestration routes переключаются последними внутри этапа. Сначала новые services
работают за legacy routes, затем controllers становятся владельцами API. Нельзя
одновременно менять feature state model и публичные UI statuses.

## Exit criteria

- Auto Mode, pipelines, ideation, GitHub и MCP routes удалены из legacy bridge.
- Feature execution имеет одну документированную state machine.
- Recovery не повторяет команды с неизвестным результатом.
- Background subscriptions/timers имеют Nest lifecycle owner.
- Сквозной fake-provider workflow проходит детерминированно.
- Полный checkpoint этапа 8, включая restart/recovery и интеграционные fake
  transports, успешно выполнен и зафиксирован завершающим коммитом.
