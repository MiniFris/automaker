# Этап 8: production verification/testing ownership

Завершение testing части `stage-8-run-artifact-port-audit.md`: actual caller —
POST `/auto-mode/verify-feature` → AutoModeApplicationService → Compat → Facade.
Dormant executeTestStep для этого gate не подключался.

## Изменения

- Verification получает exclusive lease до feature/workspace preflight. Captured
  abort signal используется для managed prepare и всех четырёх прежних команд:
  `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`.
- Local verification использует существующий LocalExecutionEnvironment.exec,
  который отменяет и проверяет cleanup process group; сохранены cwd fallback,
  timeout, Windows cmd semantics и остановка после первой failed command.
- Lease проходит preparing → executing → testing → awaiting_review/failed.
  Public persisted feature status при успешной/failed проверке не меняется;
  HTTP 200 `{ success: true, passes: boolean }` сохранён. Internal completion
  dedup выполняется перед identity-aware release. Новых UI событий нет.
- Совместимость concurrency явно изменена: local verification поверх текущего
  feature run или другой verification теперь возвращает 409. Это соответствует
  прежней exclusive remote модели; implicit reuse разных операций не вводится.
- `retainUntilCleanup` задаётся при acquisition, поэтому даже stop до первого
  continuation await не освобождает verification slot. Stop сохраняет
  interruption и abort; finally освобождает только captured lease после
  подтверждённого завершения команды.
- Cleanup failure / unknown outcome не превращается в passes:false и не
  освобождает lease. Неопределённость retained до явного устранения; автоматический
  повтор может конфликтовать, но не запускает второй процесс поверх неизвестного.
- Awaited verification принята bounded registry с тем же admission cap, tracked
  promise и `onModuleDestroy` drain. Cleanup uncertainty сохраняется как sticky
  failed close, даже если HTTP request уже завершился ошибкой. Общий shutdown
  сначала прерывает runtime, затем registry ждёт verification до FS barrier.

## Проверки

- **314 targeted unit passed**: AgentExecutor/run ports, execution/pipeline/
  recovery, leases/state machine, contexts, typed usecases и facade regressions.
- **12 native HTTP/composition contracts passed**. Owned local fixture содержит
  package scripts без installs/network: подтверждены реальные четыре команды,
  первая ошибка, testing state, preserved result/status и completion до release.
- Concurrent local verify и verify поверх held provider получают 409.
- Linux owned process PID после stop и после native shutdown получает ESRCH;
  accepted HTTP verification дренируется и возвращает passes:false без запуска
  следующих команд. Это реальные Node/npm fixture processes, не vendor calls.
- Cleanup-unconfirmed fixture сохраняет lease и отклоняет повтор; mocked managed
  environment проверяет identity signal на preflight и всех четырёх exec.
- Server tsc, owned-source ESLint, formatting/diffcheck: успешно.

## Граница результата

Planning, plan approval и существующая production verification теперь имеют
run-bound phases и cancellation ownership. Это не перенос всех обязанностей
Compat/facade и не новое исполнение pipeline templates/test steps. Остальные
исходные этапы pipeline/ideation/GitHub этим срезом не объявлены завершёнными.
Полные suites/Docker/GUI и live vendors этим агентом не запускались.
