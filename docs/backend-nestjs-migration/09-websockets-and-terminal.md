# Этап 9. WebSocket events и terminal

## Сверка текущего прогресса — 2026-10-25

Native WS/terminal lifecycle и wire parity подтверждены
[audit этапа 9](artifacts/stage-9-completion-audit.md),
[terminal host configuration](artifacts/terminal-host-configuration-audit.md) и
[завершённым source checkpoint](artifacts/local-runtime-http-errors-checkpoint.md).
Последний включает bounded local workload: 100 WS events, 11 PTY cycles,
FD/child identity checks. Это не WAN slow-client stress или Windows/macOS ownership
acceptance. [Linux packaged evidence](artifacts/current-artifact-acceptance-checkpoint.md)
относится к указанному там artifact; после финальных изменений потребуется refresh.
Открытый ниже composite item разделяется: host/RC port уже реализован, остаются
полный platform helper audit и transport stress/conditional OS gates.

## Цель

Передать Nest lifecycle владение WebSocket upgrade, authentication, connections,
broadcasting и terminal sessions, сохранив существующий wire protocol.

## Основное решение

Не заменять raw `ws` на Socket.IO. Для `/api/events` может подойти стандартный
Nest `WsAdapter`, но `/api/terminal/ws` имеет собственные сообщения, PTY semantics
и authentication. Допустим custom adapter либо lifecycle-managed raw `ws` provider,
подключённый к тому же HTTP server через `HttpAdapterHost`.

Решение принимается отдельным ADR после прототипа и contract tests. Framework purity
не является причиной ломать совместимость.

## Текущий статус checklist

Отмеченные пункты ниже подтверждены native source и contracts, а не только наличием
плана. Владение и проверки сопоставлены в
[audit этапа 9](artifacts/stage-9-completion-audit.md); более поздние результаты
[artifact checkpoint](artifacts/state-execution-contract-checkpoint.md) подтверждают
реальные Local/Docker/SSH и Linux packaged Electron проверки. Исторический срез
2026-10-24 в конце документа сохраняет результаты того запуска. Результаты wave 8 фиксируются основным агентом отдельно и не подменяют
эти результаты artifact acceptance.

Следующий срез реализовал подтверждение explicit stop/unknown и scoped native
preflight рабочего каталога; см. [stop/preflight audit](artifacts/terminal-confirmed-stop-audit.md).
Полный transport stress/backpressure и оставшиеся terminal environment/theme IO
этим срезом не закрываются. Старые замечания audit о сохранённом
`getTerminalService` больше не описывают текущий source: getter удалён; боевой
lifecycle bridge также удалён, см.
[native cutover](artifacts/native-cutover-checkpoint.md).

## 9.1. Общий WebSocket infrastructure

- [x] Получать underlying HTTP server после Nest initialization.
- [x] Создать единый upgrade router по pathname.
- [x] Выполнять connection-level auth до передачи socket handler.
- [x] Ограничить handshake/query/header sizes.
- [x] Добавить connection ids и correlation logging.
- [x] Централизовать ping/pong, idle timeout и close codes.
- [x] Реализовать bounded send queue/backpressure policy.
- [x] Закрывать upgrades во время shutdown.

## 9.2. Events gateway

- [x] Подписываться на typed EventBus.
- [x] Сохранить текущий JSON event envelope и ordering.
- [x] Изолировать slow/broken client.
- [x] Отписывать socket при close/error.
- [x] Проверить multiple clients и reconnect.
- [x] Не хранить неограниченную replay history в gateway.
- [x] Event replay использовать через EventHistoryModule.

## 9.3. TerminalModule

- [x] Превратить `TerminalService` singleton factory в Nest provider.
- [x] Разделить REST session management, PTY supervisor и WS transport.
- [x] Сохранить session limits и password/token checks.
- [x] Сохранить input/resize/ping message formats.
- [x] Поддержать несколько connections к одной session.
- [x] Очистить connection metadata после реального session exit.
- [x] Сохранить reconnect без повторного startup command.
- [x] Сохранить target metadata и immutable execution binding.
- [x] Не создавать environment при обычном просмотре terminal layout.

## 9.4. Managed remote terminal

- [x] Local PTY и Docker/SSH framed transport реализуют единый port.
- [x] Heartbeat loss не считается подтверждённым завершением remote process.
- [x] Backend restart не replay startup command.
- [x] Close browser tab не обязательно завершает shared terminal session.
- [x] Explicit delete/stop подтверждает cleanup либо возвращает unknown state.
      DELETE ждёт исходную PTY/group; при неподтверждённом cleanup — 503 с
      сохранением identity. UI не удаляет failed panels и не пересоздаёт unknown.

### Terminal runtime boundaries

- [x] Довести explicit stop до подтверждённого cleanup либо явного unknown результата
      в HTTP и UI. Native controller вызывает awaited `stopSession`; совместимый
      boolean `killSession` остаётся для прежних внутренних callers. Actual PTY,
      held cleanup, failed cleanup/retained identity и UI single/tab/restore
      scenarios проверены в новом срезе.
- [x] Передать native TerminalService явные application-owned filesystem/path/home
      ports для preflight рабочего каталога. Native factory передаёт scoped FS,
      SecurityService, RuntimePaths и snapshot home. Даже fallback проверяется
      policy и stat; denied/EIO не запускают PTY. При отсутствующем/недоступном
      HOME выбирается разрешённый root/working directory, без ambient home.
- [ ] Завершить остальные terminal environment/theme/profile IO boundaries и
      transport stress/backpressure acceptance. Preflight port не означает,
      что все platform helpers TerminalService уже application-owned.

## 9.5. Shutdown

Порядок:

1. Отклонить новые upgrades.
2. Отправить service-closing event, если protocol это допускает.
3. Прекратить приём terminal input.
4. Закрыть/остановить owned sessions по текущей policy.
5. Дождаться bounded cleanup.
6. Закрыть WS servers и underlying HTTP server.

Реализация: `WebSocketTransportService.onModuleDestroy` закрывает admission/input,
отправляет close 1012 и ограничивает WS drain; application lifecycle отдельно ждёт
TerminalService.cleanup, а shared HTTP adapter подтверждает закрытие собственных
sockets. `terminal-drain`, `terminal-closing-admission`, `shutdown-failure-signal`
contracts и `shared-http-server-adapter` units проверяют actual/failed cleanup и
последующие hooks. Transport close не считается отменой незавершённой FS операции.

## Тесты

- Upgrade auth matrix: cookie/API key/one-time token/expired token.
- Malformed URL/message/frame.
- Events ordering и subscriber failure.
- Slow client/backpressure.
- Terminal input/resize/ping/output/exit.
- Multiple viewers и reconnect.
- Session exit против socket close.
- Local/Docker/SSH terminal.
- Backend restart и shutdown deadline.
- Electron renderer connection.

## Rollout

Events и terminal не переключаются одним неделимым коммитом. Переключение идёт
последовательными коммитами в общей migration-ветке:

1. Nest-owned HTTP server + старые WS servers.
2. Общий upgrade/auth infrastructure.
3. Events gateway.
4. Terminal REST controllers.
5. Terminal WS transport.
6. Удаление raw setup из legacy bootstrap.

После шага 6 выполняется полный checkpoint этапа с HTTP/WS contracts, reconnect,
shutdown и Local/Docker/SSH terminal tests. Следующий этап до него не начинается.

## Exit criteria

- Оба WS endpoint не зависят от legacy `index.ts`.
- Wire compatibility suite проходит без изменений клиента.
- Нет connection/subscriber/session leaks.
- Terminal сохраняет Local/Docker/SSH behavior.
- Shutdown закрывает WS и PTY resources в пределах deadline.
- Полный checkpoint этапа 9 успешно выполнен и зафиксирован завершающим коммитом
  в единственной migration-ветке.

## Срез 2026-10-24: подтверждённый terminal drain и результат shutdown

Это промежуточный срез, не завершение этапа 9. Native TerminalRuntimeModule уже
владеет TerminalService (ADR-033); текущие изменения закрывают active-session
cleanup, который прежний idle lifecycle checkpoint не доказывал.

### Владение и завершение sessions

- TerminalSessionLifecycle владеет подтверждением выхода каждой PTY. `killSession`
  по-прежнему возвращает boolean принятия запроса, а не доказательство cleanup.
  Удаление session по таймеру без подтверждения выхода больше не выполняется.
- В Linux до публикации локальной PTY проверяются PPID, starttime и собственные
  process group/session. Реальный `forkpty` возвращается в родительский процесс
  раньше обязательного завершения `login_tty`/`setsid` в дочернем: readiness ждёт
  только ту же генерацию child, не присваивает владение повторно использованным PID.
- TERM и KILL отправляются только исходной проверенной process group.
  Read-only `/proc` observer ждёт также остальные job-control groups исходной
  session; обнаружение их ID не даёт права посылать им сигналы. Живые дополнительные
  groups означают неподтверждённый cleanup, а не ложный успех.
- Пустое чтение procfs при исчезновении task не считается доказательством выхода:
  выполняется повторное read-only наблюдение в пределах исходного deadline.
  Завершённые zombie/dead tasks не считаются работающим процессом; внешний reaper
  не принадлежит приложению.
- Локальное завершение ограничено 3.5 s, с TERM→KILL escalation до 1 s;
  managed transport — 22 s и обязательным target `exitConfirmed`.
  Потеря transport не подтверждает остановку remote process: exit 255 уведомляет
  subscribers, но неизвестная session identity сохраняется.
- Async `TerminalService.cleanup()` идемпотентен, закрывает admission/input/resize,
  запускает sibling cleanup, ждёт уже принятые creations, включая позднюю PTY,
  и ограничивает общий drain 25 s. Неуспешная очистка сохраняет identity и возвращает
  статическую `TERMINAL_CLEANUP_FAILED`, без raw process/provider diagnostics.
- GET известной закрывающейся/неподтверждённой session возвращает 503 `UNAVAILABLE`;
  WS отклоняет подключение с 4005 до `connected` и startup handshake. Такая session
  не создаётся заново, startup command не replay-ится. API остаётся v13: DTO shapes,
  execution binding и persisted formats не меняются.

### Проверяемый Nest shutdown

Установленный Nest 12 логирует ошибки lifecycle hooks и продолжает shutdown, поэтому
одного успешного `app.close()` недостаточно для подтверждения cleanup. Новый
`manageApplicationShutdown` сохраняет вызов последующих hooks, но собирает сам факт
ошибки и отклоняет публичный `app.close()` статической `APPLICATION_CLEANUP_FAILED`.
Повторный close использует тот же результат, без повторного выполнения hooks.

Signal handlers используют этот же checked close: SIGTERM/SIGINT завершают процесс
с 0 только при успехе, с 1 при ошибке; watchdog ограничен 30 s. Ошибка terminal
cleanup не пропускает последующий provider cleanup. Это описано в ADR-034.

### Доказательства и границы

- `terminal-drain.contract.test.ts`: реальная Nest app и реальная `/bin/sh` PTY
  с owned Node fixture, TERM-resistant root/child; close ждёт остановки, запрещает
  новую session и удаляет старую identity только после подтверждения.
- `terminal-pty-ownership.test.ts`: до-setsid readiness и изменение PID generation
  без отправки сигнала новому процессу.
- `linux-process-session.test.ts`: дополнительные группы, kernel SID 0 и пустой
  procfs read; наблюдение не посылает terminating signals обнаруженным IDs.
- `terminal-session-lifecycle.test.ts`, `terminal-service.test.ts`: deadlines,
  escalation, удержание unknown identity, late creation и managed transport loss.
- `terminal-closing-admission.contract.test.ts`: реальные HTTP/WS gates и отказ
  close при ошибке cleanup, с проверкой последующего provider cleanup.
- `shutdown-failure-signal.contract.test.ts`: отдельный server process получает
  SIGTERM и выходит с 1 только после выполнения provider cleanup, без private error
  в stderr. `application-shutdown.test.ts` проверяет dedup/receiver/idempotence.

Проверки текущего среза:

- `npm run test:server:unit`: 3599 passed, 40 skipped;
- `npm run test:server:contract`: 316 passed;
- `npm run test:packages`: 1473 passed;
- server production build, server/UI lint, UI typecheck и UI build прошли;
- Docker acceptance с owned image `automaker-nest-stage2-smoke:latest`: 11 passed,
  4 opt-in skipped; managed SSH terminal: 7 passed;
- `node scripts/smoke-server-lifecycle.mjs`: SIGTERM и SIGINT, exit 0.
- Chromium regression (hooks settings, feature create/edit, provider status,
  credentials/consent и held agent chat): 17 passed, без test retries;
- все три generated inventories обновлены и прошли `:check`.
- полный `npm run format:check` и `git diff --check` прошли. Исходная проверка
  обнаружила пять ранее неформатированных source/test files и generated Playwright
  auth state: первые исправлены только форматированием, `.auth/` добавлен в
  `.prettierignore` как генерируемый test artifact, уже исключённый из Git.

Во время chat reload браузерный runner дважды вывел Vite WS proxy `ECONNRESET`;
17 tests прошли, но источник proxy reset не установлен и не объявляется исправленным.

Первый lint текущего среза выявил пустой catch; после пояснения error precedence
повторный lint прошёл. В предыдущем общем запуске real-PTY contract дал unknown
cleanup: установленный forkpty race и пустой procfs read защищены отдельными
regressions, но точная причина той единственной ошибки не установлена. Финальные
unit/contract suites прошли без увеличения timeout/retries тестов.

Этот срез не доказывает containment намеренного `setsid` escape, очистку всех
job-control groups сигналами, cross-platform process-tree drain или ownership
внешней environment. UI отображение сохранённого unknown state, полный transport
stress/backpressure и прочие gates этапов 7–11 остаются обязательными. Signal path
проверен для production-модели одной app в process; одновременные signal-enabled
Nest apps в одном process не сертифицированы. UI build не заменяет packaged
Electron acceptance на Linux/Windows/macOS.
