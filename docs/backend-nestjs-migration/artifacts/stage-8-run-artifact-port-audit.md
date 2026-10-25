# Этап 8: incarnation-scoped AgentExecutor artifacts

Срез после `3fc08f47`; продолжает `stage-8-run-incarnation-audit.md`.

## Реальный production call chain

ExecutionService получает lease и создаёт явный `FeatureRunPort` через общий
FeatureRunCoordinator. RunAgentFn options передают capability в facade callback,
затем в AgentExecutor.execute. Recovery сохраняет expected lease при возврате
через executeFeature. Pipeline callback связывает порт с captured context.run.
В production найден один AgentExecutor constructor и один execute caller — оба
в facade; native paths передают порт явно, без lookup нового run после await.
Direct constructors без порта сохраняют прежний compatibility contract.

Port — closure над конкретным lease и существующим ConcurrencyManager. Он не
вводит ownership Map, singleton override, ALS, persisted поле или HTTP параметр.

## Изменения

- PlanSpec, task status, summary callbacks, agent-output.md и raw-output.jsonl
  пишутся через ту же serialized mutation lane. Принятая до stop запись
  завершается перед admission следующего incarnation; поздняя запись A не
  принимается после старта B. Debounced/final output flush используют этот же
  порт; raw flush сохраняет собственный snapshot строк.
- Все provider stream messages проверяют incarnation до обработки, включая
  task/revision/continuation streams. Старое сообщение не меняет sdk session
  metadata, plan, output, tools observer или UI events нового run.
- Metadata model/provider записываются в captured lease после currentness check.
  Нет mutable per-executor run context: callbacks/state wrappers создаются для
  конкретного execute и сохраняются в его options.
- Production planning проходит planning → awaiting_plan_approval → executing;
  revision возвращается в planning. Final execution review остаётся
  awaiting_review с прежним public `waiting_approval`. Legacy wire/persisted
  statuses, approval tokens и plan versions не переименованы.
- Stop сначала сохраняет interruption и закрывает lease, затем отменяет approval
  waiter: отменённый planner не перезаписывает interrupted через свой catch.
- Cleanup heartbeat/debounce/final flush выполняется также при ошибке resumed
  persisted-tasks branch; superseded output flush не считается write failure.

## Проверки

- **310 targeted unit passed** (309 основной прогон, затем дополнительный phase
  case и повтор затронутых port/state specs): AgentExecutor, execution, pipeline,
  recovery, concurrency, contexts, facade и provider forwarding.
- Held approval: после замены incarnation поздние editedPlan/task/summary/output
  mutations отклоняются. Accepted output write удерживает admission B до
  фактического завершения записи.
- **6 native HTTP/composition contracts passed**: все 17 endpoints, aliases и
  multiapp; offline execution; delayed provider A→stop→B→late A сохраняет
  snapshots output/raw-output, B model/provider и status; настоящий HTTP plan
  approval проходит до persisted approved plan и final awaiting_review.
- Server TypeScript exit 0 после синхронизации platform dist; owned source
  ESLint и formatting/diffcheck: успешно.
  Full suites, Docker/GUI и live vendors этим агентом не запускались.

## Оставшиеся исходные границы

На момент этого среза testing/fix/testing transitions были подключены только к
run-bound executeTestStep без production callers. Следующий срез
`stage-8-verification-testing-audit.md` закрывает ownership существующего actual
verification workflow `/auto-mode/verify-feature`; dormant helper для этого не
подключался. Pipeline steps по-прежнему содержат agent instructions.

Защита охватывает перечисленные application-owned artifact/status writes. Она
не является sandbox для файлов, которые provider tools меняют самостоятельно
в рабочем дереве. Полное удаление Compat/facade и остальные исходные этапы
pipeline/ideation/GitHub остаются открытыми.
