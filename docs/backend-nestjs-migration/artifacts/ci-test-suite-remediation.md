# Test Suite CI portability fixes

2026-10-25. Reconciled against the failed
[pull-request run](https://github.com/MiniFris/automaker/actions/runs/40223585528)
and [push run](https://github.com/MiniFris/automaker/actions/runs/40223581141)
for source `e7f51057`. Both failed in the server coverage step. The quoted
IssueValidation cancellation diagnostic is expected by its lifecycle test;
it was not among the failed assertions reported by GitHub annotations.

## Confirmed causes and fixes

- Storage tests copied a fixture directory that existed locally but was ignored
  by `.automaker/` and absent from Git. A narrowly scoped ignore exception and
  three synthetic project fixture files make it available in clean checkouts.
- The root catch-all server project used Vitest's default five-second deadline
  and mixed portable tests with SSH/target-process fixtures. Coverage now reuses
  the existing unit, contract and integration configs, with two workers and their
  existing deadlines/isolation. SSH runs in its own CI job with its existing
  120-second fixture deadlines. Docker/browser opt-ins retain their dedicated
  configurations and prerequisites. Both push and PR use the same workflow.
- Git worker fixtures supplied author identity only to their initial commit.
  Later PR/cherry-pick operations inherited developer-global identity. Identity
  is now configured locally in the temporary repository. The two Git failures
  were reproduced with global/system config disabled before the correction.
- Native verification fixtures omitted PATH/HOME. Their shell selected host
  `/usr/bin/node` locally and lacked the GitHub toolcache on hosted runners.
  Fixtures explicitly capture the running Node directory/runner PATH and a
  private HOME. A new real-command assertion verifies actual executable/HOME;
  it failed before the fix. Lease capture uses the same successful waitFor
  observation, avoiding a separate observation/read race.
- The shutdown child inherited repository-root cwd, so tsx read the root tsconfig
  without Nest parameter-decorator support. This exact failure reproduced under
  the original root coverage command. An explicit server-workspace cwd fixes it;
  early-exit diagnostics retain the fixture's stderr for actionable import errors.

These changes concern CI/test composition and fixtures. Production lifecycle,
provider behavior and error handling are unchanged. No test assertions or per-tier
timeouts were weakened. Existing declared coverage thresholds remain selected by
the coverage config.

## Verification

Focused isolated runs passed: Git worker 22/22, native AutoMode 13/13 and shutdown
signal 1/1 under the original root coverage invocation.

The new full coverage command passed with **4914 tests**, 19 conditional skips
across 390 files (388 passed, two conditional skips), in 339.12 seconds.
Statements: **76.77%**, branches: **68.78%**, functions: **84.09%**, lines: **77.70%**.
The original configured thresholds (60/55/75/60 respectively) were preserved and
passed. Architecture 40/40, OpenAPI 21/21, server lint and formatting/diff checks
also passed. No package dependencies or production code changed in this fix.
The previously successful package-test step is unaffected.

The full SSH job passed: **135 passed, one conditional skip**, all 11 files,
in 551.03 seconds. This uses the same command as the added CI job and keeps
optional environment checks explicit. Both full runs used `CI=true`, disabled
global/system Git configuration and the supported Node 22.22.3 host runtime.
These are local CI-equivalent results; GitHub runs must be retriggered after push.

```sh
CI=true GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 npm run test:server:coverage
CI=true GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 npm run test:server:ssh
```

Logs: `/tmp/automaker-ci-tiered-coverage.log`, `/tmp/automaker-ci-ssh-full.log`,
`/tmp/automaker-ci-project-git-final.log`, `/tmp/automaker-ci-auto-mode-final.log`
and `/tmp/automaker-ci-shutdown-fixed.log`.
