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
