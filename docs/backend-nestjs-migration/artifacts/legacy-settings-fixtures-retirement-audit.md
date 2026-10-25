# Legacy Settings fixture retirement — group 1

All seven owned test consumers now import native controllers/use cases/composition, with zero imports from `src/routes`. No production route files are deleted in this slice; the final common retirement waits for all consumer groups.

| Fixture                                                   | Replacement and retained evidence                                                                                                                                                                                                                                                                                    |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `unit/modules/model-timeouts.test.ts` (moved from routes) | Native Settings HTTP; concurrent provider saves, persisted restart values, secret-free DTO, validation before persistence                                                                                                                                                                                            |
| `unit/modules/openai-compatible-settings.test.ts` (moved) | Native Settings HTTP plus owned local mock upstream; concurrent sibling endpoint writes, key replace/retain/clear, permissions replacement, exact catalog IDs, redirect credential protection, real harmless tool verification, malformed tool JSON and upstream error redaction                                     |
| `unit/modules/execution-environments.test.ts` (moved)     | Native execution-environment Settings HTTP, actual application-owned Docker/SSH ports; no implicit connect, inspection without workspace preparation, target/fingerprint/consent validation before effects, separate credentials, local acceptance/revocation, saved-profile selection, diagnostic failure semantics |
| `unit/modules/remote-provider-setup.test.ts` (moved)      | Native HTTP and the application's owned ProviderSetupService; strict inspection target, confirmation before effect, write-only key                                                                                                                                                                                   |
| `unit/providers/model-timeouts.test.ts`                   | Production DirectSettingsCommandService catalog discovery via explicit settings read ports; existing request/header/total deadlines, Retry-After budget, agent/tool/checkpoint budgets retained                                                                                                                      |
| `unit/modules/retired-credentials-handler.test.ts`        | Real native credentials PUT remains 410 with the exact retired envelope for opaque object/array bodies and no secret reflection                                                                                                                                                                                      |
| `integration/direct-provider-browser.test.ts`             | Same opt-in scenario, now native backend/private data plus a separate Vite-only UI server. API client points directly at native origin; no legacy router mounting                                                                                                                                                    |

The new `tests/helpers/native-settings.ts` starts the actual application with private HOME/data/allowed roots, disabled startup tasks/auth, and no registered vendor providers. Tests inspect the application's actual owned Docker/SSH instances. The diagnostic runner uses the existing optional use-case runner parameter; validation, admission, mutation queues, persistence and response parsing remain production implementations.

The environment-key fixture now supplies its explicit environment before native bootstrap, respecting the immutable host snapshot. The original configured-boolean and secret-redaction assertions remain unchanged. Four moved files were previously covered by the contract configuration; this is a classification change to the regular unit matrix, not newly discovered absence of prior coverage.

## Targeted evidence

- Six executable files: 78 cases retained (model timeout HTTP15, environment18, provider setup8, direct endpoint28, provider timing8, retired credentials1).
- Final combined targeted run: all six files / 78 cases passed. The initial environment setup mismatch was corrected by explicit bootstrap environment; no assertions were weakened.
- Owned ESLint, Prettier and diff whitespace checks: exit0.
- Browser fixture imports successfully and reports one opt-in skip with the opt-in explicitly unset. Chromium was not launched; browser acceptance remains for the coordinated checkpoint.
- Logs: `/tmp/automaker-routes-settings-retirement-final.log`, `/tmp/automaker-routes-settings-direct-final.log`, `/tmp/automaker-routes-settings-browser.log`, `/tmp/automaker-routes-settings-lint.log`.

No production changes, shared schema builds, external endpoints, operator resources or paid calls were needed.
