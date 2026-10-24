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
Подписки и in-flight hook drain из этого списка реализованы дальнейшим срезом
ниже; native validation registry также реализован отдельным срезом ниже.
Остальные ограничения этого ownership checkpoint сохраняются.

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
- [x] Перенести issues, PRs, comments, review threads и validation.
- [x] Разделить read-only discovery и mutation.
- [ ] Ввести rate/error mapping без утечки command output.
- [x] Cleanup stale validations сделать lifecycle task.
- [ ] PR creation использует Git/Worktree modules, а не shell из controller.

### Срез 2026-10-24: native issue validation и per-application ownership

Шесть endpoints (`validate-issue`, `validation-status`, `validation-stop`,
`validations`, `validation-delete`, `validation-mark-viewed`) больше не используют
Express handler factories. GithubController получает typed bodies через
ZodValidationPipe и вызывает IssueValidationService. GithubModule владеет этим
application service, IssueValidationRegistry и IssueValidationRepository; никаких
новых process-global maps или compatibility aliases не добавлено.

Удалены legacy `validate-issue.ts`, `validation-common.ts` и
`validation-endpoints.ts`; prompt/schema helper перенесён в native module.
GithubHandlersService остаётся временной границей только шести других GitHub CLI
operations и больше не получает events/settings/providers для validation.
BackgroundIntegrationsLifecycle не запускает чужую validation cleanup task.

Registry резервирует project/issue slot синхронно и хранит completion promise вместе
с AbortController. Stop и шестиминутный operation timeout запрашивают отмену, но не
освобождают slot до фактического завершения работы. Ранее stop/stale cleanup сразу
удаляли глобальную запись: новый запуск мог пересечься со старым, а старый finally
мог удалить его статус. Теперь duplicate не принимается во время drain и finally
может освободить только собственный reservation. Keys — пары project path/issue,
без prefix-парсинга; registry каждой app независим.

Периодическая stale cleanup теперь является native `onModuleInit` task registry.
Она только отменяет старую работу, не выдавая потерю identity за подтверждённую
очистку. `onModuleDestroy` закрывает admission, отменяет controllers, очищает interval
и operation timers и ждёт все принятые tasks в пределах 25 s. Повторный close
возвращает тот же результат. Неподтверждённый provider/process cleanup сохраняет slot
и приводит к `ISSUE_VALIDATION_CLEANUP_FAILED`; публичный checked Nest close
отклоняется, но последующие provider cleanup hooks всё равно выполняются.
Новый запуск и status для известного unconfirmed slot получают 503 `UNAVAILABLE`,
а не новый model request или ложное подтверждение running/completed.

Workflow использует тот же native ProviderRegistry и typed EVENT_BUS. Read-only
tool options, model/provider selection и valid event envelopes сохранены.
После cancellation не публикуется late progress/complete и не начинается запись
результата; уже начатая запись дожидается завершения, не обещая filesystem rollback.
Error events теперь статические, без private provider diagnostics. Result parsing
и общее provider capability enforcement не объявляются полностью переработанными.

Repository явно инжектируется в native service и адаптирует прежние project-scoped
storage helpers. `.automaker/validations/<issue>/validation.json`, freshness,
viewed/delete behavior и API v13 payload shapes сохраняются. Shared project paths
по-прежнему означают общие файлы: per-app registry isolation не даёт multi-writer
или cross-process lease гарантий. Canonical aliases одного filesystem path и
транзакционная сериализация хранения остаются отдельными требованиями.

Для всех шести POST явно установлен HTTP 200. Новый contract сначала обнаружил
201 у прежнего stored-validation wrapper из-за default Nest POST status: явный
HttpCode восстанавливает исходную Express semantics, не меняя success body.
Некорректные issue numbers, arrays/comments и enum settings отклоняются с 400
до reservation/provider execution. Локальные schemas пока не заменяют требование
shared contract/OpenAPI coverage всех endpoints в этапе 11.

Доказательства:

- `issue-validation-registry.test.ts`: 8 regressions — синхронный claim,
  app/project isolation, cancel/duplicate race, queued cancellation, stale cleanup,
  operation timeout, idempotent bounded drain и retained unknown cleanup;
- `issue-validation.service.test.ts`: прежняя state-query проверка перенесена
  с удалённого handler на native service; проверяются repository delegation и
  viewed event только при успешной записи;
- `issue-validation-lifecycle.contract.test.ts`: 4 native HTTP contracts с реальным
  Nest, explicit fixture BaseProvider registrations и owned filesystem. Два apps
  используют один project path без пересечения runtime reservations; проверяются
  duplicate/stop/drain, provider cancellation/finally, events, persistence,
  read/view/delete, request errors, static failures, 503 admission и попытка
  последующего provider disposal при failed cleanup. Vendor/`gh` не вызываются.

Это не завершает GitHub ports/read-only-vs-mutation/rate mapping, остальные
orchestration/provider/transport/packaging gates или весь этап 8.

Проверки этого среза:

- native registry/service units: 10 passed; native validation contracts: 4 passed;
- финальный `npm run test:server:unit`: 3621 passed, 40 skipped;
- финальный `npm run test:server:contract`: 323 passed;
- `npm run test:packages`: 1473 passed;
- Docker acceptance с owned base image `automaker-nest-stage2-smoke:latest`:
  11 passed, 4 opt-in skipped; real SSH feature suite: 14 passed. Model/vendor
  exchanges остаются offline fixtures, не live acceptance;
- server build/lint, UI typecheck/lint/build, lockfile check прошли;
- SIGTERM/SIGINT lifecycle smoke: exit 0;
- Chromium regression после завершения Docker/SSH: 17 passed без test retries;
- все три inventories обновлены/проверены; полный `format:check` и
  `git diff --check` прошли.

Первый build обнаружил конфликт имени controller property с методом `validations`;
property переименовано. Первоначальный unit assertion о failed cleanup наблюдал
promise до его catch: теперь он ждёт фактический флаг, не фиксированное число
microtasks. В первом общем unit suite остался caller удалённого legacy handler;
проверка перенесена на native service и дополнена repository delegation, а не
удалена. Повторные финальные suites зелёные, без увеличения test timeout/retries.
При chat reload browser runner дважды сообщил Vite WS proxy `ECONNRESET`;
17 tests прошли, но причина этих resets не установлена и не объявляется исправленной.

### Срез 2026-10-24: native read-only GitHub discovery

`check-remote`, `issues` и `prs` переключены с Express factories на native
GithubDiscoveryService через typed project body и существующий path guard.
GithubReadPort предоставляет только remote/issues/PR discovery, не mutation и не
произвольный command/GraphQL input. GithubCliReadAdapter строит argv/queries,
NodeGithubCommandRuntime владеет созданными child processes. Module ports и
useExisting указывают на один concrete owner, не старый legacy service bag.

Issue/PR lists запрашиваются параллельно: 100 open и 50 closed/merged; failed sibling
отменяется и дожидается cleanup. Linked-PR batches по 20 используют JSON stdin и
GraphQL variables вместо интерполяции owner/repo/issue values. Remote metadata
проверяется до argv; dotted repository names не обрезаются на первой точке.
HTTP paths/body fields и API v13 сохраняются; явно установлен исходный HTTP 200
вместо default Nest POST 201.

Environment берётся из native HOST_ENVIRONMENT, не import-time execEnv/ambient
credentials. Host-wide GH_REPO убирается, чтобы не перенаправлять project request;
prompt/update notification выключены. Windows environment/PATH case variants и
delimiter нормализуются без потери auth values; Unix PATH extension сохранён.
Remote URLs лишаются userinfo/query/fragment secrets; непарсируемый opaque string
не публикуется. Command errors не содержат stdout/stderr или CLI diagnostics.

Bounds: до 8 operations и 16 commands; command deadline 30 s, operation 60 s,
stdin 256 KiB, stdout 10 MiB и сохранённый stderr 32 KiB. Linux KILL отправляется
только исходной detached process group, затем read-only observer ждёт members/
threads; parent exit сам по себе не доказывает cleanup. Confirmation ограничена
2 s. Неизвестные PID identities сохраняются, replacement запрещён, native close
сообщает failed cleanup. Discovery shutdown закрывает admission и ограничивает
drain 5 s; late result не делает уже выданный failed close успешным.

Timeout отображается в 504, rate limit — в 429, unavailable/invalid/oversized
responses — в статические ошибки. Нет automatic retry, install/login/setup или
mutation-команд. Неизвестная ошибка обоих инструментов не выдаётся за успешный
отрицательный remote lookup. Optional enrichment не скрывает cancel/cleanup/
deadline/limit failure. Если timeline first-10 window имеет следующую страницу,
pagination metadata отсутствует или запрос не удался, `linkedPRs` не публикуется
как подтверждённый полный список/пустой массив. Полная pagination и отображение
такого unknown metadata в UI остаются отдельной задачей.

Доказательства:

- `github-discovery.test.ts`: argv/variables, redaction, sibling drain, optional
  uncertainty/resource-error precedence, bounded close и Windows env construction;
- `github-command-runtime.test.ts`: реальный owned CLI child с controlled observer;
  parent close ждёт group observation, cleanup timeout сохраняет identity/запрещает
  replacement, output bound, sanitized rate error, spawn error и pre-spawn cancel;
- `github-discovery.contract.test.ts`: native HTTP, owned executable fake gh и
  настоящий Git только в owned temporary repository. Проверяются native identity,
  две независимые app/profile, отсутствие init probes, argv/stdin, literal
  metacharacter cwd, hostile metadata, rate/errors, optional discovery failure,
  native shutdown активных CLI/root/child и orphan descendant после parent exit.
  GitHub/model services не вызываются.

Удалены legacy list-issues/list-prs factories. `issue-comments`,
`pr-review-comments`, `resolve-pr-comment`, прежние review services и общий remote
helper legacy worktree/review paths ещё требуют переноса. Отдельный write port и
mutation unknown-outcome policy не добавляются в read port. Это не полный GitHub
cutover, universal process supervisor, containment намеренного group/session
escape, Windows/macOS native acceptance/packaging или завершение этапов 7–11.

Проверки среза:

- 16 targeted units и 4 native GitHub discovery contracts прошли;
- финальный frozen `test:server:unit`: 3637 passed, 40 skipped;
- `test:server:contract`: 327 passed; shared packages: 1473 passed;
- Docker с owned base image `automaker-nest-stage2-smoke:latest`: 11 passed,
  4 opt-in skipped; real SSH feature workflow: 14 passed. Это offline fixture
  provider exchanges, не paid/vendor acceptance;
- server production build/lint, UI typecheck/lint/build и lockfile check прошли;
- SIGTERM/SIGINT smoke: exit 0; все три inventories обновлены и проверены;
- Chromium regression после завершения Docker/SSH: 17 passed без test retries.
  Generic E2E composition явно заменяет только GithubReadPort offline fixture,
  чтобы не обращаться к профилю/сети оператора. Native CLI path проверяется
  отдельными contracts с настоящими owned child processes, не этим UI stub;
- полный format check и diff whitespace check прошли.

Дополнительная regression проверяет minimal environment без PATH: Unix сохраняет
системный `/usr/bin:/bin`, Windows — стандартный OS lookup вместо пустого PATH.
Один промежуточный общий unit запуск пересёкся с исправлением/обновлением этой
regression и наблюдал старый module snapshot с новым expectation. Он не принят
как финальный checkpoint; targeted повтор и новый полный запуск после завершения
всех source edits прошли. Test timeout/retries не увеличивались. Windows проверен
на уровне environment construction, не реальным процессом на Windows.

### Срез 2026-10-24: native review/comments ports и подтверждённые mutations

Все 12 GitHubModule endpoints теперь используют native controller/service returns,
typed request pipes и ports; GithubController больше не принимает Express Req/Res.
Общие критерии gh ports/error mapping остаются открытыми до аудита и переноса
остальных worktree/caller paths, а не ограничиваются этим API cutover.
Удалены GithubHandlersService, три последних review/comment handler factories и
два старых spawn/exec service helpers. Старый remote helper для legacy worktree
paths ещё остаётся отдельной задачей этапа 11, не новым owner native API.

GithubCommentsReadPort и GithubReviewMutationPort имеют разные concrete adapters:
read object не содержит resolveThread. Они используют один native command runtime,
не новый process-global cache или unscoped child-process helper. Issue comments
сохраняют cursor pagination, totalCount и ghost fallback; review comments сохраняют
regular/inline/review-body виды, bot/app authors, file/line/diff context и сортировку.

REST catalog pages явно ограничены 100 rows/page и 20 pages, без парсинга
конкатенированных `--paginate` JSON arrays. Repeated pages/cursors не образуют
бесконечный цикл. Общий response budget для review operation — 10 MiB, включая
resolved metadata. Неполный mandatory catalog теперь ошибка, а не empty/partial
success; optional metadata может отсутствовать, но не превращается в `isResolved:
false` у неизвестного inline thread. Cancel/cleanup/deadline/limit/rate failures
не маскируются optional fallback. Shared schema/OpenAPI coverage и presentation
такого unknown в UI ещё не объявляются завершёнными.

Host binding берётся из согласованных remote/CLI metadata. Metadata URL должен
быть HTTPS и соответствовать owner/repo; несовпадение origin/CLI hosts блокируется.
Internal hostname non-enumerable и не добавляется в HTTP payload. Все API commands
имеют явный --hostname, list commands — host-qualified repo, чтобы GH_HOST не
перенаправил API call после repo discovery. Отсутствие origin отдельно проверяется
через git remote: наличие upstream и недоступный gh не считаются доказанным
отсутствием GitHub repository. Непарсируемый metadata URL не уходит наружу как raw
URL/credential diagnostic.

Write adapter сначала читает thread Node и целевой repository в одном GraphQL
preflight, сверяет immutable repository IDs, точный thread ID, repository name и
viewer permissions. Чужой/запрещённый thread получает FORBIDDEN до mutation.
Уже достигнутое requested state возвращается как подтверждённый no-op. Иначе
посылается ровно одна mutation через variables/stdin; ответ должен подтвердить
тот же thread ID и requested boolean. Неподтверждённый результат после dispatch
возвращает 502 UNKNOWN_OUTCOME, не success и не автоматический replay. Только
явный spawn failure доказывает отсутствие исполнения и остаётся unavailable.
Синхронный отказ admission происходит до dispatch.

GithubReviewService владеет operation controllers/timers, закрывает admission до
abort, ждёт bounded 5 s drain и резервирует thread ID также между path aliases.
Unknown outcome удерживает reservation и запрещает replacement/opposite mutation
в этом owner; checked app.close сообщает failed outcome и всё равно вызывает
последующий provider disposal. Resource limits/deadlines command runtime сохранены.
Reservations пока volatile/per-app: durable intent journal, operator recovery и
cross-process coordination остаются обязательными дальнейшими задачами. Restart
не replay-ит mutations, но не считается доказательством восстановления unknown.
Single-dispatch guarantee относится к приложению: внутренние HTTP retries
установленного gh не сертифицированы fake executable contracts. Реальный CLI/TLS
transport acceptance и отдельный audit inherited Git repository context против
allowed-root policy остаются открытыми до финального completion audit.

HTTP client не уничтожает application session для typed POST FORBIDDEN; 401 и
legacy untyped 403 сохраняют прежний auth handling. Native/thread responses должны
явно подтвердить requested state: UI больше не подставляет его вместо отсутствующего
isResolved. Resolve mutation явно имеет retry:false. Это не полная переработка всех
HTTP methods/auth errors или shared client из этапа 11.

Доказательства:

- github-review-adapters/lifecycle units: variables/host, mandatory catalogs,
  bounded pagination, unknown flags, resource precedence, repository/thread checks,
  both mutation directions, authoritative no-op, malformed confirmation, неизвестный
  результат, serialize/replacement protection и lifecycle outcome;
- 7 native github-review contracts с настоящими owned CLI processes: enterprise
  host, cursor/REST catalogs, fields/identity, forbidden preflight без writes,
  уже применённая mutation с потерянным/невалидным ответом, отсутствие replay,
  cleanup root/child при in-flight write и попытка последующего provider disposal;
- HTTP client unit suite и Chromium permission-denial regression проверяют
  сохранённую session, отсутствие replay и отсутствие invented success.

Протокол сверён с [gh api](https://cli.github.com/manual/gh_api),
[host-qualified repo flags](https://cli.github.com/manual/gh_pr_list) и
[GitHub review-thread schema](https://docs.github.com/en/graphql/reference/pulls).
Это проверка схемы/CLI semantics, не live/vendor mutation acceptance. PR creation
через Worktree/Git ports, durable unknown recovery, остальные orchestration gates
и реальные Windows/macOS packaged acceptance остаются открытыми.

Проверки среза:

- 24 новых targeted backend units и 7 native review contracts прошли;
- финальный `test:server:unit`: 3664 passed, 40 skipped;
- финальный `test:server:contract`: 334 passed;
- `test:packages`: 1481 passed (включая новые UI client regressions);
- отдельный UI HTTP client suite: 143 passed, из них 8 новых review cases;
- Docker acceptance с owned base image `automaker-nest-stage2-smoke:latest`:
  11 passed, 4 opt-in skipped; real SSH feature workflow: 14 passed. Vendor/model
  exchanges остаются offline fixtures, не live mutation acceptance;
- server production build/lint, UI typecheck/lint/build, lockfile check прошли;
- SIGTERM/SIGINT lifecycle smoke: exit 0;
- Chromium после Docker/SSH: 18 passed без test retries, включая новый session/
  authorization-denial test; все три inventories обновлены и проверены.

Первый полный format check обнаружил formatting нового adapter unit file; после
форматирования проверка повторена. Дополнительные regressions закрывают missing
origin при наличии upstream и non-web CLI metadata URL: они не превращаются в
ложный negative remote lookup или raw URL error. Финальные suites выполнены после
последних source edits; test timeout/retries не увеличивались.

### Срез: изоляция inherited Git environment

Native GitHub command runtime больше не наследует repository-local Git context
запустившего сервер shell/hook. Из environment обоих subprocess types (`git` и
`gh`) удаляются Git directory/worktree/common-dir, index/object/shallow/namespace
overrides, `GIT_CONFIG_PARAMETERS`, `GIT_CONFIG_COUNT` и indexed config pairs.
Windows case normalization происходит до фильтрации; host snapshot не мутируется.
PATH, HOME, GitHub credentials/enterprise host, proxy и explicit global/system Git
config profiles сохраняются. Это не sandbox Git configuration: выбранный host
profile и configuration files по-прежнему считаются доверенной конфигурацией.

Новый regression на двух owned локальных Git repositories сначала воспроизвёл
ошибку: при cwd requested Git возвращал origin unrelated repository. После
исправления он возвращает requested origin. Отдельные real-Git cases проверяют
URL rewrites через indexed config pairs и `GIT_CONFIG_PARAMETERS`; native HTTP
contract проверяет discovery с одновременно унаследованными redirect variables,
неизменный public response и получение `gh` очищенного environment с сохранённым
fixture token. Windows проверен pure environment tests, не Windows subprocess.
Все Git writes здесь ограничены временными fixture repositories; vendor writes
и реальные credentials не используются.

Семантика сверена с [Git environment](https://git-scm.com/docs/git) и
[Git config environment](https://git-scm.com/docs/git-config). Environment isolation
не закрывает поиск Git repository в родительских directories, `.git`/commondir
symlinks, linked worktrees вне allowed roots, configuration includes или filesystem
TOCTOU. Отдельный application-scoped allowed-root audit остаётся обязательным;
пункты завершения этапа 8 и всей миграции этим срезом не закрываются.

Проверки среза после последних source edits:

- `npm run test:server:unit`: 3669 passed, 40 skipped;
- `npm run test:server:contract`: 335 passed; targeted discovery/review contracts:
  12 passed;
- `npm run test:packages`: 1481 passed;
- server production build и `lint:server:errors` прошли;
- production lifecycle smoke: SIGTERM и SIGINT exit 0;
- все три inventory checks, lockfile check и formatting изменённых файлов прошли.

Эти результаты получены на Linux с доступным Node 22.22.2, который ниже declared
engine floor 22.22.3; это не acceptance на поддерживаемой Node version. Docker,
SSH, Chromium и packaged multi-OS acceptance в этом срезе не перезапускались,
результаты предыдущего среза не выдаются за новые. Полный stage checkpoint и
поддерживаемый runtime остаются обязательными перед завершением этапа.

### Срез: application-scoped Git repository boundary

`GithubRepositoryBoundary` — единственный native provider внутри GithubModule,
получающий RuntimePathsService конкретного приложения. При configured
ALLOWED_ROOT_DIRECTORY canonical roots фиксируются при создании owner; DATA_DIR
сохраняется как разрешённое исключение. Это не чтение process.env или legacy
global platform path state. Relative project paths разрешаются относительно
application workingDirectory, а не ambient process cwd.

До CLI admission проверяется canonical cwd, поиск `.git` не выходит за разрешённые
roots, gitfile и commondir targets проверяются после realpath. Проверяются также
symlinks самих pointer files; malformed/missing metadata не становится доказательством
отсутствия remote. Ancestor search ограничен 256 directories, regular pointer reads
— 8 KiB с fstat и nonblocking open для отказа special files. Эти лимиты не являются
гарантией latency для зависшего filesystem/NFS.

После удаления inherited Git environment runtime устанавливает проверенные
GIT_DIR/GIT_COMMON_DIR и worktree для каждого command. Это исключает повторный
неограниченный поиск родительского repo самим CLI и перекрывает conflicting
core.worktree для обычного working tree. Сохраняются nested projects, имена
`..literal`, bare repositories, DATA_DIR repositories и linked worktrees, если их
administrative/common directories тоже разрешены. Unrestricted configuration
сохраняет прежний режим без allowed-root ограничения.

Отсутствие repository внутри ограниченной области возвращает прежний negative
check-remote result без запуска git/gh. External context даёт typed 403, malformed
или unverifiable metadata — typed 503 без private paths. Отказ boundary синхронен
и предшествует dispatch: в том числе отказ перед mutation не превращается в
UNKNOWN_OUTCOME. Настоящие post-dispatch uncertainty и запрет replay сохранены.

Три native HTTP regressions сначала воспроизвели parent discovery, внешний gitfile
и cross-owner root-policy нарушение. Новый suite проверяет все шесть CLI-backed
GitHub endpoints, два одновременных owner, настоящий linked worktree с успешной
review mutation, внешний linked worktree/common-dir, bare repo и DATA_DIR exception.
Unit tests покрывают canonical aliases и их retargeting, lexical-prefix rejection,
relative paths, pointer size/format/FIFO, bounded discovery, synchronous refusal,
core.worktree pinning и сохранение repository config без изменений.

Форматы сверены с [Git repository layout](https://git-scm.com/docs/gitrepository-layout)
и [Git environment](https://git-scm.com/docs/git). Это repository-selection policy,
не OS filesystem jail: trusted host/repository config includes, прочие Git metadata
files и конкурентная замена файлов после проверки не изолируются этим provider.
Legacy SecurityService/AllowedPathGuard и secure-fs global state этим срезом не
переведены на per-app policy; issue-validation/provider tool access и legacy worktree
helpers требуют собственного audit. Финальные stage 7–11 gates остаются открытыми.

Проверки после последних source edits выполняются с Node 22.22.3 в PATH host runner:

- `npm run test:server:unit`: 3698 passed, 40 skipped;
- `npm run test:server:contract`: 344 passed;
- `npm run test:packages`: 1481 passed (включая UI unit regressions);
- server production build/lint и UI typecheck/lint/production build прошли;
- production lifecycle smoke: SIGTERM/SIGINT exit 0;
- Docker acceptance с owned base image `automaker-nest-stage2-smoke:latest`:
  11 passed, 4 opt-in skipped; SSH feature workflow: 14 passed. Эти transport suites
  повторно выполнены после финального изменения synchronous no-repository refusal;
- Chromium после завершения Docker/SSH: 18 passed, workers=1, retries=0. Это UI
  regression с offline/provider fixtures, не live GitHub mutation acceptance;
- все три generated inventories обновлены и проверены; lockfile и полный
  `format:check` прошли.

Новые native boundary contracts воспроизводятся командой
`npm run test:contract --workspace=apps/server -- tests/contract/github-repository-boundary.contract.test.ts`.
Финальные 9 cases входят в полный contract suite. Boundary unit file и новые
runtime/mutation regressions входят в полный unit suite. Дополнительный случай
фиксирует исчезновение repository до dispatch как known refusal, не unknown write.
Timeouts/retries не увеличивались; source edits завершены до финальных server suites.

Node 22.22.3 установлен как изолированный test tool через npm exec, без изменения
project dependencies/lockfile или системного Node. Эти результаты заменяют
ограничение предыдущего environment-среза только для повторённых здесь проверок,
не доказывают packaged multi-OS acceptance или завершение этапов.

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

- [x] Event hooks подписываются через EventBus при module init.
- [x] Отписываются и очищают timers при shutdown.
- [ ] Защитить от event loops и повторной обработки feature.
- [ ] Notification channels не блокируют основной workflow.
- [ ] Ntfy/desktop/audio failures не меняют результат feature run.

### Срез 2026-10-24: typed hook subscriptions и owned task drain

BackgroundIntegrationsLifecycle получает native `EVENT_BUS`, регистрирует три
типизированные подписки в `onModuleInit` и выполняет async `destroy()` hooks в
`onModuleDestroy`, до поздней provider/resource cleanup. Global EventBus не
уничтожается отдельным subscriber: close одной app не останавливает другую app.
Инициализация повторно или после остановки запрещена, вместо дублирования подписок.

ApplicationEventMap описывает используемые hook payloads; создание/завершение
features в FeatureCommandService больше не требует `as never` для отправки событий.
Raw application event transport сохраняет прежние wire envelopes и API v13.

EventHookService учитывает принятые async tasks, включая вложенную обработку
`feature_status_changed`, которая раньше запускалась без await. Shutdown сразу
закрывает admission, отписывается, отменяет активные действия и очищает dedup timers;
уже запущенные storage/feature reads дожидаются завершения, но после остановки
новые side effects не запускаются. Ещё не начатые queued event tasks пропускаются.
Дедупликация completion/status использует пару project path + feature ID: одноимённый
feature в другом проекте не подавляется чужим событием.

Drain имеет 25 s deadline и кэширует результат. Зависшее неотменяемое storage чтение/
запись означает статическую `EVENT_HOOK_CLEANUP_FAILED`, а не ложный успех. Позднее
завершение такой операции не запускает новый hook и не меняет уже выданный результат
close. Завершённые задачи удаляются из pending registry.

Shell hooks на host используют LocalExecutionEnvironment и его process supervisor
вместо отдельного promisified `exec`: сохраняются host cwd, command substitution и
общая ограниченная величина output; command/stdout/stderr не логируются сырыми.
Unix использует прежний `/bin/sh`; для Windows hooks явно выбрана прежняя Node exec
ComSpec/cmd invocation, включая quoting/verbatim args и custom non-cmd ComSpec.
Default PowerShell invocation других LocalExecutionEnvironment consumers не меняется.
Windows argument fixtures сверены с установленной реализацией Node child_process;
это не заменяет реального Windows acceptance. TERM-resistant Linux fixture
доказывает остановку root и child после native app.close, но не containment
намеренного process-group/session escape.

Pinned Docker/SSH hooks передают общий owner AbortSignal в workspace preparation
и command execution. Потеря канала/неподтверждённая очистка не replay-ит команду:
`PROCESS_CLEANUP_FAILED`, `SSH_CLEANUP_UNVERIFIED`, `SSH_OUTCOME_UNKNOWN` сохраняют
failed cleanup outcome, даже если обычная ошибка hook изолирована от feature run.
Через checked Nest shutdown (ADR-034) такая ошибка отклоняет app.close, не пропуская
последующие provider owners. Ошибка обычной команды не делает cleanup ошибочным.

HTTP action объединяет owner cancellation с operation timeout, всегда очищает
таймер в finally и освобождает неиспользуемый response body. NtfyService принимает
необязательный caller signal, отменяет fetch/body вместе с hook owner, не меняя
поведение остальных callers. Ошибка доставки не становится ошибкой feature.
Это не универсальная переработка ntfy diagnostics, body limits или всех каналов
desktop/audio: эти проверки и event-loop/exactly-once semantics ещё обязательны.

Новые доказательства:

- `event-hook-lifecycle.test.ts`: init/close idempotence, собственные подписки,
  ожидание nested handler/history, поздний lookup, HTTP error timer cleanup и abort,
  unknown command cleanup против ordinary command failure, bounded storage drain
  и project-scoped duplicate suppression;
- `local-shell-invocation.test.ts`: Windows cmd/custom ComSpec и неизменный default
  PowerShell/Unix shell без настоящего Windows процесса;
- `event-hook-drain.contract.test.ts`: две native Nest apps с реальными owned
  loopback HTTP/ntfy requests, actual shell/child и uncertain cleanup propagation
  с проверкой попытки последующего provider cleanup;
- существующий native integrations composition contract проверяет identity того же
  `EVENT_BUS`, отдельный owner каждой app, реальную инициализацию/остановку и restart.

Это промежуточный срез этапа 8. Он не закрывает Auto Mode state-machine, ideation
decomposition/drain, pipeline storage serialization, остальные GitHub
ports, MCP HTTP/SSE и остальные gates этапов 7–11. Real remote cancellation при
потере transport, process escape и все платформы не объявляются доказанными одним
host/loopback contract.

Проверки среза (не финальный checkpoint этапа 8):

- целевые hooks/ntfy units: 96 passed; supervisor/shell-invocation targets:
  35 passed;
- финальный `npm run test:server:unit`: 3612 passed, 40 skipped;
- финальный `npm run test:server:contract`: 319 passed;
- `npm run test:packages`: 1473 passed;
- native hook-drain/composition contracts: 5 passed;
- Docker suite с owned base image `automaker-nest-stage2-smoke:latest`: 11 passed,
  4 opt-in skipped; real SSH feature suite: 14 passed. Они проверены после перехода
  hooks на typed lifecycle; последующее выделение Windows invocation дополнительно
  покрыто финальными unit/contract suites. Vendor/model endpoints здесь — offline
  fixtures, не paid/live acceptance;
- production server build/lint, UI typecheck/lint/build и lockfile check прошли;
- SIGTERM/SIGINT lifecycle smoke: exit 0;
- Chromium regression: 17 passed, без test retries; hooks settings, feature
  create/edit, provider statuses, credentials/consent и held agent chat;
- все три inventories обновлены и прошли `:check`; полный `format:check` и
  `git diff --check` успешны. Первоначальный format check обнаружил formatting нового
  contract file; повтор после форматирования прошёл.

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
