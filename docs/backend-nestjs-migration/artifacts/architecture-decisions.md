# Accepted migration architecture decisions

Статус: accepted, 2026-10-23. Изменение решения требует обновления этого файла,
основного плана и затронутых stage exit criteria.

## ADR-001: Express adapter

NestJS использует `@nestjs/platform-express`. Одновременный переход на Fastify
запрещён: он смешал бы framework migration с изменением middleware/raw response/WS
semantics. Fastify можно оценить после полного cutover отдельным проектом.

## ADR-002: Modular monolith

Backend остаётся одним process/deployment unit. Process-local sessions, PTY,
agents, schedulers и file locks не допускают безопасного horizontal scaling без
отдельной distributed-state архитектуры.

## ADR-003: Schema-first transport contracts

Request/response/event schemas размещаются в `@automaker/contracts` и используют
Zod/Standard Schema. UI импортирует schemas/inferred types, но не Nest classes или
server domain objects.

## ADR-004: Compatibility-first errors

До API v2 сохраняются status codes и `{ success: false, error }`. Stable optional
`errorCode` разрешён. Global exception filter не возвращает stack, secrets или raw
provider/process diagnostics.

## ADR-005: WebSocket protocol preservation

Сохраняются raw `ws` paths, JSON envelopes, close codes и ordering. Nest получает
lifecycle ownership через стандартный или custom adapter только после contract
tests. Socket.IO не вводится.

## ADR-006: File storage remains authoritative

Nest migration не вводит БД. Repositories/ports нужны для границ, atomicity и tests,
а не для скрытой смены storage. Existing `.automaker/` и `DATA_DIR` остаются
backward-compatible.

## ADR-007: One migration branch

Вся программа выполняется в `refactor/backend-nestjs-migration`. Все этапы —
последовательные коммиты в этой ветке, включая подготовку, тесты, документацию и
исправления после тестирования.
Отдельные feature/stage branches не создаются. Отдельный PR не является обязательным
условием этапа, route group или завершения миграции.

## ADR-008: Mandatory stage checkpoints

Каждый этап завершается полным checkpoint из основного плана. Следующий этап не
начинается при красном checkpoint. Последний commit этапа фиксирует проверенное
состояние и обновлённую документацию. Правило действует для всех этапов 0–11;
команды, результаты тестирования и причины пропусков записываются в документ этапа.
Пропуск обязательной проверки не означает успешного checkpoint.
Если проверка упала, исправления коммитятся в ту же migration-ветку, после чего
checkpoint этапа повторяется. Отдельный PR не нужен и не заменяет тестирование.

## ADR-009: API v2 confirmed provider disconnect

Требование этапа 7.6 о подтверждении setup mutation нельзя обеспечить прежним
пустым body `POST /api/setup/deauth-*`. Для шести provider disconnect operations
вводится versioned safety contract из `@automaker/contracts`; глобальный
`X-Automaker-API-Version` повышается с `1` до `2`. Error envelope не меняется:
правило ADR-004 сохраняется и для API v2.

Перед записью client получает `GET /api/setup/connection-target?provider=...`,
показывает пользователю host-application target и отправляет
`{ confirmed: true, target }`. Target содержит provider, working directory и
идентификатор текущего экземпляра repository/application. После restart или
смены экземпляра нужно повторное inspect/confirmation. Без подтверждения — 400,
несовпадающий target — 409, ошибка сохранения/недостоверный marker — 503; ни один
из этих случаев не превращается в успешный disconnect другого target.

Это ограниченное исключение из compatibility-first sequencing: native owner,
mandatory safety gate, shared schemas и обновление Web/Electron HTTP clients
вводятся одним согласованным срезом. Старые clients с пустым body больше не могут
выполнить disconnect. UI/backend должны обновляться совместно; silent fallback,
автоподстановка confirmation или старого body не допускаются.

Операция меняет только application marker, не удаляет credentials CLI и не
останавливает уже принятые runs. Target UUID не является authentication/CSRF token;
public setup access policy пока сохраняется, её hardening остаётся отдельным gate.

## ADR-010: API v3 confirmed reconnect and read-only protocol gate

Шесть `POST /api/setup/auth-*` — это reconnect application marker, а не запуск
OAuth/CLI login. Они переводятся на native command и тот же строгий confirmed
target contract. Empty body больше не принимается; `X-Automaker-API-Version`
повышается до `3`, Web/Electron clients обновляются совместно. Disconnect из
ADR-009 сохраняет mandatory confirmation и теперь также использует новый
read-only client gate.

Target preview содержит `protocolVersion: 3`. Это существенная safety capability:
API v2 имел target preview и confirmed disconnect, но его старые auth handlers
игнорировали body и использовали cwd. До любого connection POST client повторно
читает preview, проверяет protocol version и совпадение с уже подтверждённым
instance/provider/directory. Неподдерживаемый protocol или другой target запрещает
POST. Новый target никогда не подставляется в старое approval автоматически.
Server повторно проверяет target перед admission. Старый server не должен
получать mutation лишь потому, что новый client отправил типизированный body.

Reconnect снимает только обычный marker в injected application directory;
отсутствующий marker — idempotent success, другие ошибки не скрываются. Прежние
auth messages/flags сохраняются вместе с явным `credentialStatus`:
`present-unverified`, `not-detected` или `not-inspected`. Это локальное evidence,
не гарантия валидности account credentials. UI сообщает о подключении к Automaker,
а не об успешном CLI login. Реальная verification остаётся отдельной операцией.

Disconnect/reconnect сериализуются по provider внутри application instance;
отказ одной операции не блокирует очередь. Accepted jobs, включая queued hint
reads, дожидаются завершения в before-shutdown phase до закрытия host runtime.
Это не distributed lock, не общий shutdown deadline и не authentication policy.

## ADR-011: API v4 confirmed host Cursor permission files

Cursor permissions mutations требуют `confirmed: true` и конкретный host-file
target с instance UUID, backend directory, scope и canonical config path.
API header повышен до `4`; connection protocol остаётся `3`. Независимый read-only
permissions preview имеет `protocolVersion: 1`. Client проверяет preview до любого
POST/DELETE и не отправляет новые DTO старому backend, который игнорировал бы
confirmation. Новый target требует нового approval.

Global/profile/custom/delete реализованы native Nest service и repository,
используют immutable bootstrap profile location, file-scoped FIFO и atomic rename.
Custom/delete разрешены только для project target. Прочие JSON settings сохраняются,
corrupt/symlink/hardlink config не перезаписывается. UI подтверждает реальный файл
на backend host; эта операция не меняет SSH/Docker config и не перезапускает runs.
Общий setup auth/CSRF hardening и перенос model config/keys/verify остаются отдельными
задачами. Это не distributed lock и не гарантия против внешнего concurrent editor
или hostile filesystem race.

## ADR-012: API v5 confirmed project Cursor model config

Project `.automaker/cursor-config.json` переносится в native service с shared
confirmation DTO и host-file target. API header повышен до `5`; отдельный
model-config preview имеет `protocolVersion: 1`. Новый client проверяет capability
до POST, не заменяет уже approved target и проверяет применённые model IDs в ответе.
API v4 Cursor permission protocol (`1`) и connection protocol (`3`) сохранены.

Input должен содержать только известные model IDs, проверяемые own-property lookup;
неизвестные элементы списка не фильтруются молча. Corrupt config не подменяется
defaults и не перезаписывается. Unknown JSON fields/MCP/rules сохраняются.
Permissions и models переиспользуют один injectable host JSON file boundary.
Принятые model writes сериализуются по file path и drain при shutdown.

Global UI settings остаются settings-store preferences и не превращаются в project
file operations. Этот перенос не меняет фактический provider runtime model selection,
не добавляет remote writes и не означает завершения setup auth/keys/verify hardening.
