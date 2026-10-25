# Current artifact and upgrade acceptance

Date:2026-10-25. Production backend source:commit `86afe69c`, branch
`refactor/backend-nestjs-migration`. Subsequent changes in this checkpoint concern
acceptance scripts, tests and documentation; they do not alter the packaged backend.

## Linux Electron

`npm run build:electron:linux:dir` completed, including actual production dependency
installation and Electron39.2.7 native module rebuild. The actual executable passed
`xvfb-run -a node scripts/smoke-packaged-electron.mjs --executable .../automaker`.
Renderer/preload mounted; readiness200, unauthenticated401 and authenticated200
were checked. A real PTY produced its split marker and exited0. Terminal and backend
shutdown and private profile removal were confirmed.

The probe was repeated after fixing its marker synchronization: an initial shell
prompt can prefix early output, so the command prints a leading newline before the
assembled marker. The exact output assertion and protection against accepting
input echo remain. See the [deterministic reproduction](workload-acceptance.md).
Production terminal code was unchanged.

After acceptance, the generated executable tree was preserved at
`/tmp/automaker-wave17-linux-unpacked` to release space on the work partition.
The generated intermediate `apps/ui/server-bundle` was verified by path/package
identity and removed. No operator profiles, containers or volumes were removed.

## Production Docker

The actual Dockerfile server target was built with source commit metadata:

```sh
docker build --target server --build-arg GIT_COMMIT_SHA=86afe69c \
  -t automaker-nest-wave17-production-smoke:latest .
node scripts/smoke-production-docker.mjs \
  --image automaker-nest-wave17-production-smoke:latest
```

The build actually used the full40-character commit hash. Selected local image ID:
`sha256:79cf7be7bcbb541eefdcb6adc506378e1e338232cb91d017c95563f025e3b519`.
Runtime Node22.23.4. Actual readiness/auth/featureCRUD/nativeZIP/metrics checks passed;
compiled legacy code and TypeScript/test toolchains were absent. SIGTERM exited0.
The runner pins the local image, uses no host/operator mounts and cleans its own
labelled container.

The first Docker smoke failed its unchanged30-second readiness bound while the
work partition reported zero available space during image unpacking. After moving
owned generated artifacts and recovering space, the repeated smoke passed. This
sequence is recorded rather than attributed to a proven application defect; the
first run's truncated startup diagnostics did not establish the exact cause.

## Existing-volume upgrade, restart and rollback

The [private upgrade runner](backend-upgrade-acceptance.md) passed against the
selected previous wave7 image and current wave17 image. It verified old data through
the new API, mutations surviving restart and restoration of a complete baseline
snapshot into a separate volume, then read it through the selected old artifact.
Snapshot bytes, modes and numeric ownership matched; rollback did not alter the
preserved upgraded data. Four SIGTERM stops exited0. All runner-owned resources
were removed.

This is local acceptance for the named artifacts and small explicit fixtures.
It does not test an arbitrary historical release, operator volume, production
staging deployment or Windows/macOS packaging. Conditional OS/deployment gates and
the remaining stage11 boundaries remain open.

Logs: `/tmp/automaker-wave17-electron-build.log`,
`/tmp/automaker-wave17-electron-smoke2.log`, `/tmp/automaker-wave17-docker-build.log`,
`/tmp/automaker-wave17-docker-smoke2.log`, `/tmp/automaker-wave17-upgrade-final.log`.

## Additional checkpoint verification

- Complete SSH tier:136passed across11files, including actual Local/SSH feature
  execution, remote CLI/SDK transports, managed preview/test/terminal and Chromium
  Vite/HMR. Offline fixture peers/providers are used; no paid model calls.
- Native Settings browser E2E:1passed with real Chromium, including shared endpoint,
  catalog/tools, model selection, Local/Auto consent and actual SSH setup/reload.
  The migrated fixture now uses the current Radix combobox API and whitespace-
  normalized exact consent text. Assertions and existing timeouts were preserved.
- Public metadata inheritance:2native contract cases passed. Protected siblings,
  overridden handlers and explicitfalse metadata are checked through actual HTTP;
  the production public inventory and absence of controller inheritance are pinned.
- Architecture command now includes the module graph proof:27tests passed (13existing
  boundaries and14module graph cases). Production graph has40modules,52edges,
  5dynamicfactories and0cycles. This does not claim a complete provider DI graph.
- Repository formatting, diff and all three generated inventory checks passed.

These extend the full server/unit/contract/package/build/lint/type/performance
checkpoint in [wave17](legacy-retirement-logging-checkpoint.md). Production source
has not changed since that checkpoint; new scripts and tests received targeted
execution rather than repeating unaffected suites.

Logs: `/tmp/automaker-wave17-ssh-all.log`,
`/tmp/automaker-wave18-provider-browser6.log`,
`/tmp/automaker-wave18-auth-inheritance.log`,
`/tmp/automaker-wave18-architecture.log`, `/tmp/automaker-wave18-format.log`.
