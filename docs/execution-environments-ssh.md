# SSH execution environment

Обновлено: 2026-10-18. Этапы 4, 5.1, 5.2a/b: Direct, CLI и Claude/Codex/Copilot SDK,
чат и Kanban/AutoMode. [CLI matrix/auth/ограничения](execution-environments-cli.md).

SSH отделяет сервер Automaker и подключение к модели от машины, на которой агент
читает/изменяет файлы и запускает команды. Docker на обеих машинах не обязателен.
SSH **не является sandbox**: агент получает полные права выбранного удалённого
пользователя, включая сеть, процессы, доступные файлы и credentials этого пользователя.
Root/sudo автоматически не предоставляются. Скрытого перехода в Local нет.

## Что работает сейчас

- Direct chat: Read/Write/Edit, бинарные файлы, поиск, каталоги, удаление, shell и Git
  выполняются через удалённый worker. Read-only planning не получает запись/shell.
- На каждую новую сессию создаётся удалённый Git worktree/branch. Привязка к хосту,
  fingerprint, пользователю, worker и каталогу сохраняется после рестарта Automaker.
- Direct Kanban/AutoMode: планирование/approval, выполнение задач, pipeline/resume,
  тестовые команды, Verify, Commit и feature shell hooks используют ту же SSH-привязку.
- Изменение global/project default влияет на новые запуски, но не переносит старые.

В 5.3b основной Git/diff/worktree UI подключён к SSH: reads, stage/unstage, commit
и создание worktrees. Расширенные/network/PR операции явно отклоняются;
[матрица и aliases](execution-environments-git.md). Для feature есть отдельный
SSH fast-forward merge в Edit Feature, не старый общий merge handler.
Source editor для SSH заблокирован до переноса файлового backend, без local copy/autosave.
Integrated terminal подключён в 5.3c.2; dev-server/preview/port forwarding —
[Linux MVP 5.3c.3b](execution-environments-preview.md), с отдельным authenticated gateway.
Ручной test runner Docker/SSH — [5.3c.3a](execution-environments-tests.md), Linux/Python 3.

| Компонент                                       | Фактическая среда при Direct + SSH                                                                          |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Chat и инструменты                              | Pinned remote worktree                                                                                      |
| Kanban, approval, AutoMode, pipeline/resume     | Pinned remote feature worktree; workflow metadata локально                                                  |
| Verify / Commit feature                         | Тот же remote feature worktree, Stop/timeout без host fallback                                              |
| Feature shell hooks                             | Pinned remote feature worktree; `{{projectPath}}` — remote cwd                                              |
| Project-wide/unbound shell hooks при выборе SSH | Отказ, а не запуск на controller                                                                            |
| HTTP/ntfy hooks и workflow metadata             | Controller (уведомления/control plane, не source execution)                                                 |
| Git UI reads / stage / commit / create          | SSH / pinned workspace; advanced/network/PR операции отклоняются                                            |
| Source editor                                   | Явная блокировка SSH до переноса файлового backend                                                          |
| Integrated terminal                             | SSH PTY подготовленного checkout/worktree, Linux/Python 3; без controller fallback                          |
| Manual test runner                              | SSH PTY подготовленного checkout/worktree, Linux/Python 3; Start/Logs/Stop через target                     |
| Dev server / preview / port forwarding          | Linux supervised target + owned-port HTTP/WS relay; отдельный authenticated origin, MVP ограничения в guide |
| Cursor/Gemini/OpenCode chat и Kanban            | Remote CLI, HOME/auth на target; ограничения planning см. CLI guide                                         |
| Claude/Codex/Copilot SDK chat/Kanban            | Target-side SDK после [SDK setup](execution-environments-sdk.md), без Local fallback                        |

## Требования

На SSH-хосте нужны Linux, Node.js 22+ и Git в PATH **неинтерактивного SSH login**, `/bin/sh`
и обычные GNU/Linux utilities (`mkdir`, `test`, `mv -T`). Для первоначального переноса
также нужен включённый SFTP subsystem. Аккаунт должен иметь право исполнять команды и
писать в выбранный каталог. Automaker устанавливает только свой версионированный
worker: не использует sudo/apt, не устанавливает Node/Git и не меняет sshd.

Проверьте Node именно через неинтерактивный SSH: настройка только в интерактивном
`.bashrc`/nvm может не действовать. Для clone доступ к репозиторию должен уже работать
на удалённом хосте: controller private key и ssh-agent **не forward** в Git.

Со стороны Automaker нужен сетевой доступ сервера к host:port. Проверки выполнены
на Linux/WSL controller и Linux target; реальные macOS/Windows controller и внешняя
OpenSSH-инфраструктура требуют отдельной проверки. ProxyJump, SSH config aliases,
парольный login, hardware-key interaction и Windows remote target не реализованы.

## Настройка

1. В Global Settings → Execution Environment добавьте SSH profile: host, port, user,
   абсолютный Remote projects base path. Не используйте `/`. Профиль можно выбрать
   глобальным default либо сохранить его и выбрать в Project Settings. Пустой
   credential ID означает ssh-agent **процесса сервера Automaker**, не браузера.
2. Сохраните и выберите профиль. В SSH setup нажмите **Inspect SSH host fingerprint**.
   Сравните SHA256 fingerprint и алгоритм через доверенную консоль/администратора.
   Само сканирование не доказывает подлинность. До подтверждения аутентификация
   не выполняется. Для замены уже доверенного ключа есть отдельное подтверждение;
   старые сессии остаются привязаны к старому fingerprint и не мигрируют.
3. Для ключа укажите credential ID в глобальном профиле и сохраните private key
   с необязательной passphrase в SSH setup. Либо предоставьте backend свой
   `SSH_AUTH_SOCK` с нужным ключом. Никакого agent forwarding нет.
   Поддерживаются форматы ssh2 (OpenSSH/traditional PEM, в том числе с passphrase);
   PKCS#8 `BEGIN ENCRYPTED PRIVATE KEY` напрямую не поддерживается.
4. **Check SSH connection and prerequisites** проверяет доступ и Linux/Node/Git.
   Это read-only проверка: она не устанавливает worker и не переносит проект.
5. Подтвердите права удалённого пользователя и нажмите **Prepare saved SSH worker**.
   Worker устанавливается автоматически в `.automaker-ssh-<installation>/worker-<hash>`
   внутри base path, mode 0600; source hash проверяется перед исполнением.
6. В Project Settings выберите/унаследуйте профиль и явно подготовьте checkout одним
   из способов ниже. Просмотр/save/reload сами ничего не копируют и не запускают.
7. Создайте **новую** Direct chat session/feature с настроенным endpoint/model либо
   Cursor/Gemini/OpenCode с установленным и авторизованным remote CLI. Список сессий
   показывает фактический SSH backend. В системной инструкции указаны remote cwd
   и отсутствие синхронизации. Агент должен читать применимые инструкции из удалённого
   проекта; локальные `.automaker/context`/memory в SSH-чат автоматически не подмешиваются.

## Kanban / AutoMode / pipeline

Integrated terminal подготовленного SSH checkout/worktree подключён в 5.3c.2:
нужны Linux/Python 3, initial target фиксируется, browser reconnect не меняет shell,
backend restart не повторяет startup command. Детали —
[Terminal guide](execution-environments-terminal.md).

При первом старте feature сохраняется immutable intent: отдельная
`automaker/run-<hash>` branch, target branch и исходный commit. Поле branchName
карточки задаёт **удалённую target branch**, а не путь к controller worktree.
Без branchName берётся текущая ветка authoritative checkout. Нужна существующая
remote local branch (например, `main`), не `origin/main` или detached HEAD. Она не
создаётся по локальному Git автоматически. Каждая feature получает отдельный worktree
даже при выключенном старом переключателе local worktrees; соседние feature не делят
изменённые исходники. AutoMode определяет primary branch удалённо.

До worktree creation intent сохраняется на controller, поэтому повтор после recovery
не выберет новый base commit. После рестарта, смены global default или повторного
approval используется прежняя привязка. Изменение target branch существующей feature
не мигрирует её автоматически: создайте новую feature. Старый SSH binding без feature
intent также не повышается до Kanban workspace молча.

Планирование до approval не получает write/shell tools. Remote context загружается
из AGENTS.md/CLAUDE.md/CODE_QUALITY.md рабочей ветки и `.automaker/context`/`memory`
authoritative remote root. Локальные source context/memory не подмешиваются.
Автоконтекст ограничен 32 KiB/file, 64 KiB total и 50 entries/directory; превышение
даёт явную ошибку, а не переключает чтение на controller. После 5.3c.1 memory
usage в feature/pipeline/chat и writer learnings используют remote root;
controller memory не изменяется. Автоматический extractor остаётся stub;
подробности и recovery — [Memory guide](execution-environments-memory.md).
Сессии, планы, approvals, outputs, pipeline config и feature
JSON остаются локальными control-plane metadata и не синхронизируют source code.

Verify выполняет существующие npm lint/typecheck/test/build **удалённо**; зависимости
нужно установить там же. Commit feature делает `git add -A` и commit только в её
remote worktree (проверьте секреты и untracked files перед действием). Автоматические
Git actions используют identity Automaker и отключают Git hooks/GPG; настроенные
feature shell hooks исполняются отдельно в той же среде. Ничего не push/delete.
Standalone Verify/Commit/merge регистрируют lease, поэтому доступны Stop и timeout;
Stop агента не освобождает remote lease до завершения cleanup и не запускает pipeline
или merge после abort.

После pipeline с явной target branch возможен только **fast-forward** merge. Для
него исходная feature branch должна быть чистой/закоммиченной, authoritative root —
на pinned target branch без tracked changes, target history — предком source.
Никаких автоматических checkout/reset/rebase/force/pull/push. При расхождении или
dirty source задача остаётся waiting_approval с понятной причиной; история/изменения
не отбрасываются и успех merge не заявляется. Параллельные интеграции одного checkout
сериализуются в controller process; multi-controller deployment этим не покрывается.

В **Edit Feature** показаны фактические pinned environment/cwd/source → target branch,
даже если default уже изменился. Просмотр/опрос читает metadata без SSH connect и
не создаёт worktree. Там же отдельное действие **Merge remote feature (fast-forward
only)** с явным подтверждением просмотра commits; активную feature нужно остановить,
а изменения сначала закоммитить. Все проверки выполняются повторно на сервере;
клиент не задаёт branch/host/command для merge. Общее локальное Git UI к этому действию
отношения не имеет.

Feature shell hooks наследуют pinned SSH workspace даже после смены default; их
`{{projectPath}}` подставляется как remote cwd (кавычки в shell template — ваша
ответственность). Для unbound/project-wide SSH hook безопасная рабочая копия не
выбирается автоматически: такой shell hook отклоняется, а не запускается на host.
HTTP/ntfy остаются controller notifications. Unknown outcome блокирует и hooks/Git,
отмена не означает rollback; recovery из этапа 4 остаётся обязательным.

Private key/passphrase сохраняются **отдельно** от global/project settings, под
`DATA_DIR/execution-environments/ssh/credentials`, mode 0600, каталоги mode 0700.
Это plaintext server storage, не зашифрованный vault: защитите DATA_DIR и его backups.
Ключ не возвращается API и не сохраняется в localStorage; после сохранения форма
очищается. Используйте защищённое HTTPS-подключение браузер → Automaker. Credential ID
может разделяться профилями; удаление ключа блокирует их следующие подключения,
но не отзывает уже аутентифицированный SSH channel.

После первоначального import текущая remote branch — `automaker/import-<uuid>` с
dirty snapshot. Если выбрать в карточке исходную `main` из bundle, это будет именно
та ветка, без неявного переноса snapshot. Выберите правильную remote target branch
или явно интегрируйте import snapshot в неё до старта feature. Общий local branch
picker ещё не является каталогом удалённых branches.

## Первоначальный checkout и дальнейшая работа

Удалённая копия — **основная**; локальная директория нужна для настроек, сессий и
control-plane metadata. Двусторонней/фоновой синхронизации и автоматического push нет.

- **Transfer once** сохраняет Git history через bundle (если есть HEAD), переносит
  локальные изменения, untracked и ignored source, бинарные файлы и допустимые
  относительные symlinks через SFTP. Затем создаёт отдельную remote import branch и
  snapshot commit. Локальный Git не изменяется, ничего не пушится. Такой snapshot
  может включить `.env` и другие project secrets — проверьте дерево перед согласием.
  Приостановите локальные изменения: это не атомарный snapshot конкурентно меняющегося
  проекта. `.git`, `.automaker`, `.worktrees`, `node_modules` исключаются из overlay;
  уже tracked файлы этих каталогов могут присутствовать в перенесённой Git history/tree.
  Внешние/абсолютные symlinks, sockets/devices и конфликты типов файлов не переносятся.
- **Clone** принимает HTTPS или `ssh://` URL без embedded secrets, query или fragment.
  Репозиторий клонируется на SSH-хосте с его Git authentication/known_hosts. Пароли/token
  в URL запрещены; SSH key контроллера удалённому Git не передаётся.
- **Existing** использует чистый writable Git repository root с хотя бы одним commit,
  без symlink вместо root. Изменения существующего checkout не отбрасываются.
  Сначала commit/stash, затем явное подключение.

Clone/import используют новый staging-каталог, существующий target не заменяется.
При неудаче staging остаётся для проверки, его путь показывается в настройках.
Автоматической очистки remote checkout/worktrees/jobs, GC и удаления старых workers
пока нет. Подключение к уже подготовленному проекту не переимпортирует его.

Каждая chat session работает в `<remote-checkout>/.worktrees/<run-hash>` на своей
`automaker/run-<hash>` branch. Исходная ветка автоматически не merge/commit/push.
Устанавливайте зависимости из своего рабочего каталога удалённо; node_modules из
локального проекта не переносится. Параллельные сессии имеют разные worktrees, но
общий удалённый OS user — это не изоляция пользователей/секретов между проектами.

## Обрыв связи, Stop и recovery

Каждый инструмент оставляет server-side журнал operation ID и remote cwd без
содержимого команды. После потери ответа или рестарта незавершённая операция имеет
**unknown outcome**. Частичные эффекты не откатываются, команда автоматически
не повторяется; проект блокируется для новых инструментов до recovery.

Stop использует отдельное SSH-подключение, PID/start-time проверку, завершение process
group и completion marker. Просто закрыть SSH connection недостаточно. Обычные child/
grandchild проверены; отделившиеся `setsid`, внешние сервисы и системные jobs могут
продолжить работу. При потере сети отмена не гарантирована.

Осмотрите удалённые файлы/processes, затем в Project Settings подтвердите recovery.
Automaker проверит completion/cancel, но не replay и не rollback. При отсутствии
running record сохраняется cancel tombstone, чтобы запоздалый worker не начал работу.
Если worker был убит аварийно, остался stale running record или хост недоступен,
автоматический force-clear не выполняется: требуется ручная проверка хоста/процессов.
Не удаляйте журналы и tombstones вслепую и не считайте сетевую ошибку отсутствием эффектов.

Изменение host key/worker/user/root блокирует старые привязки. Подтверждение нового
ключа позволяет готовить новые запуски, но не перепривязывает старые. При легитимной
замене хоста сначала проверьте сохранность исходников и создайте новую сессию/checkout.

## Проверки реализации

Автотесты используют настоящий SSH/SFTP protocol peer на localhost с изолированными
тестовыми файлами, реальными Node/Git/shell child processes и (при наличии) отдельным
ssh-agent. Проверены private key/agent auth, trust до auth, ротация host key, pinned
worker, Git bundle/SFTP import, worktrees, binary/search/delete, timeout/cancel,
реальный channel disconnect и recovery без replay, mock-model Direct chat/restart,
read-only tools, API/UI validation и Chromium setup/reload. Внешний SSH-хост и
платный модельный API не использовались; это не production OpenSSH/full-app E2E.

Подэтап 5.1 дополнительно проверяет настоящий facade → Direct mock model → SSH tools,
read-only approval → execution, pipeline/resume, native pipeline command helper,
Verify/Commit/fast-forward merge, отказ при divergence/dirty source, immutable target
после restart, разные feature worktrees, AutoMode queue, Stop/child cleanup и
unknown outcome без replay. Controller project в этих тестах не является Git repo:
обращение orchestration к его source Git не может незаметно пройти.

Справочно: [ssh2 client API](https://github.com/mscdex/ssh2#client-methods),
[OpenSSH host key checking](https://man.openbsd.org/ssh_config),
[почему key scan не заменяет проверку подлинности](https://man.openbsd.org/ssh-keyscan).
