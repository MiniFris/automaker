# Execution-environment Settings JSON response contracts

All twenty handlers in `ExecutionEnvironmentSettingsController` parse awaited producer results with public schemas from the new `@automaker/contracts/domains/execution-environment-responses` domain. Producer implementations, inputs, cancellation helpers, status/error behavior and transport/process code are unchanged.

| Method and `/api/settings/execution-environments/` path | Response family                              |
| ------------------------------------------------------- | -------------------------------------------- |
| POST `inspect`                                          | Settings DTO                                 |
| POST `feature/inspect`                                  | Nullable persisted binding and selected type |
| PUT `global`                                            | Settings DTO                                 |
| PUT `project`                                           | Settings DTO                                 |
| POST `local/confirm`                                    | Settings DTO                                 |
| POST `local/revoke`                                     | Settings DTO                                 |
| POST `auto/confirm`                                     | Settings DTO                                 |
| POST `auto/revoke`                                      | Settings DTO                                 |
| POST `docker/check`                                     | Docker connection diagnostic                 |
| POST `docker/prepare`                                   | Docker preparation result                    |
| POST `providers/inspect`                                | Remote provider status                       |
| POST `providers/install`                                | Remote provider status                       |
| POST `providers/key`                                    | Remote provider status                       |
| POST `ssh/scan`                                         | SSH host key                                 |
| POST `ssh/trust`                                        | Settings DTO                                 |
| POST `ssh/key`                                          | Settings DTO                                 |
| POST `ssh/check`                                        | SSH diagnostic                               |
| POST `ssh/prepare`                                      | Settings DTO                                 |
| POST `ssh/project`                                      | Settings DTO                                 |
| POST `ssh/recover`                                      | Settings DTO                                 |

## Honest record boundaries

Seven response families describe the actual nested settings/profiles/selections/resolved environment, consent, SSH status/project, Docker diagnostics/preparation, provider status and SSH host-key/diagnostic records. Known primitive fields are checked; records retain extension keys and historically optional null values. No new status enums, transformations or defaults are imposed.

Feature bindings have a different existing boundary: `EnvironmentBindingStore.peek` validates only version, ID and project path. Their shared record therefore validates exactly those three scalar fields and preserves every other field as opaque data. It does not falsely claim a complete current execution descriptor. A regression fixture stores and reads `cwd:false`, numeric `createdAt`, nonstandard selection data and a string Docker descriptor through the actual peek reader and HTTP handler without rewriting them.

`binding:null`, inherited project selection, missing-profile selection, Docker unavailable diagnostics, SSH trust-required diagnostics and provider `installed:false`/unverified states remain ordinary HTTP200 payloads. Request/acceptance/profile/target guards execute in their existing order before response parsing; thrown errors continue through the existing exception filter.

## Targeted evidence

- **23 native HTTP contracts passed**: one complete actual-handler flow across all twenty endpoints with offline producer overrides, one actual persisted historical-binding regression, twenty malformed application-output boundary cases, and an error-precedence case. Docker diagnostics and Docker/SSH/provider operation ports are explicit fakes; no Docker client, SSH connection, provider installation/key write or model/vendor call occurs. Local/Auto consent fixtures select the corresponding mode before confirming, retaining the producer's existing acceptance guard.
- **4 meaningful shared schema tests passed**: nested records/null/extensions, opaque binding preservation, unavailable/unverified producer states, JSON-schema export and malformed nested payload rejection.
- **3 existing execution-environment Settings service unit tests passed**.
- Root's coordinated shared build, server TypeScript check, owned controller ESLint and `git diff --check` passed.

Logs: `/tmp/automaker-execution-env-response-native.log`, `-shared.log`, `-units.log`, `-types.log`, and `-lint.log`.

Only the dedicated controller, new shared domain, new tests and this audit belong to this slice. No barrel/package/generator/inventory/README changes, full suites, external calls, commits or sub-agents were performed by this agent. Root owns generated OpenAPI and the combined checkpoint.
