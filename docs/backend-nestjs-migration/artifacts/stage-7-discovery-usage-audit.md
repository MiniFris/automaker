# Этап 7: passive discovery и usage boundary

Срез после checkpoint `e8d3eb9d`; закрывает пять конкретных production chains
из read-only review. Исходники ToolPolicy и ранее закрытых setup status flows
не перерабатывались. Это не объявление всего этапа 7 завершённым.

| Production chain                                                       | Изменение                                                                                                                                                                                                                                                                                                            | Evidence                                                                                                                                                                                     |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/models/providers → ProviderRegistry.statuses` и `/gemini/status`     | Native `ProviderDiscoveryService → SetupStatusRuntime` читает только installation/version metadata. Registry больше не создаёт execution adapters и не вызывает `detectInstallation/checkAuth` ради statuses. Claude/Direct SDK presence отделён от CLI presence; unknown registrations не получают installed grant. | Registry/registration/discovery units; native HTTP fixture после startup проверяет ноль adapter factory calls, owned installation paths/version и unknown authentication.                    |
| `/gemini/usage → GeminiUsageService`                                   | Удалены OAuth client-source extraction, refresh и vendor credential write-back. Existing usable access token позволяет quota read; expired/refresh-only credentials возвращают требование авторизации без сети и CLI discovery.                                                                                      | Expired-file native HTTP fixture сохраняет исходное содержимое и допускает только запросы к owned Nest server. Units проверяют refresh-only/expired и успешный quota read с unexpired token. |
| `/claude/usage → ClaudeUsageService`                                   | Активный PTY path не отправляет Enter на trust dialog: завершает запрос `TRUST_PROMPT_PENDING` и останавливает PTY. User approval остаётся явным действием в CLI.                                                                                                                                                    | Existing PTY unit suite плюс trust-dialog case: no input, pending error, kill вызван.                                                                                                        |
| `ProviderUsageController → ProviderUsageService`                       | Публичные exception branches возвращают фиксированные сообщения, сохраняя прежние HTTP status/auth semantics. Internal resolved Gemini/ZAI errors также не возвращают arbitrary upstream exception/statusText.                                                                                                       | Sentinel unit matrix и native HTTP Claude/Codex/Gemini/ZAI/model-cache failures. Provider auth failures по-прежнему не превращаются в Automaker 401/403.                                     |
| `/zai/configure → ZaiUsageService → SettingsService.updateCredentials` | Сначала canonical persisted credentials, затем runtime activation. Failed save не меняет token/host и не публикует success. Masked input активирует сохранённый canonical token. Native `EVENT_BUS` заменяет disconnected emitters; публичные error events используют фиксированный текст.                           | Native HTTP persistence-failure, masked-input и app-owned notification assertions; ZAI verification error/event units; existing usage ownership/environment contracts.                       |

## Границы поведения

- Discovery по-прежнему может выполнять bounded CLI `--version`; authentication
  commands и credential-content reads к этой операции не относятся. Registry
  metadata catalog `allModels()` сохраняет прежние pure adapter catalog factories.
- Usage остаётся явным запросом quota к vendor API/CLI/app-server при наличии
  пригодных credentials. Срез убирает конкретные скрытые OAuth refresh/write и
  trust approval, не объявляет все usage GET локальными или не имеющими effects.
- Gemini credential TTL/cache сохраняется. Неизвестная expiry у существующего
  access token не выдаётся за проверку authentication; окончательный результат
  quota запроса остаётся ответственностью upstream API.
- ZAI custom `apiHost` остаётся session-only; configure response прямо сообщает
  «until server restart». Persisted host schema не добавлялась. Operator env host
  по-прежнему имеет прежний приоритет. Native settings mutation queue используется
  без изменений `SettingsService`.
- Gemini CLI explicit policy unsupported из предыдущего среза не изменён.
  Исследованный versioned admin-policy adapter в эту волну не входит.

## Targeted verification

- 7 unit files: **139 passed, 1 existing skipped** (`provider-discovery`,
  `provider-registry`, `provider-usage`, `provider-registrations`,
  `usage-environment`, `claude-usage-service`, `setup-status-runtime`).
- 3 native contract files: **6 passed** (`provider-passive-usage`,
  `provider-usage-ownership`, `usage-environment`). Используются owned files,
  native Nest HTTP и локальный HTTP upstream fixture; vendor/paid calls отсутствуют.
- Server TypeScript: собственный исправленный bus payload не имеет ошибок;
  последняя общая проверка остановилась на concurrent FS download/platform dist
  изменениях (`writeStream`, `runProcess signal`), переданных root.
- Whitespace diff check — clean. Full suites, browser, Docker и live vendor
  authentication в этом срезе не запускались; общий checkpoint принадлежит root.
