# Dev-server и preview — 5.3c.3b (Linux MVP)

Run Dev Server в Worktree UI запускает команду в **подготовленном Docker/SSH
workspace или pinned Auto/Local feature**, не на controller вместо remote checkout.
Нужны Linux, Node.js и Python 3 на выбранном target. Обычный Local/legacy runner
оставлен без смены backend. Native Windows/macOS для pinned supervisor — ещё не
проверены/не поддержаны; это не повод автоматически запускать команду в другой среде.

## Запуск

1. Подготовьте project environment, установите зависимости проекта на target.
2. Укажите **Dev Command** в Project Settings или оставьте пустым для auto-detection
   `package.json` → `scripts.dev` с npm/pnpm/yarn/bun по lockfile.
   Для Vite добавляются `--port … --host 127.0.0.1 --strictPort`, для Next dev —
   `--port … --hostname 127.0.0.1`. Остальные scripts должны учитывать `PORT` сами.
3. Custom command получает target env + `PORT`, `HOST=127.0.0.1`, `BROWSER=none`.
   `{{port}}` в команде заменяется выбранным числом. Например:
   `npm run serve -- --port {{port}}`. Команда исполняется `/bin/sh -c`; это
   осознанная shell-команда пользователя. CI принудительно не включается.
4. Нажмите Start. UI сверяет target identity; после подтверждения принадлежащего
   процессу HTTP listener кнопка Open открывает отдельный authenticated preview.

Startup не устанавливает зависимости и не угадывает другой endpoint по stdout.
Если программа игнорирует PORT, проверьте logs и исправьте command/config.
Уже занятые порты **не освобождаются убийством чужих процессов**. Для custom
hostnames Vite может требовать `server.allowedHosts`; не ставьте `allowedHosts: true`
без понимания риска. HMR должен использовать тот же browser origin/port, без
прямого обхода proxy на SSH-host port.

## Порты и установка Automaker

Зарезервирован server range **3100–3119**, target listener — соответствующий
**4100–4119**. В контроллерном namespace резервируется gateway; на target отдельно
проверяется свободный порт. Каждый TCP relay проверяет listener inode и Linux
session владельца через `/proc`, до и после connect. Произвольные host/port/URL из
браузера не принимаются. Это не универсальный SSH tunnel/SSRF endpoint.

Managed Docker project container не получает `-p`, host network или Docker socket;
его ID, mounts и pin не меняются. Relay — фиксированный Node builtin TCP bridge
через `docker exec -i`/trusted SSH exec; для Local используется явный native process.
Нового контейнера на preview не создаётся.

- Native local browser: gateways слушают `127.0.0.1`. Для удалённого browser клиента
  явно задайте `AUTOMAKER_PREVIEW_BIND=0.0.0.0` и настройте firewall/TLS.
- Стандартный Compose публикует server range 3100–3119 на **127.0.0.1 хоста**.
  Требуется обновление/recreate **server приложения** при обычном deployment;
  работающие project containers ради портов не пересоздаются.
- Удалённый доступ к Compose: `AUTOMAKER_PREVIEW_PUBLISH_ADDRESS=0.0.0.0` открывает
  этот range снаружи. Не делайте этого без защищённого транспорта/firewall.
- Предпочтительно использовать TLS reverse proxy и
  `AUTOMAKER_PREVIEW_PUBLIC_URL=https://preview-{port}.example.net`.
  Настройте DNS/certificate и каждый hostname на соответствующий server port;
  HTTP Upgrade/WebSocket обязательно proxy-ятся. UI сохраняет настроенный hostname,
  а не заменяет его текущим Automaker hostname. Без template используется hostname
  browser клиента и gateway port. Template должен быть origin без path/query/hash,
  с `{port}` в hostname или port. Это deployment-настройка, не SSH profile.
- В Electron-only/dev-server/custom Compose deployments range нужно опубликовать
  аналогично. Docker socket access сам по себе не публикует server preview ports.
- Не используйте зарезервированный range для API/UI Automaker. Если Docker сообщает,
  что host-порт занят, не убивайте чужой процесс автоматически: устраните deployment
  conflict или используйте отдельный TLS ingress к внутренним server ports.

Без опубликованного range/ingress сервер внутри Docker может запустить target
успешно, но browser не сможет открыть gateway. Это ошибка сетевого deployment,
а не основание перенести dev process на host или пересоздать pinned контейнер.

## Browser auth и границы MVP

URL содержит случайный session key **во fragment**, не в HTTP query/path.
Фиксированная bootstrap page убирает fragment из history и получает собственную
HttpOnly/SameSite=Strict preview cookie. Ключ действует только до закрытия gateway;
новый run на том же порту получает новый ключ. Не делитесь ссылкой с теми, кому
не хотите давать доступ к проектному preview.

Используйте чистый browser origin/profile для зарезервированного preview range.
Если эти host/ports прежде обслуживали другие приложения, сначала удалите их
service worker registrations и storage через browser DevTools: ранее установленный
worker способен подменить navigation/bootstrap до получения новых CSP headers
([Service Worker fetch/response interception](https://www.w3.org/TR/service-workers/#fetch-event-respondwith)).
MVP блокирует новые worker registrations, но не гарантирует устранение чужого
предыдущего browser state. Для строгой межпроектной/межзапусковой изоляции нужен
уникальный hostname на run; эта часть ещё не реализована. Не храните в MVP preview
production credentials. Смена порта не изолирует cookies одного hostname.

- Automaker cookies, Authorization, API/session/terminal keys и forwarding auth
  headers никогда не пересылаются target web-приложению.
- Target `Set-Cookie`, `Clear-Site-Data`, CORS и CSP headers не могут менять auth
  controller browser session. Target cookies пока вообще не проксируются.
  Authorization удаляется независимо от источника: project bearer/basic-login
  приложения тоже не получают полноценную поддержку до следующего origin-parity блока.
- Preview origins/referrers запрещены на Automaker API и его WS независимо от
  разрешающих CORS настроек. No-referrer cross-site subresources/navigations и
  opaque cookie contexts также не превращаются в API-authenticated clients.
  Native Electron key-auth остаётся доступен; ключи не выдаются preview.
- CSP запрещает workers/service workers, frames и cross-origin browser connects;
  HTTP/WS разрешены для самого preview origin. API проекта нужно проксировать
  через его dev server, не обращаться из browser напрямую к другому backend origin.
  Эти ограничения действуют и на ответы scripts, не только HTML.
- **Cookie-login apps, service workers, iframes и прямые cross-origin backend
  запросы пока не поддержаны.** Для их паритета потребуется отдельный уникальный
  project/run hostname с проверенной cookie/storage/origin isolation, а не общий
  path в API origin Automaker. Не считать текущий MVP полным browser sandbox.

Файловая/OS изоляция — свойство выбранной среды, не proxy: Local имеет права
пользователя Automaker, SSH — удалённого пользователя, Docker — project container.
Свободный TCP порт или просто строка URL в logs не доказывают принадлежность процесса.

## Lifecycle, логи и Stop

Один active/pending dev run на alias, максимум 8 на backend; 100 retained records,
последние 50 000 символов логов. Смена default/удаление профиля не переключают
старый run. Logs и Stop используют captured `managed-dev-*` ID; устаревший Stop
не должен остановить новый процесс на том же alias. Logs показывают backend/cwd.

Stop ждёт PTY session cleanup и отзывает HTTP/WS proxy. Неподтверждённая очистка
после обрыва связи возвращается как error с null exitCode, не фиктивный success.
Backend restart не восстанавливает dev command: EOF/15-second heartbeat lease
закрывают target supervisor, UI сверяет list/logs без автоматического Start/replay.
Managed sessions не сохраняются в legacy `dev-servers.json` и не восстанавливаются
по занятому host port. Намеренная daemonization/смена session/credentials вне cleanup.

HTTP requests ограничены 120 секундами; WS relay имеет 120-second idle timeout
(обычный HMR поддерживает heartbeat/reconnect). Gateway ограничивает TCP connections,
in-flight HTTP и upstream channels; медленный API event client отключается при
накоплении более 1 MiB, без остановки/повтора dev command.

Ручные tests pinned Local теперь используют тот же Linux/Python 3 supervisor;
подробности общего test UX — [Manual tests guide](execution-environments-tests.md).

Протоколы: [Node HTTP Agent](https://nodejs.org/docs/latest-v22.x/api/http.html#agentcreateconnectionoptions-callback),
[Vite reverse proxy/HMR](https://vite.dev/config/server-options#server-hmr).
