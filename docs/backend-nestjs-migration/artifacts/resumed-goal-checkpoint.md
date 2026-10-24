# Возобновлённая миграция: первый общий checkpoint

Ветка: `refactor/backend-nestjs-migration`. Исходный commit: `29902933`.
Это проверенный срез изменений, а не объявление завершения этапов 7–11.

## Выполненные изменения

- Ограничена очередь application-scoped filesystem; shutdown прекращает приём,
  отклоняет ожидающие операции и явно сообщает о незавершённом активном I/O.
  Отдельно ограничены и дренируются файловые commands.
- Пассивные статусы провайдеров отделены от явной проверки аутентификации;
  обновлены UI и contract fixtures без предположения об авторизации по наличию CLI.
- Pipeline configuration использует scoped repository с сериализацией изменений;
  orchestration consumers получают один native PipelineService.
- MCP connection handshake отделён от явного получения инструментов, включая UI.
- WebSocket и HTTP transport ограничивают admission, размер и backpressure;
  закрывают собственные сокеты и сообщают о неподтверждённой очистке.
  Удалены девять неиспользуемых terminal route files; сохранён прежний HTTP 200.
- Исправлена production Docker сборка shared contracts и browser assets после
  удаления dev dependencies. Developer `.env` исключён из Electron artifact.
- Реальный Electron smoke обнаружил конфликт выбранных backend/static портов.
  Добавлены исключение backend порта и ограниченная проверка JSON health своего
  дочернего процесса, подтверждаемого launch UUID в защищённом response header.

Подробности и границы: [filesystem](filesystem-lifecycle-audit.md),
[providers](stage-7-completion-audit.md), [orchestration](stage-8-completion-audit.md),
[transports](stage-9-completion-audit.md), [production](stage-10-completion-audit.md).

## Результаты проверок

Команды выполнялись с Node 22.22.3, кроме production Docker image (22.23.4).
Docker/SSH задания закончены до запуска Chromium/Electron.

| Проверка                                                  | Результат                                                                     |
| --------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `npm run test:server:unit`                                | 3731 passed, 40 skipped                                                       |
| `npm run test:server:contract`                            | 360 passed, включая финальные startup-header contracts                       |
| `npm run test:packages`                                   | 1515 passed                                                                   |
| Full real SSH: feature, managed terminal, terminal worker | 32 passed                                                                     |
| Managed Docker                                            | 11 passed, 4 opt-in skipped                                                   |
| Chromium regression, один worker, retries 0               | 18 passed                                                                     |
| Production Docker build и изолированный smoke             | ready 200, protected 401, TypeScript отсутствует, SIGTERM exit 0              |
| Signal lifecycle smoke                                    | SIGTERM exit 0; SIGINT exit 0                                                 |
| Startup identity после packaged regression                | 12 UI unit + 3 native contract passed                                         |
| Linux packaged Electron после исправления                 | renderer mounted, ready 200, protected 401, native PTY exit 0, backend closed |

Первый полный contract запуск выявил две устаревшие test fixtures; первый SSH
запуск выявил реальный несовместимый POST 201. Исправления проверены повторно.
Два первых packaged Electron запуска не прошли: ошибка smoke selector и затем
конфликт портов. Они не считаются успешной acceptance.

Финальный Linux artifact пересобран после startup исправления; packaged smoke
прошёл вне monorepo с отдельным HOME и без пользовательских credentials. Electron
39.2.7 использует bundled Node 22.21.1; host build/checks — Node 22.22.3.
Production Docker smoke выполнен до последнего optional startup-header изменения;
сам header отдельно проверен тремя native contracts и новой Electron сборкой.
Server/UI lint, UI/server TypeScript и regenerated inventories проверены для
итогового source. Explicit `node:buffer` import после lint повторно проверен
port/probe unit tests; поведение не меняет.

Свежий локальный benchmark: import 509.7 ms, composition 61.2 ms, start 2.83 ms,
health p50 0.723 ms / p95 2.015 ms, RSS 196.9 MiB, shutdown 4.87 ms,
`activeResources: []`. Это измерение, а не доказательство нагрузочного бюджета.

## Следующий срез

Остаются исходные требования: ToolPolicy и Gemini enforcement, native AutoMode
use cases/coordinator, scoped filesystem для settings и остальных legacy writers,
удаление live legacy lifecycle bridge/getters, rollback preflight, dependency rules,
контракты/OpenAPI/клиент и остальные пункты этапа 11. Полные completion audits
содержат конкретные ограничения; промежуточный checkpoint их не закрывает.

Внешние vendor calls, публичный release и изменение production DATA_DIR этим
checkpoint не выполняются. macOS/Windows packaged acceptance условна наличием
соответствующих runners согласно исходному плану.
