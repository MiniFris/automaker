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

## ADR-013: API v6 confirmed billable Claude verification

Claude verify требует approval конкретного host instance/root, endpoint, model и
authentication method. Read-only preview имеет отдельный `protocolVersion: 1`;
новый client не отправляет POST старому backend без этой capability и не заменяет
approved target автоматически. API header повышен до `6`.

Native runtime передаёт environment конкретному SDK query, не меняет process.env
и не использует глобальные auth-session/limiter singletons. API-key и CLI modes
разделены. Query выполняется без tools/MCP/project settings/session persistence;
successful terminal result обязателен. Raw diagnostics не становятся HTTP details
или application logs. Active probes ограничены, abort/close/drain управляются
владельцем Nest application. Это не гарантия OS-level child reap или sandbox.

Verification может стоить денег: UI явно показывает target и предупреждение перед
POST, автоматическая проверка при загрузке/refresh Claude setup удалена. CLI login,
marker changes и managed key persistence не являются side effects этой операции.
Public setup access policy и перенос Codex verify/ключей остаются незавершёнными
gates, а не считаются решёнными наличием UUID или confirmation boolean.

## ADR-014: API v7 confirmed Codex verification без agent tools

Native Codex verification использует отдельный protocol-1 preview и strict confirmed
request. Target включает instance/root, auth method, credential kind/profile, model
и endpoint. Новый client проверяет capability до POST и не заменяет approved target;
API header повышен до `7`. Key persistence/activation остаётся отдельной задачей.

Настоящий SDK/CLI 0.98.0 в offline contract всё ещё объявляет apply_patch/view_image
при ограниченном exec config. Поэтому no-tools verification не строится на
allowedTools/sandbox/approval flags: model query — прямой Responses HTTP/SSE с пустыми
tools и tool_choice none, без agent thread/turn и локального tool loop. CLI нужен
только для credential RPC. getAuthStatus 0.98.0 проверен на bundled CLI, а не выведен
из документации современного account/read. Metadata не включает токен/refresh;
их получение допускается после approval CLI verification. API-key mode не запускает CLI.

Mode/kind не подменяются при ошибке. Только successful terminal response с message
output доказывает probe success; partial/billing/rate-limit/error/tool output — нет.
Private diagnostics не публикуются. Per-app admission, saved timeout, abort и drain
владеют lifecycle; auth child завершается и reap-ится перед возвратом. Это не общий
shutdown deadline и не доказательство всех OS/remote/live-account вариантов.

OpenAI Docs помог разделить transports:
[app-server](https://developers.openai.com/codex/app-server) и
[Responses SSE](https://developers.openai.com/api/docs/guides/streaming-responses).
Поддержка protocol конкретной pinned version дополнительно проверяется offline
контрактами. Общий provider tool policy и setup auth/CSRF остаются открытыми gates.

## ADR-015: Credentials передаются runtime, не активируются через process.env

Native key persistence не должна зависеть от временного глобального environment
override. Обычный Codex query принимает credential/environment context, снимает
снимок до async preparation и передаёт выбранный ключ SDK явно. Неиспользуемый
createTempEnvOverride удалён. Общий subprocess transport поддерживает opt-in
inheritEnv false; Codex execution передаёт собственный снимок без ambient merge.
Поведение прочих subprocess callers по умолчанию сохранено.

Pending SDK run получает дочерний abort signal; связь с caller снимается после
settlement до выдачи output/error. Это предотвращает late-abort unhandled error,
воспроизведённый с реальным SDK 0.98.0, но не объявляет доказанным OS-level reap.
Context не является sandbox или secret allow-list. Default composition, CLI
discovery, native store/delete, durable deletion/precedence policy и общий
credential resolver ещё требуют переноса; этот срез их не подменяет cache-only
реализацией и не закрывает этап 7. Внешние API/capability versions не меняются.

## ADR-016: API v8 passive GitHub status и explicit host authentication

Installation/status GET не проверяет credentials по сети. GitHub status возвращает
authenticationChecked false; unknown не считается logout или successful auth.
Явная проверка — отдельный confirmed POST с protocol-1 preview host UUID/root,
CLI path и hostname. Client проверяет capability до POST и не подменяет target;
API header повышен до `8`. Mounted/refreshed UI не вызывает auth probe.

Успех требует account login от одной успешной `gh api user --jq .login` команды,
а не локального credential hint или fallback exit 0. `gh auth status` fallback
удалён. Raw diagnostics не раскрываются. Per-app rate/concurrency admission и
shutdown drain владеют checks; общий shutdown deadline, public setup access policy
и гарантии OS-level reap этим не закрываются. Внутренний vendor credential refresh
возможен и указан в confirmation; самостоятельные login/logout/switch не выполняются.

## ADR-017: Durable bootstrap suppression и application credential snapshots

Удаление application key должно очищать managed value и сохранять запрет bootstrap
fallback в private credentials record. Empty managed string без policy недостаточен:
после restart он снова разрешил бы environment key. Setup и обычные credentials
writes используют одну FIFO и atomic private write; другие provider keys сохраняются.
API-key/subscription-token modes имеют разные fields и не оставляют competing
managed/bootstrap auth override активным.

Application credential change активирует durable state только после commit,
очищает obsolete wizard cache и drain-ит accepted writes при shutdown. Ошибка
persistence не активирует новый key; HTTP limits/target admission ещё не перенесены.

Production Claude/Codex factories получают per-query environment resolver через
Nest. Managed state имеет приоритет над bootstrap snapshot; отсутствие выбранного
key в Codex callback не компенсируется повторным чтением более позднего record.
API-key verification учитывает ту же policy. Private read/parse errors и malformed
policy fail closed; defaults разрешены только при ENOENT. Старый backend может
игнорировать additive metadata, поэтому downgrade/cutover preflight остаётся gate.

Этот срез не подключает новые store/delete HTTP commands. Legacy key bridge,
confirmation/protocol target, status read model, остальные CLI/remote credential
consumers и command lifecycle ещё требуют переноса. Metadata не означает token
revocation, secure erase backups/bootstrap config или отзыв самостоятельного CLI
login. API header и capability versions этим срезом не меняются.

## ADR-018: API v9 confirmed native application key commands

Setup store/delete требуют protocol-1 storage preview и literal confirmed target
с application UUID/root, provider и private credentials path. Client проверяет
capability до POST и не подменяет approval новым target. API header — `9`.
Старые unconfirmed bodies отклоняются; server/client cutover выполняется вместе.

Native command владеет bounded admission, writer FIFO и shutdown drain. Committed
configured state не является successful authentication proof. Activation следует
за persistence; delete подавляет bootstrap fallback без изменения process.env/.env.
Setup handler bridge и dotenv key helpers удалены. CLI logins, operator config и
backups не удаляются, token не отзывается у upstream. Это показано в confirmation.

Presence/status читает private persisted state. Settings после reload позволяет
delete/test backend key без выдачи plaintext secret в браузер; verification имеет
отдельное согласие. Missing API/mocks/cancel не сообщают fake persistence success.
Public setup auth/CSRF, consumer policy остальных adapters и полноценная auth
evidence normalization остаются gates, не закрытыми одним UUID или metadata flag.

## ADR-019: API v10 passive Copilot setup status

GET `/api/setup/copilot-status` не запускает `gh auth status` или
`copilot auth status`. `authenticationChecked` и `authenticated` всегда false;
`hasEnvToken` означает только наличие `GITHUB_TOKEN` в application snapshot,
`hasConfigFile` — наличие обычного `hosts.yml` по пути из `GH_CONFIG_DIR`,
`XDG_CONFIG_HOME` или home context. Файл не читается и не разбирается в token/login.
Ни один из этих hints не доказывает identity, действительность token или Copilot
entitlement. Ошибки filesystem не раскрывают содержимое или пути в HTTP.

`connected` отдельно отражает application disconnect marker. Confirmed reconnect
снимает этот marker, но не меняет auth hints на verified. Сервер нормализует даже
старый adapter result с `authenticated: true` в passive response. Strict shared
schema и HTTP client отвергают прежние auth/identity claims и произвольные поля;
API header повышен до `10`, server/client поставляются совместно.

Setup больше не poll-ит якобы successful authentication после копирования login
command. Settings и setup показывают unverified state; настройки предлагают
отдельные confirmed disconnect/reconnect. Все paid/live проверки остаются явными;
GitHub account verification не доказывает Copilot entitlement. Другие providers,
полный CLI discovery/runtime ownership и public setup auth/CSRF остаются gates.

## ADR-020: API v11 passive Gemini status и confirmed Google-key storage

Native Gemini status всегда возвращает `authenticationChecked: false` и
`authenticated: false`. Key/Vertex environment flags и обычный settings-файл —
только локальные hints. Содержимое settings/OAuth files не читается, неизвестный
selected auth type не становится успешной авторизацией. `connected` отдельно
описывает application disconnect marker. Identity, произвольные error fields и
verified claims отвергаются strict shared schema/HTTP client. API header — `11`.

Google-key включён в existing protocol-1 confirmed credential target, durable FIFO
и private credentials record. Managed Google key передаётся как `GEMINI_API_KEY`;
competing bootstrap `GOOGLE_API_KEY` в этом режиме исключается. При отсутствии
managed policy отдельные operator variables сохраняются без переименования.
После удаления Google key оба bootstrap key variables подавляются и после restart.
Независимые OAuth/ADC/Vertex credentials и vendor login не удаляются и не отзываются.

Режимы разделены по официальной [Gemini CLI authentication documentation](https://geminicli.com/docs/get-started/authentication/):
Gemini API key и Vertex credentials — разные варианты. Наличие env/config не
доказывает выбранный CLI mode, account, quota или upstream authorization.
Google key принимается как bounded opaque value, без предположений о вечном prefix.

Setup Google-key save/delete использует native target consent, не сохраняет
plaintext в frontend store и не активирует `authenticated`. Исчезает недоступный
`saveApiKey` path и login-success polling. Общая Google-key форма в setup и Gemini
settings использует native persistence; native command не вызывается для скрытого
legacy Google value общим Settings Save. Legacy credentials settings transport
и его consumer policy ещё требуют отдельного аудита. Формальный Test Gemini connection больше не сообщает success
из-за длины ключа: настоящий verifier пока не реализован. Нельзя считать это
завершённой provider acceptance. Остальные consumer/auth/lifecycle/security gates
и unsafe downgrade, игнорирующий Google deletion metadata, остаются открытыми.

## ADR-021: Linux Local exec acknowledgement после group quiescence

Отправка SIGKILL и root `close` не являются достаточным доказательством завершения
обычных дочерних процессов. Linux Local exec дополнительно ждёт read-only
`waitForLinuxProcessGroupExit` для исходного owned detached group ID. Успешный
result или `PROCESS_INTERRUPTED` выдаётся только после root close и наблюдаемого
исчезновения группы либо terminal states её members/tasks. Сигналы найденным PID
не отправляются; probe использует только signal 0 для исходной группы.

`/proc/pid/stat` разбирается с учётом скобок/пробелов в comm; Linux stat pgrp и
terminal state definitions следуют [Linux man-pages](https://man7.org/linux/man-pages/man5/proc_pid_stat.5.html).
Наличие zombie leader не освобождает от проверки оставшихся threads. Недоступные
tasks не считаются успешным cleanup: [task directory может стать недоступным после завершения main thread](https://man7.org/linux/man-pages/man5/proc_pid_task.5.html).
При пустых/неопределённых наблюдениях существующей группы polling продолжается
только до deadline владельца. Reads batched/bounded, observer отменяется сигналом.

Существующий watchdog в 2 секунды остаётся включённым и после root close, пока
observer не закончил работу. Deadline и read/permission/parse failures означают
`PROCESS_CLEANUP_FAILED`, без раскрытия process metadata и без ложного terminal ack.
Monotonic clock проверяется перед outcome независимо от своевременности callback
watchdog в event loop.
Таймаут не увеличивается ради теста; исходный реальный regression test сохранён.

Это не sandbox и не containment deliberate session/group/privilege escapes.
Предполагается читаемый procfs текущего PID namespace; Windows/macOS требуют
своей acceptance. Изменение не сертифицирует все SDK/CLI/terminal cancellation
paths, не меняет HTTP contracts/API version и не закрывает весь этап 7.

## ADR-022: API v12 retired bulk credentials transport и explicit browser import

`PUT /api/settings/credentials` остаётся authenticated native tombstone с HTTP 410
и static `CREDENTIAL_WRITE_RETIRED`. Он не читает DTO/body и не обращается к private
writer. Старый Express compatibility handler возвращает тот же ответ без writer.
Loose `CredentialsUpdate` DTO/OpenAPI entry, HTTP/Electron client write method и
неиспользуемые `useSaveCredentials`/`syncCredentialsToServer` удалены. Masked GET
остаётся read-only. Server/client должны обновляться совместно, API header — `12`.

Settings localStorage migration больше не импортирует apiKeys и не имеет права
менять credential policy. `migratedCredentials` всегда false;
`credentialImportRequired` сообщает о наличии кандидатов для отдельного импорта.
Нормальный frontend settings debounce sync и до этого не синхронизировал apiKeys;
не следует приписывать ему несуществовавший автоматический write.

Settings API Keys содержит explicit legacy inspector. На mount он не читает
кандидатов и не пишет credentials. После Inspect показывает только supported
provider names; Import каждого ключа проходит existing native target confirmation,
preflight и writer. Cancellation не считается import; commit не означает auth.
Исходная browser backup не меняется, а plaintext candidate не попадает в DOM.
Поддержаны anthropic/google/openai; другие legacy secrets требуют своих форм.

Malformed JSON parser messages нормализуются до static error до Nest external
exception mapping: body-parser error excerpts не должны отражать credential body.
Migration parsing/project/outer errors также не возвращают raw input/path details.

Internal typed storage primitive остаётся для endpoint-specific Direct/z.ai
commands и fixtures; это не разрешение на произвольную HTTP запись private record.
Их дальнейшие ownership/consent gates, public setup auth/CSRF, encryption/secure
erase и unsafe downgrade preflight этим срезом не объявляются завершёнными.

## ADR-023: Native usage service ownership и tracked model-cache lifecycle

Usage services Claude/Codex/Gemini/z.ai, Codex app-server и Codex model cache
принадлежат `ProvidersModule`. Legacy symbols и override fields для них удаляются,
без обратных aliases в compatibility composition. Codex usage/cache получают один
app-server через Nest; путь cache file определяется application RuntimePaths.
Global module регистрируется только в composition root, без параллельного static
import из ModelsModule. Tests считают реальные class-token registrations.

Optional warmup остаётся background task, но имеет Nest lifecycle owner, соблюдает
`runStartupTasks` и ожидается при shutdown. Cache отдельно закрывает admission и
дожидается всех принятых операций, включая deferred invocation и file writes.
Internal nested calls не проходят повторную admission проверку: shutdown не должен
превращать принятую операцию в отказ только из-за её async scheduling.

Это не новый публичный протокол: API version остаётся 12, disk cache format и
existing usage responses не меняются. Native construction не доказывает изоляцию
всех ambient credentials/discovery paths или OS-level завершение CLI children.
Consent, status/auth evidence, model capabilities и безопасные adapter errors
остаются отдельными незавершёнными gates этапа 7.

## ADR-024: Usage environment belongs to the application, not the host process

Native Claude usage/discovery получает fresh environment из application credentials
reader для каждого запуска. Это распространяет durable managed-key selection и
bootstrap suppression на usage PTY, а не только на provider queries. Reader failure
не разрешает запуск с ambient credentials. Working directory берётся из RuntimePaths.
На POSIX CLI запускается прямым argv без shell interpolation пути; existing Windows
cmd transport требует своей platform acceptance.

Gemini usage привязывает credential paths, CLI discovery env/cwd и home-relative
candidates к snapshot конкретного приложения. z.ai bootstrap token/host/quota URL
также фиксируются из `HOST_ENVIRONMENT`; обе реализации клонируют входной объект.
Raw constructors сохраняют compatibility defaults, но native factories больше не
полагаются на них. Два Nest apps и настоящий offline PTY проверяют isolation,
managed key/delete и literal path arguments; owned HTTP fixture проверяет z.ai
authorization без vendor probes. Test diagnostics не сохраняют raw child keys.

Это не изменение API version или разрешение скрытых запросов. Codex usage context,
consent, z.ai credential mutation policy, Gemini OAuth refresh/write-back policy,
trust prompts и OS-level shutdown adapters остаются отдельными gates. Environment
snapshot сам по себе не доказывает корректную authentication, capabilities или
универсальное завершение subprocess tree.

## ADR-025: Recoverable pre-React module loading failures

HTML bootstrap owns its loading/error state until React mounts. A capturing error
listener installed before bundled modules handles module resource failures,
including a dependency fetch abort: it displays static localized EN/RU text and
an explicit Reload action instead of leaving an infinite spinner. Early head
errors wait for DOMContentLoaded; after React ownership the handler does not
modify the application. No raw URL/stack is reflected, storage is not cleared,
and there is no timed/automatic reload or credential-command retry.

The observed trace contains `ERR_NETWORK_CHANGED`. A deterministic aborted-module
test failed before this change. Chromium/network-mutating Docker acceptance now
run in separate phases on a shared host; the precise source of the original OS
network notification remains unproven. This does not disable network-change
detection, weaken browser deadlines or claim to fix all development-server stalls.

Tests cover entry/dependency abort, explicit recovery, optional image failure,
locale/blocked storage and post-React ownership. `test:ui:bootstrap` additionally
tests actual production HTML/modules with a local 503→healthy asset fixture, not
a vendor or real backend. It verifies that the guard precedes moved head entries
and that storage survives the user-requested reload. This is early hardening
evidence, not completion of stage 7/10 or packaged Electron/PWA acceptance.

## ADR-026: Context-explicit Codex usage RPC and cleanup certainty

Native Codex usage/discovery/app-server share a Nest-owned context port. Environment
comes from the application credential policy, cwd from RuntimePaths; PATH/home/version
manager discovery and CODEX_HOME auth-file resolution no longer read ambient host
globals. Compatibility defaults remain only for manual constructors. Local auth reads
are bounded and reject non-regular files; raw JWT claims are not logged.

App-server owns accepted RPCs and children, closes admission before shutdown,
cancels deferred discovery and drains spawned processes. RPC success requires child
close; Linux additionally requires quiescence of the original detached process group.
Bounded TERM→KILL cleanup failure poisons the owner and must not become successful
usage/local-auth/model-cache fallback. A dedicated static error preserves this
distinction without exposing vendor output. JSONL parsing/output bounds and rejected
server tool/approval requests do not create an execution/approval path.

The official stdio initialization/account/model protocol is preserved; no CLI/SDK
version or API contract version is changed. Offline child/native-container tests
prove environment/key/delete/path/shutdown behavior, not vendor authentication,
subscription validity, universal sandboxing or cross-platform process-tree cleanup.
Usage consent, vendor startup configuration, unverified local plan fallback and
remaining provider/status/capability gates remain required before stage completion.

## ADR-027: API v13 passive Cursor status, separate connection and authentication

Cursor GET status no longer treats `--version`, a key, a credential file or a legacy
adapter claim as successful authentication. Passive auth inspection reads only
application environment and file metadata; it does not launch discovery/auth/WSL
commands or parse credential contents. Its explicit scope is host, not remote/WSL.
Installation/version remain separate probes, with their remaining ambient discovery
limitations recorded in stage 7.

The strict shared schema fixes authenticated/authenticationChecked to false and
exposes only key/file booleans plus a static inspection error. The root connection
marker controls application disconnect/reconnect independently. HTTP/Electron
clients reject old/private/verified auth responses; server/client cut over together
with API header 13. Existing CLI command names and connection confirmation protocol
are not silently changed.

One shared setup panel replaces both login-polling implementations. Copy is only
copy; refresh is passive; settings and provider summary never claim verified login.
The model-selection availability notice uses installation and an explicit connection
marker rather than equating unverified auth with missing CLI. Queries, permissions
mutations, vendor login and account verification remain separate user actions.

Unit/native HTTP/browser contracts cover false-positive prevention, isolated app
profiles, safe metadata errors, strict transport, clipboard/no polling and confirmed
connection changes. This does not add a Cursor verifier/key manager or certify all
discovery/WSL/version/cancellation paths and does not complete stage 7.

## ADR-028: native provider ownership, registrations-only bootstrap seam

ProvidersModule owns ProviderRegistry, ProviderConnectionRepository and
ToolPolicyService directly, once per application. Legacy service factories,
registry/connection tokens and service-bag fields are removed; transitional
AutoMode/Ideation consumers inject the same native instances as agent services.

Explicit bootstrap providerRegistrations supply metadata and adapter factories,
not a replacement registry or repository. The array is copied/frozen; undefined
selects production registrations, whereas an empty array never falls back to
production. Invalid names/alias collisions fail in pure preflight before Nest
creates services; adapter factories must not run during this validation.
Retired legacy override keys fail closed rather than silently selecting live
adapters. There is no HTTP/environment switch for this test/composition seam.

Contract and E2E fixtures replace registrations while preserving native owners
and shutdown behavior. Two-application contracts inspect actual Nest wrappers,
consumer identity, marker isolation and independence after one app closes.
This changes composition, not API v13, persisted formats or provider execution
semantics. Remaining adapter DI, status, capabilities, tool policy, cleanup and
stage 7–11 gates are not declared complete by this ownership change.

## ADR-029: native agent facade, explicit transitional lifecycle port

AgentStateModule owns AgentService through a typed factory provider using native
class-token dependencies. Chat and sessions consume the same per-application
facade. The legacy agent factory, token, service-bag field and bootstrap override
are retired; session transport adaptation is renamed AgentSessionAdapter and no
longer depends on legacy tokens. The application service itself remains free
of Nest decorators and transport concerns.

Until lifecycle orchestration is migrated, the existing legacy orchestrator
receives an explicit initialize/interruptActiveSessions port to the native agent.
This is not a second owner, factory or service-bag alias. Keeping that bridge
preserves settings-before-agent startup, runStartupTasks behavior, interruption
before provider close and best-effort remaining cleanup after storage failure.
Removing this final lifecycle bridge remains required work, not an achieved gate.

Contracts and child-process crash/shutdown fixtures resolve the real native facade;
test execution is selected through explicit registrations, not a facade replacement.
Composition contracts check actual Nest wrapper cardinality, consumer/dependency
identity and two-application persistence isolation. This is an ownership change,
not an API v13 or persisted-format change, and does not complete stages 7–11.
