# Этап 9. WebSocket events и terminal

## Цель

Передать Nest lifecycle владение WebSocket upgrade, authentication, connections,
broadcasting и terminal sessions, сохранив существующий wire protocol.

## Основное решение

Не заменять raw `ws` на Socket.IO. Для `/api/events` может подойти стандартный
Nest `WsAdapter`, но `/api/terminal/ws` имеет собственные сообщения, PTY semantics
и authentication. Допустим custom adapter либо lifecycle-managed raw `ws` provider,
подключённый к тому же HTTP server через `HttpAdapterHost`.

Решение принимается отдельным ADR после прототипа и contract tests. Framework purity
не является причиной ломать совместимость.

## 9.1. Общий WebSocket infrastructure

- [ ] Получать underlying HTTP server после Nest initialization.
- [ ] Создать единый upgrade router по pathname.
- [ ] Выполнять connection-level auth до передачи socket handler.
- [ ] Ограничить handshake/query/header sizes.
- [ ] Добавить connection ids и correlation logging.
- [ ] Централизовать ping/pong, idle timeout и close codes.
- [ ] Реализовать bounded send queue/backpressure policy.
- [ ] Закрывать upgrades во время shutdown.

## 9.2. Events gateway

- [ ] Подписываться на typed EventBus.
- [ ] Сохранить текущий JSON event envelope и ordering.
- [ ] Изолировать slow/broken client.
- [ ] Отписывать socket при close/error.
- [ ] Проверить multiple clients и reconnect.
- [ ] Не хранить неограниченную replay history в gateway.
- [ ] Event replay использовать через EventHistoryModule.

## 9.3. TerminalModule

- [ ] Превратить `TerminalService` singleton factory в Nest provider.
- [ ] Разделить REST session management, PTY supervisor и WS transport.
- [ ] Сохранить session limits и password/token checks.
- [ ] Сохранить input/resize/ping message formats.
- [ ] Поддержать несколько connections к одной session.
- [ ] Очистить connection metadata после реального session exit.
- [ ] Сохранить reconnect без повторного startup command.
- [ ] Сохранить target metadata и immutable execution binding.
- [ ] Не создавать environment при обычном просмотре terminal layout.

## 9.4. Managed remote terminal

- [ ] Local PTY и Docker/SSH framed transport реализуют единый port.
- [ ] Heartbeat loss не считается подтверждённым завершением remote process.
- [ ] Backend restart не replay startup command.
- [ ] Close browser tab не обязательно завершает shared terminal session.
- [ ] Explicit delete/stop подтверждает cleanup либо возвращает unknown state.

## 9.5. Shutdown

Порядок:

1. Отклонить новые upgrades.
2. Отправить service-closing event, если protocol это допускает.
3. Прекратить приём terminal input.
4. Закрыть/остановить owned sessions по текущей policy.
5. Дождаться bounded cleanup.
6. Закрыть WS servers и underlying HTTP server.

## Тесты

- Upgrade auth matrix: cookie/API key/one-time token/expired token.
- Malformed URL/message/frame.
- Events ordering и subscriber failure.
- Slow client/backpressure.
- Terminal input/resize/ping/output/exit.
- Multiple viewers и reconnect.
- Session exit против socket close.
- Local/Docker/SSH terminal.
- Backend restart и shutdown deadline.
- Electron renderer connection.

## Rollout

Events и terminal не переключаются одним неделимым коммитом. Переключение идёт
последовательными коммитами в общей migration-ветке:

1. Nest-owned HTTP server + старые WS servers.
2. Общий upgrade/auth infrastructure.
3. Events gateway.
4. Terminal REST controllers.
5. Terminal WS transport.
6. Удаление raw setup из legacy bootstrap.

После шага 6 выполняется полный checkpoint этапа с HTTP/WS contracts, reconnect,
shutdown и Local/Docker/SSH terminal tests. Следующий этап до него не начинается.

## Exit criteria

- Оба WS endpoint не зависят от legacy `index.ts`.
- Wire compatibility suite проходит без изменений клиента.
- Нет connection/subscriber/session leaks.
- Terminal сохраняет Local/Docker/SSH behavior.
- Shutdown закрывает WS и PTY resources в пределах deadline.
- Полный checkpoint этапа 9 успешно выполнен и зафиксирован завершающим коммитом
  в единственной migration-ветке.
