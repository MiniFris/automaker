# Bounded offline Linux workload acceptance

Date: 2026-10-25. Script: `scripts/smoke-server-workload.mjs`.

Run after `npm run build:server`, with the supported Node version:

```sh
node scripts/smoke-server-workload.mjs
```

The script starts the actual production `apps/server/dist/main.js` on a private
loopback port with a random API key. All data, home/config directories and the
project are created in a private temporary directory and removed afterward.
It supplies an explicit environment, without vendor credentials or operator
profiles. It makes no provider calls, external requests or Git network commands.
It only signals the child server that it created.

The workload keeps 100 features on disk in five waves of 20, performs 100 creates,
100 updates, 100 gets and 100 deletes, and checks seven feature lists (including
the warm-up and final empty list). Each wave opens a new authenticated events
WebSocket and verifies delivery of all 20 corresponding `feature:created` IDs.
There are 11 actual PTY shell sessions: one warm-up, then two per wave. Each shell
must produce a unique marker assembled from separate input fragments, exit with
code zero, and disappear from the terminal sessions API. Shell echo alone cannot
satisfy the output check.

After warm-up and every settled wave, Linux `/proc` checks the backend's file
descriptors and recursively enumerates children. Every sample requires zero
remaining children and at most eight additional descriptors relative to warm-up.
The acceptance records observed descendant PID/start-time identities while the
shells are alive and verifies that none survives final shutdown. PID reuse does
not create a false survivor. Final checks require an empty feature list, no
terminal sessions and zero active provider queries. SIGTERM must yield exit zero
within five seconds. HTTP requests and WebSocket/PTY waits are individually
bounded. These are explicit regression budgets, not measured production SLOs.

## Results on the current built artifact

Three completed runs passed after the final server build. All three reported:

- 100 features, 300 mutations, 100 gets and seven lists;
- five event connections and 100 delivered feature-created events;
- 11 PTY cycles and 11 observed descendant identities;
- baseline, all five settled waves and final sample: 24 descriptors, zero children;
- zero surviving observed descendants; clean server exit zero.

| Run | Workload duration | SIGTERM shutdown |
| --- | ----------------: | ---------------: |
| 1   |         4587.3 ms |          57.8 ms |
| 2   |         2397.4 ms |          27.5 ms |
| 3   |         2473.8 ms |          28.3 ms |

Local logs: `/tmp/automaker-wave17-workload.log`,
`/tmp/automaker-wave17-workload-repeat1.log` and
`/tmp/automaker-wave17-workload-repeat2.log`. These temporary logs are supporting
local evidence; this document records their results for review.

## Prompt interleaving investigation

An early run failed the exact marker-line assertion during a fast shell exit.
A focused run of 51 real PTY sessions subsequently passed (24 descriptors and
zero remaining children at every sample, 51 observed descendants gone).
Source inspection found that the backend flushes pending output before sending
exit, and the installed node-pty implementation waits for its PTY stream to close
before publishing process exit.

The assertion failure was reproduced deterministically using a private shell
wrapper that waits 150 ms and then executes `/bin/sh`. Input echo can arrive
before the interactive shell's first prompt. The captured output contained the
complete marker, prefixed by the shell prompt (`$ WORKLOAD_...`); the assertion
required the marker to occupy its own line. This was a probe synchronization
assumption, not missing PTY output in the reproduced case.

The command now prints a leading newline before the assembled marker, ensuring
an exact standalone output line regardless of initial prompt timing. The marker
remains split across separate command arguments, so input echo still cannot
satisfy the output assertion. No production terminal code was changed.

Focused checks after the correction both passed:

- Normal shell: 51 sessions, 51 observed descendant identities gone, FD 24 and
  zero settled children throughout; 1993.2 ms workload, 50.9 ms shutdown, exit zero.
- Delayed private shell: two sessions, four observed descendant identities gone
  (the wrappers/sleep processes included), FD 24 and zero settled children;
  494.8 ms workload, 31.4 ms shutdown, exit zero.

The reproduction used an executable private file containing:

```sh
#!/bin/sh
sleep 0.15
exec /bin/sh
```

It was selected through the existing terminal session `shell` option. The original
command's captured output included `\r\n$ WORKLOAD_<complete marker>\r\n`.
After adding the leading newline, the same delayed-shell check passed without
waiting for or interpreting the prompt. Local diagnostics are
`/tmp/automaker-wave17-delayed-pty.log`,
`/tmp/automaker-wave17-focused-pty-fixed.log` and
`/tmp/automaker-wave17-delayed-pty-fixed.log`.

A separate attempted run overlapped the server build's clean phase and failed
artifact preflight before starting a server; run the script only after build
completion.

## Limits

This is a short sequential local workload, not a long soak, parallel load test,
large repository benchmark, event backpressure proof or complete OS process
census. The 100-feature fixture and five waves do not establish unbounded-size
behavior. It samples descendants at defined points and confirms observed process
identities; it cannot prove that no unobserved short-lived detached process ever
existed. Provider streaming, remote execution, managed dev/test workloads and
Windows/macOS resource ownership remain covered by their own checks or open
acceptance gates. This result alone does not complete the migration plan.
