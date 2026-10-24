# Native downloads, archive streams and prompt context

`LocalDownloadService` receives the application's path policy, runtime paths and
`SECURE_FILESYSTEM`. Regular downloads use an owned pipeline limited to the admitted
file length. Client disconnect and module destruction cancel the stream; shutdown
drains accepted jobs and keeps private cleanup failures visible. Streaming errors
after headers have been sent close the response instead of attempting a second JSON
response in the global exception filter.

Directory archives no longer require a system `zip` binary (absent on this runner).
Pinned production `fflate@0.8.2` incrementally produces stored ZIP entries with
backpressure. This avoids its retained per-entry compressor buffers; 2,000 empty
entries are checked against a 32 MiB array-buffer allocation budget. Source content
remains limited to 100 MiB, directory traversal to 10,000 entries / 64 levels,
encoded metadata to 2 MiB, and actual archive/file output to 500 MiB. Symlinks
are omitted; their targets are not copied. ZIP names containing a literal backslash
are rejected to avoid ambiguous extraction paths on another OS.

Archive files live in private application DATA_DIR workspaces, with mode 0700
directories and mode 0600 files. The entire reserved `.automaker-downloads` subtree
is excluded from archive scanning, including other simultaneous jobs. The output
workspace is removed after streaming; a failed removal makes later shutdown fail
instead of reporting confirmed cleanup. Admission is capped at eight downloads.

`pipeFile`, `writeStream` and `withFileStreams` belong to the scoped filesystem.
The stream scope admits one complete read/write transfer, tracks actual pipelines,
and revokes its handles after completion. This avoids recursively acquiring queue
slots when a ZIP producer reads files while its consumer writes output. A real
archive and a read/write stream transfer are tested with FS concurrency set to one.
Per-operation close does not claim cancellation of arbitrary OS filesystem work.

Prompt enhancement reads app_spec and feature titles through the injected scoped
filesystem. It no longer calls `FeatureLoader.getAll`, whose legacy recovery could
silently ignore IO errors or restore files during a passive prompt query. Missing
context remains optional; denied/unavailable reads and corrupt feature JSON reject
before provider execution. Only the titles entering the prompt are loaded, with one
extra title to retain the existing ellipsis. The optional projectPath guard matches
the request schema.

Targeted evidence: **16 platform units**, **5 archive/prompt service units**, **6 native
HTTP contracts**. Coverage includes real ZIP extraction, independent path policy,
empty files/directories, denied paths, single-slot FS transfer, concurrent archive
exclusion, actual client disconnect, sticky cleanup failure, revoked stream scope,
corrupt context without recovery writes and stopped filesystem without model calls.
Native contracts were also run under `TZ=America/Los_Angeles` with real pre-1980
and post-2099 file dates. Dates are clamped in the local calendar to the years the
pinned library accepts; UTC clamping would produce 1979 in western time zones.

Docker build ordering now caches dependency installation and browser assets before
application/libs/scripts copies; a source-only change no longer invalidates both
network downloads. The changed Dockerfile still requires its production build/smoke
checkpoint; this ordering is not itself evidence of a completed build.

Remaining: legacy Electron profile import, other global/default FS consumers,
cross-writer coordination and external-process path races. This slice does not
declare every filesystem adapter migrated or all archive workflows accepted on
unavailable macOS/Windows runners.
