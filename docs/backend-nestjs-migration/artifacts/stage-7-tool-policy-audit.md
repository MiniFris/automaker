# Этап 7.5: ToolPolicy и Gemini CLI

Срез после checkpoint `170f0123`. Это проверка конкретных policy gaps исходного
плана, не подтверждение всего этапа 7 или всех SDK permissions.

## Реализовано

- `ToolPolicyService.resolve`: omitted list + `readOnly:true` возвращает только
  `Read`, `LS`, `Glob`, `Grep`, `WebSearch`, `WebFetch`; unrestricted omitted list
  остаётся `undefined`. Explicit `[]` остаётся `[]` в обоих режимах.
- Read-only фильтр допускает только эффект `read`. `Task`, `Skill`, `TodoWrite`
  не считаются безопасными read-only tools: delegation/skills могут выполнять
  изменения, а coordination не является чтением.
- `AgentQueryOptionsBuilder` сохраняет explicit empty list при включённых
  skills/subagents, не добавляя в него `Skill`/`Task`. Обычные nonempty policies
  сохраняют прежнее добавление разрешённых delegation tools.
- `AgentExecutor` передаёт `readOnly` при initial planning с approval и при
  revisions также локальным adapters. Раньше поле проходило только в direct/
  remote branches. Implementation continuation передаёт `false`.
- `AutoModeServiceFacade` уже передаёт planning policy в injected ToolPolicy;
  caller проверен, изменений не требует. `AgentProviderSelector` сохраняет
  capability filtering, включая explicit `[]`.
- Gemini проверяет policy до CLI detection, `.geminiignore` и local/remote spawn.
  `readOnly:true`, любой explicit `tools` или `allowedTools` (включая `[]`)
  возвращает `GEMINI_TOOL_POLICY_UNSUPPORTED` с status 400. Policy не удаляется
  и не заменяется YOLO. Unrestricted adapter execution с undefined policy
  сохраняет прежние argv, stdin и stream normalization.

## Почему unsupported

CLI не закреплён в lockfile; Windows npx registration также не задаёт version.
Официальная [CLI configuration](https://geminicli.com/docs/reference/configuration/)
описывает `--allowed-tools` как autoapproval, а не restriction availability;
`yolo` автоматически разрешает все tools. `plan` зависит от capability конкретной
версии/experimental planning. Поэтому эти флаги не доказывают исполнение нашей
policy для произвольного установленного CLI. Срез не устанавливает vendor CLI
и не меняет пользовательские Gemini settings ради эмуляции ограничений.

Следствие: текущий HTTP chat builder задаёт explicit chat tool preset, поэтому
Gemini chat теперь сообщает unsupported. Это проверено native HTTP contract:
ограничение сохраняется, executable не запускается. Чтобы поддержать этот preset,
нужен отдельный versioned Gemini enforcement adapter; silently dropping policy
не является совместимым решением. Это ограничение, не заявление об успешном
Gemini read-only execution.

## Проверки

- Targeted unit: ToolPolicy, Gemini provider, AgentExecutor, AgentProviderSelector
  — **113 passed**; AgentQueryOptionsBuilder — **17 passed**.
- `gemini-tool-policy.contract.test.ts` — **3 passed**: owned executable локально,
  issued fake SSH transport с тем же owned executable, native Nest HTTP chat.
  Restricted cases не вызывают detection/transport и не изменяют fixture cwd;
  unrestricted cases действительно запускают fixture и проверяют argv/stdin/stream.
- `tsc --noEmit -p apps/server/tsconfig.json` — passed; diff whitespace — clean.
- Fake SSH transport не является live SSH acceptance. Vendor/paid calls,
  Docker, GUI и full suites в этом срезе не запускались.

Другие SDK/CLI permission implementations и remaining stage-7 gates из
`stage-7-completion-audit.md` этим срезом не объявляются выполненными.
