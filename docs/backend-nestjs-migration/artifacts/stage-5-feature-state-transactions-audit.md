# FeatureStateManager: scoped atomic state

Срез после `0f195fac`. FeatureStateManager больше не импортирует global
secureFs, atomicWriteJson, readJsonWithRecovery или path helpers. Constructor
сохраняет существующий injected FeatureLoader; native composition не менялась.

FeatureLoader.mutate выполняет strict current read, domain callback и atomic
commit в одной canonical file lane с прежними backup/recovery и shutdown drain.
listIds предоставляет scoped перечисление для reconciliation. Отдельный
read→update больше не может затереть конкурентные plan/task/status/user changes.

Status, planSpec, task и accumulated pipeline summary mutations переведены на
этот port. Events публикуются после fulfilled commit; persistence errors теперь
propagate, а не скрываются как successful update. Notifications/app-spec sync
сохраняют прежний best-effort post-commit contract. Missing feature/no-op rules
сохранены; malformed/EIO/restore/commit failure не разрешают overwrite.

Interruption проверяет pipeline\_\* predicate внутри той же transaction.
Reconciliation использует fresh strict read на каждую feature, сохраняет
pipeline status, approved-plan → ready и direct-model → interrupted, сбрасывает
только transient plan/task state. Per-feature events идут сразу после commit;
при поздней ошибке scan уже committed features не теряют свои events. Bulk
reconciliation event публикуется после успешного scan.

Проверки: **143 targeted unit** (state manager, pipeline summaries, loader) и
**27 native contracts** (4 новых state cases + scoped loader/AutoMode/Ideation
consumers), server tsc, owned ESLint и formatting/diffcheck успешны. Native
tests подтверждают concurrent mixed writes и 12 plan revisions без потери
полей/версий, disk snapshots на каждом event, EIO/corruption/rename rejection
без success events, pipeline interruption race, reconciliation и two-app roots.

Run-incarnation capability остаётся внешним coordinator guard: FSM/loader не
вводят второй execution registry. Cross-process updates одного project всё ещё
не distributed transaction. Global filesystem consumers вне FSM (например,
PlanApprovalService/recovery state) этим bounded срезом не переносились.
Полные suites/network/GUI этим агентом не запускались.
