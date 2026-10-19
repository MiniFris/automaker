# CLI/SDK execution environments — этапы 5.2a/5.2b/5.3a

Обновлено: 2026-10-17. Cursor, Gemini и OpenCode подключены к потоковому
Docker/SSH runtime. В 5.2b добавлены Claude/Codex/Copilot SDK и установка/target key
через [SDK setup](execution-environments-sdk.md). Live-model acceptance — ещё не выполнен.
В 5.3a Docker/Auto Kanban подключён к общему feature workspace и app services задач.

## Матрица

| Провайдер / workflow                   | Local                                                 | Managed Docker / Auto → Docker              | SSH                                                |
| -------------------------------------- | ----------------------------------------------------- | ------------------------------------------- | -------------------------------------------------- |
| Direct chat/tools                      | Да                                                    | Да                                          | Да                                                 |
| Direct Kanban/pipeline                 | Да                                                    | Да, pinned feature workflow                 | Да, remote feature workflow                        |
| Cursor/Gemini/OpenCode chat            | Прежний CLI, с сохранённой привязкой при явном выборе | Да, CLI внутри контейнера                   | Да, CLI в remote worktree                          |
| Cursor/Gemini/OpenCode Kanban/pipeline | Прежний workflow                                      | Да, context/tests/Verify/Commit/merge/hooks | Да, remote context/tests/Verify/Commit/merge/hooks |
| Claude/Codex/Copilot SDK chat          | Прежний SDK                                           | Да, target-side Node/SDK после setup        | Да, target-side Node/SDK после setup               |
| Claude/Codex/Copilot SDK Kanban        | Прежний workflow                                      | Да, ограничения controls см. SDK setup      | Да, ограничения controls см. SDK setup             |
| Git UI: reads, stage/commit/create     | Прежний workflow                                      | На target                                   | На target / pinned alias                           |
| Advanced/network/PR Git UI             | Прежний workflow                                      | Явный отказ                                 | Явный отказ                                        |
| Ручной terminal, dev-server/preview    | Controller                                            | Отдельный controller service                | Миграция — 5.3c                                    |

Auto не исправляет отсутствие CLI/авторизации запуском на controller. Только новый
запуск и только preflight failure Docker могут использовать ранее подтверждённый
Local fallback. Auto Kanban сохраняет этот fallback с отдельным managed worktree;
отсутствие CLI/SDK, build/exec failure и существующий binding не дают права downgrade.
Без явно сохранённой новой настройки среды остаётся legacy-поведение установки.
Существующая привязка всегда важнее изменённого default; смена модели её не переносит.

## Установка и авторизация

Контейнер проекта и SSH worker подготавливаются Automaker автоматически, как раньше.
Cursor/Gemini/OpenCode CLI и их авторизацию пока нужно подготовить **внутри выбранной среды**.
Claude/Codex/Copilot устанавливаются кнопкой в Project Settings, ключ задаётся там же;
подробности и закреплённые версии — [SDK setup](execution-environments-sdk.md).
Automaker не устанавливает произвольный latest CLI при первом prompt и не копирует
backend HOME, OAuth sessions, API keys из Credentials, MCP commands или окружение
controller. При отсутствии executable выводится `PROCESS_NOT_INSTALLED`, без fallback.

На SSH-хосте используйте того же пользователя, HOME и неинтерактивный PATH, что и
профиль Automaker. Проверяются имена `cursor-agent`, `gemini`, `opencode`; дополнительно
к PATH целевой машины доступны её `$HOME/.local/bin`, `$HOME/.opencode/bin`,
`$HOME/.npm-global/bin`. PATH и HOME сервера Automaker на другую машину не передаются.
Экспорт ключа только в интерактивной SSH-сессии не делает его доступным новым SSH exec.
Используйте поддерживаемое CLI хранилище авторизации или настройку удалённого окружения.

В managed Docker HOME — `/tmp/automaker-home`, пользователь — UID/GID backend.
Container ID виден после **Prepare and verify saved Docker environment**.
Администратор может войти в этот контейнер через `docker exec -it <container-id> /bin/bash`
с тем же Docker context и настроить CLI под его штатным пользователем; не используйте
root-login ради установки пользовательской авторизации. HOME/кеши сохраняются между
stop/start, но не переживают ручное удаление контейнера. Docker socket и controller
credential volumes внутрь контейнера передавать не нужно.

Официальные инструкции и форматы:

- [Cursor headless CLI](https://docs.cursor.com/en/cli/headless),
  [режимы Agent/Ask](https://cursor.com/docs/cli/overview).
- [Gemini headless JSONL](https://geminicli.com/docs/cli/headless/).
- [OpenCode run/auth/JSON](https://opencode.ai/docs/cli/).

Кнопки Sign In, сведения об установленном CLI и discovery моделей в других разделах
Settings пока описывают **controller**, не удалённую установку. Для привязанного remote
запуска локальная отметка Disconnected не мешает использовать отдельную удалённую
авторизацию. Remote SDK setup проверяет установку и credential presence, но не доступ
к модели. Discovery remote models и интерактивный OAuth мастер пока не реализованы.

## Ограничения провайдеров

- Cursor approval-only planning использует `--mode ask`, без `--force`. Это штатный
  read-only режим самого CLI, не дополнительная sandbox-гарантия Automaker.
- Gemini/OpenCode read-only planning с обязательным approval отклоняется: нельзя
  подменять ограниченный этап запуском в unrestricted/yolo режиме. Используйте Direct
  или Cursor либо явно выберите обычное выполнение без approval-only planning.
- `tools: []`, вложения и controller MCP/subagent/Claude connection profiles для
  remote CLI пока отклоняются. Конфигурация самого CLI на target может включать
  собственные hooks/plugins/MCP; их права определяет CLI и удалённый пользователь.
- Built-in tools действительно находятся в процессе CLI на target. Нормализаторы
  `ProviderMessage`, tool events и session IDs остаются существующими. Resume передаёт
  ID тому же CLI и cwd; OpenCode remote не делает автоматический fresh-session replay.
- В SSH контекст берётся из authoritative remote checkout. Локальные CLAUDE/AGENTS,
  memory и Cursor permission files туда не подмешиваются; автоматической синхронизации
  и git push нет. Workflow metadata и пользовательские attachments остаются control plane.
- Общие app services и внутренние text helper queries вне chat/feature workflow
  ещё не переведены на новый runtime. Глобальный Docker/SSH — не изоляция всего приложения.

Основной Git UI подключён в 5.3b; aliases, target identity, Local transition guard,
ограничения advanced Git и SSH source editor — [Git guide](execution-environments-git.md).
Shared memory context/usage и writer для chat/feature/pipeline подключены в 5.3c.1;
границы extractor и recovery — [Memory guide](execution-environments-memory.md).
Integrated terminal подготовленного target подключён в
[5.3c.2](execution-environments-terminal.md); dev-server/preview ещё не перенесены.

## Стриминг, отмена и обновление worker

CLI запускается через отдельные command/argv/stdin, без shell interpolation prompt.
SSH/Docker транспорт передаёт фреймы stdout/stderr по мере поступления; итоговый
worker response отделён от JSON, выданного CLI. Ограничения: 32 MiB суммарного вывода,
1 MiB на JSONL event, 2 MiB/4096 events в очереди controller, 64 KiB stderr,
до 10 минут на subprocess и idle timeout с учётом reasoning effort. Переполнение
завершает запрос ошибкой, а не выдаёт усечённый поток за успешное выполнение.

Stop и закрытие stream consumer ожидают отдельной подтверждённой отмены worker и
process group. SSH disconnect/непроверенный cleanup сохраняется как unknown outcome
и блокирует новые операции проекта до явного recovery. Команды не повторяются;
предыдущие эффекты не откатываются. Отделённые через setsid процессы требуют ручной проверки.

Старый SSH worker не меняется под работающей сессией. Для streaming после обновления
нажмите подготовку проекта повторно: новый worker устанавливается рядом, project
descriptor обновляется для **новых** запусков. Старые bindings продолжают использовать
свой hash/path; старые Direct runs работают, а CLI с таким binding выдаёт
`SSH_WORKER_UPGRADE_REQUIRED` и просит создать новую сессию/feature.

## Проверки

`remote-cli-environment.test.ts` использует настоящий ssh2 peer, Node, Git, worker,
target HOME и fixture CLI с существующими протоколами Cursor/Gemini/OpenCode.
Проверяются реальный AgentService и Kanban facade/pipeline, immutable binding,
remote context/auth, literal stdin/argv, read-only refusal, отмена дочерних процессов,
idle timeout, disconnect/recovery и обновление worker без retargeting.
`environment-jsonl.test.ts` проверяет framing, UTF-8, bounded buffers и закрытие consumer.
Opt-in `managed-docker.test.ts` дополнительно запускает fixture Cursor CLI и streaming
в настоящем проектном контейнере, Direct feature tools, три SDK в отдельных feature
worktrees и полный CLI facade → pipeline tests → Verify → Commit → ff-only merge/hooks.
Container-only marker обнаруживает выполнение команд на controller при общем storage.
`managed-feature-workspace.test.ts` проверяет согласие на Auto fallback, immutable
intent, потерянный ответ создания и отсутствие replay/retarget. Очищаются только свои ресурсы.

Это проверки транспорта и адаптеров, не live-model acceptance test установленных
версий CLI. Платные модельные ключи не используются. Внешний SSH и матрица
Windows/macOS остаются отдельной проверкой 5.4. Production server/UI не перезапускаются.
