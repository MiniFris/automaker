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

- [ ] Удалить module-import registration side effects.
- [ ] Удалить static методы `ProviderFactory`.
- [ ] Зарегистрировать adapters явным factory provider.
- [ ] Сохранить aliases и model matching priorities.
- [ ] Вынести disconnected markers в provider connection repository.
- [ ] Ввести duplicate alias/model ownership checks при startup.
- [ ] Поддержать mock provider только через test module override.

Nest не предоставляет неявный multi-binding, поэтому registry должен получать
явный массив provider tokens или собираться factory с перечисленными dependencies.

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
