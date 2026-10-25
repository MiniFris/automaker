# Filesystem lifecycle checkpoint

Scope: native `SECURE_FILESYSTEM`, its current consumers and the accepted
`FilesCommandService` command queue. This closes the queue lifecycle/admission
gap recorded in ADR-041; it does not migrate legacy filesystem consumers.

| Requirement                | Implementation                                                                                                                         | Evidence                                                         |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Bounded accepted work      | Factory queue defaults to 1024 total active/queued public operations; native file commands cap 256 accepted commands                   | `secure-fs-lifecycle.test.ts`, `files-command-lifecycle.test.ts` |
| Whole-operation ownership  | Queue owns compound env read/modify/write methods, not only their individual syscalls                                                  | Held read followed by refused env write test                     |
| Stop admission             | Closed/busy typed refusals map to HTTP 503; synchronous IO also refuses after close                                                    | Factory/unit and native application contracts                    |
| No lost queued callers     | Close explicitly rejects queued callers; no `p-limit.clearQueue()` promises are abandoned                                              | Immediate queued rejection test                                  |
| Retry cleanup              | Close cancels retry delay/listeners and prevents another syscall                                                                       | Fake-timer retry test                                            |
| Confirmed drain            | Close waits for dispatched IO; 5-second native deadline rejects unconfirmed cleanup                                                    | Deferred IO units and native HTTP contract                       |
| No false cancellation      | Active IO remains counted after deadline, until actual settlement; cached close failure remains a failure after late settlement        | Timeout/late confirmation tests                                  |
| Dependency ordering        | File commands stop admission/drain in `onModuleDestroy`; filesystem closes in `beforeApplicationShutdown`                              | Accepted atomic-write native contract                            |
| HTTP transport is separate | Shared HTTP adapter can release a held request without claiming FS cleanup; checked app close still fails and later provider hooks run | `filesystem-lifecycle.contract.test.ts`                          |
| Application isolation      | Closing one native filesystem does not close another application or the legacy factory instance                                        | Two-owner native contract and factory unit                       |

The factory uses an explicit FIFO owner queue instead of p-limit so every queued
promise has an explicit rejection path. The now-unused platform p-limit dependency
is removed. Legacy exported methods retain a separate unlimited-admission default
instance for compatibility; its existing consumers still require migration.

Tested limits: controlled pending filesystem promises, real regular-file operations
and atomic rename. This is not proof of cancellation of a hung kernel/NFS syscall:
such a syscall is deliberately retained as unconfirmed. Cross-writer leases,
legacy settings/atomic writer, downloads, provider SDK helpers and portable
filesystem race hardening remain separate original migration requirements.
