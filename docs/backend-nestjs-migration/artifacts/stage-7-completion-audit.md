# Stage 7 completion audit

Проверено по текущему коду 2026-10-24. Это сверка исходных требований этапа 7,
не замена Definition of Done и не объявление этапа завершённым.

| Исходная группа                 | Фактическое состояние / evidence                                                                                                                                                                                                                  | Что ещё не доказано                                                                                                                                                                                                                                          |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 7.1 provider/model capabilities | `BaseProvider.getCapabilities/getModelCapabilities` разделены; 22 `provider-capabilities` cases проверяют 7 adapters, exact/unknown IDs и пересечение model/adapter grants                                                                        | Матрица каждого SDK/CLI path × environment и custom endpoint grants не исчерпывается этими tests                                                                                                                                                             |
| 7.1 lifecycle/events            | Managed entrypoint находится в `BaseProvider`; `ProviderExecutionScope` владеет execution; 14 common adapter contracts проходят для всех 7 registrations                                                                                          | Generic adapter contract до запуска SDK не является доказательством всех фактических SDK events/cleanup paths                                                                                                                                                |
| 7.2 native registry             | `ProviderRegistry` получает явные registrations/connection repository, aliases и execution owner через DI; `ProvidersModule.register` делает metadata-only preflight                                                                              | Не отмечать старые singleton helpers всего backend удалёнными только по native registry                                                                                                                                                                      |
| 7.3 provider migration          | Все 7 registrations имеют native owner и common adapter suite; `new SettingsService` в providers/provider modules не найден                                                                                                                       | Общее поведение CLI/SDK/platform-specific discovery ещё содержит ambient helpers; полный runtime-specific contract matrix не закрыт                                                                                                                          |
| 7.4 agent decomposition         | Native `AgentsController → AgentApplicationService`; отдельные prompt, selector, stream, execution/state/session/queue helpers уже существуют; native handlers не используют Express Req/Res                                                      | Финальная проверка всех restart/persistence/shutdown критериев должна использовать соответствующие existing contract suites, не только этот targeted run                                                                                                     |
| 7.5 tool policy                 | Canonical policy и 13 tests уже проверяют aliases, capability filtering, read-only explicit lists и некоторые destructive patterns                                                                                                                | `ToolPolicyService.resolve` с unspecified list не ограничивает read-only; destructive detector не является runtime sandbox. Gemini CLI использует `--approval-mode yolo` без передачи `allowedTools`; полный runtime enforcement на всех adapters не доказан |
| 7.6 setup statuses              | Native Claude/Codex/OpenCode GET теперь passive: нет registry `detectInstallation/checkAuth`, credential contents не читаются ради статуса, hints не выставляют token/key validity. GitHub/Gemini/Copilot/Cursor passive paths существовали ранее | `ProviderRegistry.installationStatuses` всё ещё использует adapter detection для model/provider discovery; нельзя считать все discovery entrypoints пассивными                                                                                               |
| 7.6 confirmed commands          | Existing connection/credential/verification commands имеют native target/protocol/confirmation paths; этот срез их не заменяет и не вызывает                                                                                                      | Единый policy всех credential consumers, в частности usage/ZAI configuration, всё ещё не закрыт                                                                                                                                                              |
| 7.6 usage                       | Usage endpoints принадлежат `ProviderUsageController/Service`; cache/runtime ownership внесены ранее                                                                                                                                              | `ProviderUsageService` ещё возвращает некоторые raw error messages; consent/refresh semantics всех usage adapters не доказаны                                                                                                                                |
| Exit criteria                   | Native registration и agent HTTP ownership подтверждаются source; common adapter contracts проходят                                                                                                                                               | Full stage checkpoint, all supported environment acceptance и остальная tool/credential policy остаются незакрытыми. Optional live acceptance не выполнялся и не выдаётся за offline evidence                                                                |

## Изменения этого среза

- Claude status больше не объявляет env/file/cache/activity evidence проверенной
  авторизацией и не устанавливает `oauthTokenValid/apiKeyValid/hasCliAuth` из hints.
- Codex/OpenCode installation GET перенесён из provider adapters в native host
  runtime; старый `ProviderSetupStatusService.installationStatus` удалён.
- Добавлен additive `auth.authenticationChecked: false`, сохранены прежние response
  fields и install/login guidance. Version lookup остаётся bounded `--version`,
  это не auth probe. Credential-file hints используют stat, не чтение токенов.
- UI setup/settings и startup hydration сохраняют checked flag, не выводят
  validity из presence и различают unknown, failed и explicit successful verification.
  Копирование login command больше не запускает auth polling.
- Setup Continue и Project Claude configuration используют отдельный
  `canAttemptCliProvider`: installed/configured provider остаётся доступным для
  явной попытки выполнения при неизвестной authentication. Это не grant доступа:
  server connection/runtime auth checks не отключены. `connected:false` запрещает
  попытку в helper. Model catalog не зависит от setup auth boolean.
- В setup-store нет persisted authoritative verification evidence; explicit
  verification components сохраняют собственные результаты. Key save сам по себе
  больше не объявляет успешную проверку.

## Targeted evidence

- Server units: 122 passed в `setup-status-runtime`, `host-setup-status`,
  `provider-setup-status`, `provider-adapter-contract`, `provider-capabilities`,
  `tool-policy`.
- Native host/provider status contracts: 2 passed. Owned CLI/version fixtures и
  native per-app environment проверяются без vendor calls; Codex/OpenCode GET не
  создаёт provider instance. Invalid JSON auth file является только file hint.
- UI passive status / availability units: 7 passed; explicit verified result
  отображается отдельно, passive hints не маркируются ни authenticated, ни failed.
- UI TypeScript check passed. Full suites/browser запускаются root после merge;
  результаты других срезов не выдаются за новый full stage checkpoint.
