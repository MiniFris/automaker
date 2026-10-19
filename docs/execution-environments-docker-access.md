# Доступ Automaker к Docker Engine

Кнопка **Check Docker access** выполняет только ограниченный по времени
`docker info --format '{{json .ServerVersion}}'` от имени процесса сервера Automaker.
Она не создаёт контейнеры, не скачивает образы, не меняет права и не включает sandbox.
Успешный ответ не доказывает разрешение create/start/exec/remove и доступ к проекту.

На этапе 3 добавлена отдельная **Prepare and verify saved Docker environment**:
она явно готовит образ, проверяет lifecycle и (в Project Settings) storage.
Готовый opt-in Compose и ограничения описаны в [Docker guide](execution-environments-docker.md).

## Automaker работает непосредственно в системе

1. Установите/запустите Docker Engine либо Docker Desktop. Для rootless Engine
   используйте его context/socket, а не автоматически `/var/run/docker.sock`.
2. Определите пользователя, под которым работает **backend Automaker**. Пользователь
   браузера и даже вашего терминала может быть другим.
3. Настройте доступ этому пользователю. В Linux с rootful Docker один из вариантов —
   членство в группе Docker. Это даёт широкие полномочия на хосте, а не только права
   создавать «безопасные» контейнеры. Для systemd учитывайте пользователя службы и
   её группы; после изменения членства перезапустите службу/сессию Automaker.
4. Убедитесь, что `docker info` работает без интерактивного sudo под этим пользователем.
   Затем нажмите **Check Docker access** в Automaker.

На macOS/Windows проверьте, что Docker Desktop запущен, Linux-контейнеры доступны,
а backend использует правильный Docker context и Docker CLI присутствует в его PATH.

## Automaker сам работает в контейнере

Стандартный `docker-compose.yml` сейчас **не предоставляет** доступ к Engine.
`IS_CONTAINERIZED=true` сообщает только о способе запуска Automaker.

Нужно явно настроить следующие компоненты серверного контейнера:

1. Docker CLI в образе сервера либо иной поддерживаемый клиент Engine API.
   CLI в контейнере UI/nginx не помогает backend.
2. Подключение к daemon: socket или заранее настроенный SSH/TLS Docker context.
3. Для локального Unix socket — mount именно socket вашего Engine в серверный
   контейнер и права на него у конечного пользователя процесса Automaker.

Пример **фрагмента**, а не готового рабочего override для всех установок:

```yaml
services:
  server:
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    group_add:
      - '<numeric-socket-gid>'
```

Путь и GID проверяются на хосте Engine; у rootless/Desktop пути могут отличаться.
**Важно для текущего образа:** entrypoint переключается на пользователя `automaker`
через `gosu`. При этом дополнительные группы процесса могут быть сброшены.
Поэтому одного `group_add` недостаточно: образ/entrypoint должен обеспечить членство
пользователя `automaker` в группе с фактическим GID socket. Не заменяйте это запуском
всего приложения от root. Готовый `server-docker` target и
`docker-compose.execution.yml` уже выполняют эту настройку при явном opt-in;
обычный `server` target/Compose не получает доступ к daemon автоматически.

После настройки пересоздайте только сервер обычным способом развёртывания и проверьте
доступ от конечного пользователя процесса, а затем из UI Automaker.

## Docker context и удалённый Engine

В профиле можно указать имя context, который уже настроен **в среде backend**.
Без имени используются текущие настройки Docker CLI сервера, включая Docker context
и переменные подключения. Context на компьютере с браузером не учитывается.

Для удалённого Engine используйте SSH либо TLS с проверкой сертификатов. SSH-ключи
и сертификаты должны быть доступны управляющему процессу, но не проектному агенту.
Не открывайте незащищённый Docker TCP API и не отключайте проверку ключа SSH-хоста.

## Отдельные проверки готовности

- Создание/запуск/exec/удаление отдельного тестового контейнера — отдельная явная
  проверка lifecycle кнопкой подготовки, без host mounts и с очисткой своих ресурсов.
- Каталог проекта/volume: пути bind mount разрешает daemon host, а не контейнер
  Automaker. Доступный Engine не означает, что локальный путь доступен на том хосте.
- Docker socket предназначен управляющей части Automaker. Не передавайте его
  проектным контейнерам и не используйте `chmod 666` или `privileged` как обход.
- Ошибка Docker не должна незаметно переводить запуск в Local.

Источники:

- [Docker CLI info](https://docs.docker.com/reference/cli/docker/system/info/).
- [Linux permissions](https://docs.docker.com/engine/install/linux-postinstall/).
- [SSH/TLS daemon access](https://docs.docker.com/engine/security/protect-access/).
- [Daemon-side bind mounts](https://docs.docker.com/engine/storage/bind-mounts/).
