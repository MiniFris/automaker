# Этап 7: Gemini restricted chat для CLI 0.65.0

Срез после checkpoint `3fc08f47`. Восстанавливает обычный native chat preset
через version-bound policy adapter, не меняя SettingsService или другие providers.

## Production path

`AgentQueryOptionsBuilder/AgentExecutor → GeminiProvider → prepareGeminiPolicy`
сохраняет explicit tool restrictions. Отсутствующая policy сохраняет прежний
unrestricted execution. Для explicit `allowedTools`/`tools`:

- `readOnly:true` и неизвестные tools отклоняются до detection, записи и запуска.
  Наличие CLI `plan` flag не объявляется read-only enforcement.
- Поддержаны native local Linux/macOS и issued remote Linux process/filesystem
  ports. Windows/npx/WSL остаются unsupported для restricted execution.
- Проверяется доступность стандартного system policies directory: любой `.toml`,
  unreadable/truncated listing запрещает запуск model query. Отсутствие directory
  допускается. Далее bounded `--version` должен вернуть ровно `0.65.0`, а `--help`
  подтвердить `--admin-policy`, `--extensions`, `--approval-mode`.
- Provider/setup install guidance использует общий trusted version constant:
  `npm install -g @google/gemini-cli@0.65.0`, без автоматических установок.
- Owned per-invocation TOML содержит admin-tier catch-all deny, native allowlist
  и более приоритетный deny всех MCP tools. MCP tool с native short name не
  получает native grant. User policies и YOLO rules имеют меньший tier.
- `[]` не добавляет allow rules. Две explicit lists пересекаются. `Task`/`Skill`
  не грантят Gemini delegation/activation channels; остальные chat tools работают.
  Это верхняя граница разрешённых tools, не обещание поддержки каждой SDK feature.
- Query использует `--approval-mode default --extensions none --admin-policy`.
  Policy path находится в target-local `/tmp/automaker-gemini-policy-<uuid>`:
  parser CLI разделяет comma paths, поэтому arbitrary project name в policy argv
  не используется. Local/remote fixture включает comma/quote в project path.
- Успех, ошибка и cancellation проходят `finally` cleanup через тот же runtime
  filesystem port. Cleanup не использует отменённый query signal. Неподтверждённая
  очистка выдаёт `ProviderCleanupError` и блокирует execution owner для следующих
  queries. Restricted mode не создаёт `.geminiignore` и не переписывает vendor
  settings/auth profile для установки policy.
- Remote preparation допускает Gemini `tools:[]` до adapter: generic CLI guard
  обходится только после подготовки enforced policy; read-only guard сохранён.

## Проверенные основания

В [pinned policy config](https://github.com/google-gemini/gemini-cli/blob/v0.65.0/packages/core/src/policy/config.ts)
supplemental admin policy имеет tier 5 и не требует root ownership. CLI игнорирует
её при наличии system TOML — поэтому это явная граница поддержки.
[PolicyEngine](https://github.com/google-gemini/gemini-cli/blob/v0.65.0/packages/core/src/policy/policy-engine.ts)
применяет priority и global deny к tool availability и invocation.

Version-bound adapter не является filesystem sandbox: разрешённый Bash сохраняет
свои обычные shell capabilities. Реальное model/auth/vendor execution и внутренние
записи session history vendor CLI этим offline срезом не проверялись.

## Targeted evidence

- `gemini-tool-policy` + `gemini-provider` units — **34 passed**: grants,
  intersections/empty lists, version/capability/system boundaries, unique files,
  cancellation-independent cleanup и failure cleanup.
- `gemini-tool-policy.contract.test.ts` — **4 passed**: local и issued fake-SSH
  transport с owned executable; completion/cancel; настоящий native HTTP chat
  preset; cleanup failure блокирует provider owner.
- `gemini-policy-distribution.contract.test.ts` — **1 passed**, **11 checks**
  против actual npm distribution `@google/gemini-cli@0.65.0`: actual CLI
  `--version`/`--help` и реальный bundled PolicyEngine, включая permissive user
  policy, deny-all, delegation/MCP collision и ignored-system-policy boundary.
  Package установлен только в owned `/tmp` через `--ignore-scripts`; child HOME
  изолирован, внешняя сеть запрещена preload guard. Auth/model calls отсутствуют.
- Distribution acceptance opt-in через `AUTOMAKER_GEMINI_POLICY_PACKAGE`, обычные
  suites не устанавливают CLI. Для текущего fixture package root:
  `/tmp/automaker-gemini-065-LiDV4X/node_modules/@google/gemini-cli`.
- Server `tsc --noEmit` и `git diff --check` — passed. Full suites, GUI, Docker,
  live SSH и paid/vendor model calls не запускались.
- Guidance follow-up: contracts package build, **44 server units + 7 shared
  contract units + 7 UI HTTP-client units passed**. Schema и UI fallback используют
  ту же pinned install command; существующая passive authentication семантика
  сохранена.
