# Model timeouts

Timeouts are configured separately on each **Settings → AI Providers** page (Claude, Codex, Cursor, OpenCode, Gemini, Copilot). Only applicable controls are shown. There is no shared timeout panel in Model Defaults and saving one provider does not change another.

Provider timeout panels are collapsed by default. Click their heading to expand or collapse them; collapsing a panel preserves its unsaved draft.

On **OpenAI-compatible endpoints**, edit an endpoint for its nine connection/agent timeout controls. The separate **Direct task timeouts** panel contains only Verify, pipeline test wait, commit-message and PR-description deadlines, without duplicating connection controls. The UI uses seconds (millisecond precision); the API and settings file use integer milliseconds.

Empty provider fields use built-in defaults; empty endpoint fields inherit provider defaults. `Clear overrides` edits the visible fields in the draft; press Save to persist it. Changes apply to new requests, not running agents. Zero does not disable a timeout. Supported values are 1–2,147,483,647 ms, the safe Node timer range.

## Defaults and applicability

| Setting                  |                                    Default | Applies to                                                                                                    |
| ------------------------ | -----------------------------------------: | ------------------------------------------------------------------------------------------------------------- |
| Request                  | 120 s Direct; native SDK default otherwise | Whole Direct HTTP request, including streaming; explicit shared setting also controls Claude `API_TIMEOUT_MS` |
| Response headers         |                                       30 s | Direct response headers, bounded by the request deadline                                                      |
| Model discovery          |   min(request, 30 s) unless explicitly set | Direct `/models`, including body                                                                              |
| Connection test          | min(request, 30 s) for Direct; 30 s native | Direct text/tool probes, native Claude/Codex authentication probes                                            |
| Agent duration           |               300 s legacy / 900 s managed | Whole Direct run across turns, or existing agent limit if configured                                          |
| Tool execution           |                10 s legacy / 180 s managed | Each Direct tool, including its actual shell subprocess, or existing agent limit                              |
| Checkpoint save          |                                        1 s | Each Direct checkpoint persistence operation                                                                  |
| CLI/SDK idle             |                                 120 s base | Native CLI providers and remote CLI/SDK processes                                                             |
| Codex extended idle      |                                 300 s base | Native Codex CLI with xhigh reasoning                                                                         |
| Remote process duration  |                                      600 s | Whole Docker/SSH CLI/SDK subprocess, even while producing output                                              |
| Verification command     |                                      120 s | Each automatic Verify lint/test/build command                                                                 |
| Pipeline test wait       |                                      600 s | Waiting for a host test-runner session                                                                        |
| Commit message           |                                       30 s | AI commit-message generation, any provider                                                                    |
| PR description           |                                       30 s | AI PR-description generation, any provider                                                                    |
| Maximum Retry-After wait |                                        5 s | Direct retryable HTTP responses; longer waits are not retried                                                 |
| Maximum retry backoff    |                                        2 s | Direct exponential retry delay                                                                                |

Overlapping deadlines are independent: the earliest one wins. Raising only the request timeout does not raise the header or agent timeout. Idle deadlines retain existing reasoning multipliers (up to ×4), capped at the safe Node timer maximum. Remote SDK heartbeat messages count as output. Native SDKs have no new additional idle/total timers; provider-internal deadlines remain provider-controlled. Timeout cancellation waits for cooperative subprocess/tool cleanup.

## Inheritance and compatibility

Direct precedence: explicit endpoint override → `providerModelTimeouts['openai-compatible']` → existing `openaiCompatibleAgentSettings.limits` / built-in defaults. The existing endpoint `timeoutMs` remains the request override; additional Direct overrides are stored under endpoint `timeouts`. Previously saved explicit values are preserved, including a saved 120-second request timeout.

Previously saved shared `modelTimeouts` are retained only as a compatibility fallback for providers without their own record, filtered to applicable keys. A provider save creates an independent record; even an explicit empty record `{}` masks the old fallback and restores built-in defaults. Clearing Direct workflow fields preserves hidden connection fallback values. New settings do not modify the old shared record. The old unscoped API remains available to older clients, but no shared control is exposed in the UI.

Existing Claude connection/profile `timeoutMs` takes precedence over its provider request timeout. No migration is needed for unset settings, and existing behaviour is retained. The former one-hour agent / ten-minute tool and worker clamps have been removed from new worker code. An already pinned SSH session retains its original immutable worker: prepare the updated worker and start a new binding/session to use raised worker limits. Existing sessions are not silently migrated.

Provider controls intentionally exclude unrelated UI debounce, status/version checks, CLI installation/login processes, usage polling, Git/preview operations, SSH handshakes, Docker management, heartbeats and forced cleanup escalation. These are not model-generation deadlines. Existing plan-approval and event-hook timeout settings remain in their own sections.

## API and validation

Authenticated `GET /api/settings/model-timeouts/:provider` returns `{ success: true, timeouts: { ... } }`. `PUT` accepts only `{ timeouts: { ... } }`; an empty timeouts object resets that provider. Provider identifiers are `openai-compatible`, `claude`, `codex`, `cursor`, `opencode`, `gemini`, `copilot`. Writes validate positive safe integer milliseconds and reject unknown providers or inapplicable fields; concurrent scoped saves are serialized. The UI query caches only this secret-free DTO, separately by provider, not credentials or full connection settings.

Examples of common fields: `requestTimeoutMs`, `responseHeadersTimeoutMs`, `agentTimeoutMs`, `toolTimeoutMs`, `cliIdleTimeoutMs`, `remoteProcessTimeoutMs`, `commitMessageTimeoutMs`. Complete schema: `libs/types/src/model-timeouts.ts`.

## Verification (2026-10-18)

- Package, server and UI production builds pass; server/UI lint has no errors.
- The original shared-timeout rollout passed 4,230 regression tests across the server, UI and shared-library workspaces, with 40 existing skips. Preview integration tests require free ports in `3100–3119`; do not kill unrelated listeners to free test ports.
- The provider-scoped revision passed 82 focused tests (one existing skip), 574 shared-library tests, 20 preview scenarios and four selected real-Docker scenarios. The broad regression run's port-conflicted preview checks and corrected UI test mock were rerun successfully. Production browser checks verified all seven provider pages, removal of the Model Defaults panel, and no duplicated Direct connection fields.
- Deployment checks verified original numeric ownership for all 65 project archive entries, actual create/rename/delete access as the runtime user in the feature directories, and unchanged project content, modes, login key and saved timeout values. Archive ownership restoration was also tested in a disposable, network-disabled container.
- Tests cover timeout validation/persistence, inheritance and endpoint precedence, HTTP/header/retry/checkpoint cancellation, CLI reasoning multipliers, actual shell/remote-process forwarding, native authentication probes, and commit/PR generation cancellation.
- The standalone UI typecheck still reports the two pre-existing `TS2322` errors in `board-view.tsx` at lines 1257 and 1298; this change does not modify that file.

## Deployment permissions

When recreating the Automaker server, back up `/projects` as well as persistent `/data`. Record each project's original numeric UID/GID and restore them without following symlinks: archive extraction may create root-owned files even when the top-level `/projects` directory is writable. Do not infer subtree writability from that parent directory.

Before exposing the updated UI, check ownership and perform an exclusive temporary-file create → rename → delete probe **as the Automaker runtime user** in each project root and its `.automaker`/feature directories. Do not solve ownership problems by granting world-write permissions. Permission repair does not resume failed model tasks automatically.
