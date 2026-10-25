# FeatureStateManager: один subscriber и полный notification drain

Срез wave20 после `b83edc51`. Исправляет конкретные воспроизведённые дефекты из
[аудита ответственности](bounded-context-responsibility-audit.md), а не заменяет
общую проверку всех feature/run transitions.

## Воспроизведение до изменения

Actual native application с двумя project facades создавало три durable error
notifications на один `auto_mode_error`: один subscriber создавался в
GlobalAutoModeService, ещё по одному — в каждом facade. У всех были одинаковые
application EventEmitter, FeatureLoader, NotificationService и PipelineService.
У FSM нет project-specific mutable state: project identity передаётся методам.

Отдельный controlled pre-storage lookup в FSM переживал успешный `app.close()`.
После его завершения handler пытался создать notification, но storage уже закрывался
и отклонял запись как UNAVAILABLE. Уже принятая actual filesystem write, напротив,
корректно удерживала close через существующий NotificationService storage drain.
Исправление не подменяет этот работающий storage boundary.

## Изменение ownership

- GlobalAutoModeService передаёт свой FSM в SharedServices. Native project facades
  используют этот application owner, сохраняя project-scoped execution/approval/
  recovery collaborators. Нового service locator или второго registry нет.
- AutoModeServiceCompat делегирует `onModuleDestroy` глобальному owner. FSM
  синхронно закрывает admission и отписывается; ожидает accepted notification jobs
  в фазе module destroy, до `NotificationService.beforeApplicationShutdown`.
- Job резервируется до первого asynchronous lookup. Accepted event fields
  копируются до обработки. Даже emit → немедленный close включает эту работу
  в drain; новые события после закрытия не принимаются.
- Максимум 256 notification jobs. При переполнении новый job не принимается,
  записывается warning; это bounded best-effort notification delivery, не durable
  event queue и не exactly-once protocol для повторно опубликованных events.
- Shutdown ждёт settlement всех accepted jobs через allSettled. Неожиданный
  subscriber failure сохраняется отдельно, включая failure до начала close;
  фоновый rejection не становится unhandled. Existing handled notification I/O
  failures по-прежнему логируются и не превращаются в ошибку primary feature run.
- Drain ограничен пятью секундами. Deadline/unexpected failure возвращают
  `FEATURE_STATE_NOTIFICATION_CLEANUP_FAILED`; cached failed close не становится
  успешным после позднего settlement. Native application сохраняет общий
  `APPLICATION_CLEANUP_FAILED` contract.
- Standalone facade без shared FSM создаёт собственный owner. Его explicit
  `onModuleDestroy()` закрывает admission и ожидает recovery/FSM; существующий
  `drainRecoveryState()` также включает owned FSM. Shared application FSM facade
  не закрывает. Это описание notification ownership, не новый контракт автономного
  supervisor для всех возможных standalone agent/process executions.

## Проверки

`tests/contract/fsm-notification-ownership.contract.test.ts`:

1. Два project facades используют identity одного FSM; один event создаёт одну
   actual durable notification.
2. Held actual notification temp-file write удерживает app close до завершения.
3. Held pre-storage FSM lookup тоже удерживает close, затем notification сохраняется
   до закрытия storage.
4. Закрытие первого приложения отписывает его subscriber; второе продолжает
   сохранять notifications. Late event первого не вызывает notification handler.
5. Known notification write failure остаётся handled; app close завершается, late
   notifications не принимаются.
6. Standalone facade ждёт свой held lookup, отписывается и оставляет native
   application FSM работоспособным.

`tests/unit/services/feature-state-notification-lifecycle.test.ts` проверяет
synchronous reservation/detach/idempotence, bounded admission, deadline и cached
unknown outcome, all-accepted settlement при неожиданной ошибке одного job,
сохранение ошибки завершившегося ранее job и snapshot event fields.

Existing feature-state, AutoMode facade/runner и native state/AutoMode contracts
включены в targeted verification. Точные результаты полного checkpoint записывает
общий wave20 отчёт; этот документ не объявляет выполненными provider, packaging,
OS или оставшиеся architecture gates.
