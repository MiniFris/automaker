# Verification, legacy import, Gemini и CI: checkpoint

Исходный commit: `3fc08f47`; вся работа остаётся в
`refactor/backend-nestjs-migration`, без отдельных PR.

## Реализовано

- Run-bound port закрывает planSpec/tasks, summaries, output/raw output, stream
  events и model/provider metadata старого incarnation. Accepted writes используют
  ту же lane, что admission следующего запуска. Реальные fixtures проверяют
  A stop → B start → поздний A без изменения артефактов B.
- Production `/auto-mode/verify-feature` выполняет прежние четыре команды под одним
  lease, получает signal до preflight, переходит в testing и ожидается при shutdown.
  Local cancellation подтверждает завершение process group. Неизвестный cleanup
  сохраняет ownership вместо `passes:false`. Concurrent local verify теперь
  возвращает явный 409, согласуясь с exclusive remote admission; success shape прежний.
- Legacy Electron import использует snapshot config и узкий source port, private
  staging/journal, atomic no-overwrite links и initialization barrier. Settings
  публикуются последними. Partial publishing повторяется без исходного profile;
  ошибки импорта не превращаются в defaults/readiness success. Existing files и
  private modes сохраняются. Preflight учитывает новый pending import marker.
- Restricted normal Gemini chat восстановлен для проверенного CLI 0.65.0 с
  per-invocation admin policy. Version/help/system-policy checks обязательны;
  `[]`, MCP/delegation collision и cleanup проверены. Install guidance закреплён на
  той же shared version; server schema, UI fallback и Electron type согласованы.
  ReadOnly и неподдерживаемые launcher/platform условия явно отклоняются.
- Idle API budgets и dedicated CI job проверяют startup phases, p95 health, RSS,
  shutdown и resource delta. Положительный и намеренно превышающий RSS запуск
  проверены реально. Добавлены начальные static architecture guards и CI fixtures;
  Claude usage type больше не импортируется из routes.

Подробности: [artifact port](stage-8-run-artifact-port-audit.md),
[production verification](stage-8-verification-testing-audit.md),
[legacy import](legacy-profile-import-audit.md),
[Gemini policy](stage-7-gemini-restricted-chat-audit.md),
[budgets/boundaries](performance-budget-and-boundaries-audit.md).

## Итоговые проверки

| Проверка                                                    | Результат                                                                |
| ----------------------------------------------------------- | ------------------------------------------------------------------------ |
| Backend unit suite                                          | 3814 passed, 40 skipped                                                  |
| HTTP/WS contracts, включая owned actual Gemini distribution | 404 passed                                                               |
| Package/UI unit suite                                       | 1526 passed                                                              |
| Downgrade fixtures                                          | 36 passed                                                                |
| Budget / ESLint architecture fixtures                       | 10 + 5 passed                                                            |
| Real SSH feature/terminal/worker                            | 32 passed                                                                |
| Managed Docker                                              | 11 passed, 4 opt-in skipped                                              |
| Production Docker build/smoke                               | ready 200, protected 401, no TS/legacy entry, actual ZIP, SIGTERM 0      |
| Packaged Linux Electron                                     | renderer mounted, ready 200, protected 401, native PTY 0, backend closed |
| Chromium                                                    | 18 passed, workers 1, retries 0, 1.5 min                                 |

Server/shared build, server/UI lint, UI typecheck и форматирование прошли.
Generated inventories проверяются после окончательной записи evidence.
GUI acceptance выполнялась после завершения всех network-mutating jobs.

Final idle budget result (Node 22.22.3): import 979.3 ms, composition 125.8 ms,
listen 2.84 ms, health p95 6.08 ms, RSS 205,770,752 bytes, shutdown 6.99 ms,
unexpected resources `[]`; все budgets passed. Startup tasks в этом benchmark
отключены; отдельный production smoke проверил SIGTERM/SIGINT exit 0 за 33.7/21.3 ms.
Изолированный отрицательный budget fixture завершился с exit 1 и подтверждённым
cleanup при превышении RSS. Remote GitHub CI не запускался и push не выполнялся.

Artifact проверки выявили ENOSPC. Удалены только прежние smoke images этой
миграции и заново генерируемые Linux/server bundles; source и пользовательские
данные не затронуты. Сборка повторена успешно. Npm/browser caches теперь имеют
отдельные BuildKit mounts, сохраняя downloads при изменениях исходников/manifest.

Actual CLI acceptance использует owned `/tmp` npm fixture с blocked network и
private HOME; выполнены `--version`, `--help` и policy engine проверки. Auth/model
calls и установка CLI в профиль оператора не выполнялись.

## Оставшиеся исходные пункты

Полный goal не завершён. Следующие конкретные цепочки: native app-spec/backlog
workflow adapters и их route globals (RunningAgents всё ещё читает их), ideation
repository/conversion transaction и background drain, остальные default/global FS
consumers/getters и dead route factories. Также открыты оставшиеся dependency rules,
shared schema/OpenAPI/client decomposition, нагрузочные performance сценарии и
остальные пункты этапа 11. Initial CI guards не подменяют эти требования.

Gemini readOnly/launcher restrictions, недоступные platform runners и operational
old-binary/canary rollout не объявляются принятыми благодаря offline fixtures.
