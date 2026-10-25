# Этап 10. Cutover и production hardening

## Цель

Удалить legacy composition, закрыть временные compatibility layers и доказать,
что Nest backend пригоден для production во всех поддерживаемых режимах запуска.

## 10.1. Legacy removal

- [x] Route inventory показывает Nest owner для каждого endpoint.
- [x] Удалить legacy router module/middleware.
- [x] Удалить Express route factories и неиспользуемые common helpers.
      Все 83 оставшихся test-only файла `src/routes` и старый helper удалены
      в [проверенном wave17 checkpoint](artifacts/legacy-retirement-logging-checkpoint.md).
- [x] Удалить старый `src/index.ts` из production build.
- [x] Удалить wrapper providers, которые только выдавали legacy instances.
- [x] Удалить singleton getters и side-effect registration. Native providers
      регистрируются явно; последние managed dev/test getters и WeakMaps удалены.
      См. [source-port checkpoint](artifacts/source-ports-and-locators-checkpoint.md).
- [x] Удалить временные feature flags/route ownership registry. В runtime config,
      bootstrap и module composition переключателей legacy ownership нет;
      generated inventory остаётся проверяемой документацией.
- [x] Проверить отсутствие imports из удалённых paths.

Express остаётся transitive platform через `@nestjs/platform-express`; удаляется
ручная Express composition, а не сам adapter.

Актуальный исходный код: production `LegacyModule`, `src/index.ts`, service
container/tokens, startup/shutdown bridge и каталог `src/routes` удалены.
Все 318 HTTP operations принадлежат native controllers. Wave17 переводит последние
характеризационные tests на настоящий Nest HTTP и удаляет 83 test-only route files.
Генератор inventory больше не разбирает legacy routers; architecture guard
проверяет отсутствие каталога и его transitive imports.
[Общий build/test checkpoint wave17](artifacts/legacy-retirement-logging-checkpoint.md)
прошёл; остальные acceptance gates остаются отдельными требованиями.

Предыдущие проверенные срезы:
[native cutover](artifacts/native-cutover-checkpoint.md),
[native lifecycle](artifacts/native-lifecycle-cutover-audit.md),
[source ports](artifacts/source-ports-and-locators-checkpoint.md) и
[transport/terminal/metrics](artifacts/transport-context-terminal-observability-checkpoint.md).
Их результаты относятся к указанным там commits. Исторические descriptions
compatibility adapters и retained routes не описывают текущую composition.

Production lifecycle smoke выполняется `npm run smoke:server:lifecycle`.
Последний завершённый checkpoint подтверждает SIGTERM/SIGINT exit 0 и idle budget;
это не свежая проверка Docker/Electron artifacts или sustained workload.

## 10.2. Dependency rules

Добавить CI/ESLint checks:

- controllers не импортируются services/providers;
- domain/application не импортирует Nest/Express;
- modules не обходят public exports соседнего модуля;
- providers не импортируют routes;
- нет прямого `process.env` вне config bootstrap;
- нет module-level service instances;
- нет shell execution в controllers;
- нет циклических module imports без утверждённого ADR.

Текущая автоматическая защита уже запрещает service/controller/route imports,
controller shell/FS imports, service locator getters и module-level `*Service`
instances; source/build guards запрещают возврат legacy handlers. Чтение ambient
`process.env`/`process.cwd()` запрещено в `core`/`modules` (кроме config parser).
Это **не** полный набор правил выше: ограничение не охватывает все `services` и
`providers`; framework-free application/domain, public exports соседних модулей и
проверка provider DI graph ещё требуют отдельного решения/проверки.
Явный граф импортов Nest проверяется автоматически:40модулей,52ребра и
5динамических фабрик;циклов нет. Неизвестная композиция завершает проверку
с ошибкой. См.
[module graph audit](artifacts/nest-module-import-graph-audit.md).
Native Local execution теперь использует application snapshot:
[checkpoint](artifacts/local-runtime-http-errors-checkpoint.md). Dev/Test spawns,
legacy Direct workspace policy и FSM notification ownership затем исправлены и
прошли [следующий checkpoint](artifacts/fsm-direct-policy-process-checkpoint.md).
Оставшиеся MCP/config/helper boundaries проверяются отдельно.

## 10.3. Production configuration

- [x] Fail-fast validation обязательных variables. Runtime config разбирается
      до создания Nest/HTTP resources; invalid ports, booleans и preview ranges
      отклоняются. Provider credentials намеренно необязательны.
      [Config tests](../../apps/server/tests/unit/core/runtime-config.test.ts).
- [x] Зафиксировать proxy/trust policy: `trust proxy=false`, forwarding headers
      не меняют peer identity; HTTPS termination и ingress rate limits описаны
      в [deployment policy](../backend-architecture.md#deployment-http-policy).
      Настройка конкретного внешнего ingress остаётся deployment acceptance.
- [x] Проверить текущие CORS/local-origin и private-network semantics:
      11 actual HTTP cases в `deployment-http-policy.contract.test.ts`;
      private-network permission header не выдаётся, private IPv4 origins
      сохраняют историческое разрешение. Это не exclusive allowlist.
- [x] Cookie secure/same-site policy по deployment mode. Уже проверены
      HttpOnly, SameSite=Lax и Secure при NODE_ENV=production:
      [auth service](../../apps/server/tests/unit/core/auth-service.test.ts).
      Actual HTTP проверяет production cookie при spoofed forwarding headers;
      внешний HTTPS proxy/browser остаётся отдельным deployment acceptance.
- [x] Request/body/download limits. Реальный HTTP body >50 MiB получает 413;
      binary descriptors ограничивают stream size; download quota/invalid metadata
      отклоняются до headers/pipe. См.
      [HTTP middleware](../../apps/server/tests/contract/nest-shell.contract.test.ts),
      [binary responses](../../apps/server/tests/contract/files-binary-responses.contract.test.ts)
      и [download cancellation/cleanup](../../apps/server/tests/contract/download-filesystem.contract.test.ts).
      Эти limits не являются sustained workload acceptance.
- [x] WebSocket origin/auth policy. Preview origins отклоняются; одноразовые
      tokens/auth проверяются отдельно от HTTP CORS. Историческая совместимость
      не вводит exclusive allowlist для остальных WS Origins; policy явно
      описана в [deployment policy](../backend-architecture.md#deployment-http-policy).
- [ ] Secrets redaction и file permissions.
- [x] Liveness/readiness probes. Native HTTP проверяет public live/ready,
      protected detailed health и ready=503 при stopping; liveness остаётся 200.
      [Core HTTP contract](../../apps/server/tests/contract/core-response-contracts.contract.test.ts).
- [ ] Graceful shutdown в Docker stop timeout.

## 10.4. Performance

- [x] Сравнить startup/RSS/latency с baseline.
- [x] Проверить large feature lists, event streams и terminal output.
- [ ] Проверить provider streaming без двойной serialization.
- [x] Найти случайные request-scoped heavy dependencies. В native composition
      нет `Scope.REQUEST`/request-scoped providers; owners остаются application-scoped.
- [x] Проверить file descriptors и child processes после repeated workflows.
- [x] Установить budgets и regression thresholds в CI/benchmark job.

## 10.5. Security review

- [x] Auth bypass на public metadata и route inheritance.
      Проверены actual Nest HTTP inheritance/explicit false override/protected siblings
      и текущий production public inventory без controller inheritance:
      [contract](../../apps/server/tests/contract/auth-metadata-inheritance.contract.test.ts).
- [ ] Path traversal/symlink/remote alias boundary.
- [x] CSRF/content-type/cookie behavior. Actual HTTP проверяет credentialed
      preflight, production cookie и 415 для form/multipart/text; новый token
      protocol не вводится при сохранении существующего API.
- [x] WebSocket token reuse и expiry. Настоящий upgrade принимает one-time
      token один раз, повторный/expired получает 401; app/restart isolation проверена.
      [WebSocket contract](../../apps/server/tests/contract/websocket-transport.contract.test.ts),
      [auth isolation](../../apps/server/tests/contract/auth-isolation.contract.test.ts).
- [ ] Command injection в Git/provider/execution paths.
- [ ] SSRF через preview/MCP/provider endpoints.
- [ ] Secret leakage в DTO, exceptions и logs.
- [ ] Cleanup ownership Docker/SSH/PTY resources.

Уже существующие security evidence с более узким scope, чем общий review:

- Protected HTTP inventory целиком получает 401 без credentials; public routes
  сохраняют назначение. [Nest HTTP contract](../../apps/server/tests/contract/nest-shell.contract.test.ts).
  Inherited `@Public()` metadata отдельно проверена в указанном выше contract.
- Canonical roots, sibling prefixes, revoked access, escaped/dangling symlinks и
  queued parent retargeting покрыты [path-policy units](../../apps/server/tests/unit/core/native-path-policy.test.ts)
  и [two-app HTTP/FS contract](../../apps/server/tests/contract/native-path-policy.contract.test.ts).
  Native managed target tokens/pins и отсутствие Local fallback проверяются
  [SSH Git acceptance](../../apps/server/tests/unit/routes/environment-git.test.ts).
  Эти suites не заменяют аудит каждого command/transport path.
- HTTP/WS preview-origin denial и malformed origins проверены
  [preview contract](../../apps/server/tests/contract/preview-policy-isolation.contract.test.ts);
  API key/cookie/token precedence — [request-context contract](../../apps/server/tests/contract/request-context.contract.test.ts).
  Общие CORS/private-network и proxy/CSRF deployment combinations ещё не закрыты.
- Unexpected exception diagnostics не пишут raw secret/prompt text:
  [confidentiality units](../../apps/server/tests/unit/core/exception-log-secrets.test.ts).
  Auth key/session/cache имеют private file modes на поддерживающей их OS:
  [native storage contract](../../apps/server/tests/contract/native-auth-cache-filesystem.contract.test.ts).
  Полный review всех DTO/provider/log paths остаётся отдельной задачей.

В первоначальном документальном аудите новые tests не запускались: ссылки ведут к уже
существующим исполняемым проверкам и сопоставлены с текущей реализацией.
Свежий общий checkpoint wave17 прошёл; его результаты приведены в ссылке выше.

## 10.6. Packaging acceptance

### Standalone/Web

- setup/login/project/board/agent/terminal smoke;
- restart/recovery;
- production build without dev dependencies.

### Docker

- clean install and upgrade with existing data volume;
- health/readiness;
- SIGTERM shutdown;
- no permission regression.

### Electron

- server bundle install;
- native `node-pty` rebuild;
- dynamic port/startup detection;
- app close cleanup;
- packaged macOS/Windows/Linux smoke where runners are available.

## 10.7. Rollout plan

1. Internal development artifact.
2. Automated migration/contract suite.
3. Canary with copied non-sensitive project data.
4. Opt-in prerelease channel.
5. Staged production release.
6. Monitoring window без удаления rollback artifact.
7. Объявление завершения после успешного upgrade/restart/Electron evidence.

Storage migrations должны быть backward-readable либо сопровождаться backup и
отдельным downgrade warning. Nest cutover сам по себе не требует изменения storage.

- [x] Реализовать и проверить downgrade preflight для interrupted queue deliveries
      и `agent-session-deletions` tombstones, а также pending `agent-executions`
      terminal intents/running records. Backend, игнорирующий эти markers,
      нельзя запускать против несовместимого DATA_DIR: незавершённый cleanup или
      stale backups не должны воскресить удалённые сессии, а quarantined prompts
      не должны попасть в автоматическое выполнение. Проверить отказ небезопасного
      запуска и согласованный snapshot/явное преобразование перед downgrade.

      Реализованы standalone read-only preflight и offline full-snapshot restore
      fixture: [исполняемые tests](../../scripts/tests/backend-downgrade.test.mjs),
      [audit](artifacts/downgrade-preflight-audit.md),
      [операционная процедура](../backend-storage-downgrade.md).
      Проверка конкретного старого artifact на staging остаётся частью rollout.

## Оставшиеся acceptance gates на текущем срезе

- После следующих production изменений повторить artifact acceptance. Для backend
  commit `86afe69c` свежие Web/Docker/Linux Electron artifacts уже проверены:
  [checkpoint](artifacts/current-artifact-acceptance-checkpoint.md).
- Private existing-volume upgrade/restart и snapshot rollback с выбранным старым
  artifact прошли [реальную проверку](artifacts/backend-upgrade-acceptance.md).
  Реальный operator/staging DATA_DIR и иные старые releases этим не проверены.
- Sustained feature/event/provider/PTY workload и повторные workflows с проверкой
  файловых дескрипторов и owned child processes. Idle budgets уже действуют,
  sustained workload SLO ими не определяется.
- Полная security/deployment matrix: proxy, cookie/CORS/CSRF и поддерживаемые
  execution transports. Имеющиеся negative contracts закрывают конкретные paths,
  но не позволяют автоматически отметить весь security review выполненным.
- macOS/Windows packaged/process ownership acceptance на доступных OS runners;
  Linux evidence не объявляется проверкой этих систем.
- Сверка полного набора dependency rules, operational docs и rollout evidence.
  Canary/prerelease/production rollout требуют соответствующей среды и отдельного
  разрешения; локальная проверка не считается внешним deployment.

## 10.8. Документация

- [x] README commands и prerequisites.
- [x] Backend module architecture.
- [x] Добавление controller/provider/module. См. «Adding behavior» в
      [архитектуре backend](../backend-architecture.md).
- [x] Contracts и error format.
- [x] Config/environment reference. Таблица typed bootstrap variables и defaults
      в [runtime reference](../backend-architecture.md#runtime-configuration-reference).
- [x] Testing tiers.
- [x] WebSocket protocols.
- [x] Startup/shutdown lifecycle. Admission/drain/FS barrier и unknown outcomes
      описаны в [lifecycle](../backend-architecture.md#lifecycle).
- [ ] Electron/Docker packaging.
- [x] Troubleshooting и rollback.

## Срез hardening: recovery при ошибке загрузки UI до React bootstrap

Во время acceptance этапа 7 повторялся HTML `Loading…` до открытия Agent view.
Разбор `/tmp/automaker-usage-env-chat-loading-trace.zip` выявил конкретные console
errors `net::ERR_NETWORK_CHANGED`, а не только незавершённые network snapshots.
При abort module graph браузер оставлял исходный HTML spinner: React и его error
boundary ещё не успевали запуститься. Новый regression test сначала воспроизвёл
бесконечный spinner на старой версии; trace —
`/tmp/automaker-bootstrap-before-trace.zip`.

Chromium действительно может сбрасывать connections при IP-address change:
[primary implementation change](https://chromium.googlesource.com/chromium/src/+/5713c0915ae0910437e2071c7862eb2009246615%5E%21/).
Одновременный Docker acceptance — вероятный источник таких notifications на этом
runner, но Docker→конкретный OS notification не измерен и не объявляется доказанным.
Chromium теперь проверяется отдельно от network-mutating acceptance. Задержки
Vite и прочие причины UI loading не считаются автоматически устранёнными.

В `index.html` установлен независимый inline guard до bundled entry. Capturing
resource error для module script показывает static EN/RU alert и Reload вместо
spinner. Если body ещё не существует, показ откладывается до DOMContentLoaded.
После передачи страницы React guard не меняет DOM. Optional image/classic-script
errors не превращаются в bootstrap failure. Raw error/URL/stack не отображаются.
Нет auto-reload, retry loop, очистки storage или отправки credential commands.
Повторная загрузка выполняется только пользователем. Это не таймер: медленная
загрузка без ошибки не объявляется failed.

Проверки используют реальные browser abort entry/dependency, localization и
неудавшийся optional image. После manual Reload приложение действительно
монтируется, а marker localStorage сохраняется. Marker устанавливается один раз
после failure, не пересоздаётся init script на reload, поэтому тест не маскирует
удаление storage. Восемь unit исполняют настоящий inline guard в отдельном DOM,
включая early-head failure, blocked storage, duplicate errors и late failure после
React ownership.

`npm run test:ui:bootstrap` собирает UI и выполняет отдельный production artifact
smoke. Собранные HTML/modules обслуживает owned loopback fixture: сначала JS
возвращает HTTP 503, затем Reload загружает настоящие assets. Fixture блокирует
внешние origins и возвращает API 503 вместо подключения к реальному backend.
Проверены moved-to-head bundled entry, failure alert, отсутствие auto-navigation,
восстановление React и сохранение storage. Browser/server закрываются в finally.
Это не packaged Electron smoke и не проверка PWA/service-worker recovery.

Checkpoint среза:

- 8 новых guard unit tests; `npm run test:packages`: 1457 passed.
- `npm run test:server:unit`: 3549 passed, 40 existing skipped.
- `npm run test:server:contract`: 279 passed.
- Chromium Agent/Running Agents + bootstrap recovery: сначала 6 passed, затем
  отдельный `--repeat-each=5 --workers=1 --trace=on` — 30 passed без test retries.
  Проверялись оба module abort, explicit reload, EN/RU и optional image failure.
- `npm run test:ui:bootstrap`: production build + owned 503/recovery smoke успешны;
  финальный повтор `node apps/ui/scripts/smoke-bootstrap-recovery.mjs` успешен.
  UI build также собрал Electron main/preload, но это не packaged acceptance.
- UI lint, UI typecheck, lockfile, formatting/diff и три inventory checks: успешно.
- Backend source не менялся относительно `446320bc`; Docker/SSH acceptance этого
  commit не запускались одновременно с Chromium. Их результат из предыдущего
  среза остаётся отдельной записью, а не новым измерением текущего среза.
- Один служебный browser запуск из root без UI config был остановлен; он не
  использован как acceptance evidence. Валидные browser запуски выполнялись из
  `apps/ui` с штатным config. Guard unit harness использует Node URL constructor,
  чтобы Vite не превращал путь к HTML fixture в browser asset URL.

Этап 10 не объявляется завершённым; этот срез устраняет конкретный дефект,
обнаруженный acceptance незавершённого этапа 7. Остальные cutover, security,
packaging и stage gates остаются обязательными.

## Exit criteria

- Legacy bridge и production legacy entrypoint удалены.
- Полная test/packaging/security matrix проходит.
- Нет необъяснённой performance/resource regression.
- Upgrade существующей установки подтверждён.
- Rollback procedure проверена на staging.
- Operations/development documentation соответствует коду.
- Финальный checkpoint этапа 10 успешно выполнен для Web, Docker и Electron;
  результаты зафиксированы завершающим cutover-коммитом в migration-ветке.

## Сверка evidence после source checkpoint wave21

Workload/performance пункты выше подтверждены
[реальными repeated workflows](artifacts/workload-acceptance.md) и
[последним source checkpoint](artifacts/mcp-checkpoints-correlation-checkpoint.md):
100 features, 300 mutations, 100 events/5 connections, 11 PTY cycles, стабильные
FD и отсутствие owned children; startup/RSS/latency budgets выполняются. Это
ограниченный воспроизводимый workload, а не новый production SLO. Документация
API, архитектуры, testing tiers, WebSocket и downgrade уже существует и сверена
с соответствующими checkpoint. Packaging снова проверяется после последнего
production изменения; старые артефакты не объявляются текущими.
