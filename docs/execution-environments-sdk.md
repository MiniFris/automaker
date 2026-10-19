# Target-side SDK providers — этап 5.2b

Claude, Codex и Copilot теперь запускают SDK отдельным Node-процессом внутри
выбранного Docker/SSH target. Их CLI, встроенные инструменты, HOME и cwd находятся
на target, а не на controller. Local и установки без новых настроек сохраняют
прежний provider flow. Изоляция всего приложения этим не обещается.

Поддержаны Docker/Auto и SSH chat/Kanban/pipeline/Verify/Commit/remote merge.
В 5.3a Docker feature services подключены к единому pinned worktree/runtime.
Привязанные запуски не меняют среду при смене default. Старые Docker feature bindings
без workspace metadata не мигрируют — нужна новая feature.

## Как настроить без ручного npm/контейнера

1. Сохраните Docker/Auto или SSH в глобальных/проектных Execution Environment.
   Подготовьте проектный контейнер либо SSH worker/authoritative checkout обычными
   кнопками подготовки. Для SSH сначала подтвердите fingerprint и SSH credentials.
2. В **Project Settings → Execution Environment → Remote providers — SDK setup**
   выберите Claude/Codex/Copilot и нажмите **Inspect saved provider target**.
   Обычный просмотр страницы сам не подключается и ничего не устанавливает.
3. Проверьте показанные target/cwd, примите согласие и нажмите
   **Install pinned SDK on target**. Нужны Linux x64/arm64, Node 22+ и npm на target,
   сеть до npm registry, место и права записи в HOME. Docker/worker создаётся
   Automaker, отдельно поднимать агентский контейнер или вводить image SHA не нужно.
4. Введите отдельный API key (Claude/Codex) или Copilot token и нажмите
   **Save key on target**. Для доступа к Automaker по сети используйте HTTPS.
   Затем создайте новый чат или SSH feature с соответствующей моделью.

Ключ передаётся только этому проверенному target через stdin worker, хранится
там в `credentials.json` (0600, owner target user); в controller settings/Credentials,
project files, argv и response его нет. Поле пароля очищается после операции,
в браузерное хранилище ключ не записывается. Агент с правами target user может
читать этот файл — это не vault и не граница против самого агента.

Ключ/токен используется вместо автоматически скопированных credentials controller.
Существующие OAuth credentials или переменные среды **target user** также могут
использоваться, если managed key отсутствует. Автоматический browser/device OAuth
мастер пока не реализован. Для Codex штатный headless OAuth описан в
[официальной документации](https://developers.openai.com/codex/auth/).
Кнопки старых Provider Settings относятся к controller, не к этому target.

Status `configured-unverified` означает только наличие key/env/cache, не проверку
срока токена, тарифа, доступа к выбранной модели или биллинга. Inspect не отправляет
платный модельный запрос. **Remove managed target key** удаляет только отдельный
managed key, не отзывает OAuth, не очищает чужие CLI credentials и не останавливает
уже выполняющийся запрос. На SSH credentials общие для проектов/установок того же
OS-пользователя; Docker HOME относится к одному проектному контейнеру.

## Закреплённые версии и storage

| Provider | SDK                                     | Bundled CLI                   |
| -------- | --------------------------------------- | ----------------------------- |
| Claude   | `@anthropic-ai/claude-agent-sdk@0.2.32` | `cli.js` из этого SDK         |
| Codex    | `@openai/codex-sdk@0.98.0`              | platform vendor binary из SDK |
| Copilot  | `@github/copilot-sdk@0.1.16`            | `@github/copilot@0.0.389`     |

Версии совпадают с проверенными server SDK. Установка идёт в
`$HOME/.local/share/automaker/providers/<provider>-<manifest-id>`, не в проект,
не в системный npm prefix, без sudo. Команда — фиксированный `npm install --prefix`
с `--ignore-scripts`, `--no-audit`, `--no-fund` и registry.npmjs.org; произвольные
packages/versions/commands/paths API не принимает. Прямые зависимости закреплены,
transitive resolution фиксируется target `package-lock.json` при первой установке.
Это не заранее проверенный полный transitive lock всех платформ.

Manifest, версии пакетов и явные SDK entrypoints проверяются перед исполнением.
Project node_modules не участвует в выборе SDK. Повторная установка готовой версии
идемпотентна; живая установка защищена lock. После прерывания сначала выполните SSH
recovery, затем явно повторите установку; повреждённый lock/manifest требует проверки
администратором, не автоматического удаления каталога. Обновление catalog в новой
версии Automaker создаёт другой prefix; автоматической миграции ключей/сессий нет.

В Docker HOME — `/tmp/automaker-home`; пакеты и credentials переживают stop/start,
но не удаление контейнера. Никаких controller mounts, Docker socket или host auth
для работы SDK внутри контейнера не добавляется. На SSH права не повышаются.
Claude CLI может отказать в unrestricted режиме при root SSH login; используйте
обычного пользователя. `IS_SANDBOX=1` добавляется только настоящему managed Docker
target, не SSH; штатные проверки CLI не обходятся на SSH-хосте.

## Поддержанные controls

- Claude: model, system prompt/append, maxTurns, thinking budget, output schema,
  SDK session resume и штатный поток сообщений. `readOnly` ограничивает доступные
  built-in tools до Read/Glob/Grep, без bypassPermissions; `tools: []` поддержан.
  MCP задаётся пустым strict config; controller MCP/subagents/profiles не переносятся.
- Codex: [SDK threads/resume](https://developers.openai.com/codex/sdk/), model,
  reasoning effort, system/context prompt, output schema и streaming ThreadEvents.
  cwd явно передаётся как workingDirectory. Sandbox наследует server Codex sandbox
  setting/override (`workspace-write` по умолчанию), read-only planning использует
  `read-only` и отключённую сеть. Запуск неинтерактивный, approval policy `never`;
  явные request overrides с интерактивным approval и additionalDirs отклоняются.
  Остальные controller-specific Codex preferences не копируются автоматически;
  собственный remote config загружает сам Codex. Native sandbox не ограничивает
  внешние интеграции, которые пользователь отдельно настроил в remote CLI.
- Copilot: [официальный SDK](https://github.com/github/copilot-sdk/blob/main/docs/getting-started.md),
  model, appended system prompt, session create/resume, существующие event normalizers,
  отдельный process/stdio CLI server и разрешения native SDK. `autoRestart=false`.
  Read-only/tool-free controls и output schema пока отклоняются.
- Вложения, controller MCP, subagents и Claude connection profiles для remote SDK
  пока отклоняются. `maxTurns` контролирует Claude; Codex/Copilot не получают
  обещание эквивалентного native turn limit. Общий process deadline — 10 минут.
- Статус/границы относятся к chat/feature workflow. Основной Git UI подключён
  в 5.3b ([матрица и ограничения](execution-environments-git.md)); integrated terminal —
  [5.3c.2](execution-environments-terminal.md), dev-server/preview остаются в 5.3c.3.
  Memory context/usage и writer подключены
  в [5.3c.1](execution-environments-memory.md); внутренние text helpers ещё не перенесены.

Поток SDK обрамлён служебными event/heartbeat/complete/failure frames. Успешный
ProviderMessage result выдаётся только после complete, окончания процесса и cleanup.
Ошибка resume не запускает новую сессию автоматически. Stop/закрытие consumer
отменяет process group и ждёт подтверждения; SSH unknown outcome блокирует проект
до явного recovery, без replay. Ключи managed/env redacted из SDK event/error output.

## Проверки и границы acceptance

- Настоящий SSH/SFTP peer, target Node/Git/worker и fixture npm/SDK проверяют
  installation/auth lifecycle, permissions/target identity, chat/restart/resume,
  Kanban context/commit/merge, ограничения и error redaction.
- Установленные в Automaker настоящие Claude/Codex/Copilot SDK дополнительно
  проходят свои stdio/JSONL/JSON-RPC протоколы с fixture CLI. Проверяются реальная
  передача target key, cwd/HOME и read-only CLI flags, не только mock SDK методы.
- Managed Docker проверяет все три SDK runner с fixture packages в chat и отдельных
  feature worktrees; общий CLI feature workflow проверяет tests/Verify/Commit/merge/hooks.
  Отдельный opt-in
  выполняет настоящий npm install и `--version` всех bundled CLI без модельного запроса:

```sh
MANAGED_DOCKER_TEST_BASE_IMAGE=automaker-server:latest \
MANAGED_PROVIDER_INSTALL_TEST=true \
node_modules/.bin/vitest run --project=server apps/server/tests/integration/managed-docker.test.ts
```

Этот opt-in скачивает закреплённые npm packages в собственный временный контейнер;
после ownership-проверки удаляются только его тестовые ресурсы. Производственная
установка и живые provider credentials не используются. Live-model acceptance,
внешний SSH и матрица Windows/macOS остаются отдельными проверками 5.4.
