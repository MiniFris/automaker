# Main Settings JSON response contracts

## Exact controller coverage

| Method and `/api/settings/` path | Runtime shared response schema                                                                        |
| -------------------------------- | ----------------------------------------------------------------------------------------------------- |
| GET `status`                     | `SettingsStatusResponseSchema`                                                                        |
| GET `global`                     | `SettingsDocumentResponseSchema`                                                                      |
| GET `credentials`                | `SettingsCredentialsResponseSchema`: four concrete masked credential status records                   |
| POST `project`                   | `SettingsDocumentResponseSchema`                                                                      |
| POST `agents/discover`           | `SettingsAgentsResponseSchema`: concrete agent definitions                                            |
| GET `model-timeouts`             | `SettingsTimeoutsResponseSchema`                                                                      |
| GET `model-timeouts/:provider`   | `SettingsTimeoutsResponseSchema`                                                                      |
| GET `openai-compatible`          | `SettingsDirectResponseSchema`: endpoint/model/capability/status and agent records                    |
| PUT `global`                     | `SettingsDocumentResponseSchema`                                                                      |
| PUT `credentials`                | `SettingsRetiredCredentialsResponseSchema`: existing authenticated HTTP410 retirement payload         |
| PUT `project`                    | `SettingsDocumentResponseSchema`                                                                      |
| POST `migrate`                   | `SettingsMigrationResponseSchema`: full flags/count/errors payload, including HTTP200 `success:false` |
| PUT `model-timeouts`             | `SettingsTimeoutsResponseSchema`                                                                      |
| PUT `model-timeouts/:provider`   | `SettingsTimeoutsResponseSchema`                                                                      |
| PUT `openai-compatible/endpoint` | `SettingsDirectResponseSchema`                                                                        |
| POST `openai-compatible/remove`  | `SettingsDirectResponseSchema`                                                                        |
| PUT `openai-compatible/agent`    | `SettingsDirectResponseSchema`                                                                        |
| POST `openai-compatible/models`  | `SettingsDirectModelsResponseSchema`: catalog IDs                                                     |
| POST `openai-compatible/test`    | `SettingsDirectTestResponseSchema`: verification and tool-test flags                                  |

All nineteen handlers parse their actual result at the controller boundary. Existing cancellation helpers remain unchanged. Public domain exports use the existing package wildcard; no root barrel, generator or inventory changed.

## Compatibility and scope

Global/project settings are intentionally extensible user-owned maps: the response validates the map container and envelope, without pretending that arbitrary user fields are a fully validated `GlobalSettings` document. Nulls, nested objects, arrays, unknown keys and future theme values remain intact. Server-owned status/count/boolean/string primitives and concrete nested credential/discovery/direct-model records are validated. Response records preserve extensions and nullable historical optional values. No new response enums, coercion, defaults, config preview, domain DTOs, input/file validators or service behavior were introduced.

The retired credentials route remains HTTP410 when authenticated. Invalid API-key access remains HTTP403; statuses were not changed to satisfy a mistaken blanket expectation. Migration's existing false result remains HTTP200 with its complete result payload.

The separate execution-environment Settings controller has twenty additional operations and is explicitly **outside this slice**; no Docker/SSH/provider setup operations were exercised or claimed covered.

## Evidence

- **21 native HTTP contract tests passed**. Actual native queries/commands cover every main endpoint, including owned project/global settings, scoped agent discovery, timeout updates, both migration outcomes and direct endpoint/agent configuration. Eighteen injected malformed application payloads prove runtime parsing and safe500 handling without disclosing their contents. Nested direct extension/null values and request/auth behavior are also covered.
- Credential reads use a narrow fake returning empty default credentials. Direct catalog and connection-test commands run against an explicit fetch fake for `offline.invalid`; exactly two external-transport invocations are intercepted. No actual credentials, vendor/model calls or target setup are used.
- **5 shared schema tests passed**, covering opaque maps, typed nested records, historical values, migration false and JSON-schema exportability.
- Root's coordinated shared build, server TypeScript check, owned controller ESLint and `git diff --check` passed. Two initial positive fixtures were corrected to existing domain semantics: Claude accepts `requestTimeoutMs`, and endpoint base URLs normalize with a trailing slash.

No full suites, external network, Docker, GUI, commits or sub-agents were used. Root owns generated OpenAPI and the combined checkpoint.
