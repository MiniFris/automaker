# Native terminal host configuration and RC ownership

`TerminalRuntimeModule` supplies every native `TerminalService` with an explicit
host port built from the application's frozen `HOST_ENVIRONMENT` and host platform,
and an RC adapter backed by its injected `SECURE_FILESYSTEM`. Shell preference,
WSL environment fallback, child environment and locale use that snapshot. Existing
environment filtering and request/config override precedence remain unchanged.
Independent applications no longer share later ambient environment mutations.

The host port probes only its finite absolute shell candidates and Linux
`/proc/version`; it does not expand the shared provider/profile system-path
allowlist. Relative shell candidates do not cause cwd-relative filesystem probes.
Platform/architecture remain the real host identity; this is not a new OS/process
supervisor or a claim of additional non-Linux process cleanup proof.

Native RC generation uses the canonical resolved terminal cwd for project settings,
file generation and shell RC environment paths. The adapter reuses existing pure
generators, RC version and signature format. Regeneration is serialized per project
with bounded admission, exclusive UUID temporary files and atomic replacement.
New native files/directories use private modes. Only ENOENT is optional; IO/policy
errors prevent allocation rather than falling through to an unconfigured shell.
An exclusive-create collision is never removed as an owned temporary file.

Terminal cleanup tracks accepted RC/theme refresh promises alongside session
creation and retains its existing bounded deadline before the FS shutdown barrier.
Closing rejects new session admission; completion of held RC creation cannot
allocate a late PTY. Theme changes also stop admission and drain accepted work.

Direct constructors without these explicit native ports retain legacy shell/env
discovery and raw platform RC compatibility. The existing preflight HOME/cwd and
max-session configuration were already injected in native composition and remain
unchanged. No controller, public protocol or remote runtime redesign is included.

## Focused verification

- Three new host/RC unit cases and 57 existing terminal service cases passed.
  The new fixtures compare every generated RC/theme/version/signature file byte
  for byte with the previous format, check private/exclusive unique temporary
  writes and coalesced regeneration, and exercise IO failure/retry/collision.
- Four native cases passed, covering two actual private PTYs with distinct captured host
  environments after ambient mutation, canonical alias configuration, symlink
  escape rejection before allocation, held creation/theme IO during cleanup and
  native RC IO failure without spawning. Held RC creation also blocks real
  `app.close()` until the accepted IO settles, before the filesystem barrier.
- Three existing terminal-stop contracts passed, including an actual owned
  TERM-resistant group, native denied/EIO preflight and missing/unauthorized HOME
  fallback. Server no-emit and scoped ESLint/format/diff checks passed.

Logs: `/tmp/terminal-host-config-unit.log`,
`/tmp/terminal-host-config-unit-final.log`, `/tmp/terminal-host-config-native.log`,
`/tmp/terminal-host-config-stop.log`, `/tmp/terminal-host-config-tsc.log` and
`/tmp/terminal-host-config-lint.log`.

All fixtures use temporary profiles/workspaces and only owned processes. Host
discovery performs finite read-only shell/WSL probes. No operator profile, external
network, vendor, GUI, full suite, commit or branch operation is part of this slice.
