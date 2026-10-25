# Native lifecycle, AutoMode и settings: общий checkpoint

Продолжение `170f0123` в единственной ветке `refactor/backend-nestjs-migration`.
Этот срез не закрывает автоматически все пункты этапов 7–11.

## Изменения

- Удалены `LegacyModule`, `LEGACY_APPLICATION`, `createLegacyApplication` и runtime
  `.legacy`. Startup/shutdown координируют реальные native providers; managed
  dev/test runtimes внедряются в worktree owner и cleanup owner через DI.
- Удалены import-side dotenv/path initialization/auth probes. Production library
  import не запускает сервер; CLI сохраняет явный запуск. Startup promises реально
  отслеживаются; позднее завершение после timeout/shutdown не запускает следующего
  владельца. Cleanup предпринимает все предусмотренные попытки и сохраняет failure.
- Все 17 AutoMode endpoints используют typed controller/application service.
  Canonical project contexts заменяют `Compat.facadeCache`; background commands
  ограничены, отслеживаются и дренируются до filesystem barrier. Удалены handler
  bag и 16 неиспользуемых route files, meaningful merge tests перенесены.
- Native settings используют scoped filesystem для чтений, директорий, backups,
  temp/rename и cleanup; целые mutations сериализуются по canonical key. Admission
  ограничен, shutdown ожидает принятые изменения. Query-triggered migration не
  перезаписывает concurrent command старым snapshot.
- Read-only ToolPolicy сохраняет `[]`, ограничивает delegation и получает planning
  intent также для local providers. Gemini явно отклоняет неподдерживаемые policy
  до discovery, записи `.geminiignore` и запуска CLI.

Подробности: [native lifecycle](native-lifecycle-cutover-audit.md),
[AutoMode](stage-8-auto-mode-audit.md), [settings](settings-filesystem-audit.md),
[ToolPolicy](stage-7-tool-policy-audit.md).

## Проверки

Итоговый общий checkpoint выполняется после целевых проверок владельцев.
Успешные результаты в этом срезе:

- Package/UI suite: **1519 passed**; UI typecheck/lint и shared package build passed.
- Backend units: **3770 passed, 40 skipped** на итоговом source.
- Backend contract suite: **372 passed** на итоговом source.
- Settings: **62 unit + 63 utility + 4 native contract passed**.
- ToolPolicy/Gemini: **130 unit + 3 contract passed**.
- Native lifecycle: **101 unit + 28 contract passed**, включая admission-order delta.
- Typed AutoMode: **84 unit + 9 merge + 3 native HTTP passed**.

Server build/lint, UI typecheck/lint, shared package build, monorepo formatting и
все три generated inventory checks passed. Lockfile check выявил SSH URL pinned
Electron node-gyp commit; URL нормализован в HTTPS без изменения commit/dependency
graph, затем check passed.

- Реальный SSH feature/managed terminal/worker: **32 passed**.
- Managed Docker: **11 passed, 4 opt-in skipped**. Первый запуск ошибочно использовал
  Node-only base image без Git/gosu; повторный запуск на локальном production image
  прошёл с неизменными assertions.
- Production Dockerfile build и fresh container smoke: ready 200, unauthorized
  detailed health 401, TypeScript и compiled legacy entrypoint отсутствуют,
  SIGTERM exit 0 (runtime Node 22.23.4).
- Linux packaged Electron заново собран после cutover: renderer mounted, readiness
  200, protected 401, native PTY exit 0, backend closed. Smoke запускается вне
  monorepo с отдельным HOME; runtime Electron Node 22.21.1.
- Production host signal smoke: SIGTERM exit 0 / 36.7 ms, SIGINT exit 0 / 33.2 ms.
- Benchmark: import 684.1 ms, composition 109.1 ms, start 2.79 ms, health p50
  0.682 ms / p95 2.379 ms, RSS 198.0 MiB, shutdown 7.02 ms, active resources `[]`.
  Это измерение на занятом runner, не утверждённый нагрузочный budget.

Chromium regression: **18 passed**, один worker, retries 0, 1.4 min. Первый запуск
остановился до тестов из-за занятого стандартного порта 3108. Для успешного запуска
выбраны свободные 34107/34108 без изменения или остановки чужого listener.

Первый общий contract запуск дал 369 passed / 3 failed: устаревшая проверка связи
controller → AutoMode facade, MCP lookup после закрытия filesystem и отказ уже
принятой credential-команды из-за слишком раннего закрытия settings queue. Проверка
DI обновлена; MCP проверяет admission до lookup; settings drain перенесён после
upstream credential drains и до filesystem barrier. Целевые 7 contracts и повторный
полный suite прошли. Ошибки не скрывались ослаблением assertions успешной записи.

## Известные ограничения и следующий срез

Gemini normal chat с explicit preset сейчас возвращает unsupported, поскольку
старый `--allowed-tools` не обеспечивает availability restrictions. Unrestricted
adapter path сохранён. Research выявил возможный version-bound путь для normal chat
через `v0.65.0 --admin-policy` с deny/allow TOML; CLI игнорирует supplemental policy
при наличии system policy files. Он ещё не реализован и не проверен установленным
CLI. `readOnly` по одному plan flag не гарантируется. См.
[policy loader](https://github.com/google-gemini/gemini-cli/blob/v0.65.0/packages/core/src/policy/config.ts)
и [mode selection](https://github.com/google-gemini/gemini-cli/blob/v0.65.0/packages/cli/src/config/config.ts).

Открыты исходные требования: production FeatureRunCoordinator/state machine и
защита от stale completion по run incarnation; полное удаление Compat/facade;
оставшиеся provider discovery/usage/consent/configuration цепочки; scoped download,
prompt и legacy Electron import; остальные filesystem consumers/coordination;
удаление оставшихся route factories/getters; rollback preflight, dependency rules,
performance budgets, contracts/OpenAPI/client и остальные пункты этапа 11.
Эти ограничения не скрываются успешными проверками текущего среза.

Конкретные следующие provider цепочки (read-only audit, не повторное открытие
ToolPolicy/status исправлений):

1. `/models/providers → ProviderRegistry.statuses` создаёт adapters и вызывает
   auth probes; заменить metadata/passive discovery без execution factories.
2. Gemini usage GET обновляет OAuth и пишет vendor credential file при истечении
   токена; passive read должен требовать повторную авторизацию без такой mutation.
3. Claude usage PTY самостоятельно отправляет Enter на trust prompt; вернуть
   существующий pending result без подтверждения за пользователя.
4. ProviderUsageService возвращает raw upstream error messages; заменить их
   фиксированной публичной mapping, сохранив established HTTP semantics.
5. ZAI configure активирует token до успешной persistence и создаёт отдельный
   emitter; сначала durable commit, затем activation и injected application event.
