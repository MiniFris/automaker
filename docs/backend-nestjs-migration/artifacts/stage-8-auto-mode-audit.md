# Этап 8: typed AutoMode и project contexts

Проверенный срез после `170f0123`; это не закрытие всего этапа 8.

## Реализовано

- Все 17 HTTP endpoints используют Nest controller, Zod DTO и явный
  `AutoModeApplicationService`. Express request/response adapter bag
  `AutoModeHandlersService` удалён. Удалены 16 файлов неиспользуемой legacy
  auto-mode route group: внешних production callers не осталось; meaningful
  merge tests перенесены на native application service.
- Сохранены HTTP 200, response fields, immediate background acknowledgements,
  approval tokens, merge consent/error contract и omitted branch → `null`.
  Guard optional imagePaths согласован с optional DTO: отсутствие attachments
  больше не блокирует follow-up.
- `ProjectRunContextRegistry` владеет canonical project contexts вместо
  `Compat.facadeCache`. Native identity проверяется scoped SecurityService;
  symlink aliases используют один facade. Scheduler и ConcurrencyManager общие
  для приложения, contexts разделены по проектам и приложениям.
- Admission ограничен 256 принятыми background commands и 1024 contexts.
  Shutdown запрещает новые команды и execution leases, повторно проверяет
  stopping перед microtask dispatch, прерывает facade и дренирует принятые
  команды в `onModuleDestroy` с deadline 5 секунд и cached failure. Pending
  command ownership сохраняется при timeout. Этот hook предшествует FS close
  в `beforeApplicationShutdown`; root runtime lifecycle сначала сохраняет
  interrupted state и прерывает execution.
- Отдельный synchronous `closeAdmission` закрывает command/facade/lease admission
  до первого await сохранения interruptions, не отменяя ещё сохраняемую работу;
  abort и dispose approval выполняются последующим `interruptForShutdown`.
- Recovery проверяет shutdown latch перед следующим feature и сохраняет
  незавершённый recovery intent. Обычный stop/restart не закрывает admission.
- Native host execution получает scoped cwd validator. Managed feature target
  получает validator immutable prepared binding вместо host realpath проверки
  remote cwd. HTTP DTO не принимает этот internal binding marker.

## Проверки

- Targeted unit: **84 passed** — typed usecases, command admission/drain/deadline,
  concurrency, recovery, SDK validator forwarding и agent runner.
- Merge application contract unit (общий vitest config): **9 passed**.
- Native HTTP contracts: **3 passed** — все 17 success payloads/200, immediate
  ack при pending execution, invalid DTO/merge consent; canonical symlink alias,
  stop/restart и два приложения; настоящий feature через offline MockProvider
  до persisted `waiting_approval`.
- Server TypeScript: exit 0. Общие проверки checkpoint выполняет root.

## Открытые исходные требования

`FeatureRunCoordinator` пока не интегрирован в production: единственным владельцем
execution leases остаётся `ConcurrencyManager`; второй реестр jobs не введён.
Единая feature state machine, run-incarnation guard для stale completion и полное
удаление Compat/facade остаются отдельным обязательным срезом 8.1. Следующий шаг:
перенести transitions execute/resume/stop/completion в typed coordinator,
делегирующий существующему ConcurrencyManager, и проверять completion по token
конкретной acquisition до записи статуса/освобождения lease.

Этот срез не меняет оставшиеся исходные gates pipeline/ideation/GitHub и не
объявляет полный AutoLoop/state-machine drain завершённым. Live provider и
network acceptance не требовались для данного offline cutover и не выполнялись.
