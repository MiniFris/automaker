# Retire permanently skipped MCP SDK mocks

The former `tests/unit/services/mcp-test-service.test.ts` contained22 permanently
skipped SDK-mock cases and an empty skipped suite. It mocked transport construction
and client responses rather than exercising the actual SDK protocol; its stdio
transport mock no longer represented the bounded native transport. The file has
been removed after verifying the replacement coverage below.

| Former meaning                                       | Current executable evidence                                                                                     |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| stdio/SSE/HTTP connection and discovery              | Actual SDK stdio, HTTP JSON, HTTP-SSE and legacy SSE peers in mcp-transport/mcp-http-native contracts           |
| Missing command/URL                                  | Three cases in mcp-invalid-config reject before transport acquisition                                           |
| Env and headers                                      | Actual two-app stdio environment/saved overrides and HTTP/SSE saved-header assertions                           |
| Connect/list/non-Error failures                      | Separate actual protocol timeout/error/redaction cases and controlled saved-settings Error/non-Error failures   |
| Cleanup after success/error                          | Actual reader/process termination, TERM-resistant grandchild identity, held shutdown and no post-close dispatch |
| Tool mapping/empty catalog                           | Actual SDK rich tool schema/description/enabled mapping and empty stdio/HTTP/SSE catalogs                       |
| Saved ID, missing/undefined servers, settings errors | Actual native saved-ID HTTP tests plus invalid-config cases                                                     |

Two old expectations are intentionally not restored: ignoring failed cleanup is
replaced by retained uncertainty and a failed clean-close claim; a malformed SDK
result without required tools is rejected by the real client, rather than treated
as an empty successful catalog. Both have executable negative proofs.

Added `mcp-invalid-config.contract.test.ts` has11 cases, including three actual SDK
stdio tool variants. Together with the existing three real transport/ownership
contract files,42 cases passed on2026-10-25:
`/tmp/automaker-wave22-mcp-retirement.log`. Private fixture servers execute no tools,
make no vendor/model calls and close their owned processes. No production MCP
semantics were changed by this test retirement.

This removes22 skipped mock cases; it does not turn unrelated conditional Docker,
Gemini distribution or Windows cases into passed evidence.
