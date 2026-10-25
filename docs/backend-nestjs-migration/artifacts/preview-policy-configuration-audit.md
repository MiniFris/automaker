# Application-owned preview policy

## Implemented

Native composition owns one immutable `PreviewPolicy`, constructed from parsed `RuntimeConfig.preview`. HTTP middleware, WebSocket admission and managed dev servers receive that policy explicitly. Managed dev servers pass it to gateways and relay-script generation; alias resolution uses the application's captured working directory. Gateway URL, cookie security, bind host and `preserveUrlHost` use the same snapshot. These native paths no longer read live `process.env` or `process.cwd()`.

Defaults remain ports 3100–3119, local binding outside container mode and `0.0.0.0` in container mode, with explicit bind override. Public URL templates retain `{port}` in hostname or port position and require an HTTP(S) origin without credentials/path/query/hash. Every configured origin is validated before resource construction.

Two explicit configuration constraints now fail fast: at most 256 reserved ports, and preview ports no greater than 64535 because the target listener uses `preview + 1000`. Reversed/noninteger/out-of-range ranges and malformed templates/bind values fail parsing. The bounded range also bounds public-origin generation and port admission work.

Preview API distrust is independent of active sessions. Reserved numeric ports and configured public origins remain blocked after gateway expiration. Malformed/non-HTTP origins and malformed origin headers are denied for HTTP and WebSocket transports. Existing opaque-origin native key-client behavior and normal API request behavior remain intact.

## Evidence and boundaries

- 40 focused unit cases passed across typed preview policy/configuration, legacy compatibility and WebSocket transport. They cover URL and environment snapshots, hostname/port templates, bounded relay target ports, invalid configuration and malformed-origin rejection.
- Six native contract cases passed across the new isolation contract and existing WebSocket transport contract: two application configurations, HTTP/WS admission, managed policy identity/URL description/path resolver, and an actual private ephemeral gateway whose closed origin remains API-untrusted. Server `tsc --noEmit` and owned production ESLint passed; formatting and whitespace checks passed.
- Native source import review finds no import of the ambient legacy `execution-environment/preview-policy.ts`. Separate lazy compatibility defaults remain for standalone gateway/dev/tunnel constructors; native factories supply their policy explicitly.

No default-range preview listener, GitHub/model call, Docker/SSH target or host listener adoption is required for this slice. The private gateway fixture exercises capability authorization and expiry without executing a managed target command. It does not certify remote target/process lifecycle beyond the existing implementation. Public HTTP/WS success/error payload contracts were not changed.
