# Setup HTTP client extraction

The remaining setup namespace and its private provider helpers now live in
`apps/ui/src/lib/http-domains/setup.ts` as `createSetupClient`. The root HTTP client
binds its existing get/post/delete/event transport and supplies a narrow host port
for confirmation and translation. Its public `setup` API remains structurally
compatible with ElectronAPI. The public `checkClaudeCli` bridge delegates to the
same domain status method instead of retaining a separate setup endpoint call.

All existing protocol parsing and orchestration order were moved intact:
inspection → explicit confirmation where required → fresh preflight → mutation →
response target verification. Provider reconnect/disconnect switches remain
explicit; credential changes still omit the secret from confirmation text and
refuse stale/old targets. Cursor configuration/permissions and Claude/Codex/GitHub
verification retain their request/response matching. Install cancellation and
event subscription/unsubscription continue through the owning transport.

The domain imports no browser globals, fetch implementation, authentication
bootstrap or WebSocket connection implementation. Window confirmation is resolved
late by the root host adapter, preserving browser/Electron presentation ownership.
Factory construction starts no IO or subscriptions. Two factories retain separate
host/transport targets without a shared mutable setup object.

Targeted evidence: **132 existing setup/provider/consent HTTP cases passed** across
15 files; **3 new domain-port cases passed** for isolated IO/host ownership,
independent targets/consent and changed-target refusal before mutation. One added
case verifies the public Claude CLI bridge through the extracted domain. UI
TypeScript, targeted client/domain/test ESLint and formatting passed. No backend,
schema, package, authentication/bootstrap transport or WebSocket behavior was
changed; no full suite, GUI or network run was started by this owner.

The root client drops from 2447 to 1706 lines. This completes the setup namespace
extraction, without claiming every remaining root filesystem/Electron bridge is a
domain method or changing the existing consent UX.
