# Ideation: repository, analysis и единый text stream

Дата: 2026-10-25, wave23; продолжение native Ideation lifecycle/conversion.

## Границы и ownership

`IdeationService` остаётся единственным владельцем session map, session tasks и
существующего `IdeationJobs`. Public standalone constructor, public methods,
HTTP paths и response schemas сохранены. Новые collaborators не имеют Nest
hooks, собственной очереди accepted jobs или второго session registry:

| Collaborator                   | Ответственность                                                         | Переданные зависимости                                                                                  |
| ------------------------------ | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `IdeationIdeaRepository`       | Create/list/get/update/delete/archive идеи                              | Captured atomic filesystem, working-directory validation, ID generator                                  |
| `IdeationProjectAnalysis`      | Analysis progress/result/error, cache read/write                        | Captured filesystem, validation, context reader, event emitter                                          |
| `IdeationTextStream`           | SDK options, provider selection, Direct preparation, text normalization | Native provider registry, settings, validation, captured host environment, Direct checkpoint repository |
| `IdeationProjectContextReader` | Read-only context, structure и существующие analysis heuristics         | Captured filesystem, feature/idea/cache readers, ID generator                                           |
| `IdeationPromptCatalog`        | Prompt/category catalog и ideation prompt composition                   | Plain inputs                                                                                            |

Последние два collaborator выделены root непосредственно перед этим срезом и
сохранены. Native `IdeationModule` уже явно передаёт scoped filesystem, security
validator, settings/provider owner, host environment и checkpoint repository в
существующий constructor. Collaborators создаются из этих зависимостей; скрытого
native fallback на ambient filesystem нет. Standalone defaults остаются прежними.

Analysis admission/abort/drain остаётся у `IdeationJobs`: collaborator получает
существующий AbortController. Сохраняются прежние локальные analysis heuristics;
это выделение ответственности не заменяет их платной model query.

## Сохранённые семантики

Idea document paths, поля/defaults/timestamps, сортировка и atomic backup writes
не меняются. Существующие permissive read fallbacks (`[]`/`null` при ошибке чтения)
и поведение missing delete сохраняются; новый fail-closed policy не вводится.
Session persistence остаётся у session owner.

Message и suggestions используют один `IdeationTextStream.run`: assistant text
blocks накапливаются, непустой success result заменяет accumulated text, следующие
text blocks дописываются. В обоих путях остаётся text-mode Direct preparation с
одним native checkpoint repository. Message callback публикует прежние partial
stream events; suggestions возвращает parsed suggestions и started/complete/error
без добавления chat progress events. Conversation history, maxTurns, custom
provider credentials, readOnly и `allowedTools: []` suggestions сохраняются.

## Реальный concurrent HTTP и drain

Native idea mutations уже проходят через существующий
`ProjectFeatureSerializer.run(project)` в IdeationApplicationService. Проверка
держит реальное чтение idea document первого HTTP update после получения snapshot,
принимает второй независимый update и подтверждает: второй read ещё не начался.
После освобождения оба изменения (`title` и `notes`) находятся в документе.
Lost update в этом native same-app сценарии не воспроизведён; дополнительная
repository queue не добавлена.

Следующий реальный HTTP update удерживает atomic temporary-file write. При
`app.close()` существующий IdeationJobs уже закрывается, а filesystem shutdown
barrier ещё не вызван. После release запрос завершается, shutdown проходит и
документ содержит все три изменения. Это проверка реального storage/HTTP/lifetime,
а не замена метода repository готовым результатом.

Serializer остаётся per-application/project. Этот срез не обещает distributed
locking между несколькими процессами или приложениями, которые одновременно
мутируют один внешний directory. Standalone прямые CRUD-вызовы также не получают
нового скрытого lock.

## Проверки

Команды из корня с Node
`/home/user/.npm/_npx/ca3942424f2c6fc5/node_modules/node/bin` в PATH:

- `npm exec --workspace=apps/server -- vitest run tests/unit/services/ideation-service.test.ts tests/unit/modules/ideation-jobs.test.ts`:
  **42/42 PASS**, `/tmp/automaker-wave23-ideation-unit-final.log`.
- `npm exec --workspace=apps/server -- vitest run --config vitest.contract.config.ts tests/contract/ideation-native.contract.test.ts tests/contract/planning-ideation-response.contract.test.ts tests/contract/direct-checkpoint-callers.contract.test.ts`:
  **16/16 PASS**, `/tmp/automaker-wave23-ideation-contract.log`.
- `npm exec --workspace=apps/server -- tsc --noEmit`: exit 0;
  `/tmp/automaker-wave23-ideation-tsc.log`.
- `npm exec --workspace=apps/server -- eslint src/services/ideation-service.ts src/services/ideation tests/contract/ideation-native.contract.test.ts`:
  exit 0, `/tmp/automaker-wave23-ideation-lint.log`.

Три добавленных native cases проверяют captured repository/analysis filesystem
в двух настоящих приложениях при запрещённом legacy filesystem IO; concurrent
HTTP patches и held-write shutdown; общий stream normalization с разными event
semantics и provider options. Existing native contracts сохраняют conversion
restart/idempotency, collision handling, provider cancellation, sibling isolation,
response schemas и реальные app-owned Direct checkpoint callbacks.

Fixtures используют приватные временные directories, loopback port 0 и явный
MockProvider. Платные model endpoints не вызываются. Первый targeted run выявил
опечатку нового fixture endpoint (`analyze-project` вместо существующего `analyze`);
fixture исправлен, финальный run выше зелёный. Full suites/build выполняет root
после общего freeze; targeted результаты не заменяют этот общий gate.
