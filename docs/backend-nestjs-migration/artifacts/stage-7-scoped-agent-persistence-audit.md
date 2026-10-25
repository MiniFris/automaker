# Agent persistence: scoped filesystem

Срез после `cad18752`: AgentSessionRepository, AgentQueueDeliveryStore,
AgentExecutionStore и artifact scrubber принимают explicit filesystem port.
Native AgentStateModule передаёт один application-owned SECURE_FILESYSTEM во
все три stores; atomic writes, backups, journals, tombstones и snapshot cleanup
используют тот же owner. Прямые legacy constructors/helpers сохраняют прежний
default отдельно; native factories не используют этот fallback.

AgentStateModule.beforeApplicationShutdown дренирует execution → delivery →
repository до global FS barrier. Downstream repository остаётся доступным,
пока execution settlement ещё пишет history/metadata/delivery proof. Original
onApplicationShutdown APIs сохранены; алгоритм claim/settlement/recovery,
journal formats, filenames, permissions и exact artifact suffix matching не
менялись. Дополнительной ownership Map или replay path нет.

Проверки:

- **85 targeted units**: execution intent, queue delivery, deletion, storage
  failures, execution lifecycle и session repository/registry.
- **18 native contracts**: 6 новых scoped-storage cases, existing storage
  recovery/composition, lease/state и real owned Node crash recovery fixtures.
  Все model streams в lifecycle fixtures — offline fakes; vendors не вызывались.
- Two-app FS identity/root isolation и независимость после close; cross-root
  symlink rejection; corrupt-main committed backup и authoritative absence;
  cold pending delivery/run interruption без automatic replay; fail-closed
  reads/commits; tombstone purge без удаления похожих чужих файлов.
- Actual native close: producer final settlement → ordered store drain → FS.
  Held completing-journal write задерживает shutdown, downstream history commit
  завершается до repository drain/FS close.
- Server tsc, owned-source ESLint, formatting/diffcheck успешны. Full suites
  этим агентом не запускались.

Границы: stores по-прежнему имеют application-local serialization/ownership,
а не distributed locking для двух writers одного DATA_DIR. Existing drain
semantics не расширялись новым timeout/retry протоколом. Legacy constructor
defaults не удалены; прочие agent IO consumers вне перечисленных stores этим
срезом не переносились. PlanApprovalService не является таким residual:
актуальная реализация делегирует FeatureStateManager и не имеет собственного FS.
