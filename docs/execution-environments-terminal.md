# Интерактивный terminal — 5.3c.2

Integrated terminal использует подготовленный Docker/SSH project или сохранённый
feature workspace. Ввод, Ctrl-C, resize, cwd и shell находятся на target. Один
managed container по-прежнему разделяется проектом; новый контейнер на terminal
не создаётся. Обычный Local/legacy terminal сохраняет native node-pty.

## Требования и запуск

- Target: Linux с доступным `/proc`, Python 3 и `/bin/bash` либо `/bin/sh`.
  Python используется только для PTY; модель и провайдер от него не зависят.
  Managed Docker toolchain уже включает Python. На SSH установите его обычным
  способом для своей ОС; Automaker не запускает sudo и не устанавливает пакеты
  незаметно при открытии terminal.
- Нужен ранее подготовленный project target: существующий managed Docker container
  или authoritative SSH checkout. Первую подготовку выполняет агент либо действия
  Prepare в Execution Environment settings. Terminal/Git inspection не создаёт
  контейнеры, checkout/worktrees и не включает Auto Local fallback.
- UI сначала запрашивает `/api/git/environment` для controller alias рабочего
  каталога, затем передаёт `environmentTargetId` в `POST /api/terminal/sessions`.
  Сервер повторно проверяет target, binding, Git working copy и Docker ownership/
  SSH fingerprint. Отсутствующий/устаревший target не открывает controller shell.
- Старый pinned feature alias сохраняет SSH/Docker даже после удаления профиля или
  смены default на Local. Подтверждённый Auto Local feature использует прежний
  native Local worktree; недоступный cwd не заменяется домашним каталогом.

Terminal header показывает Local/controller, Docker или SSH и начальный runtime cwd.
Это не динамический `pwd`: команда `cd` в shell не меняет привязку или label.
Terminal без project cwd — явно unscoped Local/controller session, не remote target.

## Протокол и конфигурация

Фиксированный Python supervisor создаёт настоящий controlling PTY. Он передаётся
через `docker exec -i` или проверенное ssh2 exec connection; на controller не
запускается shell для интерпретации terminal commands. Ввод/resize/ping/close и
base64 output передаются отдельными bounded JSON frames. Unicode stream декодируется
с сохранением границ символов, output/scrollback и очереди ограничены.

Для managed terminal не копируются controller env, RC/theme files или credentials.
Shell читает собственную target-конфигурацию; доступны auth/config, уже настроенные
на target. Custom env из server API отвергается. Shell override поддерживает только
`/bin/bash` и `/bin/sh`; другие remote shells требуют отдельного расширения.
Внешние OS terminal/editor actions не перенесены и по-прежнему отклоняются для
managed targets. Используйте integrated Terminal view.

Для managed sessions REST list/get и WebSocket `connected` возвращают фактический
`executionEnvironment`. Legacy/Local WebSocket явно помечается Local/controller.
`GET /api/terminal/sessions/:id` позволяет проверить сессию без создания новой.
Существующие application auth и дополнительный terminal password/token сохранены.

## Reconnect, Stop и restart

- Потеря browser WebSocket не закрывает PTY: reconnect подключается к прежнему ID,
  проигрывает scrollback и не меняет target. Стартовая команда разрешается сервером
  только первому WebSocket connection; повторное подключение/remount не повторяет её.
  Это at-most-once попытка, не гарантия доставки startup command.
- Stop/DELETE отправляет close supervisor. В здоровом соединении exit приходит
  после завершения foreground/background process groups этой PTY session.
  Supervisor работает Linux child subreaper и забирает orphaned jobs, чтобы обычные
  фоновые команды не оставляли zombies на container PID 1. Ответ
  DELETE означает, что остановка инициирована, а не что все процессы уже завершены.
  Target identity остаётся в service до exit. Resize не отбрасывает remote output.
- Backend отправляет heartbeat каждые 3 секунды. EOF/потеря heartbeat более 15 секунд
  закрывают target session; Docker activity lease удерживает container от idle stop,
  а завершение учитывается при вычислении idle time.
- Shell не переживает backend restart и не возобновляется автоматически. Restore
  layout проверяет старые ID, но не создаёт замену исчезнувшим сессиям. Создайте новый
  terminal явно; прежняя startup command автоматически не повторяется.
- При потере Docker/SSH transport выводится unknown-outcome warning и exit 255.
  Это **не подтверждение cleanup**: target может завершаться ещё до 15 секунд.
  Нет автоматического reconnect/replay транспортной команды или Local fallback.
  Проверьте effects на target перед повторным запуском команды.

Cleanup относится к обычным foreground/background jobs в session Linux PTY.
Намеренный `setsid`, daemonization, смена credentials или вмешательство пользователя
в supervisor не являются управляемым dev-server lifecycle. Это не sandbox: shell
имеет права target user. Ручные tests подключены в [5.3c.3a](execution-environments-tests.md).
Долгоживущие dev-server и preview/port
forwarding подключены в [Linux MVP 5.3c.3b](execution-environments-preview.md). Browser/xterm не является гарантией восстановления
screen state full-screen TUI после restart backend.

## Проверки и источники протокола

Реальные Linux PTY tests: controlling terminal, Unicode, dimensions/resize, Ctrl-C,
exit status, EOF, heartbeat и cleanup background jobs. SSH tests используют настоящий
SSH/SFTP peer, HTTP terminal auth, pinned worktree/default changes и разрыв транспорта.
Docker opt-in использует свой disposable image/container, не рабочий server.
Для test base image без Python `MANAGED_TERMINAL_TEST=true` добавляет его только
в owned fixture image. Платформенная/live-host матрица остаётся этапом 5.4.

API сверены с первичными источниками:
[Python pty](https://docs.python.org/3/library/pty.html),
[Python termios](https://docs.python.org/3/library/termios.html),
[Linux procfs](https://docs.kernel.org/filesystems/proc.html).
