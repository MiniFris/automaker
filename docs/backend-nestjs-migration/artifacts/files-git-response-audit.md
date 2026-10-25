# Filesystem and Git response contracts

Sixteen filesystem and six Git JSON handlers now parse public runtime response
schemas from `domains/files-responses` and `domains/git-responses`. The root barrel,
generator, dependencies, application services, storage and process lifecycle are
unchanged by this slice.

Filesystem contracts describe read content, directory/project entries, stat,
existence, mutation acknowledgements, saved-image paths, path validation, browse
and directory resolution. Native stat dates normalize to the same ISO strings
Express previously serialized; a shared test compares the complete JSON bytes and
checks the generated output date-time schema. Empty content, false existence,
nullable parent paths, permission warnings and non-file/non-directory entries
remain valid. No path, filename or stored-data restriction is added.

Git contracts describe the actual target worker's environment descriptor, diffs,
optional merge state, file diff, stage/unstage counts, branch-only/file-specific
details and enhanced status. Branch/path/status text stays opaque; unborn or
untracked files retain empty commit metadata. Local/Docker/SSH descriptors use the
same seven owned fields as `ProjectGitEnvironment`. No remote runtime is contacted
by these fixtures. Five Git handlers retain `cancel` with disconnect abort and its
listener cleanup in `finally`; response parsing occurs after that wrapper settles.

`GET fs/image` and `POST fs/download` remain manual binary responses. Neither is
claimed as JSON runtime coverage. Fixtures independently assert image MIME/cache,
file octet-stream bytes/disposition and directory ZIP bytes/disposition by decoding
the actual archive. Existing streaming ownership/limits/cleanup implementation is
unchanged.

## Targeted evidence

- Three shared schema matrices passed, exercising Date normalization/output metadata,
  filesystem empty/false/null cases and malformed nested records, all target
  environment types, optional merge state, both Git details forms and malformed
  owned Git responses.
- Six native HTTP cases passed, exercising all 22 JSON operations using only private
  temporary files and an offline Git repository, including unborn files,
  stage/unstage, committed modification and a real merge conflict.
- A 22-handler malformed application-success matrix asserts safe HTTP 500 replies.
  Request/path/missing/conflict/admission errors and the existing filesystem IO
  unknown-outcome mapping retain their status/error precedence. Permission-denied
  browse remains HTTP 200 with its established warning.
- Git error and disconnect fixtures retain the original error identity, abort the
  accepted signal and remove the close listener on operation rejection as well as
  malformed response parsing.

The parent coordinated the shared build successfully. Focused shared/native tests,
scoped controller/test ESLint, server no-emit, formatting and diff checks passed.
Logs are `/tmp/files-git-response-shared.log`, `/tmp/files-git-response-native.log`
and `/tmp/files-git-response-tsc.log`. This owner ran no full suites, external
network, user repository/process operations, GUI, commits or branch changes.
