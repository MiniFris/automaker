# Files binary response contracts

Both manual binary endpoints now consume shared runtime descriptors from `domains/files-binary-responses.ts`; they do not serialize those descriptors as JSON responses.

- `FilesController.image` parses `ImageBinaryBodySchema` and `ImageBinaryResponseDescriptorSchema` before committing status/headers or sending a Buffer view. Shared MIME/cache/length values drive the actual response. `ImageQueryService` uses the shared extension→MIME map and 20 MiB limit; the buffered byte guard also checks actual read length.
- `LocalDownloadService.headers` parses `DownloadBinaryResponseDescriptorSchema` before setting any binary headers. Its file/ZIP variants validate status, Content-Type, Content-Disposition, Content-Length and ZIP X-Directory-Size. The returned descriptor's validated `byteLength` supplies both existing scoped `pipeFile` bounds. Downloads are not buffered.

Existing status, MIME mapping, cache policy, filename quote/CRLF sanitization and 20/500/100 MiB image/file/directory budgets remain intact. A new explicit 8192-character disposition bound and HTTP header-character validation reject invalid metadata before header commitment. ZIP construction, disconnect/abort handling, temporary cleanup and shutdown ownership were not rewritten. The existing sixteen FS JSON response schemas are unchanged.

Focused evidence with Node 22.22.3:

- 20 shared cases passed: exact buffered bytes, zero bytes, allowed media/cache/length metadata, matching lengths, byte budgets, mismatches and invalid headers.
- 5 new native cases passed: supported extension MIME mapping and exact non-text bytes; regular/empty file and ZIP bytes; actual header length equal to stream bound; malformed image replies/metadata rejected before binary headers; original quota/auth precedence; temporary ZIP removal when final metadata validation fails.
- Existing FS/Git response and download lifecycle cases passed (10), including private ZIP bytes, concurrent archive isolation, disconnect and held shutdown cleanup. Total: 15 distinct native cases across targeted runs.
- Server `tsc --noEmit`, owned production ESLint, formatting and whitespace checks passed. Root executed the coordinated shared build and owns OpenAPI generation/proof integration.

The first new cleanup assertion was adjusted to await the existing asynchronous finally-removal after client EOF; production lifecycle behavior did not change. MIME remains extension-derived; this does not certify decoded image formats. Stream descriptors validate metadata/bounds, not an eagerly buffered full-file snapshot or file immutability during streaming. Existing bounded streaming and actual-byte fixtures provide the complementary evidence. No external resources or user files were used.
