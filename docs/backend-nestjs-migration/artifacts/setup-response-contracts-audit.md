# Setup JSON response contracts

All **50 SetupController operations** now parse awaited application results at the controller boundary. The new public `@automaker/contracts/domains/setup-responses` domain reuses 21 existing response schemas and adds concrete missing host-status, catalog, platform/key-presence and permissions-read/example schemas. No producer, request, credential, transport or installation behavior changed.

| Family                    | Exact operations                                                                                                                                                                 | Count |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| Status                    | GET `claude-status`, `gh-status`, `cursor-status`, `codex-status`, `opencode-status`, `gemini-status`, `copilot-status`                                                          | 7     |
| Manual guidance           | POST `install-claude`, `install-codex`                                                                                                                                           | 2     |
| Connection                | GET `connection-target`; POST `auth-{claude,cursor,codex,opencode,gemini,copilot}` and corresponding `deauth-*`                                                                  | 13    |
| Credentials/host metadata | GET `credential-target`, `api-keys`, `platform`; POST `store-api-key`, `delete-api-key`                                                                                          | 5     |
| Verification              | GET `claude-verification-target`, `codex-verification-target`, `github-authentication-target`; POST `verify-claude-auth`, `verify-codex-auth`, `verify-github-auth`              | 6     |
| Discovery/cache           | GET `copilot/models`, `opencode/models`, `opencode/providers`; POST both `models/refresh` and both `cache/clear`                                                                 | 7     |
| Cursor models             | GET `cursor-config/target`, `cursor-config`; POST `cursor-config/default-model`, `cursor-config/models`                                                                          | 4     |
| Cursor permissions        | GET `cursor-permissions/target`, `cursor-permissions`, `cursor-permissions/example`; POST `cursor-permissions/profile`, `cursor-permissions/custom`; DELETE `cursor-permissions` | 6     |

## Honest boundaries

- Install guidance is manual-only. Claude's existing `success:false` HTTP200 response remains valid; `installationPerformed:false` is retained. Reconnect/presence hints do not become live authentication or entitlement verification.
- Passive setup status and explicit verification remain separate. Unverified Claude/Codex results retain HTTP200, their target and safe error text. Request confirmation, target identity, client IP/rate limits and admission execute before response parsing; existing thrown errors are unchanged.
- Catalogs include complete model records plus count/cache flags; authenticated-provider lists and cache messages have their actual payloads. Nullable optional historical fields and catalog extensions remain supported.
- Cursor permissions read has concrete envelope/profile/target fields, while persisted permission payloads remain opaque at this transport layer. The existing repository validation is unchanged. The opaque-read regression overrides its read-only repository port; it does not claim the real repository accepts malformed persisted permissions or weaken mutation schemas. Trusted available-profile records remain typed. Cursor model configuration reuses its existing shared contract.

## Evidence

- **53 native HTTP contracts passed**: one actual-service flow covers all fifty routes and asserts fifty unique method/path fixtures; a fifty-case malformed application-output matrix proves every outer parser; separate cases cover opaque permission-read preservation and confirmation precedence.
- Host setup, application credential changes/presence, Claude/Codex verification and GitHub authentication use explicit offline port fakes. Model discovery uses fake registry adapters. Cursor configuration/permission mutations use owned temporary fixture files. No actual credentials, host probes, SDK/model requests, installs or live vendor calls occur.
- **3 focused shared tests passed**: typed catalogs, opaque read values, manual guidance and JSON-schema exportability.
- Root's coordinated shared build, server TypeScript check, owned controller ESLint and `git diff --check` passed.

Logs: `/tmp/automaker-setup-response-native.log`, `-shared.log`, `-types.log`, `-lint.log`.

Only SetupController, the new shared domain, new tests and this audit belong to this slice. Root owns query-input fixture adaptation, generated contracts/inventories and the combined checkpoint. No barrel/package/generator/README edits, full suites, commits or sub-agents were performed by this agent.
