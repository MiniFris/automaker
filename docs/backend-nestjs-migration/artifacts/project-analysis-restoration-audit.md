# Native project analysis: восстановление действующего workflow

Wave22, после `75a17e18`; production freeze — 2026-10-25 10:09:57 UTC.
Это конкретный functional/lifecycle slice, не завершение этапа 8 или всей миграции.

## Исправление прежнего вывода

В responsibility audit ошибочно было указано, что HTTP analysis уже обслуживается
отдельным application path. Для AutoMode это было неверно: действующий
`POST /api/auto-mode/analyze-project` шёл через Compat в бросающий ошибку
`AutoModeServiceFacade.analyzeProject()`. Background200 оставался, работа не выполнялась.
Welcome view и `useAnalyzeProject` используют этот API. Старые transport contracts
подменяли Compat method и проверяли только ack/response schema.

Реальная baseline implementation в `473f935c^:apps/server/src/services/auto-mode-service.ts`
выбирала `phaseModels.projectAnalysisModel`, публиковала auto-mode events и сохраняла
`.automaker/project-analysis.md`. Это другой workflow, чем Ideation analysis/cache;
Electron mock, пишущий app_spec.txt, не определяет прежний backend output.

## Текущий владелец и контракт

- Plain `ProjectAnalysisService` получает явные query/files/event/observation ports.
  Native factory в AutoModeModule передаёт SettingsService, ProviderRegistry,
  scoped filesystem/security, captured host environment, checkpoint repository и
  application metrics. Зависимость application service обязательна. Facade/Compat
  analysis stub и forwarding удалены после переключения endpoint.
- Input и normal response прежние: только `projectPath`, HTTP200 с
  `{success:true,message:"Project analysis started"}`. Job резервируется до ack;
  закрытый/неподтверждённый/full owner отклоняет новую работу как unavailable.
- Максимум **8 accepted jobs на приложение**, включая preflight, stream и запись.
  Незавершённый unknown job сохраняет ownership и блокирует replacement. Feature
  leases/ConcurrencyManager не дублируются; analysis имеет ephemeral `analysis-*` ID.
- Прежняя phase-model/provider/credentials selection; effective task-execution
  projectAnalysisPrompt, Read/Glob/Grep, readOnly и максимум5 turns. Query adapter
  действительно использует agent-mode preparation и actual provider stream.
- Deadline: provider-specific `agentTimeoutMs`, если этот provider поддерживает
  такой override; иначе global `modelTimeouts.agentTimeoutMs`, затем **300000ms**.
  Fallback timer действует с reservation; configured deadline учитывает уже
  затраченное preflight время. Timeout aborts controller; автоматического replay нет.
- Максимум **4MiB UTF-8** streamed/final analysis text. Пустой/oversized результат
  не заменяет прежний report. Scoped adapter пишет exclusive0600 temp и atomic
  rename; проверяет abort после temp write и перед publish. Уже совершённый atomic
  commit не откатывается; completion не публикуется после отмены.
- Events сохранены: `auto_mode_feature_start`, `auto_mode_progress`, затем
  `auto_mode_feature_complete` только после записи; failures — `auto_mode_error`.
  Metadata: featureName/title Project Analysis, projectPath, branchName:null.
  Ошибки controlled, private provider exception text не публикуется.
- Module destroy закрывает admission, aborts jobs и ждёт actual settlement до
  **5000ms**. Unknown outcome остаётся failed/cached close; native application
  возвращает APPLICATION_CLEANUP_FAILED. Provider и analysis owners могут иметь
  последовательные deadlines: observed negative app close занимает около10s,
  это не обещание общего application shutdown за5s.

## Existing-only Local/Docker/SSH

Opaque preparation выдаётся только серверным resolver на основании saved/pinned
ProjectGit target. WeakMap/provenance guard привязывает grant к SettingsService,
controller cwd и ephemeral analysis runKey. Проверяются selection и descriptor
fingerprints; request body не содержит runtime, binding или preparation policy.

Новый optional trusted helper argument и internal existingOnly branch не меняют
обычные callers. Analysis не готовит контейнеры, checkout или feature worktrees,
не запускает install/clone и не переключается на controller при remote failure.
SSH использует явно подготовленный authoritative checkout. Docker требует уже
подготовленный **работающий** container. Выявленный дополнительный hole закрыт:
`verifyStorage` внутри вызывает Docker runtime, чей обычный start мог запустить
остановленный container. Analysis capability теперь несёт отдельный no-start
manager/runtime: storage probes и tool calls только проверяют Running. Остановка
между preparation и tool read также отклоняется без restart.

Существующие ограничения remote read-only providers сохраняются: Direct, Cursor,
Claude/Codex используют их поддерживаемые adapters; provider/config combination,
который не умеет enforce readOnly, отклоняется до query как controlled runtime error.
Controller MCP, subagents/connection profiles и credentials не пересылаются вместо
remote setup. Missing/unverified target не становится Local fallback.

## Доказательства среза

- `project-analysis.contract.test.ts`: **6 native HTTP cases** — actual configured
  output/events/file mode; provider failure preserves previous report; held provider
  abort/drain + two apps; held temp write не становится late publish; configured
  deadline; unconfirmed cleanup/cached failed close.
- `project-analysis-ssh.contract.test.ts`: **1 actual SSH + Direct tool-loop case**.
  Private upstream просит Read; actual SSH worker возвращает authoritative source,
  poisoned controller отсутствует в report/requests. Read/Glob/Grep сохранены;
  prepareProject/prepareWorker не вызываются, remote worktree не создаётся.
- `project-analysis-existing-target.test.ts`: **8 focused Docker/authority cases**:
  existing/missing/stopped/changed selection/changed descriptor/forged-cross-job
  grant; actual verifyStorage/runtime path и actual issued read после остановки.
  В последних probes engine verification/runner подменены, сам verifyStorage/runtime
  не подменён. Это не утверждение о новом real-container E2E analysis запуске.
- После final no-start fix: **83 unit passed, 2 conditional skipped** в targeted
  selection; **7 native contracts passed**, server tsc, scoped ESLint и format/diff0.
  Старые endpoint response/merge fixtures обновлены на обязательный native owner.

Полные suite, SSH/Docker artifact acceptance и итоговые counts фиксируются общим
checkpoint. Этот документ их не подменяет и не закрывает остальные architecture,
provider/OS или deployment gates.
