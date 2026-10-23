# Этап 7. AI providers и agents

## Цель

Заменить side-effect provider registry и ручную композицию агентских сервисов на
явные Nest providers, сохранив модели, streaming, tools, permissions, attachments,
usage accounting и execution environment bindings.

## Целевая модель

```text
ProvidersModule
├── ProviderRegistry
├── ModelCatalogService
├── ClaudeProviderAdapter
├── CodexProviderAdapter
├── CopilotProviderAdapter
├── CursorProviderAdapter
├── GeminiProviderAdapter
├── OpenCodeProviderAdapter
└── OpenAICompatibleProviderAdapter

AgentsModule
├── AgentApplicationService
├── AgentSessionRegistry
├── AgentExecutor
├── ToolPolicyService
└── AgentRecoveryService
```

## 7.1. Provider interface

- [ ] Зафиксировать общий interface: installation/auth status, models, capabilities,
      start, stream, follow-up, cancel и dispose.
- [ ] Разделить provider capability и model capability.
- [ ] Явно описать vision, tools, thinking/reasoning, MCP и remote execution.
- [ ] Не считать неизвестную capability автоматически доступной.
- [ ] Стандартизировать provider events до передачи в application event bus.
- [ ] Нормализовать cancellation и terminal reasons.

## 7.2. ProviderRegistry

- [x] Удалить module-import registration side effects.
- [x] Удалить static методы `ProviderFactory`.
- [x] Зарегистрировать adapters явным factory provider.
- [x] Сохранить aliases и model matching priorities.
- [x] Вынести disconnected markers в provider connection repository.
- [x] Ввести duplicate alias/model ownership checks при startup.
- [x] Поддержать mock provider только через test module override.

Nest не предоставляет неявный multi-binding, поэтому registry должен получать
явный массив provider tokens или собираться factory с перечисленными dependencies.

### Промежуточный срез: обязательная зависимость registry

`AgentService`, `IdeationService`, `ExecutionService` и Auto Mode facade больше
не импортируют `ProviderFactory`: `ProviderRegistry` обязателен в их constructors
или factory options. Application composition передаёт один registry, содержащий
явные registrations и connection repository. Remote CLI/SDK execution сохраняет
явный `throwOnDisconnected: false` для target-side авторизации; Local execution
проверяет connection state. Vision проверяется по model capabilities registry.

Unit tests передают registry mocks напрямую. Transport acceptance создаёт явный
registry с реальными adapters через `tests/helpers/provider-registry.ts`, включая
restart/default-change сценарии. Следующий срез удалил сам `ProviderFactory`, его
barrel export и последние fallback в simple-query, backlog planning, Codex auth и
legacy worktree text handlers. Все source/test callers передают registry явно.
45 routing/catalog/alias tests сохранены в `provider-registrations.test.ts`.

Spec → feature generation передаёт тот же registry и abort controller во вторую
фазу. Contract с fake provider и реальным файловым хранилищем проверяет сохранение
spec, создание backlog feature и отмену между фазами без второго model call.

Checkpoint удаления factory: server build и lint, 2900 unit-тестов (40 skipped),
230 HTTP/WS contracts, 34 managed SSH/Git/preview теста (1 skipped), 11 реальных
Docker acceptance тестов (4 opt-in skipped) и три выбранных remote CLI/SDK/SSH
chat/restart сценария. SSH suite использует отдельный preview port range
43200–43219, чтобы не конкурировать с production listeners. Все три inventory
checks актуальны. Production process smoke по SIGTERM/SIGINT завершился с кодом 0.
Пропущенные opt-in проверки не доказывают завершение этапа 7 целиком.

### Проверка владельцев моделей

`ProviderRegistry.onModuleInit()` проверяет каталоги до открытия HTTP listener.
Пустые model ID, ID с пробелами по краям и повторяющиеся ID (без учёта регистра)
отклоняются, в том числе повтор внутри одного provider. Bare `modelString` не
является глобальным ключом: разные providers могут обращаться к одной SDK-модели
через разные application-facing ID. `allModels()` повторяет проверку для refreshed
catalogs; приоритеты predicate matching и aliases не меняются.

Конструкторы Cursor/Gemini/Copilot больше не вызывают CLI detection: он остаётся
в явных status/execution methods. Unit test с production registrations запрещает
CLI probes при startup validation. Nest contract проверяет отказ запуска при
конфликте каталогов. Checkpoint: build, lint, 2906 unit tests (40 skipped),
231 HTTP/WS contracts, dependency inventory check и production SIGTERM/SIGINT smoke.

### Test-only providers и Playwright composition

`MockProvider` перенесён из production source в `tests/helpers`. Отдельный entrypoint
`npm run dev:e2e --workspace=apps/server` собирает `AppModule` через Nest testing
module и явно переопределяет registry и две auth probes. Каталоги, aliases и
приоритеты production registrations сохраняются; AI execution заменён fake adapter.
Playwright и E2E workflow используют этот entrypoint, а не production mock flag.

`AUTOMAKER_MOCK_AGENT` больше не влияет на production config, login rate limit или
Claude/Codex auth verification. Успешный login сбрасывает счётчик ошибок; после пяти
неудачных попыток действует rate limit независимо от старого флага. Setup handlers
явно сохраняют прежний HTTP 200 вместо стандартного Nest POST 201.

Standalone test entrypoint создаёт собственный временный `DATA_DIR` до импорта
legacy readers, слушает только loopback, запрещён при `NODE_ENV=production` и
удаляет хранилище при shutdown. In-process contract fixtures пока разделяют старый
module-level auth store; его перенос в instance-scoped repository ещё не завершён.
Background startup tasks в E2E composition отключены, поэтому этот harness не
заменяет production lifecycle или live-provider acceptance.

Checkpoint: 2907 unit tests (40 skipped), 235 HTTP/WS contracts, server build/lint,
UI typecheck, все три inventory checks и production SIGTERM/SIGINT smoke. Contract
запускает настоящий test server process и проверяет readiness, exit 0 и удаление
его временного хранилища после SIGTERM. Chromium smoke создания Agent Chat Session
пройден с новым test composition; полный UI suite ещё не подтверждён.

## 7.3. Перенос providers

Рекомендуемый порядок:

1. Mock provider как test reference.
2. Claude как текущий default/fallback.
3. Codex и model cache/app-server integration.
4. Gemini.
5. Cursor и OpenCode CLI adapters.
6. Copilot.
7. OpenAI-compatible agent loop и local tools.

Для каждого provider:

- [ ] installation/auth detection;
- [ ] model catalog;
- [ ] local and supported remote execution;
- [ ] event normalization;
- [ ] cancel/cleanup;
- [ ] credentials redaction;
- [ ] usage endpoint;
- [ ] contract tests с fake SDK/CLI;
- [ ] optional live acceptance test вне обычного CI.

## 7.4. AgentService decomposition

- [ ] Отделить persisted session repository от active session registry.
- [ ] Отделить prompt/context construction.
- [ ] Отделить provider selection.
- [ ] Отделить execution environment preparation.
- [ ] Отделить stream normalization/event publication.
- [ ] Отделить follow-up/cancel.
- [ ] Отделить completion persistence/recovery.
- [ ] Сохранить session identifiers и UI event order.

На первом migration commit этого блока существующий `AgentService` допустимо зарегистрировать целиком как
Nest provider. Его деление выполняется после переноса routes и contract coverage.

## 7.5. Tool policy

- [ ] Единый policy для read/write/search/shell/delete tools.
- [ ] Учитывать provider capability и execution environment capability.
- [ ] Сохранить plan/read-only ограничения.
- [ ] Не полагаться только на название tool от внешнего SDK.
- [ ] Нормализовать tool calls и usage events.
- [ ] Проверить command wrappers, redirects и destructive detection.

## 7.6. Models/setup/usage routes

- [ ] Перенести provider status и setup endpoints, отложенные на этапе 4.
- [ ] Перенести Claude/Codex/Gemini/ZAI usage endpoints.
- [ ] Перенести model discovery/cache refresh.
- [ ] Status не должен выполнять дорогую авторизацию без явного запроса.
- [ ] Setup mutation требует подтверждения и возвращает фактический target.

## 7.7. Agent routes

- [ ] Start/query/follow-up/cancel.
- [ ] Session list/history интеграция.
- [ ] Running agents read model.
- [ ] Streaming через EventBus compatibility layer.
- [ ] Request завершение не отменяет долгоживущий agent job.
- [ ] Shutdown отмечает jobs interrupted до закрытия provider processes.

## Тесты

- Registry priority/aliases/duplicate detection.
- Capability matrix всех providers.
- Fake provider stream/follow-up/cancel/error.
- Agent session restart/recovery.
- Remote binding tests без controller fallback.
- Tool policy adversarial cases.
- Usage parsing fixtures.
- UI Agent и Running Agents smoke.

## Exit criteria

- Provider registration полностью явная и управляется Nest DI.
- Нет создания `SettingsService` внутри provider.
- Agent routes удалены из legacy bridge.
- Все providers проходят общий adapter contract suite.
- Active sessions корректно завершаются или помечаются interrupted при shutdown.
- Полный stage checkpoint пройден для fake providers и всех доступных
  environment-specific integration suites; результат зафиксирован отдельным
  завершающим коммитом в общей migration-ветке.
