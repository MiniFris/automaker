# Actual Linux terminal output and TCP backpressure acceptance

2026-10-25, production `apps/server/dist` built from wave22 checkpoint `67948aa8`.
This is a bounded artifact acceptance, not a result for later wave23 source. The
root checkpoint repeats the probe after its final build.

[Probe](../../../scripts/smoke-terminal-backpressure.mjs) launches one private native
backend, actual local PTYs and loopback WebSocket clients. A Python socket peer
completes the actual WS upgrade and stops receiving; it changes only its own socket
receive buffer/MSS. No fake `bufferedAmount`, operator profile, external service,
Docker job or interface configuration is used. A healthy viewer keeps receiving
output and application ping/pong while the slow connection reaches close `4008`.

| Actual measurement                              | Result                                                                       |
| ----------------------------------------------- | ---------------------------------------------------------------------------- |
| Producer                                        | 118,766,430 bytes / 1,812 chunks in 20,007.89 ms                             |
| Healthy live viewer                             | 20,038,758 bytes / 4,895 packets, final marker, 67 pongs                     |
| Reconnect replay                                | 50,000 characters, including final marker                                    |
| Actual paused socket                            | receive buffer 8,192 bytes; negotiated MSS 1,012                             |
| Slow viewer                                     | close `4008`; 1,080,363 bytes drained before close                           |
| Kernel TCP TX queue peak                        | 30,976 bytes, measured through `/proc/net/tcp`                               |
| Backend descriptors                             | baseline 24, peak 27, settled 23                                             |
| Backend RSS                                     | baseline 221,122,560 bytes; sampled peak 225,050,624; settled 226,480,128    |
| Owned descendants                               | three PID/start-time identities observed, none surviving; settled children 0 |
| SIGTERM with another live PTY and paused viewer | exit 0 in 42.84 ms                                                           |

The probe aggregates children across **all** `/proc/<pid>/task/*/children` files:
native PTY creation may occur on a worker thread. It verifies PID start time and
process group before owned cleanup. Startup has a 30 s bound, the actual producer
runs 20 s, sampling has a 23 s bound, and cleanup/shutdown assertions retain 5 s
bounds. Prettier, syntax and whitespace checks passed. Log:
`/tmp/automaker-wave23-terminal-backpressure.log`.

Terminal pending output and scrollback deliberately retain capped tails. Produced
and delivered byte counts therefore differ; this does not assert complete stdout
replay. FD, RSS and TCP queues are OS measurements, not logical buffer counters.
One 20 s Linux workload is not a WAN benchmark, a universal memory/throughput bound,
or actual Windows/macOS/WSL process acceptance. Existing
[host/RC evidence](terminal-host-configuration-audit.md) separately covers captured
application environment, scoped atomic RC/theme IO and accepted-operation drain.
