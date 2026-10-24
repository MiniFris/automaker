# Этап 10. Cutover и production hardening

## Цель

Удалить legacy composition, закрыть временные compatibility layers и доказать,
что Nest backend пригоден для production во всех поддерживаемых режимах запуска.

## 10.1. Legacy removal

- [x] Route inventory показывает Nest owner для каждого endpoint.
- [x] Удалить legacy router module/middleware.
- [ ] Удалить Express route factories и неиспользуемые common helpers.
- [x] Удалить старый `src/index.ts` из production build.
- [x] Удалить wrapper providers, которые только выдавали legacy instances.
- [ ] Удалить singleton getters и side-effect registration.
- [ ] Удалить временные feature flags/route ownership registry.
- [ ] Проверить отсутствие imports из удалённых paths.

Express остаётся transitive platform через `@nestjs/platform-express`; удаляется
ручная Express composition, а не сам adapter.

Промежуточный срез composition: `application-service.providers.ts` создаёт каждый
stateful service отдельным Nest factory provider с явным `inject`. Lifecycle adapter
получает готовые зависимости и больше не создаёт services. Local dev/test runners
и pipeline имеют отдельный экземпляр на приложение; их module-level signal handlers
удалены, cleanup выполняет application lifecycle. Contract двух Nest applications
подтверждает изоляцию экземпляров и shutdown. Compatibility tokens и startup/shutdown
adapter пока остаются и подлежат дальнейшему удалению. Checkpoint среза: server build,
lint, 2900 unit-тестов и 228 HTTP/WS contract-тестов.
Production lifecycle smoke выполняется командой `npm run smoke:server:lifecycle`:
реальные startup tasks, readiness, auth guard и завершение отдельных processes по
SIGTERM/SIGINT. Текущий benchmark использует Nest entrypoint и завершается естественно.
Числа и ограничения измерения записаны в `artifacts/performance-baseline.md`.

Последующий cleanup удалил неиспользуемые legacy routers context, enhance-prompt,
features, setup, GitHub, backlog-plan и app-spec, а также их неиспользуемые generation
handlers. Worktree router пока остаётся для adapter acceptance и получает registry
явно. Статический provider factory и compatibility `src/index.ts` удалены. Server
build очищает только генерируемый `apps/server/dist` перед `tsc`, поэтому удалённые
entrypoints и adapters не остаются в production artifact. Остальные legacy handlers,
service tokens и lifecycle adapter ещё требуют переноса.

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

## 10.3. Production configuration

- [ ] Fail-fast validation обязательных variables.
- [ ] Корректные proxy/trust settings для web deployments.
- [ ] CORS allowlist и private-network behavior.
- [ ] Cookie secure/same-site policy по deployment mode.
- [ ] Request/body/download limits.
- [ ] WebSocket origin/auth policy.
- [ ] Secrets redaction и file permissions.
- [ ] Liveness/readiness probes.
- [ ] Graceful shutdown в Docker stop timeout.

## 10.4. Performance

- [ ] Сравнить startup/RSS/latency с baseline.
- [ ] Проверить large feature lists, event streams и terminal output.
- [ ] Проверить provider streaming без двойной serialization.
- [ ] Найти случайные request-scoped heavy dependencies.
- [ ] Проверить file descriptors и child processes после repeated workflows.
- [ ] Установить budgets и regression thresholds в CI/benchmark job.

## 10.5. Security review

- [ ] Auth bypass на public metadata и route inheritance.
- [ ] Path traversal/symlink/remote alias boundary.
- [ ] CSRF/content-type/cookie behavior.
- [ ] WebSocket token reuse и expiry.
- [ ] Command injection в Git/provider/execution paths.
- [ ] SSRF через preview/MCP/provider endpoints.
- [ ] Secret leakage в DTO, exceptions и logs.
- [ ] Cleanup ownership Docker/SSH/PTY resources.

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

- [ ] Реализовать и проверить downgrade preflight для interrupted queue deliveries
      и `agent-session-deletions` tombstones, а также pending `agent-executions`
      terminal intents/running records. Backend, игнорирующий эти markers,
      нельзя запускать против несовместимого DATA_DIR: незавершённый cleanup или
      stale backups не должны воскресить удалённые сессии, а quarantined prompts
      не должны попасть в автоматическое выполнение. Проверить отказ небезопасного
      запуска и согласованный snapshot/явное преобразование перед downgrade.

## 10.8. Документация

- [ ] README commands и prerequisites.
- [ ] Backend module architecture.
- [ ] Добавление controller/provider/module.
- [ ] Contracts и error format.
- [ ] Config/environment reference.
- [ ] Testing tiers.
- [ ] WebSocket protocols.
- [ ] Startup/shutdown lifecycle.
- [ ] Electron/Docker packaging.
- [ ] Troubleshooting и rollback.

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
