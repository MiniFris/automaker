# План: OpenAI-compatible провайдер и локальный агент

Дата: 2026-10-15. Статус: этапы 1–4 завершены в границах Linux MVP; следующий — этап 5.

Актуализация 2026-10-17: дальнейшая модель прав и Local/Docker/SSH вынесена в
[отдельный план общих сред выполнения](execution-environments-plan.md).
Direct-specific permissions UI заменён общими настройками. Для Direct работают
явно подтверждённый Local, managed Docker и подготовленный SSH chat/runtime;
SSH Kanban/AutoMode и feature Git/tests/hooks подключены в подэтапе 5.1;
Cursor/Gemini/OpenCode CLI подключены в 5.2a; Claude/Codex/Copilot SDK — в 5.2b,
остальные app services — следующий 5.3. [Матрица и CLI/SDK setup](execution-environments-cli.md).
Legacy sandbox сохраняется только без явной новой настройки и для старых pinned
запусков. Сохранить профиль недостаточно: требуется соответствующая подготовка/
confirmation. Границы SSH описаны в [SSH guide](execution-environments-ssh.md).

## Цель

Подключать произвольный OpenAI-compatible endpoint напрямую из backend Automaker,
без Claude/Codex/OpenCode CLI. Локальный агент выполняет инструменты в выбранном
проекте/worktree и возвращает существующий поток `ProviderMessage` для chat,
AutoMode, планирования и pipeline.

## Архитектурные решения

- Новый тип провайдера `openai-compatible`; канонический ID модели `direct-<api-model-id>`.
  `providerId` отдельно выбирает endpoint. API model ID сохраняется без изменения
  регистра, `/`, `:` и внутренних префиксов. Существующая маршрутизация GPT в Codex
  и динамических моделей в OpenCode сохраняется. Для ID из каталога используется
  `toDirectModelId()` — он добавляет внешний префикс даже к API ID вида `direct-model`;
  `addProviderPrefix()` остаётся идемпотентной утилитой для уже нормализованных ID.
- Транспорт, цикл агента и инструменты разделены. Начальный транспорт — Chat
  Completions; Responses добавляется отдельным адаптером. Протокол выбирается явно:
  автоматическое повторение запроса через другой endpoint не допускается.
- Capabilities задаются для каждой модели. `/models` помогает заполнить каталог,
  но не доказывает поддержку tools, streaming, vision или JSON Schema.
- Конфигурация endpoint не содержит API-ключей. Авторизация: без ключа, именованная
  переменная окружения или ссылка на отдельную запись credentials. Разрешение
  конфигурации происходит на сервере, без изменения `process.env`. Файл credentials
  использует существующее незашифрованное хранилище проекта; шифрование не добавлено.
- Сначала последовательные инструменты; read-only режим действительно исключает
  файловые изменения и shell из доступного реестра.
- Новый провайдер регистрируется в factory после появления работающего транспорта.
  До этого `direct-` должен завершаться явной ошибкой, без fallback в Claude/OpenCode.

Основа протокола: [официальное описание function calling](https://developers.openai.com/api/docs/guides/function-calling).
Tool call выполняет приложение, после чего возвращает результат модели; вызов модели
сам по себе не предоставляет доступ к локальной файловой системе.

## Этап 1. Контракты, конфигурация и идентификаторы

Статус: завершён.

- [x] Типы endpoint, auth, моделей и capabilities; экспорт из `@automaker/types`.
- [x] Опциональные настройки endpoints и отдельное хранилище ключей в Credentials.
- [x] Утилиты `direct-`, сохранение ID при resolution/migration, защита от
      пересечения с GPT/Codex, Claude и slash-ID OpenCode.
- [x] Серверная валидация конфигурации и разрешение endpoint/model/секрета.
- [x] Передача разрешённой конфигурации через `ExecuteOptions` (контракт).
- [x] Тесты маршрутизации, URL, credentials и конфликтующих имён моделей.

Готовность: конфигурация проверяется и разрешается детерминированно; неизвестный,
отключённый endpoint, отсутствующий секрет или модель дают явную ошибку.
Платных запросов нет; UI и инструменты ещё не доступны.

## Этап 2. Прямой HTTP-транспорт

Статус: завершён (backend API; подключение через UI — этап 5).

- [x] `OpenAICompatibleProvider extends BaseProvider`, регистрация в factory.
- [x] Chat Completions: текстовые запросы, история, streaming/non-streaming,
      AbortSignal, отдельные таймауты и ограниченные retries.
- [x] Безопасная политика redirects: ключи не пересылаются на другое назначение.
      Ответы с неподдерживаемым протоколом отклоняются явно.
- [x] Агрегация tool-call deltas; незавершённые arguments никогда не исполняются.
- [x] Нормализованные assistant/error/result события; корректные finish reasons.
- [x] Поддержка `tools: []`, read-only и structured output по capabilities.
- [x] Тестовый локальный HTTP/SSE endpoint: фрагментация, 401/429/5xx, обрыв, abort.

Готовность: direct text generation работает без CLI; неподдерживаемые возможности
дают понятную ошибку, а не ложное успешное завершение.

Детали реализации:

- `apps/server/src/providers/openai-compatible-provider.ts`: текстовые prompts,
  явная история, server-resolved connection и нормализация событий. Текст приходит
  только assistant-deltas; итог не дублирует его отдельным assistant-сообщением.
- `apps/server/src/providers/openai-compatible/transport.ts`: native `fetch`, API
  prefix сохраняется; Bearer header только из выбранного connection. Redirects
  отключены. JSON и SSE ограничены 16 MiB на тело, SSE frame и tool arguments — 1 MiB,
  количество tool calls — 128. UTF-8 декодируется с проверкой целостности.
- `timeoutMs` — deadline всей HTTP-попытки, включая чтение тела. Дополнительно
  ожидание headers ограничено 30 секундами или меньшим `timeoutMs`. При выходе
  потребителя из async generator response отменяется, timers/readers освобождаются.
- Повторы: только HTTP 429/500/502/503/504, максимум `maxRetries` (0–5), до чтения
  модельного ответа. Backoff ограничен; `Retry-After` учитывается до 5 секунд;
  более длительное ожидание возвращает HTTP-ошибку, а не повтор раньше указанного
  срока. Сетевые ошибки и частичный stream никогда не воспроизводятся автоматически.
- SSE требует и terminal `finish_reason`, и `[DONE]`. `length`, `content_filter`,
  отказ модели, повреждённый или оборванный ответ не превращаются в success.
  Это опирается на [OpenAI Docs: streaming events](https://developers.openai.com/api/reference/resources/chat/subresources/completions/streaming-events).
- Structured output запрашивается только при capability `structuredOutput`;
  добавлена прямая зависимость backend `ajv@8.20.0`. Schema компилируется до HTTP,
  JSON проверяется локально без coercion, загрузки remote `$ref` или async schemas.
  Используется поддерживаемый AJV по умолчанию JSON Schema draft-07 в strict mode;
  неподдерживаемые schemas/formats дают явную ошибку. Для лимита модели отправляется
  `max_completion_tokens`; скрытого fallback на устаревший `max_tokens` нет.
- В этапе 2 обязательно явное `tools: []`. Read-only допускается с этим пустым
  набором; tools/MCP/subagents не исполняются. Transport может собрать полные tool
  calls для будущего AgentLoop, но provider отклоняет их без ложного success.
- `detectInstallation` показывает наличие runtime, не проверенное соединение или
  авторизацию endpoint. Каталог пока пуст; vision, Responses, reasoning parameters,
  SDK resume и Claude prompt presets отклоняются явно. Нужны явные текстовые
  `systemPrompt`/`conversationHistory`; автоматической загрузки CLAUDE.md пока нет.

Для backend-вызова после `resolveOpenAICompatibleConnection(...)`:

```typescript
const provider = ProviderFactory.getProviderForModel(toDirectModelId(connection.model.id));
for await (const message of provider.executeQuery({
  openaiCompatibleConnection: connection, // Server-only, contains the selected API key.
  model: connection.model.id, // Bare, exact API ID.
  prompt: 'Hello',
  cwd: worktreePath,
  tools: [],
})) {
  // Forward ProviderMessage to the consumer. Never log the connection object.
}
```

## Этап 3. Агентный цикл и безопасное чтение

Статус: завершён для Linux descriptor backend. На других платформах файловые
инструменты отклоняются явно; text generation с `tools: []` не требует этого backend.

- [x] `AgentLoop`, `ToolRegistry`, JSON Schema validation, tool call IDs/results.
- [x] Инструменты Read, LS, Glob, Grep с ограничением вывода и realpath-проверкой
      workspace, включая symlinks и доступ к `.git` worktree metadata.
- [x] maxTurns, общий budget/timeout, лимиты tool calls, detection повторений.
- [x] Cancel и очистка ресурсов также при раннем закрытии async generator.
- [x] Локальная история tools и checkpoint; изоляция параллельных сессий.
- [x] Тест цепочки «найти → прочитать → ответить», unknown tool, invalid args,
      read-only, context overflow и повторяющихся tool calls.

Готовность: модель самостоятельно изучает тестовый проект; каждый результат
сопоставлен с вызовом; лимиты и отмена останавливают цикл.

Детали реализации и границы:

- `agent-loop.ts` управляет историей и последовательным выполнением tool calls;
  `tool-registry.ts` проверяет аргументы AJV без преобразования типов. Неизвестный
  инструмент и неверные аргументы возвращают безопасный tool error модели, а не
  запускают код из текста. Повторный ID отклоняется; повтор одинакового вызова
  определяется по имени и нормализованным JSON-аргументам, включая порядок ключей.
  Пары assistant/tool сохраняются по протоколу [OpenAI Docs: function calling](https://developers.openai.com/api/docs/guides/function-calling).
- Если `tools` не передан, доступны только Read/LS/Glob/Grep. Явный `tools: []`
  выключает их; непустой список ограничивает доступные имена. `allowedTools` не
  подменяет этот список: в общем контракте это настройка auto-approval.
  Сам по себе `readOnly: false` не включает Write/Edit/shell: явные права и sandbox
  добавлены на этапе 4. MCP и subagents не поддержаны.
- `workspace.ts` сначала проверяет реальный корень и основной ALLOWED_ROOT_DIRECTORY,
  без исключения DATA_DIR для модели. Затем открывает каждый компонент через
  закреплённый родительский descriptor, O_NOFOLLOW/O_NONBLOCK и `/proc/self/fd`.
  Реальный путь проверяется до/после доступа; handles/directories закрываются
  в finally. Разрешены только обычные файлы с одним hard link и обычные каталоги.
- Все symlinks (в том числе внутренние) и hard-linked файлы отклоняются консервативно.
  `.git`, включая worktree pointer и внешнюю Git metadata, не читается и не обходится;
  обычные файлы worktree доступны. Также закрыты `.automaker`, `.codex`, `.claude`,
  `.ssh`, `.aws`, credentials.json и каталог checkpoints. DATA_DIR закрыт и при
  нахождении внутри workspace. Это read-only слой доступа, не OS sandbox для shell;
  он не обещает защиту от процесса, который уже может копировать чужие файлы в проект.
- Read читает UTF-8 до 1 MiB, до 500 строк за запрос. Glob поддерживает только `*`,
  `?`, `**`; Grep ищет буквальную подстроку, без regex. Recursive search пропускает
  dependency/build trees, ограничен 5000 entries, глубиной 16 и, для Grep, 8 MiB
  текста. Вывод инструмента ограничен 16384 символами, с явным marker усечения.
- Context guard считает UTF-8 размер запроса/истории со schema и резервом ответа.
  При заданном model.contextWindow действует консервативная byte-based оценка;
  это не точный tokenizer для произвольного endpoint. Переполнение завершает run
  ошибкой: история и tool/result пары не обрезаются незаметно. Budget операционный,
  не денежный; точного учёта стоимости/общего количества model tokens пока нет.

| Параметр                | По умолчанию | Максимум |
| ----------------------- | -----------: | -------: |
| ExecuteOptions.maxTurns |           12 |      100 |
| maxToolCalls            |           64 |      256 |
| maxDurationMs           |       300000 |  3600000 |
| toolTimeoutMs           |        10000 |    60000 |
| maxContextBytes         |      1048576 |  4194304 |
| maxOutputChars          |       262144 |  1048576 |
| maxRepeatedCalls        |            3 |       10 |

Лимиты задаются через server-only `ExecuteOptions.openaiCompatibleAgent.limits`.
Дополнительно история ограничена 1024 сообщениями. Подготовка workspace ограничена
меньшим из toolTimeoutMs/maxDurationMs; общий deadline AgentLoop включает модельные
запросы, retries и инструменты. Отмена I/O кооперативная: run перестаёт ждать,
а дескрипторы незавершённой kernel operation освобождаются после её возврата.

Checkpoint и восстановление:

- `onCheckpoint` получает отделённый snapshot без connection/API key; snapshot
  содержит текст проекта и не предназначен для UI settings/логов. Callback ограничен
  1 секундой, включая финальную попытку сохранения после cancel/ошибки.
- `AgentCheckpointStore(dataDirectory)` — opt-in серверное сохранение в
  `direct-agent-checkpoints/<uuid>.json`: temp + rename, mode 0600, JSON validation,
  размер до 16 MiB, защита от простых file/directory symlinks. Записи одного sessionId
  сериализуются в рамках одного экземпляра store; межпроцессного locking пока нет.
- Snapshot привязан к endpoint ID, API model ID, реальному workspace, URL/protocol,
  исходному prompt/history и schemas/набору tools. Сохраняются потраченные turns,
  tool calls, output chars и duration; восстановление не обнуляет budgets.
- При прерывании pending calls получают `INTERRUPTED` results в checkpoint.
  Восстановление продолжает разговор с этой границы, не воспроизводя инструменты
  автоматически. Completed checkpoint повторно не запускается. `sdkSessionId`
  остаётся неподдерживаемым: локальный UUID не является Claude SDK session ID.
- Persisted checkpoint тестируется с новым экземпляром provider. Полноценное app
  session/queue resume остаётся этапом 5, crash journal для будущих writes/shell —
  этапом 6. Checkpoints не обещают exactly-once выполнение или глобальную блокировку
  двух одновременно запущенных resume одного snapshot.

Пример opt-in сохранения (в дополнение к connection из этапа 2):

```typescript
const store = new AgentCheckpointStore(dataDirectory); // Server-owned, not model-selected.
const options = {
  openaiCompatibleConnection: connection,
  model: connection.model.id,
  cwd: worktreePath,
  prompt: 'Find the entry point and explain it',
  readOnly: true,
  tools: ['Glob', 'Read', 'Grep', 'LS'],
  openaiCompatibleAgent: {
    onCheckpoint: (snapshot) => store.save(snapshot),
    // checkpoint: await store.load(sessionId), // Resume the same original request.
  },
};
```

## Этап 4. Изменение файлов и shell

Статус: завершён для ограниченного Linux MVP. Принято уточнение безопасности:
неограниченный host shell / `full-access` не включён. Нативный Windows backend,
проверка PowerShell и работа с большими dependency trees остаются этапом 6.

- [x] Write и literal Edit: атомарная запись, проверки путей и конфликтов.
      Универсальный multi-file apply-patch не требуется для текущего Edit и не реализован.
- [x] Контейнерный sh/bash adapter и выбор pwsh: cwd, очищенное окружение, timeout, лимит вывода,
      завершение дерева процессов; секреты endpoint не наследуются shell.
- [x] Профили read-only/workspace-write; full-access явно отклоняется, а не ослабляет
      sandbox. Реальное ограничение shell через Docker, без host-shell fallback.
- [x] TodoWrite; выполнение тестов обычным shell-инструментом.
- [x] Интеграционные тесты на временном Git repo/worktree: изменение → тест → diff,
      выход через symlink, ошибка patch, timeout и отмена дочернего процесса.

Готовность: агент выполняет небольшую coding-задачу и тесты в изолированном worktree.

Детали реализации и границы:

- `openaiCompatibleAgent.access` — server-only право, не аргумент инструмента модели.
  По умолчанию `read-only`; `readOnly: true` может только сузить права.
  `allowedTools` не выдаёт прав. При `workspace-write` default tools дополнены
  Write/Edit/TodoWrite и shell, если sandbox явно настроен. В read-only default
  остаётся Read/LS/Glob/Grep; TodoWrite и настроенный read-only shell можно выбрать явно.
  До этапа 5 эти параметры доступны только backend callers, не через UI.
- Read возвращает SHA-256 всего файла, даже при выдаче диапазона строк.
  Write требует `expectedSha256: null` для нового файла либо hash из Read для замены.
  Edit заменяет ровно одно буквальное совпадение с тем же hash precondition.
  Несуществующий/неоднозначный фрагмент не меняет файл. Только корректный UTF-8
  без NUL, до 1 MiB; родитель Write должен существовать.
- Доступ остаётся descriptor-based, без symlinks и hardlinks. Дополнительно закрыты
  `.env` / `.env.*` и приватные `.direct-write-*`. Временный файл создаётся с O_EXCL,
  fsync и сохранением обычных permission bits, затем публикуется rename (замена)
  либо link (эксклюзивное создание). Временный файл удаляется в finally.
  Записи одного пути сериализуются в процессе. Это атомарность одного файла и
  оптимистическая защита от конфликтов, не файловая транзакция и не CAS против
  произвольного внешнего процесса, меняющего дерево прямо перед rename.
- Shell требует доверенный, уже локально установленный image с полным `sha256:…`
  ID. Автоматической загрузки/сборки образов нет (`--pull never`). Image с VOLUME
  отклоняется; HEALTHCHECK отключён. Docker CLI использует фиксированный путь и
  окружение только с PATH; ключ endpoint и process.env в контейнер не передаются.
  Нужен локальный Docker daemon на `unix:///var/run/docker.sock`; remote context
  не используется. Образ должен быть без секретов, с `/bin/sh`,
  `cp`, `sleep`, `/bin/tar` и выбранным sh/bash/pwsh. Инструмент называется Bash
  для sh/bash либо PowerShell для pwsh. Реально проверен sh в Alpine; bash/pwsh
  требуют соответствующего runtime image, отдельной проверки pwsh пока нет.
- Исходный workspace никогда не монтируется. В task-owned staging копируются только
  разрешённые UTF-8 файлы; защищённые пути и symlinks не копируются, hardlinks
  отклоняются. Этот staging монтируется read-only. При workspace-write рабочая копия
  создаётся в контейнерном tmpfs 32 MiB; read-only профиль работает прямо на ro mount.
  Контейнер offline, rootfs read-only, caps drop ALL, no-new-privileges, non-root UID,
  PID limit 64, RAM 256 MiB, CPU 1; временные /tmp и HOME также ограничены tmpfs.
- До 2000 entries, глубина 16, 16 MiB исходного текста, 1 MiB на файл, 100 изменений
  на импорт, 8000 bytes объединённого stdout/stderr. Бинарные файлы и большие
  node_modules/build trees не поддерживаются: snapshot завершается ошибкой, а не
  запускает тест с молча неполным проектом. Зависимости/компиляторы нужны в выбранном
  образе; сеть отключена, автоматического npm install нет. Git metadata не копируется,
  поэтому Git diff снимает host caller после импорта, не модель внутри контейнера.
  В staging файлы имеют mode 0644: executable bits/chmod через shell пока не
  переносятся; скрипты следует запускать через явный interpreter.
- Результат экспортируется tar-потоком из tmpfs, с лимитом размера и проверкой
  заголовков/путей/типов, без распаковки архива на хост. Symlink, hardlink, special
  file, protected path, binary и удаление исходного файла отклоняют весь импорт.
  Это не moment-in-time snapshot при фоновых записях; несовместимый/повреждённый tar
  отклоняется, но согласованность разных файлов во времени не гарантируется.
  Контейнер удаляется до импорта. Изменения текста проверяются по hash
  и возвращаются через тот же guarded writer, включая создание обычных parent dirs.
  Nonzero exit не отменяет валидные изменения. Публикация атомарна по файлам, не
  по всему batch: при позднем конфликте/отмене уже записанные файлы не откатываются.
  После неизвестного результата нужно перечитать файлы/проверить diff до повторения.
- Tool deadline и cancel удаляют контейнер вместе с detached descendants; AgentLoop
  ждёт cleanup, а не только разрывает ожидание команды. До начала импорта отменённый
  snapshot отбрасывается. Cleanup Docker CLI ограничен 5 s; при невозможности подтвердить
  удаление возвращается явная ошибка с именем контейнера. Нет обещания удаления после
  SIGKILL самого сервера/недоступности daemon: crash reaper/journal остаются этапом 6.
  Docker daemon/image/kernel считаются доверенными; это не защита от kernel exploits
  или другого доверенного host-процесса с теми же правами на workspace.
- Перед выполнением tool batch checkpoint получает сбалансированные INTERRUPTED
  tombstones, затем уточняется известными результатами. Сбой не возвращает resume
  к предыдущему model request и не повторяет старые call IDs автоматически.
  `requestHash` привязан и к эффективным access/shell/image. Старые snapshots с иной
  формулой hash намеренно не мигрируются, а отклоняются. Exactly-once не обещается.
  TodoWrite хранит список в tool result/history, поэтому он доступен и после resume.

Пример server-only подключения coding tools (image ID выбирает оператор сервера):

```ts
const options: ExecuteOptions = {
  // ... prompt, cwd, model, openaiCompatibleConnection
  readOnly: false,
  openaiCompatibleAgent: {
    access: 'workspace-write',
    shell: { backend: 'docker', image: trustedLocalImageId, executable: 'sh' },
    limits: { toolTimeoutMs: 30_000 },
    onCheckpoint: (snapshot) => store.save(snapshot),
  },
};
```

Docker integration tests включаются явно, без pulls и реальных API-запросов:

```bash
DIRECT_AGENT_DOCKER_TEST_IMAGE=sha256:<full-local-image-id> \
  node_modules/.bin/vitest run --project=server \
  apps/server/tests/unit/providers/openai-compatible-agent.test.ts \
  apps/server/tests/unit/providers/openai-compatible-shell.test.ts
```

## Этап 5. Интеграция с приложением и UI

- [ ] Разрешение providerId в chat, simpleQuery, AgentExecutor, AutoMode и pipeline.
- [ ] Сохранение providerId в chat sessions/queue и feature execution/resume.
- [ ] CRUD endpoints, проверка подключения и tool calling, ручной/`/models` каталог.
- [ ] UI настроек, phase model selectors, project overrides, feature/chat selectors.
- [ ] Серверные DTO скрывают ключи; настройки UI не перезаписывают секреты.
- [ ] Логи/вывод инструмента отображаются без дублирования текста и событий.
- [ ] E2E с mock endpoint: chat, feature, plan approval, pipeline, restart/resume.

Готовность MVP: пользователь добавляет endpoint/model и выполняет coding-задачу
через существующий интерфейс без установленного агентного CLI.

## Этап 6. Расширение и устойчивость

- [ ] Responses adapter, vision и provider-specific reasoning parameters.
- [ ] MCPClientManager: lifecycle, namespacing, listTools/callTool и cancellation.
- [ ] Сжатие контекста без разрыва tool-call/result пар, восстановление checkpoint.
- [ ] Journal инструментов: после сбоя неоднозначные shell-вызовы автоматически
      не повторяются; checkpoints не обещают exactly-once выполнение.
- [ ] Нагрузочная проверка нескольких worktree, Linux/Windows, redaction логов.
- [ ] Native/cross-platform shell, реальная проверка bash/pwsh runtime images;
      безопасная поддержка больших/binary dependency trees и файловых удалений.
- [ ] Crash reaper контейнеров; отдельно решить, нужен ли full-access вообще.
- [ ] Документированная матрица совместимости конкретных endpoint и моделей.

## Проверки и ограничения

- В каждом этапе — сборка затронутых пакетов и целевые тесты; полный typecheck
  backend/UI перед этапом интеграции. Базовые существующие ошибки фиксируются отдельно.
- Тесты транспорта/агента используют локальный fake endpoint. Реальные API-вызовы
  нужны только для финальной проверки выбранного пользователем endpoint/model.
- Первоначально поддерживаются модели со структурированным function calling.
  Текст без tools пригоден только для text generation; команды из текста не исполняются.
- Настройка локальных/LAN endpoints допустима. Remote deployments должны отдельно
  ограничивать доступ к конфигурации endpoints и сетевые назначения.

## Журнал выполнения

- 2026-10-15: план сохранён; начат этап 1. В исходной рабочей копии нет node_modules.
- 2026-10-15: этап 1 реализован. Добавлены общие типы, кодирование opaque model ID,
  приоритетная маршрутизация, валидатор endpoint/коллекции, resolver соединения и
  раздельные ключи. `SettingsService` проверяет endpoints до сохранения и объединяет
  ключи отдельных endpoints без удаления соседних записей. В UI дополнена обязательная
  таблица иконок нового `ModelProvider`; экран настройки пока не реализован.
- Зависимости установлены через `npm ci --ignore-scripts --no-audit --no-fund`;
  lifecycle scripts не запускались, package-lock не изменён.
- Успешны `npm run build:packages`, `npm run build --workspace=apps/server`, ESLint
  изменённых серверных исходников и `git diff --check`.
- Целевой Vitest-прогон пяти файлов: **257 тестов прошли**, из них **46** — новый
  файл `apps/server/tests/unit/providers/openai-compatible-config.test.ts`.
- Расширенный Vitest-прогон server/types/model-resolver выявил отсутствие нативного
  `node-pty` (`pty.node`): два набора (`claude-usage-service`, `terminal-service`)
  не загрузились. Итог последнего прогона: **2505 тестов прошли**, **22 пропущены**,
  **2 набора не загрузились**. Это ограничение окружения после установки без lifecycle
  scripts; оно не покрывается успешным целевым прогоном.
- Для проверки UI сгенерирован локальный, игнорируемый Git файл `routeTree.gen.ts`.
  `npm run typecheck --workspace=apps/ui` остаётся неуспешным из-за двух ошибок
  `string | undefined → string` в неизменённом `board-view.tsx:1257,1298`
  (поле `branchName`). Ошибка таблицы иконок от расширения `ModelProvider` исправлена.
- HTTP-транспорт, реестр инструментов и интеграция выбора endpoint в UI намеренно
  не включены в этап 1. Реальные API-запросы не выполнялись.
- 2026-10-15: этап 2 реализован: зарегистрирован прямой provider, добавлены Chat
  Completions transport и локальные HTTP/SSE integration tests. В package.json и
  package-lock добавлена AJV; посторонние изменения lockfile от npm удалены,
  Git URLs нормализованы существующим скриптом проекта.
- `npm rebuild node-pty --no-audit --no-fund` успешно собрал отсутствующий нативный
  модуль. Наборы `terminal-service` и `claude-usage-service` после сборки проходят:
  **85 passed, 1 skipped**. Прежнее ограничение `pty.node` устранено локально.
- Проверки этапа 2: **62 новых HTTP/SSE теста** в
  `apps/server/tests/unit/providers/openai-compatible-provider.test.ts`; конфигурация —
  **47 тестов**. Общий прогон `vitest run --project=server --project=types
--project=model-resolver --silent=passed-only --reporter=dot`: **2653 passed,
  23 skipped; 92 файла passed, 1 skipped**. Есть предупреждение существующих тестов
  о количестве SIGINT/SIGTERM listeners; ошибок тестов нет.
- Успешны сборка общих пакетов и backend, ESLint новых/изменённых provider-файлов,
  проверка lockfile и форматирования. UI typecheck на этом этапе не повторялся;
  две ошибки из этапа 1 в `board-view.tsx` остаются вне текущей области изменений.
- Реальные OpenAI/сторонние API не вызывались. Проверена только локальная реализация
  протокола; совместимость конкретного сервиса требует отдельного smoke test.
  Для пользователя провайдер пока не доступен через UI: сквозное разрешение
  endpoint в app services и каталоги остаются этапом 5; локальные tools — этапом 3–4.
- 2026-10-15: этап 3 завершён. Добавлены AgentLoop, ToolRegistry, read-only workspace,
  четыре инструмента чтения, operational budgets, общий deadline, checkpoint/store
  и server-only контракты в ExecuteOptions. Новые зависимости не потребовались.
- Новые тесты этапа 3: **90** — agent loop (**36**), read tools / path boundary (**41**),
  checkpoint validation/persistence (**13**). Проверены реальная цепочка
  find/read/answer через локальный endpoint, persisted resume в новом provider,
  invalid args/unknown tools, budgets, параллельные сессии, root/directory substitution,
  symlink/hard-link escapes, закрытая worktree metadata, UTF-8, ограничения вывода,
  отмена и освобождение дескрипторов. Существующие HTTP/SSE тесты (**62**) проходят.
- Финальный общий прогон server/types/model-resolver: **2743 passed, 23 skipped;
  95 файлов passed, 1 skipped**. Успешны build:packages, сборка backend, ESLint
  изменённых provider-модулей, форматирование и git diff --check. Предупреждение
  существующих тестов про SIGINT/SIGTERM listeners осталось без изменений.
- Текущий filesystem backend — Linux с procfs; внутренние symlinks также запрещены.
  Переносимый backend не подменён слабой строковой проверкой пути: он остаётся
  задачей совместимости этапа 6. UI и ошибки его typecheck из этапа 1 не менялись;
  real API smoke tests не выполнялись. Следующий этап — запись файлов и shell
  с реальным sandbox и проверками на временном Git worktree.
- 2026-10-15: этап 4 завершён в границах Linux MVP. Добавлены SHA-256 preconditions,
  атомарные Write/literal Edit, TodoWrite, явные access profiles и Docker snapshot
  shell. Новые зависимости не потребовались. Правила новых инструментов проверяются
  AJV; парность function calls/results сохранена по OpenAI Docs.
- Добавлено **49 тестов**: mutation boundary (**28**), расширение agent loop (**7**,
  включая **2** с Docker), shell/Docker (**14**). Из них **16** требуют явного
  DIRECT_AGENT_DOCKER_TEST_IMAGE; без него пропускаются, а не используют host shell.
- Реально проверен уже установленный локальный Alpine image с immutable ID
  `sha256:28bd5fe8b56d1bd048e5babf5b10710ebe0bae67db86916198a6eec434943f8b`.
  Образы не загружались/не собирались. Тестовые контейнеры удалены; чужие контейнеры
  и образы не изменялись. Проверен полный цикл mock model → Read → Edit → shell test
  → ответ и host Git diff в отдельном worktree; также symlink/hardlink/protected paths,
  конфликт, ошибка Edit, отмена реальных detached grandchildren и deadline AgentLoop.
- Итоговый общий прогон server/types/model-resolver с включёнными Docker tests:
  **2792 passed, 23 skipped; 97 файлов passed, 1 skipped**. Успешны build:packages,
  сборка backend и ESLint provider-модулей. Известное предупреждение существующих
  тестов о SIGINT/SIGTERM listeners осталось; UI typecheck не повторялся, изменения
  этапа 4 UI не затрагивают. Реальные модельные API-запросы не выполнялись.
- Ограничения этапа 4 намеренно явные: небольшие UTF-8 проекты, local Docker image,
  offline sandbox, без file deletions/mode changes и без full-access. PowerShell
  adapter пока не проверен на реальном pwsh image, native Windows не поддерживается.
  Дальше — этап 5: безопасное серверное разрешение endpoint/providerId и интеграция UI.
- 2026-10-16: исправлена недоступность формы в основной странице настроек.
  `ProviderTabs` не используется этой страницей: она отображает отдельные разделы
  по `SettingsViewId`. Добавлены `direct-provider`, пункт **AI Providers →
  Direct API (OpenAI-compatible)**, экспорт формы и её отображение в `SettingsView`.
  Прямая ссылка: `/settings?view=direct-provider`. Регрессионный тест монтирует
  реальный `SettingsView` с боковым меню и формой, проверяет переход, прямую ссылку
  и раскрытие ранее свёрнутого меню. Предыдущий component/browser harness формы
  не проверял её доступность из основной страницы настроек.
  Проверки исправления: **18 UI-тестов прошли** (4 файла, в том числе 3 новых
  регрессионных теста), production UI build, ESLint изменённых файлов и
  `git diff --check` успешны. UI typecheck по-прежнему сообщает только две
  существующие ошибки `branchName` в `board-view.tsx:1257,1298`.
  Запущенные Docker-контейнеры не пересобирались и не перезапускались.
