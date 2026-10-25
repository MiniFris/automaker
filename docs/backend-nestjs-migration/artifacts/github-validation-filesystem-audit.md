# GitHub issue validation storage

## Implemented native boundary

`GithubModule` now constructs `IssueValidationRepository` with the application's `SECURE_FILESYSTEM` and a `SecurityService.validateLocalPath` canonical-project resolver. It explicitly imports `SecurityModule`. The repository has no global filesystem fallback.

All repository reads, listings, writes, deletions and read/update/write viewed mutations share a transaction lane per canonical project. Project symlink aliases therefore cannot race a replacement against a viewed mutation. Admission is bounded to 256 accepted operations per repository; rejected work returns `503`. Failures reach the original caller without poisoning subsequent queued operations.

`lib/validation-storage.ts` accepts an explicit filesystem port throughout. Native callers always supply it. Writes replace the existing JSON atomically using the scoped temporary-file/rename helper. Existing `.automaker/validations/{issueNumber}/validation.json`, JSON indentation, timestamps, freshness rules, sorting and successful response/event contracts are unchanged. Idempotent delete still succeeds for an absent directory.

Only genuine `ENOENT` is optional state. EIO, denied paths, invalid JSON and malformed stored validation objects propagate instead of becoming null/empty lists/false deletion. A failed viewed mutation emits no viewed event; successful events remain after commit. No automatic provider replay or replacement job was added.

## Shutdown ordering

`IssueValidationRegistry` retains ownership of active producers and drains them during `onModuleDestroy`. The repository stays writable for their final accepted result, then stops admission and drains its transaction queue during `beforeApplicationShutdown`, before the scoped filesystem barrier. Its five-second close result is cached, including timeout/failure. New work is rejected after close starts.

A real native close test holds a registry producer, starts shutdown, observes cancellation, allows its final repository write, holds that rename, and asserts the order `producer committed → repository drained → filesystem closed`. This proves actual Nest ordering rather than relying on same-module provider hook order.

## Validation

Node 22.22.3, without model/vendor/CLI requests:

- 31 existing unit cases passed (validation storage, registry and service).
- 2 new repository unit cases passed (bounded admission, failure recovery, bounded close and retained timeout after late completion).
- 7 native cases passed across existing issue-validation lifecycle and the new filesystem contract. The final three-case filesystem retry also passed after adding commit/event assertions.
- Native checks cover two isolated roots, explicit filesystem identity, foreign roots, escaped symlinks, canonical project aliases, concurrent write/viewed mutation, corruption, read/list/delete/rename EIO, unchanged prior JSON after failure, successful retry, producer-held close and post-close rejection.
- Server `tsc --noEmit` and owned production ESLint passed. Changed files pass formatting and diff whitespace checks.

## Limits

Public standalone storage helpers retain their legacy default filesystem for non-native callers; direct helper callers do not receive the repository transaction lane. Serialization is application-local, with no inter-process locking. A timeout reports unconfirmed cleanup and does not prove termination of a blocked OS operation. Wire statuses and provider cancellation/ownership algorithms were not changed.
