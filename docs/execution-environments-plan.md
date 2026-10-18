# Среды выполнения Automaker

Обновлено: 2026-10-18. Статус: этапы 1–4 реализованы для Direct provider
(Local/managed Docker и SSH chat/runtime проверены на Linux/WSL).
Этап 5.1 реализован: Direct SSH Kanban/AutoMode, feature Git/tests/hooks.
Реализован 5.2a: streaming CLI adapters Cursor/Gemini/OpenCode (Docker/SSH chat,
SSH Kanban). Реализован MVP 5.2b: Claude/Codex/Copilot target-side SDK,
установка и отдельный target key через UI. Реализован 5.3a: Docker/Auto feature
workspace, tests/Verify/Commit/ff-only merge/hooks. Реализован базовый 5.3b: Git UI
reads, stage/commit/create через runtime. Реализован 5.3c.1: memory context/usage
и writer для feature/pipeline/chat. Реализован 5.3c.2: integrated terminal для
подготовленных Docker/SSH targets. Реализован 5.3c.3a: ручной test runner Docker/SSH.
Реализован Linux MVP 5.3c.3b: supervised dev + отдельные capability-authenticated
HTTP/WS preview origins, fixed owned-port relay Docker/SSH/Local; native pinned
Local manual tests. Browser MVP не поддерживает target cookie apps, service workers
и cross-origin browser backend calls; инструкции — [Preview guide](execution-environments-preview.md).
Следующий — 5.3c.3c: уникальные browser origins на run и auth/storage/worker parity.

## Цель и принятые решения

Отделить подключение к модели от среды исполнения инструментов. Настройка общая
для провайдеров: глобальное значение по умолчанию, переопределение в проекте,
неизменяемая привязка конкретного запуска. Режимы: Local, Auto, управляемый Docker
на проект и SSH. Local означает права пользователя процесса Automaker без sudo;
при контейнерной установке это среда самого контейнера Automaker.

Auto предпочитает управляемый Docker; локальный fallback требует явного согласия.
Auto использует Docker context по умолчанию на сервере; именованные Docker contexts
выбираются через явный профиль. Отсутствующая настройка сохраняет legacy-поведение,
а не автоматически включает Docker или расширяет права Direct agent.
При явно выбранном Docker/SSH скрытый переход в Local запрещён. Нельзя менять среду
работающего запуска, автоматически переносить проект при изменении настройки или
повторять прерванные команды с неизвестным результатом.

Профили хранятся глобально. В проекте — выбор профиля или наследование. Секреты SSH
хранятся отдельно на сервере; проектные файлы не содержат ключей/паролей. Отсутствующий
профиль означает ошибку конфигурации, а не разрешение локального исполнения.

## Этап 1 — настройки, наследование, диагностика

- [x] Общие типы Local/Auto/Docker/SSH; профили и разрешение global → project.
- [x] Строгая серверная валидация, API сохранения и сброса к наследованию.
- [x] Разделы Execution Environment в настоящих Global и Project Settings.
- [x] Проверка доступа к Docker Engine от имени сервера Automaker: нет CLI,
      daemon недоступен, нет прав, timeout, неверный context, успешный API-запрос.
- [x] Диагностика различает подключение, lifecycle контейнеров и доступ к проекту.
      На этом этапе только read-only проверка подключения: успешный docker info НЕ
      означает разрешение create/exec/remove или готовность проектного хранилища.
- [x] Контекстные инструкции: native Linux, Docker Desktop, Automaker в контейнере,
      SSH/TLS endpoint; без chmod 666, privileged или незащищённого TCP API.
- [x] Честная маркировка: настройки подготовлены, runtime ещё не переключается.
- [x] Unit/API/UI tests, сборки, lint и фиксация известных ограничений.

Этап 1 не запускает контейнеры, не устанавливает Docker, не меняет права/Compose,
не создаёт SSH worker и не ослабляет существующие ограничения Direct agent.
Проверяемый Docker context может использовать уже настроенный SSH/TLS транспорт.

## Этап 2 — общий runtime и полноценный Local

- [x] Интерфейс ExecutionEnvironment: файловые операции, поиск, exec, cancel,
      рабочие каталоги/worktrees, status/capabilities.
- [x] Local backend без snapshot-ограничений; отмена дерева процессов, лимиты вывода,
      timeout, корректная обработка бинарных файлов, зависимостей и удаления.
- [x] Серверная фиксация выбранной среды в run/session; сохранение при рестарте.
- [x] Предупреждение и серверное подтверждение Local без отдельной изоляции.
- [x] Подключение Direct agent и автоматических pipeline tests; read-only этапы
      остаются read-only, текстовые запросы не получают tools.
- [x] Убрать Direct-specific permissions UI после подключения нового runtime,
      предусмотреть миграцию старых настроек без незаметного повышения доступа.

Результаты этапа 1 выше описывают состояние до подключения runtime. После этапа 2
Local уже работает для Direct provider после явного подтверждения; Docker/Auto/SSH
остаются недоступными для исполнения и не подменяются Local. Поддержка CLI-провайдеров
и остальных app services по-прежнему относится к этапу 5.

## Этап 3 — автоматический Docker на проект

- [x] Управляемый базовый образ, автоматическая подготовка, один контейнер на проект,
      worktrees для параллельных задач, постоянные зависимости, idle stop/restart.
- [x] Все Direct tools и Direct pipeline tests используют один backend,
      без смешивания local/container. Остальные app services — этап 5.
- [x] Проверка create/start/exec/remove отдельным явно запускаемым probe без host mounts;
      отдельная проверка выбранного проектного хранилища. Очистка только своих ресурсов.
- [x] POSIX native/Desktop/Compose storage mapping volumes/bind mounts с учётом
      daemon-host paths. Реальные проверки — Linux/WSL; Windows native Docker paths
      не включены, macOS/Desktop требуют отдельной платформенной проверки.
- [x] Мастер настройки и повторная диагностика; образ и контейнеры не создаются
      при обычном просмотре настроек. Docker socket не передаётся агентскому контейнеру.
- [x] Runtime Auto и отдельный подтверждаемый Local fallback только при preflight
      failure нового запуска; без downgrade после подготовки/команд и для pinned runs.

## Этап 4 — SSH

- [x] Подключения: host/port/user, ключ/ssh-agent, отдельное хранение секретов,
      подтверждение fingerprint и отказ при изменении host key.
- [x] Автоматическая подготовка версионированного remote worker; первый target Linux.
- [x] Remote checkout — основная рабочая копия; явный clone/первоначальный перенос,
      без неявной двусторонней синхронизации и автоматического git push.
- [x] Файлы, Git, worktrees, команды, тесты через Direct chat/tools и общий command
      helper выполняются удалённо; reconnect/cancel,
      неизвестный результат команды не повторяется автоматически.
- [x] Диагностика SSH и доступности рабочего каталога, без Local fallback.

Граница этапа 4 на момент его завершения: общий SSH runtime и Direct chat, не полный Kanban workflow.
Локальные source context/worktrees/Git/terminal/hooks других app services нельзя
незаметно смешивать с remote checkout; старт и resume Direct SSH pipeline/AutoMode
блокировались до миграции 5.1. Текущее состояние: [SSH guide](execution-environments-ssh.md).

## Этап 5 — остальные провайдеры и app services

Этап разделён на последовательные подэтапы: 5.1 — Direct SSH Kanban/AutoMode
(remote context, pinned feature workspace, verify/commit/merge и feature shell hooks);
5.2 — адаптеры CLI/SDK с удалённой авторизацией и стримингом; 5.3 — общий Git UI,
terminal/dev-server/preview/port forwarding и memory writers; 5.4 — платформенная
матрица и финальный E2E.
Нельзя отмечать весь этап 5 завершённым после готовности только 5.1.

Подэтап 5.3 выполняется отдельными проверяемыми блоками:

- [x] **5.3a:** Docker Kanban для Direct/CLI/SDK: создание и фиксация
      feature worktree внутри среды, source context, pipeline tests, Verify/Commit,
      fast-forward merge и feature shell hooks через тот же runtime. Auto сохраняет
      подтверждаемый Local fallback только до любых Docker effects. Старые feature
      bindings не переносятся автоматически. Проверки на настоящем тестовом Engine,
      без перезапуска рабочих контейнеров и без реальных model credentials.
- [x] **5.3b (основной workflow):** общий Git UI и project/worktree операции; показывать
      фактический backend и не допускать неявных операций на controller для SSH.
      Реализация: общий selector/dispatcher перед legacy handlers; status/diff/
      details/log/branches/remotes/list, stage/unstage/commit и создание обычных
      worktrees через runtime. SSH paths представлены controller aliases, не
      каталогами для локального shell. Pinned feature workspace важнее default.
      Непереведённые remote операции явно отклоняются, а не исполняются на host;
      destructive/network/PR automation остаётся отдельным расширением Git.
      Мутации проверяют target identity, увиденную UI; просмотр не создаёт
      контейнеры/checkout/worktrees и не делает fetch/авторизацию controller.
      Расширенные destructive/network/PR Git operations остаются неподдержанными
      в remote UI до отдельного расширения адаптера; подробная матрица —
      [Git guide](execution-environments-git.md). Это не полный паритет Git UI.
- [ ] **5.3c:** terminal/dev-server, preview/port forwarding и memory writers.
      Выполняется отдельными блоками:
  - [x] **5.3c.1:** memory context/usage и writer learnings в
        authoritative project root закреплённого runtime; конкурентные записи,
        отсутствие controller fallback, реальные SSH/Docker проверки.
        Автоматический extractor сейчас является stub; не добавлять скрытые
        model calls под видом переноса файлового backend.
  - [x] **5.3c.2:** интерактивный terminal (PTY, input/resize, reconnect/cancel),
        immutable session target и UI фактической среды.
        Реализация: Linux target PTY supervisor на Python 3; framed duplex transport
        через Docker exec/SSH, target handshake и metadata в WS/REST. Просмотр
        не подготавливает среду; explicit create сверяет inspected targetId.
        Shell не переживает restart backend: heartbeat cleanup, без автосоздания
        session и replay startup command при восстановлении layout.
  - [ ] **5.3c.3:** dev-server/manual tests, preview/port forwarding и lifecycle
        долгоживущих процессов; без пересоздания pinned контейнеров ради портов.
    - [x] **5.3c.3a:** ручной test runner подготовленного Docker/SSH workspace:
          inspect → start, streaming/log history, immutable target, stop/cleanup,
          backend restart без replay; UI фактической среды.
    - [x] **5.3c.3b (Linux MVP):** supervised dev-server,
          отдельный authenticated HTTP/WS gateway и проверка owning Linux session
          для каждого target TCP relay. Нет новых port bindings/project containers;
          публикуется отдельный server range. Native pinned Auto/Local manual tests
          используют Linux/Python 3 supervisor. Обычный Local/legacy не меняет backend.
          Cookie apps, workers и внешние browser backend requests пока отключены;
          это не полный browser sandbox и не межзапусковая storage isolation.
    - [ ] **5.3c.3c:** уникальный browser origin на run и полноценный preview parity:
          cookie/storage/service-worker isolation между проектами и повторными
          запусками, безопасная поддержка cookie-login/worker приложений и project
          backend allowlists. Избавить local setup от ручного DNS, remote TLS ingress
          описать отдельно; не расширять доступ preview к Automaker API/session.

  Полный 5.3 не завершён, пока эти сервисы не переведены и не проверены.

Подэтап 5.2 разделён по фактическим способам запуска провайдеров:

- 5.2a (реализован): потоковый argv/stdin runtime для Docker/SSH; Cursor, Gemini,
  OpenCode — remote chat и SSH feature workflow; remote HOME/auth без копирования
  controller credentials; отмена process group, output limits и unknown outcome.
  CLI должны быть установлены и авторизованы внутри выбранной среды. Существующая
  автоматическая подготовка проектного контейнера/SSH worker сохраняется.
- 5.2b (реализован MVP): Claude/Codex/Copilot target-side SDK adapters,
  provisioning/API-key UX и сквозные проверки настоящих SDK протоколов.
  Chat — Docker/SSH/Auto, Kanban — SSH; без скрытого запуска controller SDK.
  Live-model acceptance и интерактивный OAuth мастер не входят в проверенный MVP.
- Docker feature hooks/Verify/Commit подключены в 5.3a; остальные app services
  остаются в 5.3b/c. Исторический Docker Kanban guard 5.2 снят после сквозных проверок.

- [x] Перевести Direct SSH Kanban/AutoMode: remote context, feature branch/worktree,
      planning/resume/tests/merge; снять временные guards только после сквозных проверок.
- [x] CLI/SDK запускаются в выбранной среде chat и feature workflow SSH/Docker/Auto.
      Матрица, ограничения провайдеров и границы app services задокументированы.
- [ ] Перевести Git, тесты, terminal/dev-server, preview/port forwarding и hooks;
      UI показывает фактическую среду и границы ещё не переведённых функций.
- [ ] Сквозные тесты Local/Docker/SSH, restart/recovery, несколько проектов/worktrees,
      platform compatibility и документация развёртывания.

Подэтап 5.1 не снимает ограничения других providers/app services: scope и матрица
описаны в [SSH guide](execution-environments-ssh.md). Полный этап 5 остаётся в работе.
После 5.2a актуальная матрица и ограничения — [CLI guide](execution-environments-cli.md).

### Проверяемые результаты 5.2

- [x] 5.2a: argv/stdin + framed streaming Docker/SSH, bounded buffers/idle timeout,
      отмена process group с подтверждением и unknown-outcome recovery без replay.
- [x] 5.2a: Cursor/Gemini/OpenCode chat и SSH feature workflow с target HOME/auth;
      нет controller env/credential/config forwarding и зависимости от host CLI status.
- [x] 5.2a: server guards для SDK remote, CLI Docker Kanban, unsupported read-only/
      tools/attachments/MCP; actual runtime в UI; explicit SSH worker upgrade для новых runs.
- [x] 5.2b MVP: SDK adapters и provisioning/target-key UX; actual SDK protocol tests.
- [ ] Live provider/model acceptance с реальными credentials — проверка 5.4;
      интерактивный OAuth и remote discovery требуют отдельного расширения.

Результат 5.2b: запуск закреплённых Claude/Codex/Copilot SDK отдельным Node
процессом внутри Docker/SSH; поток событий и подтверждённый cleanup через общий
runtime. Установка пакетов — отдельное подтверждаемое действие в Project Settings,
без глобального npm/sudo/изменения проекта. Ключ задаётся отдельно для target и
хранится там с режимом 0600, не в project/global settings и не через controller env.
Status различает установку и наличие credentials, но не обещает доступ к модели
без реального запроса. CLI Docker Kanban подключён в 5.3a. Read-only и
unsupported options должны либо реально соблюдаться SDK, либо явно отклоняться.
Операционные инструкции и ограничения — [SDK setup](execution-environments-sdk.md).

## Проверки и журнал

- До начала работ сохранены имеющиеся изменения Dockerfile и UI навигации Direct API.
- Существующий UI typecheck имеет две ошибки branchName в board-view.tsx:1257,1298;
  этот файл не относится к текущей задаче.
- Источники для диагностики: Docker Docs, Linux post-installation, Protect access to
  the Docker daemon socket, Bind mounts. Host key checking: OpenSSH ssh_config(5).
- Реализованы authenticated settings API `POST /api/settings/execution-environments/inspect`,
  `PUT /global`, `PUT /project` и `POST /docker/check` в этом же namespace. Настройки
  валидируются также при записи через общий SettingsService; секретные и неизвестные
  поля отвергаются. Null в project selection восстанавливает наследование.
- UI не использует отдельную копию настроек в Zustand/localStorage: общий query cache
  с ключом проекта, серверное сохранение, инвалидирование после изменения глобального
  значения. Работают ссылки `/settings?view=execution-environment` и
  `/project-settings?section=execution-environment` (для выбранного проекта).
- Проверка Docker запускается при явном выборе сохранённого Docker-профиля/Auto
  либо кнопкой. Просмотр страницы и сохранение профилей сами не создают контейнеров.
  Diagnostic subprocess: без shell/stdin/sudo, timeout 8 секунд, суммарный вывод
  ограничен 32 KiB; raw stdout/stderr не возвращаются в API. Контекст — сохранённое
  имя, не произвольные CLI options. Lifecycle и storage всегда `not-tested` на этапе 1.
- Целевой прогон 7 файлов: **81 тест прошёл**. Проверены config validation,
  наследование/override/reset, orphaned profile без downgrade, persistence, реальные
  HTTP handlers и mount в settings router, CLI argv/output/cancel, диагностические
  статусы и настоящая навигация обеих settings pages. SSH connections и контейнерный
  lifecycle этим прогоном не проверяются.
- Сборки `build:packages`, backend и production UI прошли; ESLint изменённых server/UI
  исходников и тестов успешен. UI typecheck повторён: только две прежние ошибки
  `branchName` в `board-view.tsx:1257,1298`, новых ошибок нет.
- Финальный общий прогон `vitest run --project=server --project=types
--project=model-resolver --project=ui --silent=passed-only --reporter=dot`:
  **3241 passed, 41 skipped; 134 файла passed, 3 skipped**. Opt-in Docker/browser
  suites этим прогоном не включались. Прежнее предупреждение SIGINT/SIGTERM listeners
  сохраняется; ошибок тестов нет. Браузерный full-app E2E на этом этапе не выполнялся.
- Реальный read-only probe доступного Docker Engine вернул `available`; контейнеры,
  образы, mounts, permissions и пользовательские настройки этим probe не менялись.
- [Инструкция по предоставлению доступа к Docker](execution-environments-docker-access.md)
  отдельно учитывает текущий `gosu` entrypoint: `group_add` без членства целевого
  пользователя в socket group может не сохраниться после смены пользователя.
- SSH пока является только профилем конфигурации. Ни remote worker, ни SSH credentials,
  ни переключение Direct/CLI/pipeline на новую среду на этапе 1 не включены.
- Запущенные Docker-сервисы не пересобирались/не перезапускались. Для появления новых
  UI и API в контейнерной установке требуется обновить **server и ui**.

### Этап 2 — реализация и ограничения

- Реализованы общий `ExecutionEnvironment`, Local backend и независимый bounded
  поиск. Файловые операции, бинарные файлы/base64, создание/удаление и shell работают
  непосредственно с рабочей копией без snapshot export/import. Поиск и сообщения
  ограничены операционными бюджетами; размер проекта/дерева зависимостей не ограничен.
- Локальный runtime передаётся провайдеру как выданный сервером object capability.
  JSON-объект из запроса или metadata сам по себе не предоставляет shell/запись.
- Серверные `local/confirm` и `local/revoke` требуют обычной авторизации settings API.
  Confirmation требует `accepted: true`, `warningVersion: 1` и текущий выбор Local.
  Grant хранится отдельно от project/global settings с mode 0600 и identity сервера.
  `skipSandboxWarning` и container flag не дают права Local.
- Для unconfigured installs сохраняется legacy backend и его policy snapshot.
  Сохранённый явный Local без confirmation завершается ошибкой до запроса к модели.
  Нет неявного повышения прав существующих legacy sessions/features.
- Chat привязан ключом session ID, feature и её pipeline — project/feature ID;
  metadata chat и Direct checkpoint содержат привязку. Смена default не изменяет
  уже привязанный запуск. Для смены среды существующей сессии/feature пока нужно
  создать новую; отдельный idle-only reset/migration UI остаётся дальнейшей задачей.
- После смены identity требуется новое явное confirmation; Local binding может
  обновить identity после подтверждения, но не тип/cwd и не результат команды.
  Повреждённое состояние/подмена cwd не приводят к fallback. Legacy binding с другой
  identity автоматически не мигрирует.
- Read-only planning не получает mutating/shell tools. Text-only helpers не получают
  инструменты и не требуют filesystem grant. Direct pipeline tests используют ту же
  привязку feature, Local exec либо прежний legacy Docker shell, не скрытый host runner.
- Новый timeout Local по умолчанию — 180 s, duration query — 900 s; сохранённые limits
  имеют приоритет. Legacy defaults остаются прежними; общий максимум toolTimeoutMs
  расширен до 600000. Вывод shell ограничен, отмена ждёт завершения/cleanup либо
  возвращает явную cleanup failure. Никакого автоматического rollback/повтора команд.
- Native filesystem — не sandbox и не cross-process CAS. Local shell наследует
  окружение процесса Automaker; все доступные ему credentials/mounts потенциально
  доступны агенту. Это прямо перечислено в предупреждении, в том числе внутри Docker.
- Process-group cancellation проверена на Linux с реальными child/grandchild;
  отделившиеся процессы/системные службы не гарантированно останавливаются. macOS и
  PowerShell/taskkill Windows реализованы, но на реальных этих системах не прогонялись.
- Direct permissions UI удалён. В форме endpoint — ссылка на общий раздел среды;
  project/global UI поддерживают confirmation/revoke и показывают применяемую scope.
  Отзыв блокирует следующие requests; уже выданный текущему request grant действует
  до завершения/обычного Stop.
- Добавлены **39 тестов** относительно этапа 1. Проверены большие бинарные файлы,
  dependency paths, byte/line pagination UTF-8, аргументы/конфликты, запись/удаление,
  shell exit/output, timeout с сохранёнными эффектами, process tree cancellation,
  legacy/Local миграция, revoke, restart/pinning и неподделываемый runtime grant.
- Сквозные mock-model тесты проходят по настоящим Local tools и shell, chat после
  рестарта, approval → запись при смене project selection во время ожидания, и
  автоматическим pipeline tests без Docker. Настоящие модельные API не вызывались.
- Реальный Chromium smoke проверил сохранение Local confirmation через API и
  восстановление после reload на временном сервере; это component/browser harness,
  не полный main-app router/auth E2E. Реальная навигация обоих settings views покрыта
  отдельными React tests.
- Успешны build:packages, backend build, production UI build и ESLint новых/изменённых
  runtime/UI файлов. UI typecheck повторён: только две прежние ошибки branchName в
  `board-view.tsx:1257,1298`. Старое предупреждение unused `thrownErrorMsg` в AgentService
  вне новых строк не исправлялось.
- Legacy Docker opt-in tests не включались: ранее использованный Alpine image
  отсутствует в текущем daemon. Новые образы не скачивались/не собирались, права на
  daemon и запущенные контейнеры не менялись.
- Финальный общий прогон server/types/model-resolver/UI с включённым Chromium harness:
  **3281 passed, 40 skipped; 137 файлов passed, 2 skipped**. Без browser opt-in:
  **3280 passed, 41 skipped**. Старое SIGINT/SIGTERM MaxListeners предупреждение
  осталось; ошибок тестов нет. `git diff --check` и форматирование новых модулей успешны.
- Использование и точные границы описаны в [Local guide](execution-environments-local.md).

### Этап 3 — управляемый Docker

- Добавлены общий bounded Docker CLI transport, версионированный worker и
  `ManagedDocker`/`DockerExecutionEnvironment`. Образ автоматически готовится при
  первом исполнении/явной подготовке: фиксированный Node/Git/build-toolchain recipe,
  без передачи build context проекта, arbitrary CLI options, sudo или host-shell fallback.
- Один installation/project container, общая настоящая рабочая копия и внутренние
  worktrees. Project dependencies остаются в storage, HOME/cache — в writable layer
  контейнера между stop/start. Автоматическое пересоздание/удаление проектных
  контейнеров, обновление image и GC не выполняются во избежание потери состояния.
- PID 1 останавливает idle container через 15 минут. Stop intent публикуется до
  проверки активных worker-запросов; новый worker сначала регистрируется и ждёт
  решения idle-stop перед исполнением. Проверена гонка запуска команды/idle-stop
  с детерминированными часами; реальный Engine проверен на stop/start, не ожиданием
  15 минут wall-clock.
- Все Direct file tools, пакетный Glob/Grep и pipeline commands используют worker
  внутри той же привязанной среды. Бинарные файлы, большие dependency trees и удаление
  не требуют snapshot export/import. Cancel использует отдельный remote control call,
  проверяет PID start identity, завершает process group и ждёт completion. Убийство
  Docker CLI не считается подтверждённой отменой. Cleanup failure фатален, без replay.
- Привязка сохраняет owner installation, Engine ID, context, container/image IDs,
  mount mapping и UID/GID. Проверяются ownership/configuration/namespace/mounts до
  операций; daemon/context подмена не мигрирует запуски. Нет docker.sock, host PID/
  network, privileged, volumes-from или передачи Automaker environment/API keys агенту.
  Сеть bridge для зависимостей разрешена; пользователь — UID/GID backend.
- Новый authenticated `POST /docker/prepare` требует `accepted: true`, использует
  только сохранённый профиль и проверяет create/start/exec/remove на отдельном probe
  без host mounts. В project scope дополнительно проверяет двустороннюю nonce-запись
  через настоящее project storage. Probe cleanup удаляет только проверенный собственный
  контейнер; неизвестный результат/непроверенная очистка не становятся success.
  Старый `/docker/check` остаётся строго read-only, отдельно от readiness.
- Native POSIX bind, controller bind path translation и named-volume project subpath;
  запрещены nested mounts, metadata внешнего Git worktree и disposable storage
  controller. Пути совпадают с Automaker для Git backlinks. Storage mismatch, UID/GID
  ошибки и неподдержанный volume-subpath блокируют tools до запроса к модели.
- Реализован Auto, отдельные `/auto/confirm` и `/auto/revoke` с versioned warning и
  server-side scope grant. Local consent не даёт Auto fallback. Только первый
  connection/mapping preflight нового запуска может выбрать Local с этим согласием;
  build/create/start/storage/exec ошибки и pinned Docker никогда не downgrade.
  Привязанный Local fallback не меняется обратно при восстановлении Docker.
- UI содержит последовательную подготовку/check/recheck, явное разрешение build/probe,
  различает lifecycle/storage, показывает actionable server errors и отдельный fallback
  consent. Просмотр/save/reload сами не готовят образ и не создают контейнеров.
  Список сессий возвращает model/provider/environment metadata и показывает фактический
  Docker/Local/Auto fallback. Полная карточка среды всех feature/services остаётся этапом 5.
- Добавлены `server-docker` target (официальный Docker CLI/buildx) и opt-in
  `docker-compose.execution.yml`: socket только controller, persistent projects volume,
  автоматическое членство automaker в реальной socket GID до gosu. Обычная установка
  не получает доступ к daemon. Предыдущие пользовательские изменения Dockerfile сохранены.
- Реальные Linux/WSL проверки: lifecycle/cleanup, bind и named-volume subpath,
  отсутствие доступа к sibling project/credentials, binary files, caches после restart,
  Git/worktrees, timeout effects, cancel без остановки соседней команды, полный цикл
  mock Direct-model Write → Bash → Read и pipeline command. GID/gosu проверен в
  отдельном временном controller container с **тестовым Unix socket, не socket Engine**;
  host permissions не менялись. Временные owned containers/volume/test image удалены.
- Реальный smoke использовал уже локальный `automaker-server:latest` как parent
  временного test image, без pull/apt и без запуска приложения. Production image
  recipe проверен unit tests; network build/redeploy `server-docker` не выполнялся.
  macOS/Desktop и Windows native Docker backend не объявляются проверенными:
  Windows paths отвергаются с рекомендацией WSL/Linux, Desktop POSIX mapping реализован,
  но требует отдельной проверки. SSH и остальные providers/app services — этапы 4–5.
- Chromium harness проверил Local → Auto, явный prepare через API (mock lifecycle),
  отдельный fallback consent и reload без повторной подготовки. Это component/browser
  harness, не full-app auth/router E2E. В промежуточных параллельных прогонах встречался
  bootstrap timeout браузера (отдельный прогон проходил). Добавлены network/console
  diagnostics и ожидание static-import crawl/prebundle перед открытием no-HMR harness;
  финальный общий прогон после этого прошёл. Увеличение timeout/повтор действий модели
  для обхода проблемы не применялось.
- Backend и production UI build успешны; ESLint новых/затронутых runtime/UI/routes/
  tests, Compose config validation, shell syntax и `git diff --check` успешны.
  UI typecheck: только прежние две ошибки `branchName` в board-view.tsx:1257,1298;
  файл не изменялся. Старое SIGINT/SIGTERM MaxListeners предупреждение осталось.
- [Docker guide и инструкции развёртывания](execution-environments-docker.md) описывают
  полномочия controller, ограничения и обязательный backup/перенос существующих
  `/projects` из writable layer **до** включения нового volume. Живые server/UI
  не перезапускались; для использования изменений требуется обновить оба сервиса.
- Финальный общий прогон server/types/model-resolver/UI с включёнными Chromium
  harness и реальным managed Docker smoke: **3320 passed, 40 skipped; 141 файлов
  passed, 2 skipped (143 total)**. Добавлены 39 тестов относительно этапа 2.
  Отдельный Docker smoke: 6 тестов прошли. После прогона собственные тестовые
  контейнеры, volume и image tag отсутствуют; automaker-server healthy и ui продолжают
  работать без перезапуска. Следующий этап — SSH, он ещё не начат.

### Этап 4 — SSH runtime и Direct chat

- Добавлены ssh2 transport, отдельный server-only key store и host trust. Host scan
  отклоняет handshake до authentication; подтверждение повторно сверяет exact SHA256
  fingerprint, замена ключа требует отдельного согласия. Все последующие подключения
  сверяют pinned key. Private key/passphrase (в том числе encrypted traditional PEM)
  и server ssh-agent проверены; public key вместо private key и неверная passphrase
  отвергаются. Agent forwarding отсутствует.
- Credentials — отдельные файлы DATA_DIR, mode 0600, каталоги 0700; они не попадают
  в project/global settings, API responses, browser storage или remote worker. Это
  plaintext storage на сервере, не vault; инструкция требует защиты DATA_DIR/backups
  и HTTPS до Automaker. API и UI работают только с сохранённым SSH profile/credential ID.
- Явная автоматическая установка versioned worker под выбранным Linux OS user,
  source hash/user/root identity проверяются перед исполнением. Node 22+, Git и
  SFTP (для import) должны быть настроены на target; sudo/apt/установка Node/Git
  и автоматический Local fallback отсутствуют. View/save/check ничего не устанавливают.
- Remote checkout authoritative: явные clone/import/existing, новый staging без
  замены target. Import сохраняет Git history через bundle, SFTP overlay и отдельный
  snapshot commit dirty/untracked/ignored source. UI предупреждает о project secrets,
  исключённых dependency/metadata деревьях и необходимости остановить локальное
  редактирование. Локальный Git не меняется; push/background sync отсутствуют.
- Direct chat получает отдельные remote branches/worktrees; binary/files/search/
  remove/shell/Git и общий helper тестовых команд используют один SSH backend.
  Local cwd — только metadata identity, runtime cwd — remote. В SSH-чат не загружаются
  устаревшие локальные context/memory; инструкции нужно читать из remote working copy.
  Привязка сохраняется после рестарта и смены default, без автоматической миграции.
- Unknown operation journal сохраняется на сервере без command contents. Потеря
  результата/рестарт блокируют новые tools до явного Project Settings recovery;
  команда не replay/rollback. Cancel использует отдельное соединение и ждёт
  completion/PID-start check, а не просто закрывает транспорт. Recovery сохраняет
  tombstone и для ещё не стартовавшего worker. Stale/crashed worker без доказанной
  очистки требует ручного осмотра; force-clear и автоматического GC пока нет.
- В global/project настройках есть fingerprint, key/agent, read-only check, явная
  установка worker, source selector, project readiness и recovery. Секретная форма
  очищается после сохранения/смены профиля. Список сессий показывает фактический SSH.
- Зафиксирована граница app services: Direct SSH Kanban/AutoMode, запуск и resume
  полного pipeline, local auto-merge блокируются до этапа 5. Покрыты обходы через
  pipeline resume, чтобы локальные source context/worktree/Git не выполнялись.
  Общий remote command helper не означает готовность полного pipeline workflow.
  Другие CLI providers, terminal/dev-server/manual Git UI/hooks остаются Local;
  UI banner и [SSH guide](execution-environments-ssh.md) это явно указывают.
- Реальный localhost SSH/SFTP peer проверил trust до auth, key rotation, private
  key/ssh-agent, worker hash, Git bundle+binary+dirty/deleted source, worktrees,
  search/delete, timeout effects, отмену child/grandchild, настоящий channel loss,
  restart/recovery без replay. Mock-model AgentService chat проверяет Write → Bash →
  Read, remote pipeline command helper, read-only tools, pinning после restart,
  отсутствие stale local instructions и отказ при удалённом credential до model call.
- Chromium harness расширен реальным SSH setup: save → scan/trust до auth → key →
  prepare worker → reload без reconnect/install и без ключа в форме/storage. Это
  component/browser harness, не full-app auth/router E2E и не внешний OpenSSH сервер.
- SSH transport/state/API/UI/runtime и tests проходят ESLint; затронутые старые
  AgentService/ExecutionService/Pipeline tests сохраняют прежние warnings. Сборки
  shared packages/backend/production UI успешны. UI typecheck: только две прежние
  ошибки `board-view.tsx:1257,1298`. Старое SIGINT/SIGTERM MaxListeners предупреждение
  остаётся; unrelated fixes в этот этап не включены.
- npm audit отдельно сообщает о существующих зависимостях проекта; ssh2 и его новые
  transitive packages в списке advisory отсутствуют. Массовый audit fix не запускался.
  Lockfile HTTPS normalization/lint сохранены. Production server/UI не перезапускались;
  для появления новых настроек в Docker требуется обновить **оба** сервиса.
- Финальный общий прогон server/types/model-resolver/UI с включёнными Chromium
  harness и managed Docker smoke: **3347 passed, 40 skipped; 143 файла passed,
  2 skipped (145 total)**. Добавлены 27 тестов относительно этапа 3. `git diff --check`,
  форматирование новых SSH модулей и lint lockfile успешны. Следующий — этап 5.

### Подэтап 5.1 — Direct SSH Kanban/AutoMode

- Большой этап 5 разделён на 5.1–5.4. Реализован именно 5.1, не remote adapters всех
  провайдеров и не полный перенос приложения. Остальные checklist остаются открытыми.
- Добавлен `SSHFeatureService`: bootstrap remote feature workspace, context, Git
  status/commit/fast-forward merge. Server-side binding содержит `sshWorkspace`
  с branch/baseBranch/baseCommit; intent сохраняется до worktree creation. Board
  branchName — remote target branch. Неподготовленные/неизвестные targets, старые
  bindings без feature intent и изменение target не приводят к Local fallback.
- ExecutionService и PipelineOrchestrator (start/resume/test/fix/merge), AgentExecutor
  initial/planning/task/continuation используют одну binding/run key и controller cwd
  только как metadata identity. Перед source/tools проверяются worker, Git common dir
  и actual branch. Controller worktree lookup не выполняется для SSH.
- AutoMode primary-branch filtering/concurrency используют remote current branch
  через settings-aware WorktreeResolver; legacy resolver остаётся прежним без SSH.
  Новый SSH dependency загружается лениво, чтобы не затронуть legacy-only users.
- Context — из remote feature root и remote authoritative `.automaker/context/memory`.
  Явные bounded budgets: 32 KiB/file, 64 KiB total, 50 entries/directory. Ошибки
  транспорта/бюджетов не превращаются в локальное чтение. Planning до approval
  остаётся read-only. Local memory usage/learnings writer для SSH не вызывается;
  feature/plan/output/pipeline JSON остаются локальными control-plane metadata.
- Facade Verify/Commit выполняются в той же remote workspace; Verify сохраняет
  существующие npm commands. Standalone Verify/Commit/merge регистрируют lease и
  используют его abort signal. Stop держит SSH lease до cleanup, pipeline проверяет
  abort после model step и до post-processing, не публикует merge/success после Stop.
- Git integration — только clean-source fast-forward в clean tracked root на
  pinned target branch, без checkout/reset/rebase/force/fetch/push/delete. Параллельные
  merge одного root сериализуются внутри controller process. Dirty/diverged source
  или target дают waiting_approval/ошибку, не ложный verified. Commit использует
  фиксированную Automaker identity, Git hooks/GPG отключены для автоматических actions.
- Feature shell hooks выбирают **pinned** workspace, в том числе после смены default;
  `{{projectPath}}` — remote cwd. Unbound/project-wide SSH shell hooks отклоняются,
  не запускаются на host. HTTP/ntfy остаются controller notifications. Unknown journal
  блокирует последующие context/Git/hooks и сохраняет recovery без replay этапа 4.
- Добавлены metadata-only `/settings/execution-environments/feature/inspect` и явный
  `POST /auto-mode/merge-ssh-feature` с `accepted:true`. Никаких request-supplied
  branch/host/command. Merge делегируется facade с проверкой inactive feature и
  revalidation pinned state; неизвестные поля и path-like feature IDs отвергаются.
- В Edit Feature добавлен actual environment/cwd/source → target panel и отдельный
  подтверждаемый remote merge. Просмотр/опрос metadata не устанавливает worker,
  не создаёт workspace и не подключается по SSH. Настройки/SSH guide обновлены:
  явно перечислены ещё Local CLI/terminal/general Git/preview и границы hooks/memory.
- Новые реальные localhost SSH/Git tests используют controller **без Git repo**:
  несколько feature worktrees, pinning/restart/retarget refusal, remote context,
  real facade → mock Direct model → tools → Verify/Commit/merge, real approval,
  pipeline/resume, native pipeline helper без host TestRunner, AutoMode queue,
  Stop/child cleanup и disconnect/recovery без replay. Внешние SSH/model endpoints
  не вызывались. Есть отдельные API/UI/lease regressions; старые blanket SSH guards
  заменены проверками настоящего remote preflight, а не отключены без замены.
- Успешны build:packages/backend/production UI, ESLint новых/затронутых модулей,
  formatting и `git diff --check`. UI typecheck: только прежние две ошибки
  `board-view.tsx:1257,1298`; старые unused/SIGINT/SIGTERM warnings не скрывались.
  Production контейнеры не пересобирались/не перезапускались; для новых UI/API нужно
  обновить **server и ui**. Следующий подэтап — 5.2, remote CLI/SDK adapters.
- Финальный общий прогон server/types/model-resolver/UI с включёнными реальными
  managed Docker smoke и Chromium harness: **3375 passed, 40 skipped; 146 файлов
  passed, 2 skipped (148 total)**. Относительно этапа 4 добавлены 28 тестов:
  13 SSH feature workflow, 5 UI, 8 merge API, metadata inspect и remote lease.
  Сохранён прежний текст ошибки pipeline abort при более ранней проверке Stop;
  дополнительный целевой прогон PipelineOrchestrator проверяет этот контракт.

### Этап 5.2a — CLI streaming adapters (2026-10-17)

- Добавлен server-only `runProcess(command/argv/stdin)` для Docker/SSH без shell
  interpolation и forwarding controller env/keys. stdout/stderr идут фреймами во
  время выполнения; финальный worker response не смешивается с JSON провайдера.
  Бюджеты вывода/event/очереди/времени и UTF-8 decoding не дают неограниченного
  накопления данных. Закрытие consumer ожидает подтверждённый remote cleanup.
- Cursor/Gemini/OpenCode используют существующие normalizers/session IDs, но сам
  CLI и его built-in tools выполняются внутри pinned target cwd/HOME. Нет host
  CLI-path/WSL/npx fallback и зависимости от controller Disconnected. Remote OpenCode
  не делает fresh-session replay после ошибки. Убраны local Gemini ignore writes
  и Cursor permission reads для remote runs.
- Подключены AgentService и SSH feature workflow: context, Kanban facade/pipeline
  tests, Verify/Commit/fast-forward merge/hooks наследуют прежнюю SSH-привязку.
  Local CLI/SDK при явной настройке также получают consent и immutable binding;
  не настроенные установки сохраняют legacy-поведение.
- SDK remote и CLI Docker/Auto Kanban явно отклоняются. Не поддерживаемые remote
  MCP/subagents/Claude profiles, attachments, `tools: []` и Gemini/OpenCode read-only
  planning не заменяются unrestricted execution. Cursor read-only использует Ask.
- Явная повторная подготовка SSH устанавливает новую worker version рядом и
  обновляет descriptor только для будущих runs. Старые bindings не retargeted;
  Direct продолжает работать, CLI со старым worker требует нового запуска.
- Обновлены actual feature environment UI, settings warnings и guides, добавлена
  [матрица CLI/auth/setup](execution-environments-cli.md). CLI binaries/auth пока
  готовятся на target вручную; автоматическая подготовка контейнера/worker уже есть.
  Мастер provisioning/auth и Claude/Codex/Copilot SDK — следующий **5.2b**.
- Добавлены 20 regression tests: 7 framing/JSONL, 11 real SSH peer/fixture CLI
  (включая настоящий chat/facade/pipeline, cancel, idle timeout, unknown outcome,
  upgrade), 1 actual UI binding и 1 настоящий Docker CLI streaming. Target PATH
  в SSH CLI fixtures задан отдельно, чтобы не использовать установленные host CLI.
- Общий прогон server/types/model-resolver/UI, с Chromium и opt-in Docker:
  **3395 passed, 40 skipped; 148 файлов passed, 2 skipped (150 total)**.
  Успешны build:packages, server и production UI; ESLint затронутых новых модулей,
  formatting, lockfile lint и `git diff --check`. UI typecheck содержит только прежние
  `board-view.tsx:1257,1298`; старые SIGINT/SIGTERM warnings не скрывались.
- Внешний SSH и live model acceptance не проверялись; платные модельные ключи не
  использовались. Удалены только собственные ephemeral Docker test resources.
  Production server/UI не пересобирались и не перезапускались; чтобы получить
  изменения в запущенном приложении, требуется обновить **обе** части.

### Этап 5.2b — target-side SDK и provisioning/key UX (2026-10-17)

- Claude/Codex/Copilot запускаются отдельным Node-процессом на target через общий
  runProcess; весь SDK/CLI и его built-in tools находятся в Docker/SSH cwd/HOME.
  Local сохраняет прежний provider flow. Server runtime capability проверяется,
  controller auth/config не участвуют в запуске target SDK.
- Каталог закрепляет проверенные версии server SDK: Claude 0.2.32, Codex 0.98.0,
  Copilot 0.1.16 и bundled Copilot CLI 0.0.389. SDK загружается по явному entrypoint
  из managed HOME prefix; import-only exports Codex/Copilot проверены настоящими SDK.
  Нет project module resolution, произвольных packages/versions, global npm или sudo.
- В Project Execution Environment добавлен Remote providers SDK setup: явные
  inspect/install/save/remove key. На mount нет remote действий. Install использует
  фиксированный npm prefix/registry, ignore-scripts и lock; direct dependencies
  pinned, transitive resolution сохраняется в target package-lock при установке.
  Inspect не создаёт controller/remote worktree и не создаёт контейнер; подготовленный
  Docker container может быть запущен для явной проверки.
- Authenticated settings API строго валидирует provider, fields, projectPath,
  acceptance и inspected targetId до передачи ключа. При изменённом target запись
  отклоняется. Key передаётся stdin и хранится только на target (0600, atomic rename),
  не в controller settings/argv/response/browser storage. Managed/env keys redacted
  из SDK event/error output; credential presence не выдаётся за live authentication.
- Подключены chat и SSH feature workflows: context/worktree/tests/Verify/Commit/
  merge/hooks используют прежнюю immutable SSH-привязку, в том числе при смене
  default и restart. Remote SDK не зависит от controller Disconnected/CLI path.
  Resume failure не делает automatic fresh-session replay.
- SDK result удерживается до complete и завершения процесса/cleanup. Copilot stop
  errors не игнорируются; отключён autoRestart. Stop/consumer close используют общий
  подтверждённый cancel и SSH unknown-outcome recovery, без возврата в Local.
- Claude read-only предоставляет только Read/Glob/Grep и strict empty MCP; Codex
  передаёт workingDirectory/sandbox, read-only/network controls. Для обычного Codex
  учитывается server sandbox choice, workspace-write по умолчанию; unattended approval
  — never. Copilot read-only, controller MCP/profiles/subagents, attachments и
  неподдержанные SDK controls отклоняются. Docker CLI/SDK Kanban остаётся guard до 5.3.
- Добавлены **34** теста: 12 SSH SDK/setup (в том числе настоящие три SDK с fixture
  CLI JSONL/stdio/JSON-RPC), 7 completion/cleanup/serialization unit, 8 API, 5 UI,
  2 Docker (runner всех SDK и реальный npm install/bundled CLI --version).
  Первый полный прогон: 3422 passed; после redaction/completion regression tests
  целевой прогон SDK: 19 passed. Финальный общий прогон с Chromium, Docker и настоящим
  target npm: **3429 passed, 40 skipped; 152 файлов passed, 2 skipped (154 total)**.
- Успешны build:packages, backend и production UI, ESLint затронутых SDK/API/UI
  модулей, formatting, lockfile lint и git diff --check. UI typecheck: только прежние
  board-view.tsx:1257,1298. Существующие SIGINT/SIGTERM warnings не скрывались.
- Live-model requests, реальные provider keys и внешний SSH не использовались.
  Интерактивный OAuth/master remote discovery не реализованы; имеющийся target OAuth
  может использовать native SDK. Это не production/live-model acceptance и не полная
  platform matrix: проверки остаются в 5.4. [Инструкции и матрица SDK](execution-environments-sdk.md).
- Удалены только собственные ephemeral Docker test containers/images/volumes;
  production automaker-server и automaker-ui не пересобирались/не перезапускались.
  Для нового UI/API нужно обновить обе части. Следующий этап — **5.3**, общие app
  services, Docker feature workflow, Git/terminal/dev-server/preview/memory writers.

### Этап 5.3a — Docker/Auto feature workflow (2026-10-17)

- Выделен общий `FeatureWorkspaceService`; прежний SSH adapter остаётся совместимым
  экспортом. Новые Docker/Auto features получают отдельную pinned ветку/worktree,
  target branch/base commit и эффективный runtime cwd. Все source/Git/worktree
  команды выполняются внутри Docker; server paths остаются control-plane identity.
- Неизменяемый environment binding с `featurePreparation` сохраняется **до**
  создания worktree. При рестарте/смене default задача не перескакивает между Docker
  и Local. Intent фиксирует base commit до Git effects. Потерянный ответ допускает
  только read-only reconciliation полной чистой исходной working copy; missing,
  partial или изменённый workspace блокируется без replay, reset и удаления refs.
- Direct и CLI/SDK используют runtime cwd; сняты Docker Kanban guards 5.2.
  Execution/resume, context, pipeline tests, Verify, Commit, ff-only merge и feature
  shell hooks используют один backend. Stop сохраняет managed lease до cleanup.
  Controller worktree resolver и host TestRunner не используются этим workflow.
- Auto Local fallback требует отдельного действующего server consent и допустим
  только при Docker preflight failure. Его worktree также фиксируется, а последующая
  доступность daemon не переносит задачу. Native Windows managed feature fallback
  явно отклоняется до POSIX commands; отдельный Local workflow не изменён.
- Feature dialog показывает Docker cwd/ветки и подтверждаемый merge через общий
  `/api/auto-mode/merge-environment-feature`; прежний SSH endpoint сохранён.
  Checkbox approval привязан к конкретной project/feature/workspace identity.
  Незавершённая подготовка видна; Verify/Commit/hooks не создают workspace неявно.
- Старые Docker feature bindings без workspace metadata отклоняются с просьбой
  создать новую feature. Pinned legacy/Local runs не мигрируют. Merge не делает
  checkout/reset/push/force/delete и отказывает при dirty/diverged source/target.
- Project-wide/unbound Docker/Auto shell hooks не исполняются на host. HTTP/ntfy
  и workflow metadata остаются controller. Автоматические managed memory usage/
  learnings writers отключены до 5.3c. Общие Git UI, terminal/dev-server/preview
  ещё не мигрированы; предупреждение и актуальная матрица сохранены.
- Добавлены 13 тестов: 9 managed intent/Auto fallback/lost-result/partial-checkout/
  platform/symlink checks, 2 UI, 1 common merge API, 1 real-Docker feature workflow.
  Docker suite дополнительно расширен Direct feature tools и каждым SDK в отдельном
  feature worktree. Полный CLI facade/tests/Verify/Commit/merge/hooks проверен с
  container-only marker, который обнаруживает host execution при общем storage.
- Финальный полный прогон с Chromium, настоящим Docker и target npm install:
  **3442 passed, 40 skipped; 153 файлов passed, 2 skipped (155 total)**, 175 секунд.
  Дополнительный UI прогон после обновления текстов Settings: 31 passed.
  Build:packages, server, production UI, ESLint затронутых модулей, Prettier,
  lockfile lint и git diff --check успешны. UI typecheck сохраняет только две
  прежние ошибки board-view.tsx:1257,1298. Известные SIGINT/SIGTERM MaxListeners
  и unused NtfyEndpointConfig warning не скрывались; новых зависимостей нет.
- Проверки не используют live model/provider credentials или внешние SSH hosts.
  Docker fixtures принадлежат только тестам и очищаются с проверкой ownership;
  рабочие automaker-server/UI не пересобирались и не перезапускались.
  Для установки изменений требуется обновление обеих частей приложения.
  Следующий блок — **5.3b: общий Git UI и project/worktree операции**; весь этап 5
  и платформенная/live-model acceptance 5.4 не завершены.

### Этап 5.3b — основной Git UI / project-worktree adapter (2026-10-18)

- Добавлены общий `ProjectGitService` и фиксированный target-side Git worker.
  `/api/git` и `/api/worktree` разрешают backend **до** legacy path/Git handlers:
  Docker/SSH errors не превращаются в пустые success responses или Local fallback.
  Просмотр metadata не подключается к SSH/Engine; Git browsing не создаёт окружение,
  checkout или worktree и не делает Auto Local fallback.
- Реализованы status/enhanced-status/check-changes, project/file diff и details,
  commit/branch log, cached branches/remotes, list/info, stage/unstage, commit и create
  worktree. Git commands и synthetic diff/filesystem checks выполняются на target.
  Node запускает Git с argv/literal pathspecs, отключёнными hooks/fsmonitor/external
  diff/textconv/GPG. Traversal, absolute/.git paths и выход через symlink отвергаются.
- SSH UI использует controller aliases; runtime cwd выводится отдельно. Saved pins
  важнее default и `useWorktrees:false`; прежние remote feature worktrees остаются
  видны после выбора Local/другого профиля. Retired target entries могут быть metadata-only;
  их status не берётся из одноимённого каталога другого target. Server-only reopen по
  metadata-resolved binding ID не может создать новый binding при его отсутствии.
- Remote mutations требуют `environmentTargetId` из inspection/list/diff. Старый ID
  отклоняется и при переходе remote → Local, **до host mutation**. Client очищает scope
  только после Local inspection/read. UI writes сериализуются внутри controller;
  активные project features (включая symlink project aliases) блокируют mutations.
  Это не atomic lease относительно внешнего Git/параллельного старта нового агента.
- В desktop/mobile Worktree panel показан фактический Git backend. Source editor
  проверяет среду до mount: для SSH не стартуют controller readers/autosave; вместо
  неподключённого remote editor показан явный alert. Docker editor использует shared
  controller files. Source branch selector не меняет Kanban target branches.
- Advanced Git (delete/discard/stash/rebase/cherry-pick/general merge), network/PR и
  source-editor remote backend не реализованы: старые handlers для remote не вызываются.
  Для feature merge сохраняется отдельный ff-only flow 5.1/5.3a. Listing не делает fetch,
  gh/network discovery или forwarding controller credentials. Create не запускает
  root sync, configured-file copy либо init scripts. [Подробная матрица](execution-environments-git.md).
- Новые проверки: fixed worker на настоящем Git; SSH HTTP routers с намеренно
  несовпадающим controller repo, offline pin и default changes; no-preparation routing,
  symlink activity guard; target-token HTTP client, UI label и editor mount gate;
  дополнительный настоящий Docker Git workflow. Без live-model/provider keys.
- Добавлены **48 тестов**: 10 worker, 8 routing/activity, 19 SSH HTTP, 10 UI/client/
  editor gate и 1 Docker. Финальный общий прогон с Chromium, реальным Docker и
  target npm install: **3490 passed, 40 skipped; 159 файлов passed, 2 skipped
  (161 total)**, 194 секунды. Успешны build:packages, server и production UI,
  ESLint затронутых модулей, Prettier, lockfile lint и git diff --check.
  UI typecheck сохраняет только две прежние ошибки board-view.tsx:1257,1298;
  существующие SIGINT/SIGTERM MaxListeners warnings не подавлялись.
- Новых зависимостей нет. Рабочие server/UI контейнеры не пересобирались и не
  перезапускались; удаляются только принадлежащие тестам ephemeral ресурсы.
  Для применения изменений требуется обновление обеих частей приложения.
  Следующий блок — **5.3c: terminal/dev-server/preview/port forwarding/memory writers**.
  Полный Git UI parity и platform/live-model acceptance пока не заявлены.

### 5.3c.1 — shared project memory через runtime (2026-10-18)

- Добавлен фиксированный target-side memory worker и `RuntimeMemoryStore`:
  memory читается/обновляется в authoritative project root SSH/Docker/Auto fallback,
  не в feature worktree и не в controller copy SSH. Смена default и restart
  сохраняют прежний backend. Нет новых dependencies или обновления pinned SSH worker.
- Managed context возвращает memory отдельно, без YAML metadata в prompt, сохраняя
  общий budget с source context. `loaded` обновляется после проверки полного context;
  completion usage подключён к ExecutionService, pipeline (включая resume) и chat.
  Waiting approval/skip-tests и неуспешный provider result не увеличивают success.
  Отсутствующие инструкции корректно обрабатываются также в Auto Local runtime.
- Chat до binding не запускает controller memory loader для Docker/SSH/Auto;
  инструкции и memory загружаются после подготовки из выбранной среды.
- Writer сериализует изменения по project target, использует target lock и SHA-256,
  fsync/atomic rename с сохранением permissions. Удалённый после загрузки файл не
  воскрешается; conflict/lock/unknown acknowledgement не повторяет запись и не
  разрешает Local fallback. Stale lock recovery только после проверки target.
- Callback learnings получает `FeatureMemoryWriter` для закреплённой среды.
  Сам extractor в facade остаётся stub: новых model calls/расходов нет.
  [Memory guide](execution-environments-memory.md) описывает ограничения и recovery.
- Добавлены 28 тестов: 24 real-files/worker, 2 completion routing, 1 real SSH
  shared-memory/restart/default test и 1 Docker lifecycle/worktrees test.
  Расширены существующие реальные SSH chat/facade и Docker CLI Kanban сценарии
  проверкой автоматических usage writes, без настоящих model credentials.
- Целевые проверки: 143 tests passed; реальный Docker — 11 passed, 1 skipped
  (повторный target SDK install в этом целевом прогоне отключён). Финальная общая
  регрессия server/types/model-resolver/UI с Chromium, Docker и target SDK install:
  **3518 passed, 40 skipped; 160 файлов passed, 2 skipped (162 total)**,
  237 секунд. Существующие SIGINT/SIGTERM MaxListeners warnings не подавлялись.
- Server и production UI builds успешны. UI typecheck сохраняет ровно две прежние
  ошибки board-view.tsx:1257,1298. ESLint: 0 errors, 6 прежних warnings в agent-service
  и execution-service tests; они не подавляются и не исправляются этим этапом.
- Следующий — **5.3c.2: интерактивный terminal**. Dev-server/manual tests,
  preview/port forwarding — 5.3c.3; полный 5.3 и platform/live-model acceptance
  ещё не завершены. Ideation/internal text helpers также пока не перенесены.
  Рабочие контейнеры не пересобирались/не перезапускались; текущие изменения требуют
  обновления server для применения.

### 5.3c.2 — integrated terminal через target PTY (2026-10-18)

- Добавлены фиксированный Linux/Python 3 PTY supervisor и duplex transport через
  `docker exec -i`/проверенный ssh2 exec. Node-pty controller используется только
  для Local/legacy, не как remote fallback. SDK/agent worker protocol не меняется.
- TerminalService выбирает подготовленный project/worktree через общий target
  selector, сверяет inspected ID и проверяет binding/working copy/ownership/host key
  до shell dispatch. Существующий target фиксируется до закрытия session, в том числе
  после default/profile changes. Auto не подготавливает fallback при terminal open.
- REST session create/list/get и WebSocket connected возвращают фактическую среду.
  UI inspect→create использует все пути создания, включая initial cwd/tab/split/layout.
  Header показывает backend и начальный runtime cwd. Browser reconnect сохраняет
  прежний shell/scrollback; resize не отбрасывает remote output.
- Supervisor обрабатывает input/Unicode/Ctrl-C/resize и bounded queues. Stop в
  здоровом соединении подтверждается после cleanup обычных jobs PTY session.
  Linux child subreaper забирает orphaned jobs (проверка на 25 фоновых процессах),
  чтобы завершённые команды не оставляли zombies на container PID 1.
  Docker activity marker удерживает контейнер от idle stop. Потеря transport/heartbeat
  завершает shell без автоматического replay; неизвестный outcome выдаётся как 255,
  а не обещание подтверждённого cleanup. Намеренная daemonization не покрывается.
- Backend restart не восстанавливает живой PTY: target lease истекает за 15 секунд;
  UI не создаёт замену исчезнувшей сессии. Startup command разрешается только первому
  WebSocket connection; at-most-once попытка, не гарантия доставки.
- Application/terminal auth сохранены; размеры и input ограничены, pending creates
  учитываются в лимите sessions. Controller env/RC/themes не копируются на target.
  Внешние OS terminal/editor actions и неподготовленные targets остаются явно
  неподдержанными. SSH требует Python 3; установка не выполняется скрыто.
- Добавлено 28 тестов: 9 настоящего PTY worker (включая heartbeat), 7 реального SSH/
  HTTP/auth/pinned features/transport loss, 7 validation/creation concurrency и 4 UI
  inspect→create, 1 настоящего Docker PTY. Docker test opt-in добавляет Python только
  в свой disposable fixture image, поскольку текущий server test base его не содержит;
  рабочие image/server/UI не меняются. Fake/live-model calls для terminal не нужны.
- Целевой PTY/SSH/legacy/UI прогон: 62 tests passed до добавления последних HTTP/
  validation cases; отдельный SSH/HTTP — 7 passed, Docker lifecycle/Git/PTY — 3 passed.
  Первый общий прогон: 3545 passed и один timeout существующего browser settings
  сценария после reload; отдельно browser/PTY/SSH — 17 passed, без повторения timeout.
  Финальная полная регрессия с Chromium, Docker PTY и настоящим target SDK install:
  **3546 passed, 40 skipped; 163 файлов passed, 2 skipped (165 total)**, 203 секунды.
  Supervisor в финальном прогоне уже включает subreaper/25-job cleanup. Прежние
  SIGINT/SIGTERM MaxListeners warnings не подавлялись.
  Server/production UI builds прошли, ESLint затронутого source/new tests без ошибок
  и warnings; Prettier и git diff --check успешны. UI typecheck по-прежнему показывает
  две прежние ошибки board-view.tsx:1257,1298.
- Инструкции, требования и границы restart/reconnect описаны в
  [Terminal guide](execution-environments-terminal.md). Рабочие контейнеры не
  перезапускались; для применения нужно обновить server и UI.
- Следующий — **5.3c.3: dev-server/manual tests, preview и port forwarding**.
  Полный 5.3, SSH source editor, advanced Git parity и платформенная/live-model
  acceptance пока не заявлены.

### 5.3c.3a — ручной test runner Docker/SSH (2026-10-18)

- Блок 5.3c.3 разделён: ручной test runner завершён отдельно от dev-server и
  preview/port forwarding. Последние требуют согласованного deployment/HTTP/WS
  решения без пересоздания pinned container и без доступа preview JavaScript
  к Automaker session/API через общий browser origin.
- Новый dispatcher перед legacy validators/Git router обрабатывает Start/Stop/Logs
  подготовленного Docker/SSH project/worktree. UI делает свежий metadata inspect,
  сервер сверяет target ID до dispatch. Команда берётся из настроек канонического
  проекта; присланные client command/projectPath не перенаправляют её на controller.
  testFile передаётся одним quoted аргументом, traversal/absolute/NUL отклоняются.
- PTY supervisor расширен noninteractive `/bin/sh -c` режимом с target env + CI.
  Это отдельный долгоживущий transport, без 600-second agent RPC limit, host shell
  fallback, controller env/auth copy или скрытых dependency installs. Нужны Linux
  и Python 3, как для managed terminal. Docker activity marker удерживает существующий
  контейнер от idle stop; port bindings и сами project containers не меняются.
- Рабочая сессия сохраняет исходный transport/cwd после default/profile changes,
  включая retired feature pins. Logs/Stop по ID не ищут новую среду. Неизвестные
  managed IDs не попадают в legacy runner. Обычные Local/legacy tests сохранены;
  активные Local и managed runs не дублируются друг другом. Latest logs выбираются
  между обеими историями, а не всегда из старого remote record.
- Stop ждёт подтверждённый session cleanup; потеря transport — Error с null exitCode,
  не фиктивный Cancelled/Passed. Настоящий command exit 255 остаётся Failed.
  Исправлена PTY EOF/waitid race: EOF вывода не считается завершением процесса;
  продолжается child monitor/heartbeat/Stop и проверяется реально reaped child status.
  Команды с полностью перенаправленным stdio не убиваются преждевременно и не
  выдаются за Passed. При закрытии terminal/supervised command exit от SIGKILL — -9.
  EOF/15-second heartbeat lease закрывают target без replay после backend crash;
  историю backend не восстанавливает. Намеренная daemonization не покрывается.
- Лимиты: 8 active/pending managed runs, 100 records, последние 50 000 символов
  логов на backend/UI. Handshakes учитываются до ready; shutdown ждёт pending opens
  и останавливает их transport. Удаляются только старые records в памяти, не файлы.
- UI показывает фактические backend/cwd и completion errors. Дубликаты start/fetch
  не стирают output и не оживляют уже завершённую сессию. Poll по старому ID ловит
  missed completion/backend restart без создания нового run. Панель обновляется
  и при rollover bounded scrollback с неизменной длиной.
- Добавлено 30 тестов: 10 настоящего SSH/HTTP/auth/source isolation/old feature pin/
  profile changes/disconnect/legacy compatibility/log limits; 3 lifecycle limits;
  2 worker command/closed-stdio cases; 1 настоящий Docker test runner; 14 UI tests
  inspect/start/stop/history/metadata/restart/rollover. Целевой прогон после последнего
  исправления history selection: **37 passed**; после изменения EOF monitor —
  **31 passed** (worker/SSH terminal/manual tests/lifecycle limits). Отдельный Docker прогон:
  **13 passed, 1 skipped** (target SDK install выключен только в этом прогоне).
- Финальная общая регрессия server/types/model-resolver/UI с Chromium, настоящими Docker PTY
  и SDK install: **3576 passed, 40 skipped; 169 файлов passed, 2 skipped (171 total)**,
  210 секунд, с последней версией EOF monitor и history selection.
  Прежние SIGINT/SIGTERM MaxListeners warnings не подавлялись.
  Server и production UI builds успешны; UI typecheck — те же две прежние ошибки
  board-view.tsx:1257,1298. ESLint затронутого source/new tests без errors/warnings;
  Prettier и git diff --check успешны. Зависимости не добавлялись.
- Инструкции и ограничения: [Manual tests guide](execution-environments-tests.md).
  Pinned Auto/Local manual runs ещё явно отклоняются; не выдаются за управляемую
  сессию с подтверждённым cleanup. Этот parity остаётся в 5.3c.3b. Pipeline/Verify
  tests и обычный Local/legacy runner не менялись. Рабочие server/UI не обновлялись
  и не перезапускались; для применения нужен rebuild/restart приложения.
- Следующий — **5.3c.3b: dev-server/preview/port forwarding + оставшийся Local parity**.
  Полные 5.3c/5.3/5.4, SSH source editor, advanced Git и live-model acceptance
  не отмечены завершёнными.

### 5.3c.3b — dev-server/preview и pinned Local tests, Linux MVP (2026-10-18)

- Новый dev dispatcher до legacy validators/Git handlers: Start/Logs/Stop/List
  через подготовленный project/worktree target. Start сверяет fresh inspected ID,
  берёт команду из канонических project settings, игнорирует client command/root
  override. Retired feature pin и active session важнее нового default/profile.
  Просмотр managed state не инициализирует legacy host-process recovery.
- `/bin/sh -c` запускается target PTY supervisor без 600-second RPC limit,
  target env + PORT/HOST/BROWSER; CI для dev принудительно не включается.
  Auto-detection scripts.dev по target package.json/lockfile: npm/pnpm/yarn/bun;
  Vite/Next получают port/host args. Custom command поддерживает `{{port}}`.
  Неподготовленный target, занятые порты и неправильный PORT не приводят к
  host fallback, убийству чужого listener или повтору команды по stdout URL.
- Gateway резервирует 3100–3119 у controller, target — 4100–4119. Каждый fixed
  Node TCP relay проверяет `/proc/net/tcp*`, inode/fd и session владельца до/после
  connect; PID приходит от supervisor, не HTTP клиента. Docker exec/SSH exec
  передают бинарный stream с backpressure; для pinned Local запускается native
  Node/Python transport. Project container ID/mounts/port bindings не меняются.
- Отдельный HTTP origin сохраняет root-relative assets и WebSocket/HMR без path
  rewriting в Automaker API origin. Bootstrap обменивает fragment key на HttpOnly/
  SameSite=Strict cookie, ключ отзывается закрытием gateway и меняется при новом run.
  Controller cookies/API/session/terminal/authorization headers не проходят target;
  target Set-Cookie/Clear-Site-Data/CORS/CSP не проходят browser. Собственная CSP
  блокирует workers/frames/external connects. API/WS guard отвергает preview origins
  независимо от разрешающих CORS, сохраняя native Electron header-auth.
- Redirects переписываются только для самого preview/фиксированного target listener;
  external/malformed Location возвращает 502, не uncaught exception controller.
  Неизвестный managed ID не восстанавливает процесс и не запускает legacy handler.
  Stop требует исходный session ID, ждёт cleanup и отзывает активные HTTP/WS.
  Disconnect — retained error/null exitCode; backend restart — lease cleanup без replay.
- Лимиты: 8 pending/active dev runs, 100 records, 50K log chars, 32 in-flight HTTP/
  upstream bound, 64 incoming connections; 120-second HTTP/relay idle bounds.
  Slow global event clients отключаются при bufferedAmount > 1 MiB. Managed records
  не пишутся в legacy dev-servers.json и не восстанавливаются по host port.
- UI сохраняет captured IDs/backend/cwd/public host, не останавливает новую сессию
  по старому stopped event. Log polling использует старый ID, stale fetch не
  переключает target, capability fragments не попадают в lifecycle console logs.
  Pinned Auto/Local manual tests теперь проходят через native Linux supervisor;
  остальные платформы явно отклоняются, обычный Local/legacy runner сохранён.
- Compose публикует только server 3100–3119 на host loopback; remote/TLS требует
  осознанной deployment настройки. Это изменения конфигурации, не redeploy:
  рабочие server/UI/project containers не перезапускаются автоматически.
  YAML validated с execution override; unset ANTHROPIC_API_KEY warning сохранён.
- Browser MVP границы видны в settings/feature/Git UI и
  [Preview guide](execution-environments-preview.md): cookie apps, service workers,
  iframes/external backend connects не поддержаны. Нужен чистый browser origin;
  ранее зарегистрированный чужой worker может перехватить bootstrap до новой CSP.
  Нет обещания полноценной межпроектной storage isolation; следующий 5.3c.3c
  переводит browser origins на уникальные per-run hostnames, прежде чем снимать
  cookie/worker ограничения. Полный 5.3c/5.3 и platform/live-model acceptance не заявлены.
- Проверки: новый real SSH/HTTP/WS/old feature pin/unrelated-port/transport-loss
  прогон — **6 passed**, включая настоящий Vite module load и hot update в Chromium,
  запрет preview API/WS и сохранение controller HttpOnly cookie. Native Local feature
  workflow — **10 passed** (один новый combined manual tests/preview case).
  UI dev hooks/client — **17 passed** (6 новых). Последний targeted gateway/policy/Git
  прогон с malformed/target redirects — **26 passed**.
- Первый full run: 3596 passed, одна устаревшая Git guard assertion для теперь
  поддержанного start-dev. Вторая общая проверка пересеклась с финальным redirect fix
  и получила несовместимый cached module/test snapshot; после фикса targeted — зелёный.
  Запущен чистый acceptance run без последующих изменений source/tests; результат ниже.
- Acceptance с последней версией: **3596 passed, 40 skipped**, один timeout прежнего
  browser settings reload case (`direct-provider-browser.test.ts:229`), подобные
  reload timeouts уже отмечены в 5.3c.2. Отдельно старый browser + новый SSH/Vite
  scenario — **7 passed**. Без изменения кода финальный полный прогон с меньшей
  параллельностью (3 workers), Chromium, настоящими Docker PTY/preview и target SDK
  install: **3597 passed, 40 skipped; 174 файла passed, 2 skipped (176 total)**,
  296 секунд. Добавлен **21 тест**: 3 policy, 4 gateway (включая redirects), 6 SSH/
  browser, 1 native Local, 1 real Docker и 6 UI. Прежние SIGINT/SIGTERM
  MaxListeners warnings не подавлялись. Prettier и git diff --check успешны.
- Server и production UI builds успешны; UI typecheck сохраняет только две прежние
  ошибки board-view.tsx:1257,1298. Source/new tests ESLint: 0 errors; одна прежняя
  unused-disable warning dev-server-service.ts:373. Новые зависимости не добавлялись.
- Следующий — **5.3c.3c: per-run preview origins и cookie/storage/worker parity**.

### Запуск обновлённого приложения (2026-10-18)

- По запросу пользователя пересобраны и запущены server/UI через основной
  `docker-compose.yml`. Данные и прежний ключ входа сохранены; перед пересозданием
  сделаны приватные резервные копии `/data` и `/projects`.
- Настоящий production startup выявил несовместимый named import `ssh2.utils`
  в native Node ESM, скрытый interop тестового bundler. SSH state/transport теперь
  используют default import CommonJS-пакета; добавлены две проверки импортов через
  отдельный native Node process. SSH suite и новые проверки: **16 passed**;
  server build, native import smoke, source ESLint и git diff --check успешны.
- После повторной сборки server healthy, без рестартов. Health через UI proxy —
  HTTP 200, настройки без авторизации — HTTP 401, с действующим ключом — HTTP 200.
  В Chromium проверены настоящий login и видимость страницы
  `settings?view=direct-provider`, без page errors. Тестовая browser session завершена.
- Preview-порты 3100–3119 опубликованы только на loopback. Docker daemon/socket
  не подключён: прежние права установки не расширялись. Полный regression suite
  после исправления импорта повторно не запускался; полный прогон выше относится
  к завершению 5.3c.3b до этого deployment fix.
