# Final NestJS migration acceptance

Date: 2026-10-25. Accepted application source: `56cb8535bed72b9a870b42a1328d988cb9500177`.
All implementation and acceptance commits are on `refactor/backend-nestjs-migration`.
This checkpoint supersedes the earlier artifact checkpoint for current production source.

## Source acceptance

The [final source checkpoint](public-ports-uncertainty-and-application-checkpoint.md)
records full post-refactor results: 4057 server units, 849 HTTP/WS contracts,
1756 package/UI tests, 136 SSH cases, 15 managed Docker cases, 14 Direct Docker
isolation cases, 40 architecture cases and 21 OpenAPI cases. The conditional pinned
Gemini distribution case passed separately without model/auth calls. Conditional
skips remain identified there; overlapping focused runs are not added to these totals.
Builds, UI typecheck, lint, inventories, downgrade preflight, repeated workloads,
actual terminal backpressure, signal shutdown and performance budgets passed.

## Actual production artifacts

Commands were run from the accepted source with Node 22.22.3 on the build host:

```sh
docker build --target server \
  --build-arg GIT_COMMIT_SHA=56cb8535bed72b9a870b42a1328d988cb9500177 \
  -t automaker-nest-final-production-smoke:56cb8535 .
node scripts/smoke-production-docker.mjs \
  --image automaker-nest-final-production-smoke:56cb8535
node scripts/smoke-backend-upgrade.mjs \
  --old-image automaker-nest-wave7-production-smoke:latest \
  --new-image automaker-nest-final-production-smoke:56cb8535
npm run build:electron:linux:dir --workspace=apps/ui -- \
  --config.directories.output=/tmp/automaker-final-electron
xvfb-run -a node scripts/smoke-packaged-electron.mjs \
  --executable /tmp/automaker-final-electron/linux-unpacked/automaker
node apps/ui/scripts/smoke-bootstrap-recovery.mjs
```

All six commands completed with exit 0. Shared packages had already been built by
source acceptance before the workspace Electron command. Docker used the actual
production Dockerfile, with no cached artifact substituted for the accepted backend.

- Docker image ID: `sha256:3b075963870d38103a55463f4a979520244e9c12c5c04dfad1ec1f99b1a655a3`.
  Its source label matches the full accepted SHA. Runtime Node 22.23.4.
  Readiness 200, protected route 401, scoped feature CRUD, native archive and JSON
  metrics passed. Legacy and development toolchains were absent. SIGTERM exit 0.
- Actual Electron 39.2.7 Linux x64 executable, rebuilt native modules, renderer and
  preload passed. Its embedded Node runtime is 22.21.1 (measured from the actual
  executable); host development/CLI uses 22.22.3. Readiness 200, unauthenticated 401, authenticated 200, actual PTY
  exit 0, terminal cleanup, backend close and private profile removal passed.
- Fresh production Web HTML/modules displayed the bootstrap failure, recovered
  after explicit reload and preserved local storage. Broader browser workflows and
  actual Chromium Vite/HMR evidence remain linked from the source/stage checkpoints.
- Existing-volume upgrade used the retained old image
  `sha256:5a1751f40ccc00e49a8b2864d0b132470bc45ef4ebedb1caadb8baa28dee64be`.
  Old settings/features were read by the new API; new writes survived restart.
  Full snapshot restoration matched bytes, modes and numeric ownership, and the old
  artifact read the restored baseline. All four SIGTERM stops exited 0; runner-owned
  resources were removed. The preserved upgraded data was not overlaid by rollback.

Logs: `/tmp/automaker-final-docker-build.log`, `automaker-final-production-docker.log`,
`automaker-final-upgrade.log`, `automaker-final-electron-build.log`,
`automaker-final-electron-smoke.log` and `automaker-final-web-smoke.log` under `/tmp`.

The build filled the work partition during image unpacking. Before smoke execution,
verified unused migration build-cache records were removed by exact ID in dependency
order, recovering approximately 3 GiB. A previous task-owned image was also removed;
the rollback image was retained. No general prune was used. The two operator
containers remained running and no operator data/mounts were used by acceptance.
After success, the generated `apps/ui/server-bundle` intermediate was verified by
absolute path and package identity and removed, recovering 883 MiB. The accepted
executable remains at `/tmp/automaker-final-electron/linux-unpacked/automaker`.

## Scope of completion

The [original-requirements reconciliation](final-requirements-audit.md) maps every
remaining local marker to evidence and distinguishes external rollout conditions.

The repository implementation, local available-environment acceptance and operational
upgrade/rollback procedure are complete. Historical checkpoint documents retain their
then-current pending statements; this checkpoint is the final current-source result.
Windows/macOS packaging requires their OS runners. Paid/live vendor acceptance is
conditional and was not performed. External canary, prerelease and production rollout
require a target environment and release authorization; no push, release or deployment
was performed. Linux results are not claimed as those external checks.
