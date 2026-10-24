# Этап 6. Execution environments, Git и worktrees

## Цель

Перевести наиболее чувствительную инфраструктурную область в явные Nest-модули,
сохранив закрепление среды, безопасность путей, cancel semantics и запрет скрытого
fallback между Local/Docker/SSH/Memory.

## Целевая декомпозиция

```text
ExecutionModule
├── ExecutionRegistry
├── ExecutionResolver
├── LocalExecutionAdapter
├── DockerExecutionAdapter
├── SshExecutionAdapter
├── RuntimeMemoryStore (capability текущего binding, не отдельная среда)
└── ProcessSupervisor

GitModule
├── ProjectGitService
├── GitReadPort
├── GitWritePort
└── adapters per execution environment

WorktreeModule
├── WorktreeApplicationService
├── WorktreeRepository
├── Branch/PR use cases
└── FeatureWorkspaceService
```

## 6.1. Execution contracts

- [x] Перенести существующие runtime interfaces в стабильный application port.
- [x] Разделить capabilities: files, exec, interactive PTY, Git, preview, tests.
- [x] Ввести immutable `ExecutionBinding` для project/session/feature run.
- [x] Зафиксировать `runtimeCwd`, authoritative root, target id и environment type.
- [x] Различить preflight failure, execution failure, cancellation и unknown outcome.
- [x] Запретить retry mutation после transport loss без idempotency proof.
- [x] Запретить silent Local fallback для явно выбранного Docker/SSH.
- [x] Auto fallback разрешать только до первых external effects и после согласия.

## 6.2. Registry и DI

- [x] Заменить function imports/global caches на injectable registry.
- [x] Каждый adapter объявить provider с capability metadata.
- [x] `ExecutionResolver` выбирает adapter, но не выполняет setup при inspect/read.
- [x] Preparation остаётся отдельным explicit use case.
- [x] Credentials и target setup не передаются через controller environment.
- [x] Не создавать adapter на каждый request без необходимости.

## 6.3. Local adapter

- [x] Сохранить запуск без shell там, где возможен argv.
- [x] Сохранить process-tree cancellation, output limits и timeouts.
- [x] Явно маркировать отсутствие sandbox.
- [x] Централизовать temporary directories и cleanup.
- [x] Зафиксировать и покрыть тестами Windows/WSL policy (без POSIX fallback на native Windows).

## 6.4. Docker adapter

- [x] Инкапсулировать Docker CLI/context calls.
- [x] Сохранить ownership labels и cleanup только собственных ресурсов.
- [x] Разделить inspect, prepare, execute и destroy.
- [x] Не mount Docker socket внутрь agent container.
- [x] Сохранить pinned project container/worktree behavior.
- [x] Сериализовать conflicting container preparation.
- [x] Не пересоздавать pinned container ради preview ports.

## 6.5. SSH adapter

- [x] Инкапсулировать transport/channel lifecycle.
- [x] Сохранить fingerprint confirmation и отказ при изменении host key.
- [x] Разделить controller alias и remote path.
- [x] Сохранить target-side worker version negotiation.
- [x] Подтверждать cancellation/cleanup, иначе возвращать unknown outcome.
- [x] Исключить Local filesystem fallback.
- [x] Не логировать private keys, passwords и raw SSH diagnostics.

## 6.6. Memory capability

Memory не является четвёртой execution environment: операции выполняются через
`RuntimeMemoryStore` в уже закреплённом Local/Docker/SSH binding.

- [x] Зафиксировать допустимые operations и persistence boundary.
- [x] Сохранить concurrent write serialization.
- [x] Не выдавать Memory capabilities, которых реально нет.

## 6.7. ProcessSupervisor

- [x] Единый owner child processes, PTY transports и worker heartbeats.
- [x] Registry jobs с correlation/session/feature ids.
- [x] Bounded stdout/stderr buffers.
- [x] Timeout/cancel/escalation policy.
- [x] Shutdown drain с deadline.
- [x] Recovery metadata без автоматического replay mutation.
- [x] Test doubles без настоящего spawn.

## 6.8. GitModule

- [x] Перенести status/diff/log/branches/remotes в read use cases.
- [x] Перенести stage/unstage/commit/create в write use cases.
- [x] Затем перенести pull/push/rebase/merge/cherry-pick/stash/sync.
- [x] Разделить local `@automaker/git-utils` и remote worker adapter.
- [x] Валидировать repository/root/binding перед каждой mutation.
- [x] Сохранить conflict states и continue/abort operations.
- [x] Не делать implicit fetch в read-only endpoints.
- [x] Не получать credentials в controller.

## 6.9. WorktreeModule

- [x] Перенести list/info/create/delete.
- [x] Перенести feature worktree resolution и metadata.
- [x] Перенести branch tracking/switch/checkout.
- [x] Перенести init script и hooks с тем же execution binding.
- [x] Перенести PR info/create/description после базовых Git operations.
- [x] Перенести test/dev routes на соответствующие application services.
- [x] Защитить активные worktrees от удаления.
- [x] Сохранить cleanup partial create failure.

## Migration waves

1. Execution interfaces и registry без смены поведения.
2. Local/Memory adapters.
3. Docker adapter.
4. SSH adapter.
5. Git read paths.
6. Git write paths.
7. Worktree lifecycle.
8. Branch/network/destructive operations.
9. PR and GitHub-dependent worktree operations.

## Тестовая матрица

| Область          | Unit | Fake transport | Real Local | Real Docker | Real SSH |
| ---------------- | ---: | -------------: | ---------: | ----------: | -------: |
| Resolve/binding  |    ✓ |              ✓ |          — |           — |        — |
| Files/exec       |    ✓ |              ✓ |          ✓ |           ✓ |        ✓ |
| Cancel/timeout   |    ✓ |              ✓ |          ✓ |           ✓ |        ✓ |
| Git read/write   |    ✓ |              ✓ |          ✓ |           ✓ |        ✓ |
| Worktrees        |    ✓ |              ✓ |          ✓ |           ✓ |        ✓ |
| Restart/recovery |    ✓ |              ✓ |          ✓ |           ✓ |        ✓ |

Real environment suites не входят в быстрый unit job и запускаются на выделенных
runners. Credentials реальных AI providers им не нужны.

## Безопасность

- Любая mutation получает resolved immutable binding.
- UI и logs показывают фактическую среду и authoritative path.
- Inspect/read не подготавливает environment и не выполняет clone/fetch.
- Shell string разрешается только в задокументированных случаях с отдельной защитой.
- Destructive operation проверяет ownership и active sessions.

## Exit criteria

- Execution/Git/worktree routes удалены из legacy bridge.
- Все environment adapters доступны через DI registry.
- Controller не формирует commands и не выбирает fallback.
- Unknown-outcome и cancellation semantics покрыты тестами.
- Local/Docker/SSH matrix проходит до переноса agent orchestration.
- Полный checkpoint этапа 6 успешно выполнен на всех доступных Local/Docker/SSH
  runners и зафиксирован завершающим коммитом в единственной migration-ветке.

## Checkpoint 2026-10-24

- Все 59 маршрутов `/api/worktree` имеют единственного владельца Nest; legacy mount удалён.
- Local/unit: 78 тестов registry, bindings, Git/worktree и process services прошли.
- SSH: 136 сценариев выполнены на реальном локальном SSH/SFTP peer; после обновления
  контрактов перенесённых операций целевые 35 route/preview/workspace сценариев прошли.
- Docker: 11 доступных real-engine сценариев прошли на локальном образе без pull;
  4 дополнительных opt-in сценария требуют отдельного образа с PTY/provider tooling.
- Исправлена единая preview port policy: relay использует настроенный диапазон, поэтому
  runner не зависит от свободности стандартных `3100–3119`.
- Native Windows runner и browser executable в этом окружении отсутствуют; соответствующая
  fail-closed policy покрыта unit-тестами, browser-only smoke остаётся отдельным opt-in job.

### Follow-up Linux Local exec cleanup (2026-10-24)

После обнаружения race в этапе 7 усилен terminal acknowledgement Local exec:
SIGKILL/root close дополняются bounded process-group/task quiescence probe.
Исходный child/grandchild test сохранён без ослабления. Watchdog не снимается
до observation, а monotonic deadline не позволяет поздний false success.
Подробности, evidence и ограничения перечислены в
[документе этапа 7](07-providers-and-agents.md#local-exec-lifecycle-regression-обнаружение-и-исправление-2026-10-24).
