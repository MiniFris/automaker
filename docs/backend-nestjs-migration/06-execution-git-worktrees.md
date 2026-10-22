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
├── MemoryExecutionAdapter
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

- [ ] Перенести существующие runtime interfaces в стабильный application port.
- [ ] Разделить capabilities: files, exec, interactive PTY, Git, preview, tests.
- [ ] Ввести immutable `ExecutionBinding` для project/session/feature run.
- [ ] Зафиксировать `runtimeCwd`, authoritative root, target id и environment type.
- [ ] Различить preflight failure, execution failure, cancellation и unknown outcome.
- [ ] Запретить retry mutation после transport loss без idempotency proof.
- [ ] Запретить silent Local fallback для явно выбранного Docker/SSH.
- [ ] Auto fallback разрешать только до первых external effects и после согласия.

## 6.2. Registry и DI

- [ ] Заменить function imports/global caches на injectable registry.
- [ ] Каждый adapter объявить provider с capability metadata.
- [ ] `ExecutionResolver` выбирает adapter, но не выполняет setup при inspect/read.
- [ ] Preparation остаётся отдельным explicit use case.
- [ ] Credentials и target setup не передаются через controller environment.
- [ ] Не создавать adapter на каждый request без необходимости.

## 6.3. Local adapter

- [ ] Сохранить запуск без shell там, где возможен argv.
- [ ] Сохранить process-tree cancellation, output limits и timeouts.
- [ ] Явно маркировать отсутствие sandbox.
- [ ] Централизовать temporary directories и cleanup.
- [ ] Проверить Windows/WSL process behavior.

## 6.4. Docker adapter

- [ ] Инкапсулировать Docker CLI/context calls.
- [ ] Сохранить ownership labels и cleanup только собственных ресурсов.
- [ ] Разделить inspect, prepare, execute и destroy.
- [ ] Не mount Docker socket внутрь agent container.
- [ ] Сохранить pinned project container/worktree behavior.
- [ ] Сериализовать conflicting container preparation.
- [ ] Не пересоздавать pinned container ради preview ports.

## 6.5. SSH adapter

- [ ] Инкапсулировать transport/channel lifecycle.
- [ ] Сохранить fingerprint confirmation и отказ при изменении host key.
- [ ] Разделить controller alias и remote path.
- [ ] Сохранить target-side worker version negotiation.
- [ ] Подтверждать cancellation/cleanup, иначе возвращать unknown outcome.
- [ ] Исключить Local filesystem fallback.
- [ ] Не логировать private keys, passwords и raw SSH diagnostics.

## 6.6. Memory adapter

- [ ] Зафиксировать допустимые operations и persistence boundary.
- [ ] Сохранить concurrent write serialization.
- [ ] Не выдавать Memory capabilities, которых реально нет.

## 6.7. ProcessSupervisor

- [ ] Единый owner child processes, PTY transports и worker heartbeats.
- [ ] Registry jobs с correlation/session/feature ids.
- [ ] Bounded stdout/stderr buffers.
- [ ] Timeout/cancel/escalation policy.
- [ ] Shutdown drain с deadline.
- [ ] Recovery metadata без автоматического replay mutation.
- [ ] Test doubles без настоящего spawn.

## 6.8. GitModule

- [ ] Перенести status/diff/log/branches/remotes в read use cases.
- [ ] Перенести stage/unstage/commit/create в write use cases.
- [ ] Затем перенести pull/push/rebase/merge/cherry-pick/stash/sync.
- [ ] Разделить local `@automaker/git-utils` и remote worker adapter.
- [ ] Валидировать repository/root/binding перед каждой mutation.
- [ ] Сохранить conflict states и continue/abort operations.
- [ ] Не делать implicit fetch в read-only endpoints.
- [ ] Не получать credentials в controller.

## 6.9. WorktreeModule

- [ ] Перенести list/info/create/delete.
- [ ] Перенести feature worktree resolution и metadata.
- [ ] Перенести branch tracking/switch/checkout.
- [ ] Перенести init script и hooks с тем же execution binding.
- [ ] Перенести PR info/create/description после базовых Git operations.
- [ ] Перенести test/dev routes на соответствующие application services.
- [ ] Защитить активные worktrees от удаления.
- [ ] Сохранить cleanup partial create failure.

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
