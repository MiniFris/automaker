# Security audit remediation

2026-10-25, branch `refactor/backend-nestjs-migration`.

The pull-request Security Audit job reproduced 60 findings: 6 critical, 45 high,
6 moderate and 3 low. Its command is `npm audit --audit-level=critical`.
The audit threshold and failure behavior are preserved.

Updated direct dependencies and their transitive graph include Vite 7.3.7,
Vitest/UI/coverage 4.1.12, ws 8.22.0, YAML 2.9.1, Zod 4.6.6, MCP SDK 1.32.2,
Copilot SDK 0.2.2, electron-builder 26.18.0 and Electron 42.11.18. Router plugin
1.168.48 is paired with its required React Router 1.170.46 peer. All workspace
Vitest declarations use the same version. XML parser, archive and logging
libraries were also updated to fixed releases.

Nest 12.2.0 pins Multer 2.4.0, affected by
[GHSA-q7qp-rjg7-q26m](https://github.com/advisories/GHSA-q7qp-rjg7-q26m).
A scoped root override selects Multer 2.5.0 without downgrading Nest.
The Electron server preparation script copies root overrides into its standalone
manifest so the same fix is retained outside npm workspace resolution.

Electron 39 still depends on `extract-zip`, which has no patched release for
[GHSA-jmr9-qjv8-65gv](https://github.com/advisories/GHSA-jmr9-qjv8-65gv) and
[GHSA-7pqw-9j4j-h8q3](https://github.com/advisories/GHSA-7pqw-9j4j-h8q3).
Electron 42.11.18 uses the maintained internal extractor. This is the intentional
major-version update in the remediation and requires actual packaged acceptance.
The setup action's explicit Linux Rollup binding is also updated to 4.65.0.

npm 10 failed with an internal Arborist `edgesOut` error during the initial
multi-workspace update. Lockfile generation used npm 11.6.2 in an isolated
manifest-only directory; normal project/CI installation remains supported.
The clean graph must not retain the former invalid nested Vitest 3.2.4 entry.

The initially selected Copilot SDK 0.1.32 passed audit but failed actual Node 22
imports (`vscode-jsonrpc/node` lacks the required `.js` suffix). The first unit/
contract attempts exposed this; 0.2.2 imports `vscode-jsonrpc/node.js`, and the
full unit rerun passed. Actual installed-SDK protocol coverage is run separately
against private SSH/CLI peers.
No provider authentication or paid model calls were made.

Zod 4.6 also changed default ISO datetime validation to require seconds. Explicit
UTC minute/full-precision alternatives retain the existing request/response
acceptance. Nine regression cases cover valid minute/second/fraction/leap-day
values and invalid/non-UTC inputs across event filters, health and file stats.
The existing file-stat test still checks string/date-time JSON schema and Date
normalization. OpenAPI is regenerated for the new Zod representation.

Standalone Electron preparation now omits development dependencies from copied,
already compiled local library manifests. This avoids resolving their test-runner
peer graphs during production packaging and the npm 10 internal resolver failure.
The generated bundle contains no Vitest and uses Multer 2.5.0.

The native Copilot fixture initially timed out after the SDK update: it sent
notifications with a fixed session ID while SDK 0.2.2 allocates that ID on the
client. Fixtures now echo the requested session ID, and the SSH assertion compares
the result to the ID observed by its CLI peer. No production timeout or assertion
was relaxed.

## Validation

- Root `npm audit --audit-level=critical`: **0 vulnerabilities**, exit 0.
- Separate generated server bundle `npm audit --omit=dev --workspaces=false`:
  **0 vulnerabilities**, exit 0; pinned Multer override present and no Vitest.
- Clean `npm ci --ignore-scripts`, subsequent CI-style forced install/native binding
  setup and final lockfile dry-run succeeded. Native node-pty rebuild succeeded.
- Full server unit: **4057 passed**, 18 conditional skips.
- Full package/UI after timestamp compatibility: **1765 passed** (including nine new cases).
- Full contract attempt: **848 passed**, one conditional skip and the one fixed-ID
  Copilot fixture timeout described above. After correction, all **4 cases** in
  that native discovery file passed in 4.07s with the original timeout. This is a
  full-run-plus-focused-rerun result, not a claim of a second full green aggregate.
- Actual installed SDK/SSH integration: **12 passed**, including Claude/Codex/
  Copilot protocol peers, chat restart, feature/commit/merge and planning controls.
- OpenAPI **21 passed**; architecture **40 passed**. Server/shared builds, UI
  typecheck, server/UI lint, lockfile lint, formatting and diff checks passed.
- Actual Linux Electron 42.11.18 build/native rebuild and packaged smoke passed:
  renderer/preload, readiness/auth, real PTY, terminal/backend cleanup and profile
  removal. Fresh production Web bootstrap recovery/storage smoke passed.

Accepted executable: `/tmp/automaker-security-electron/linux-unpacked/automaker`.
The verified generated server-bundle intermediate was removed after its audit and
packaged acceptance to recover work-partition space. Running operator containers
were not rebuilt or replaced.

Logs are `/tmp/automaker-security-*`, especially `audit-accepted`, `bundle-audit`,
`unit-final`, `packages-complete`, `contract-final`, `cli-discovery-fixed`,
`electron-build-accepted`, `electron-smoke`, `web-smoke` and `sdk-ssh`.
The GitHub workflow itself is not claimed as rerun before this commit is pushed.
Windows/macOS packaging and live vendor/model calls were not performed.
