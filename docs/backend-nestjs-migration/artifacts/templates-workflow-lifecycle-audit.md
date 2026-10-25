# Native template clone workflow ownership

## Implemented

`SpawnTemplateCommandRunner` tracks accepted commands, their original child objects and Linux owned-child supervisors. Linux commands spawn as detached session leaders; completion waits for the existing generation-checked supervisor's process-group proof. Shutdown stops admission, aborts every accepted command and awaits all results. Unknown cleanup retains the command/owner references and makes shutdown fail. Affirmative no-spawn errors remain ordinary startup failures and do not poison the runner. Stderr remains bounded to 64 KiB; argv execution remains shell-free.

`TemplatesService` owns the whole accepted clone through target creation, clone, metadata removal, initialization, response and error cleanup. It reserves each canonical target synchronously before yielding and bounds accepted workflows to 16. Exclusive nonrecursive destination creation allows cloning into an empty directory while preventing a losing attempt from deleting another attempt's target. Existing/foreign directories retain their contents. Cleanup checks the created directory's device/inode; changed identity, unconfirmed process cleanup or failed removal retain admission and report a safe cleanup error.

Cancellation checks surround awaited stages and target-identity checks. A stopped workflow cannot start initialization or publish success after a held clone returns. Existing successful response fields/shared response validation, sanitized name, storage location and best-effort nonzero `git init` warning behavior remain unchanged.

Both runner and whole-workflow ownership drain during `onModuleDestroy`, before scoped filesystem closure. Runner cleanup uses the existing bounded child supervisor; whole-workflow drain has a cached ten-second limit. Timeout remains a failure after late completion. The two owners can drain concurrently: no new command is admitted during shutdown, while accepted workflows retain filesystem access to finish their owned cleanup.

## Focused evidence

Node 22.22.3; no GitHub/model calls or host listeners:

- Unit cases cover stopped admission before any spawn/filesystem work; ordinary clone failure and retry; retained unknown command cleanup; directory identity replacement; cleanup EIO; bounded whole-workflow drain/no late initialization; affirmative real missing-executable failure followed by a known nonzero private command; and normal Darwin/Windows compatibility behavior.
- Native contracts cover canonical alias contention, an external exclusive-mkdir collision with preserved foreign contents, held clone and held cleanup across application close, rejected post-close work, and an actual private TERM-resistant Linux command stopped before target removal/filesystem closure.
- Final targeted checks: 14 unit cases and 6 native contract cases passed, including existing workspace/template response contracts and edge-module tests. Server `tsc --noEmit`, owned production ESLint, formatting and whitespace checks passed.

## Limits

Linux evidence certifies only the original owned process group under the existing supervisor's generation-anchor rules; deliberately escaped sessions are outside that proof. Non-Linux commands retain original root-process compatibility and bounded cancellation, without claiming descendant-tree certification. Destination identity checks are not cross-process filesystem locking or an atomic defense against arbitrary external rename races. No automatic clone replay, journal or directory adoption was added; unknown cleanup preserves the target for inspection.
