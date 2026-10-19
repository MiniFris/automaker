# Управляемый Docker на проект

Статус этапа 5.3a: Direct, Cursor/Gemini/OpenCode и Claude/Codex/Copilot SDK
поддерживают Docker chat и Kanban/pipeline с общей привязкой feature workspace.
Установка SDK и отдельный target key: [SDK setup](execution-environments-sdk.md).
Feature tests, Verify/Commit/ff-only merge и shell hooks выполняются в контейнере.
Основной Git UI (reads, stage/commit/create) подключён в 5.3b; advanced/network/PR
операции явно отклоняются, см. [Git guide](execution-environments-git.md).
Integrated terminal подготовленного target подключён в [5.3c.2](execution-environments-terminal.md).
Ручной test runner подключён в [5.3c.3a](execution-environments-tests.md).
Dev-server/HTTP/WS preview подключён в [Linux MVP 5.3c.3b](execution-environments-preview.md),
без публикации портов project container. Project-wide hooks ещё не переведены:
**это не изоляция всего приложения**. [CLI setup и матрица](execution-environments-cli.md).

## Как включить

1. В Global Settings → Execution Environment создайте Docker profile (необязательно
   указывать context) и выберите его, либо Auto. В Project Settings можно изменить
   выбор только для проекта. Сохранение и просмотр настроек не создают контейнеров.
2. **Check Docker access** проверяет только read-only подключение к Engine от имени
   пользователя backend. Инструкции при ошибке описывают CLI/socket/groups/context.
3. Отметьте разрешение подготовки и нажмите **Prepare and verify saved Docker
   environment**. Это явное действие может скачать/собрать образ и создать контейнеры.
   В Global Settings проверяется lifecycle без mounts. В Project Settings дополнительно
   создаётся/проверяется контейнер проекта и двусторонняя запись в его хранилище.
4. Начните новую сессию/feature. Первый запуск также автоматически готовит
   Docker, если вы пропустили шаг 3. Уже привязанные legacy/Local-запуски не мигрируют.
   CLI/SDK должны быть установлены и авторизованы внутри среды; model endpoint
   и среда инструментов — независимые настройки.

Первое создание образа может занять несколько минут: нужны сеть до registry/Debian
repositories, свободный диск и разрешение Docker build. Базовый образ —
`node:22-bookworm-slim`, с Git, bash, Python, make/g++; результат помечается версией
worker и фиксируется по image ID. В UI не нужно вводить SHA или создавать контейнер.
Обновление base tag не пересобирает уже существующие проектные окружения автоматически.

## Рабочая копия и жизненный цикл

На installation/project создаётся один контейнер, общий для внутренних worktrees.
Все Direct tools — чтение/запись/base64/Edit/LS/Glob/Grep/Mkdir/Delete/shell — и
Direct pipeline tests обращаются к worker внутри него. Поиск пакетный: не отдельный
Docker CLI вызов для каждого файла. Snapshot export/import и ограничения размера
dependency tree отсутствуют; отдельные операции имеют бюджеты чтения/вывода/времени.

Проект монтируется по **тому же абсолютному POSIX пути**, что видит Automaker.
Нет скрытой копии репозитория и двустороннего sync. `node_modules`, `.git` и результаты
доступны Automaker сразу; изменения сохраняются в project storage. `$HOME`/кеши и
другие установленные внутри контейнера файлы сохраняются в его writable layer
между stop/start, но НЕ переживают удаление контейнера. Сам Automaker этот контейнер
по окончании задачи не удаляет. PID 1 останавливается после 15 минут без активных
worker-запросов; последующий запрос запускает тот же контейнер. Это работает и после
рестарта управляющего сервера. Фоновые процессы не считаются отдельной вечной lease.

Worktrees должны находиться внутри корня проекта; `.git`/commondir вне этого корня
не монтируются автоматически. Параллельные задачи используют разные cwd/worktrees,
но имеют доступ к **одному проекту целиком**, не sandbox на каждую feature.

### Kanban / AutoMode (5.3a)

Новая Docker/Auto feature получает `.worktrees/feature-<id>` и отдельную ветку
`automaker/feature-<id>`. Board `branchName` означает целевую существующую local branch
в проекте; при отсутствии используется текущая branch root. Base commit фиксируется
до первого Git effect. Чтение инструкций и `.automaker/context`/`memory` идёт через
runtime; metadata задачи, agent-output и уведомления остаются на controller.
Исходные незакоммиченные изменения root не копируются в feature worktree.

Agent, pipeline tests, Verify (`npm run lint/typecheck`, `npm test`, `npm run build`),
Commit и feature shell hooks используют один container ID и cwd. Context ограничен
32 KiB/file, 64 KiB total; агент может явно прочитать дополнительные файлы.
Memory usage для managed features/pipeline/chat и writer learnings используют
общий project root через runtime (5.3c.1); автоматический extractor остаётся stub.
Подробности — [Memory guide](execution-environments-memory.md).
Project-wide/unbound shell hooks для Docker/Auto не запускаются
на controller. HTTP/ntfy уведомления остаются управляющей частью.

В feature dialog видны фактическая среда, cwd, source/target branch и отдельный
подтверждаемый **Merge remote feature (fast-forward only)**. Это merge внутри
контейнера в pinned target, без push/checkout/reset/удаления worktree. Dirty source,
не та target branch или diverged history требуют ручного разрешения. Git UI использует
target в поддержанных операциях. Integrated terminal запускается внутри выбранного
контейнера; source editor остаётся controller service;
общие project files не означают изоляцию всего приложения.

Docker feature bindings, созданные до 5.3a без workspace metadata, не мигрируют:
создайте новую feature. Новое поле `featurePreparation` сохраняет выбранную среду
до создания worktree, поэтому рестарт или изменение default не перемещает задачу.
Если ответ создания потерян, повторный старт делает только read-only проверку уже
созданного worktree/branch. Если результат нельзя подтвердить, операция не повторяется:
проверьте Git refs/worktrees и server intent state; восстановите ожидаемую identity
вручную либо создайте новую feature. Автоматического destructive repair/GC нет.

Привязка сессии/feature сохраняет installation owner, Engine ID, context, container
ID, image ID, storage mapping и UID/GID. Изменение default/profile не меняет текущую
привязку. Подмена Engine, mounts, ownership, privilege settings или повреждённое
состояние блокируют выполнение, а не пересоздают среду и не повторяют команды.
Контейнеры не мигрируют между contexts; UI reset/migration существующего проектного
окружения и автоматического GC пока нет. Не удаляйте его вручную во время задач. Один controller на DATA_DIR;
несколько одновременно работающих backend с общей директорией состояния не поддержаны.

## Native, Desktop и контейнерная установка

- Linux/WSL backend: bind mount реального пути проекта на daemon host; UID/GID backend.
- macOS backend + Docker Desktop: тот же POSIX путь через file sharing Desktop.
  В этой разработке реально проверен Linux/WSL; macOS требует отдельной платформенной проверки.
- Windows native paths пока не поддержаны этим Docker backend: используйте WSL либо
  Linux Automaker server. PowerShell Local — отдельный backend.
- Automaker в Docker: каталог должен быть writable bind mount или named volume
  **самого server container**, а не его disposable writable layer. Управляющая часть
  читает Mounts server container и вычисляет host bind path либо project subpath в
  named volume. Named volume монтируется только нужной подпапкой, не вместе с другими
  проектами. Требуются Engine 26+ и совместимый CLI; вложенные mounts отвергаются.
- Remote Docker context возможен только при действительно общем storage. Локальный
  путь клиента не становится remote путем сам собой. Двусторонний nonce probe
  проверяет идентичность файлов до агентских команд; ошибка не запускает Local.
  Перенос проекта на другой сервер будет частью SSH-этапа.

Проверка storage создаёт один случайно именованный файл `.automaker-storage-…`,
читает его в контейнере, записывает ответ и проверяет ответ в Automaker, затем
удаляет только этот файл. Ошибка проверки не даёт права агенту исполнять команды.
При недоступном/неверном storage подготовленный контейнер сохраняется для диагностики;
повторная подготовка обязана проверить storage заново.

## Opt-in Compose для Docker controller

Обычный `docker-compose.yml` остаётся без доступа к daemon. Для **новой установки**:

```sh
docker compose -f docker-compose.yml -f docker-compose.execution.yml up -d --build
```

Override выбирает `server-docker` target (Docker CLI/buildx без daemon), предоставляет
socket ТОЛЬКО server и создаёт persistent `/projects` volume. Entrypoint определяет
фактический socket GID и добавляет пользователя automaker в эту группу **до gosu**.
Не нужны `chmod 666`, privileged, ручной image SHA или отдельный контейнер на проект.
Для rootless/Desktop задайте `AUTOMAKER_DOCKER_SOCKET` реальным путём socket на хосте.
Сокет не создаётся как каталог при ошибочном пути. Для SSH/TLS contexts настройте
CLI и credentials у backend отдельно; Unix-socket override для них не обязателен.

**Существующая установка:** сначала сделайте backup/перенос проектов, если они лежат
в старом writable layer `/projects`. Новый volume перекроет этот каталог, а пересоздание
server удалит старый writable layer. Автоматическая миграция существующей установки
этим override не выполняется; не включайте его вслепую поверх неперенесённых проектов.
В этой разработке production server/UI не пересобирались и не перезапускались.

Docker socket даёт управляющей части широкие, фактически host-level полномочия.
Read-only bind socket не ограничивает доступные Engine API. Это осознанное изменение
доверия к **Automaker server**, а не к агентскому контейнеру.

## Отмена, права и Auto

Контейнер не получает socket, volumes-from, host network/PID namespace, privileged,
API keys модели или окружение управляющего процесса. Включены cap-drop ALL,
no-new-privileges, pids limit. Agent работает как UID/GID backend, без автоматического
sudo; сеть bridge доступна для зависимостей. При root backend пользователь внутри
контейнера также root, но не privileged/root на хосте. ОС/языковые зависимости могут
требовать другого базового образа — выбор произвольного custom image UI пока не включён.

Shell использует `/bin/sh`, ограниченный вывод и deadline. Cancel отправляет отдельный
запрос worker, проверяет process identity, завершает process group и ждёт completion.
Убийство локального `docker exec` клиента само по себе не считается отменой. При
непроверенном cleanup запрос завершается фатальной ошибкой; другой параллельный запуск
не останавливается вместе с контейнером. Отделившиеся `setsid` процессы могут потребовать
ручной проверки. Нет rollback, exactly-once или автоматического повтора неизвестной команды.

Auto использует default context и предпочитает Docker. Отдельный server-side consent
**Allow Auto Local fallback** разрешает Local только для нового, ещё не привязанного
запуска при ошибке connection/mapping preflight. Local consent сам по себе не даёт
этого разрешения. Ошибки build/create/start/storage/exec не вызывают downgrade.
Local fallback закрепляется за сессией/feature и требует действующего consent для
следующего request; его нельзя незаметно заменить Docker после восстановления daemon.
Новый managed Auto fallback feature workflow требует POSIX runtime; native Windows
выдаёт явный отказ до worktree commands. Используйте Linux/WSL server либо явно Local.
Session metadata содержит фактическую среду; список чатов показывает Docker/Local
или `Local (Auto fallback)`. Общая карточка среды для всех feature/services — этап 5.

## Проверки

Unit/API/UI tests не требуют daemon и не скачивают образы. Реальный Linux smoke:

```sh
MANAGED_DOCKER_TEST_BASE_IMAGE=automaker-server:latest \
  node_modules/.bin/vitest run --project=server apps/server/tests/integration/managed-docker.test.ts
```

Этот opt-in использует уже локальный Node/Git image для маленького временного test
image: проверяет runtime, но не загрузку production base image/apt. Собственные
временные контейнеры, volume и test tag удаляются после проверки ownership; чужие
контейнеры и Docker build cache не очищаются. Реальный redeploy Compose, macOS/Windows
и SSH этим тестом не проверяются.

Основания mapping и lifecycle:
[Docker bind mounts](https://docs.docker.com/engine/storage/bind-mounts/),
[volume subpaths](https://docs.docker.com/engine/storage/volumes/#mount-a-volume-subdirectory),
[docker exec](https://docs.docker.com/reference/cli/docker/container/exec/),
[официальный CLI image](https://github.com/docker-library/docker/blob/master/29/cli/Dockerfile).
