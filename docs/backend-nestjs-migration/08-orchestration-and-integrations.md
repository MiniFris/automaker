# Этап 8. Оркестрация и интеграции

## Цель

Перенести сервисы, которые координируют несколько доменов: Auto Mode, pipelines,
planning, ideation, GitHub, MCP, notifications и hooks. Этот этап начинается только
после стабилизации Features, Execution, Git и Agents modules.

## Срез: native ownership интеграционных сервисов

`MCPModule`, `IdeationModule` и `PipelineModule` теперь создают свои сервисы
через явные class-token factory providers. `OrchestrationModule` владеет
`EventHookService`, который получает `BackgroundIntegrationsLifecycle`.
Четыре legacy tokens/factories/service-bag fields и bootstrap overrides удалены.
Application services и background lifecycle инжектируют native instances;
retired override keys отклоняются до создания сервисов. Новые global modules
или скрытые service-bag aliases для этих сервисов не добавлены.

Сохранены явные dependencies: MCP использует native SettingsService, ideation —
application events, SettingsService, FeatureLoader и ProviderRegistry. Hook startup
по-прежнему выполняет initialize один раз через существующий lifecycle owner;
shutdown снимает его subscription и cleanup timers, не меняя другое приложение.
Native composition contract проверяет actual Nest wrappers и identity consumers,
два приложения, persisted ideas/pipeline steps и независимость после закрытия
первого приложения. Отдельный contract сохраняет MCP server в настоящих settings,
запускает owned Node stdio fixture с зависшим handshake и закрывает приложение:
реальный Nest before-shutdown hook завершает child PID, завершает pending discovery
и запрещает новое discovery после shutdown. Это не live external MCP server.

В pipeline подтверждён аналогичный notifications/history дефект: shallow spread
defaults сохранял общий массив steps. Создание step в одном проекте загрязняло
конфигурации других проектов без файлов. Reader теперь клонирует fallback,
а merge defaults создаёт отдельный массив и для partial JSON без steps. Три
regressions сначала упали, затем прошли для missing/malformed/partial config;
дополнительно проверяется, что изменение возвращённого пустого config не меняет
другой read или проект. Исторические pipeline files не очищаются автоматически.

Это ownership cutover, не завершение этапа 8: ideation decomposition, cancellation/
persistence drain, разделение MCP test/list и SSE/HTTP transport acceptance,
in-flight hook shell/HTTP drain, typed EventBus subscriptions, validation registry
и остальные orchestration gates остаются открытыми. Pipeline storage serialization,
ошибки чтения и multi-writer coordination этим clone fix не закрыты. HTTP API v13,
wire payloads, IDs, persisted formats и execution binding semantics не меняются.

Проверки среза (не финальный checkpoint этапа 8):

- Pipeline isolation: 3 real-filesystem regressions первоначально упали,
  затем прошли без сброса defaults или изменения существующих файлов.
- Целевые native composition/Nest shell/MCP transport contracts: 45 passed;
  повтор после форматирования и усиления PID assertion до `ESRCH` также успешен.
- `npm run test:server:unit`: 3580 passed, 40 skipped.
- `npm run test:server:contract`: 307 passed.
- `npm run test:packages`: 1473 passed.
- Server/UI production build (Electron main/preload включены), server/UI lint,
  UI typecheck, lockfile, formatting/diff и три inventory checks: успешно.
- Production SIGTERM/SIGINT lifecycle smoke: exit 0.
- Docker acceptance с `automaker-nest-stage2-smoke:latest`: 11 passed,
  4 opt-in skipped; owned containers/image/volume cleanup проверен.
- Выбранные реальные SSH CLI/SDK/Direct chat/restart cases: 3 passed,
  34 отфильтрованы.
- Chromium после Docker/SSH: 17 passed — hooks settings/dialog validation и
  endpoint persistence/reload, feature add/edit, Agent chat/Running Agents,
  Cursor/Gemini/Copilot status и confirmed credentials/import. Endpoint fixture
  использует `https://ntfy.invalid`, а не публичный notification server.
  Paid/live vendor authentication, внешний MCP/Ntfy и packaged Electron этим
  offline fixture acceptance не проверялись.

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
выполнение второй раз. После потери registry старый ticket недействителен. При
повторном открытии диалога для сохранённого `generated`-плана coordinator проверяет
отсутствие активного run и выдаёт новый recovery ticket. Чтение ticket не запускает
выполнение; только его явное подтверждение продолжает approved-план.

Для повторного открытия диалога и reconnect UI запрашивает текущий ticket через
защищённый `POST /api/auto-mode/pending-plan-approval`. Endpoint возвращает ticket
только для активного ожидания и совпадающей сохранённой версии. Схемы request/response
находятся в `@automaker/contracts`. Закрытие диалога не отменяет server-side ожидание.
Подтверждение `POST /api/auto-mode/approve-plan` также обрабатывается напрямую Nest
controller с общей decision schema. Невалидное тело возвращает 400, устаревший ticket
— 409 в общем error envelope. Старый Express approval handler удалён.

При shutdown сохраняется interrupted state, затем останавливаются scheduler,
active run controllers и approval registry. Ожидания получают `AbortError`, их
таймеры очищаются; persisted execution state сохраняется для восстановления.
Явная версия generated-плана сохраняется без дополнительного auto-increment;
ошибки plan persistence возвращаются вызывающему workflow.

Промежуточный общий checkpoint: 2900 unit-тестов и 227 HTTP/WS contracts. Дополнительно
проверены shutdown/recovery races и настоящий SSH approval workflow: до решения
Write недоступен, после решения используется тот же remote workspace. Полный этап 8
остаётся незавершённым: restart/resume acceptance и остальные integration gates
требуют дальнейшей работы.

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
- [x] Не сохранять live clients между несвязанными requests без owner lifecycle.
- [x] Добавить fake MCP server integration tests.

Локальный fixture server в `tests/fixtures/mcp-test-server.mjs` проходит настоящий
SDK handshake по stdio. `mcp-transport.contract.test.ts` проверяет tools discovery,
timeout подключения/list-tools, oversized catalog, redaction и shutdown активного
соединения. Все шесть сценариев подтверждают завершение дочернего процесса. Таймеры
operation deadline очищаются в `finally`, active clients закрываются через Nest
`beforeApplicationShutdown`, повторный cleanup безопасен. SSE/HTTP acceptance и
ограничение сырых transport frames остаются отдельной незакрытой частью этапа.

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
