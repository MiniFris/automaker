# Legacy WebSocket contracts

Зафиксировано: 2026-10-23. Эти контракты должны сохраняться до отдельной
версионированной смены клиента.

## Общий HTTP upgrade

Оба endpoint используют один HTTP server и два `WebSocketServer({ noServer: true })`.

Поддерживаемые paths:

- `/api/events`;
- `/api/terminal/ws`.

Upgrade отклоняется до передачи connection handler, если:

- request определяется как preview API request — HTTP 403;
- не проходит API key/session cookie/session token/short-lived `wsToken` — HTTP 401;
- pathname неизвестен — socket уничтожается.

Проверка short-lived `wsToken` дополняет, а не заменяет стандартную authentication.

## `/api/events`

Canonical event names определены union type `EventType` в
`libs/types/src/event.ts`. Он включает agent, auto-mode, backlog, feature, project
analysis, spec, issue validation, ideation, worktree, dev-server, test-runner,
Git operations и notification events. Текущий `EventCallback` объявляет payload как
`unknown`; точная discriminated payload map отсутствует и создаётся на этапе 3.

### Client → server

Application messages отсутствуют. Connection используется только для server events.

### Server → client

```json
{
  "type": "<EventType>",
  "payload": {}
}
```

- Event ordering соответствует синхронному порядку `EventEmitter.emit()`.
- Ошибка одного in-process subscriber не останавливает остальных.
- При `bufferedAmount > 1 MiB` server закрывает connection кодом `4008`.
- При close/error subscriber удаляется.
- Replay отсутствует; восстановление состояния выполняется REST/event-history API.

## `/api/terminal/ws`

### Query

- `sessionId` — обязателен после upgrade;
- `token` — обязателен, если включён terminal password;
- общая WS authentication всё равно выполняется на upgrade.

### Close codes

|   Code | Meaning                                       |
| -----: | --------------------------------------------- |
| `1000` | terminal session завершена                    |
| `4001` | terminal password token отсутствует/невалиден |
| `4002` | отсутствует `sessionId`                       |
| `4003` | terminal отключён                             |
| `4004` | session не существует                         |
| `4008` | client не успевает читать output              |

### Initial server sequence

Первым сообщением всегда отправляется `connected`:

```json
{
  "type": "connected",
  "sessionId": "...",
  "shell": "...",
  "cwd": "...",
  "executionEnvironment": {},
  "allowInitialCommand": true
}
```

Затем до live subscription отправляется накопленный scrollback, если он есть:

```json
{ "type": "scrollback", "data": "..." }
```

Порядок `connected` → `scrollback` → live `data` предотвращает потерю/дублирование
между snapshot buffer и subscription.

### Client messages

Input:

```json
{ "type": "input", "data": "text" }
```

- `data` должен быть строкой;
- максимум 1 MiB;
- invalid type/size возвращает `{ "type": "error", "message": "..." }`.

Resize:

```json
{ "type": "resize", "cols": 120, "rows": 40 }
```

- целые `cols` 1–1000;
- целые `rows` 1–500;
- invalid resize игнорируется;
- minimum interval 100 ms;
- одинаковые размеры дедуплицируются;
- tracking живёт до exit session, а не до disconnect viewer.

Heartbeat:

```json
{ "type": "ping" }
```

Ответ:

```json
{ "type": "pong" }
```

Malformed JSON и неизвестный type сейчас только логируются; connection не закрывается.

### Server messages

```json
{ "type": "data", "data": "..." }
{ "type": "exit", "exitCode": 0 }
{ "type": "error", "message": "..." }
```

При `bufferedAmount > 1 MiB` connection закрывается `4008`, но terminal session
не перезапускается. Reconnect подключается к той же session и получает scrollback.

## Lifecycle invariants

- Несколько viewers могут быть подключены к одной terminal session.
- Disconnect viewer не завершает terminal session.
- Exit session очищает resize metadata и connection registry.
- Backend restart не replay startup command.
- Unknown remote cleanup не должен представляться как подтверждённый exit.
- Nest migration не меняет JSON envelope, close codes или ordering.

## Обязательные compatibility tests

- upgrade auth matrix;
- неизвестный pathname;
- events ordering и slow client;
- terminal initial sequence;
- input size/type;
- resize validation/rate limit/deduplication;
- ping/pong;
- multiple viewers;
- reconnect/scrollback;
- session exit и backend shutdown.
