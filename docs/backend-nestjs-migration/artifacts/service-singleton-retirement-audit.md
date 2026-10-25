# Удаление восьми process-wide service owners

Срез после checkpoint `ef36030e`. Удалены named singleton exports/getters и
constructor defaults, которые позволяли обходить native application ownership.
HTTP routes, execution/lease semantics и provider policies не менялись.

| Семейство                                               | Фактический caller и изменение                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ntfyService`                                           | Reachable `EventHookService` получает `NtfyService` из native OrchestrationModule factory. У каждой Nest application собственный class provider; exported instance удалён.                                                                                                                                                       |
| `pipelineService`                                       | ExecutionService, FeatureStateManager, PipelineOrchestrator, AutoModeCompat/GlobalService больше не используют singleton/default fallback. Native factories уже передавали owner; теперь constructor/FacadeOptions требуют его явно. Test doubles стали локальными fixtures, standalone tests передают explicit PipelineService. |
| `getTerminalService`                                    | Native TerminalModule уже владел TerminalService. Оставшийся settings compatibility factory получает explicit TerminalService, getter и module cache удалены.                                                                                                                                                                    |
| `getInitScriptService` и singleton convenience wrappers | Native WorktreeApplicationService не использовал этот singleton. Unmounted compatibility create/run handlers получают explicit InitScriptService; module cache и wrappers удалены. Pure class/path methods сохранены.                                                                                                            |
| `getDevServerService` / `peekDevServerService`          | Native LocalProcessRuntimeModule/WorktreeProcessService уже использовали DI. Unmounted compatibility router/dispatchers/handlers делят explicit per-router dev owner, вместо глобального singleton.                                                                                                                              |
| `getTestRunnerService`                                  | Аналогично: native owner сохранён, compatibility handlers получают один explicit per-router instance. Getter и module cache удалены.                                                                                                                                                                                             |
| `getFeatureExportService`                               | Native feature services уже создавали context-bound FeatureExportService с featureLoader. Compatibility import/export handlers теперь используют переданный featureLoader, не глобальный default instance. Getter удалён.                                                                                                        |
| `getGeminiUsageService`                                 | Reachable consumers уже использовали ProvidersModule DI; неиспользуемый getter/cache удалён. Usage behavior не менялся.                                                                                                                                                                                                          |

## Reachability и оставшиеся references

- В `src` не осталось imports/exports восьми retired singleton API. Имя
  `pipelineService` встречается как explicit parameter в старых pipeline route
  factories; это не module-level instance и не fallback.
- `createWorktreeRoutes` / `createSettingsRoutes` не импортируются production
  bootstrap/native modules. Они сохранены для existing transport acceptance
  fixtures, требуют explicit owners; test context helper останавливает созданные
  local dev/test services. Изменения fixtures не запускали SSH/Docker acceptance.
- `getManagedDevServerService(settings, events)` и
  `getManagedTestRunnerService(settings, events)` сохранены: это context-keyed
  compatibility helpers с обязательным SettingsService, а не default process
  singleton. Native LocalProcessRuntimeModule продолжает создавать классы напрямую.
- Другие default dependencies, storage adapters и unrelated service families
  этим срезом не объявляются переписанными. Ideation/app-spec/backlog/concurrency
  implementations и agent execution logic не менялись.

## Проверки

- 16 targeted unit files — **468 passed**: execution, pipeline, feature-state,
  event hooks/ntfy, terminal, dev server/persistence/events и facade runner.
- 4 native contract files — **7 passed**: native integrations composition,
  event-hook drain, pipeline repository, plan recovery. Проверены per-app ntfy
  identity и совпадение injected hook dependency, сохранение owned shutdown и
  persisted pipeline/recovery behavior.
- Server TypeScript, formatting и `git diff --check` — passed.
- Full suites, GUI, Docker, live SSH и vendor calls не запускались. Общий stage
  checkpoint выполняет root после source freeze.
