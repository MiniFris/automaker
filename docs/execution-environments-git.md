# Git UI и среды выполнения — 5.3b

Обновлено: 2026-10-18. Основной Git UI использует выбранный Docker/SSH target,
а для запущенной feature — её неизменяемую привязку. Это не перенос всех сервисов
приложения: dev-server/preview подключены в [Linux MVP 5.3c.3b](execution-environments-preview.md); ручной test runner подключён
в [5.3c.3a](execution-environments-tests.md); integrated terminal подключён
в [5.3c.2](execution-environments-terminal.md); memory context/usage и writer
подключены в [5.3c.1](execution-environments-memory.md), extractor остаётся stub.

## Поддержанные операции

| Git / Worktree API                                                          | Docker/Auto → Docker и SSH                                                       |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| status, enhanced status, changes, file/project details                      | На target                                                                        |
| общий diff, file diff, untracked text/binary summary                        | На target, без external diff/textconv/fsmonitor                                  |
| commit log, branch log, branches и remotes                                  | На target, только cached remote refs                                             |
| list, feature info/status/diffs                                             | Реальные Git worktrees + metadata сохранённых pins                               |
| stage/unstage, commit                                                       | На target, проверка target identity и активности project agents                  |
| create worktree                                                             | На target, из существующей local branch/base commit, без fetch/copy/init scripts |
| delete/discard/stash/rebase/cherry-pick/general merge/network/PR automation | Явный отказ, без controller fallback                                             |

Для feature integration используйте отдельный проверенный **Merge remote feature
(fast-forward only)** из feature dialog. Общий старый Merge UI не запускает host Git
для удалённого проекта. Advanced Git/network/PR операции требуют дальнейшего
расширения адаптера; текущий UI показывает actionable error, а не выполняет их локально.
GitHub API-интеграции вне `/api/git` и `/api/worktree` остаются controller services.

## Как выбрать и подготовить среду

Сохраните global/project Execution Environment и явно подготовьте Docker environment
или authoritative SSH checkout в Project Settings. Git browsing **не создаёт**
контейнеры, checkout, branches/worktrees и не запускает авторизацию. Первый настоящий
Git read может запустить уже подготовленный остановленный Docker container.
Auto Git UI не делает Local fallback даже при наличии agent fallback consent:
ручной Git view не должен неожиданно сменить checkout. Уже pinned Auto Local feature
остаётся Local и требует действующего fallback consent при выполнении операций.
Unconfigured/обычный Local сохраняют прежние Git handlers.

Worktree panel на desktop/mobile показывает фактический backend и runtime cwd.
`POST /api/git/environment` читает только сохранённые metadata, без SSH/Engine вызова.
Мутации передают `environmentTargetId`, полученный при inspection/list/diff: сервер
повторно разрешает target и отклоняет отсутствующий/устаревший ID до dispatch.
Это проверка актуальности scope, не авторизация и не гарантия отсутствия внешних
Git изменений. Клиентские host/command/runtime JSON не дают права исполнения.
Если после remote inspection выбор изменился на Local, старый remote ID **тоже**
отклоняется до controller mutation. Успешный Local read/inspection очищает прежний
remote scope в HTTP client; просто изменить default недостаточно, чтобы старый
remote request незаметно исполнился на host.

## SSH paths и неизменяемые features

UI получает **controller alias** вида `<project>/.worktrees/<id>`, а не путь,
который следует открыть в локальном shell. Runtime cwd отображается отдельно.
Aliases разрешаются только относительно доверенного проекта; source/worktree
должны принадлежать его Git common dir. Нет local/root fallback при ошибке,
отсутствующей feature или повреждённой working copy.

Feature lookup использует сохранённый run binding, а не вычисляет каталог по
feature ID. Смена default, в том числе на Local или другой remote profile, не
переносит старые feature worktrees. Их metadata остаётся в selector; сведения о
другом target могут быть metadata-only, пока пользователь не откроет Changes.
`useWorktrees:false` не отменяет существующий managed feature binding.
Worktree selector показывает настоящие source branches; board `feature.branchName`
по-прежнему означает target branch. Выбор source workspace для Git inspection не
переназначает Kanban features: их карточки остаются на target branch board.

Source editor ещё использует controller filesystem. Для SSH он **не монтируется**:
не запускаются его file readers и autosave, вместо него показано предупреждение.
Используйте target-side Changes/Commits либо editor на SSH-хосте. Для Docker editor
по-прежнему работает с общими project files на controller; это не изоляция editor.
Открытие внешнего editor/terminal через Worktree actions на remote пока отклоняется.
Integrated Terminal view использует inspected project/worktree target (5.3c.2).

## Запись, ошибки и ограничения

- Перед Git UI mutations остановите project features. Проверка активности консервативна
  для всего проекта; UI writes сериализуются внутри одного controller process.
  Это не блокировка против внешнего Git, параллельного старта агента после проверки,
  другого server instance или ручных изменений файлов.
- Commit использует Automaker identity, отключённые Git hooks/GPG; выбранные files
  меняют index так же, как прежний Commit UI. Ошибка не откатывает staging/index.
  Path arguments передаются как literal pathspecs, не shell; traversal, `.git`,
  absolute paths и выход через symlink запрещены. Имена с quotes/newlines поддержаны.
- Create не делает reset/reuse произвольной существующей branch: уже зарегистрированный
  worktree возвращается, конфликт существующего branch/path отклоняется. Файлы root,
  в том числе dirty/ignored config, не копируются; init scripts/автосинхронизация не стартуют.
- Remote refs показываются из cache. Listing не запускает `fetch`, credential helper,
  gh CLI, push или network discovery. Для network операций пока нужен target-side Git.
- Read errors не превращаются в `success:true, files:[]`. Output ограничен 4 MiB на
  operation, diff — 300 changed files, synthetic text — 256 KiB/file, история — 100
  commits, deadline — 120 секунд. Большой/binary контент не выдаётся за полный diff.
- Abort/disconnect использует общий runtime cleanup; unknown outcome не replayится.
  SSH project recovery остаётся обязательным. Нет автоматического destructive repair,
  rollback, массовой миграции или cleanup worktrees. Один controller на DATA_DIR.

## Проверки

Worker проверяется настоящим Git: staged/untracked/renames, quotes/newline/literal
pathspecs, symlink/traversal, commit/log, worktrees и отсутствие external helpers.
HTTP routers проверяются на настоящем SSH peer с намеренно несовпадающим controller
repo: inspection без connect, root и pinned operations, refusal, unavailable target,
legacy/Local и default changes. Opt-in Docker suite проверяет тот же adapter через
настоящий Engine. UI tests проверяют metadata label, source-editor gate и передачу
target IDs. Без model calls, платных ключей и перезапуска рабочих контейнеров.
