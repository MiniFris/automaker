# Этап 8: production coordinator и incarnation execution status

Следующий проверенный срез после `e8d3eb9d`. Дополняет
`stage-8-auto-mode-audit.md`; весь этап 8 этим не закрыт.

## Production ownership

Native AutoMode provider получает Nest `FeatureRunCoordinator` и явно передаёт
его GlobalAutoModeService → единственному per-app ConcurrencyManager. Facades,
execution, recovery и pipeline используют этот же manager/coordinator. Прежняя
неиспользуемая Map `FeatureRunCoordinator.runs` удалена; coordinator stateless.

Каждый RunningFeature содержит immutable incarnation token, execution state,
completion dedup и mutation lane. Identity-aware release проверяет конкретный
acquired lease; nested reuse сохраняет incarnation и reference count. Internal
continuations передают expected lease через execution/recovery/pipeline, поэтому
запоздалый callback A не может reuse нового B через `_calledInternally`.

ExecutionService, RecoveryService, PipelineOrchestrator и facade remote
verify/commit/merge освобождают только свои leases. Forced local stop A сохраняет
старый object для его finally, но release A больше не уменьшает leaseCount B.
Managed stop сохраняет прежний запрет раннего освобождения remote lease.

## Status mutation и completion

Execution/pipeline status writes и completion summary проходят через coordinator
с captured lease. Accepted writes сериализуются на lease; released slot остаётся
в той же ownership Map, пока accepted writes не завершатся. Async acquisition
следующего incarnation ждёт эту lane и затем повторно проверяет admission.
Status write, принятый до stop, завершается перед новым run; late write старого
incarnation не принимается. Обычные running queries не показывают released slot.

Lease state отражает preparing/executing/awaiting_review/completed/failed/
interrupted без изменения public persisted statuses. Итоговый legacy
`waiting_approval` исполнения обозначает внутренний awaiting_review. Public
status mapping для планового approval не изменён. Terminal auto-mode completion
проверяется и dedup по incarnation; pipeline и outer execution используют один
completion key. Verify/commit events привязаны к captured run, а не к свежему
lookup, который мог бы найти другой incarnation.

## Доказательства

- **251 targeted unit passed**: execution, pipeline, recovery, concurrency,
  registry, state machine, provider/status forwarding и facade regressions.
- Real-manager tests: A force stop → B acquire → late A release/status;
  delayed accepted status write → admission B только после write; duplicate
  completion; late recovery/pipeline finally сохраняют B без записи статуса A.
- **5 native HTTP/composition contracts passed**: 17 endpoint contracts,
  aliases/multiapp/stop-restart, real offline workflow, runtime ownership и
  delayed offline provider A → stop → B → late A с сохранением B lease/status.
  Coordinator identity проверяется против actual Nest provider.
- Server TypeScript exit 0; formatting/diffcheck успешны. Full suites и external
  acceptance этим агентом не запускались.

## Следующий обязательный срез

Это защита execution status/lease/completion, а не всех persisted артефактов.
AgentExecutor по-прежнему пишет planSpec и agent-output через прежние ports.
Необходим следующий scoped per-run FeatureStateManager/output port с captured
incarnation, чтобы поздний provider A не перезаписывал planning/output B.
Нужна также полная интеграция planning/approval/testing transitions в одну
production state machine; наличие внутреннего state на execution lease не
закрывает этот исходный gate. Полное удаление Compat/facade и остальные исходные
pipeline/ideation/GitHub gates остаются открытыми.
