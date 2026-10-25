import { createHash } from 'node:crypto';
import ts from 'typescript';
import { z } from 'zod';

/** Pins reviewed executable structure, not formatting/comments. Never refresh automatically. */
export function binarySourceDigest(contents) {
  const ast = ts.createSourceFile('boundary.ts', contents, ts.ScriptTarget.Latest, true);
  const nodes = [];
  function visit(node) {
    nodes.push(
      !ts.isSourceFile(node) && typeof node.text === 'string' ? [node.kind, node.text] : [node.kind]
    );
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return createHash('sha256').update(JSON.stringify(nodes)).digest('hex');
}

// Reviewed runtime graph: image parse -> headers/send; download descriptor ->
// headers/bounded pipeFile; native FS ownership and ZIP writer. Updating a pinned
// implementation requires source review and byte/lifecycle acceptance again.
export const BINARY_SOURCE_APPROVALS = Object.freeze({
  'apps/server/src/modules/files/application.providers.ts':
    '79d3d3cd5e49a90887066f39b880e27f38100bf77e1e1556e036fa3efbb33288',
  'apps/server/src/modules/files/files.module.ts':
    'cf2ed9d8ae3ce9cff5b98c7f35fa32f501af876dbc9bbd85df78fd0a3ff6d994',
  'apps/server/src/modules/files/files.controller.ts':
    '560a30cfa1eee69971f3d4b2f845b21184fb01bac26c3889eb959742c614eb7a',
  'apps/server/src/modules/files/image-query.service.ts':
    '338e627d522b94a154c6d8b1d8e0f0f3e300f17dd6d841c52564017adf8bc544',
  'apps/server/src/modules/files/local-download.service.ts':
    '306136794856033e259e6c7804d6ae8c47ee30100e9d3f76f93403539236c519',
  'apps/server/src/modules/files/local-zip-archive.ts':
    '664f2e6b0398131ec6eb594595205daf4a6bbbee7dfde7c423f6855e0c656fea',
  'apps/server/src/core/security/security.module.ts':
    '2b4cfb569caf277467faa0d386fe166c527976c0f5b4556d59eba0d3f334a9cf',
  'libs/platform/src/secure-fs.ts':
    '0a9fc9ee4caa4b9df1bc6839fc06be383b7253ad34362516fbeab2337ec2d336',
});

export async function binarySourcesVerified(read) {
  for (const [file, approved] of Object.entries(BINARY_SOURCE_APPROVALS))
    if (binarySourceDigest(await read(file)) !== approved) return false;
  return true;
}

export async function binaryOperationContract(handler, read) {
  if (!['FilesController.image', 'FilesController.download'].includes(handler)) return undefined;
  if (!(await binarySourcesVerified(read))) return undefined;
  const shared = await import('@automaker/contracts/domains/files-binary-responses');
  const image = handler === 'FilesController.image';
  const media = image ? shared.IMAGE_BINARY_MEDIA_TYPES : shared.DOWNLOAD_BINARY_MEDIA_TYPES;
  const headersSchema = z.toJSONSchema(
    image ? shared.ImageBinaryHeadersSchema : shared.FileDownloadBinaryHeadersSchema,
    { io: 'output' }
  );
  const properties = { ...headersSchema.properties };
  if (!image)
    properties['X-Directory-Size'] = z.toJSONSchema(shared.DirectoryDownloadBinaryHeadersSchema, {
      io: 'output',
    }).properties['X-Directory-Size'];
  const headers = Object.fromEntries(
    Object.entries(properties)
      .filter(([name]) => name !== 'Content-Type')
      .map(([name, schema]) => [
        name,
        {
          description:
            name === 'X-Directory-Size'
              ? 'Present for directory ZIP responses only.'
              : 'Validated before response headers are sent.',
          schema,
        },
      ])
  );
  return {
    'x-response-contract': 'shared-binary-runtime',
    'x-binary-runtime-proof': Object.keys(BINARY_SOURCE_APPROVALS),
    responses: {
      200: {
        description: image
          ? 'Validated image bytes and headers.'
          : 'Validated file/ZIP metadata with an owned bounded byte stream.',
        headers,
        content: Object.fromEntries(
          media.map((type) => [type, { schema: { type: 'string', format: 'binary' } }])
        ),
        'x-max-response-bytes': image ? shared.IMAGE_MAX_BYTES : shared.DOWNLOAD_MAX_BYTES,
      },
      default: {
        description:
          'Non-success responses use endpoint/middleware JSON errors; full error schema is not yet verified.',
      },
    },
  };
}
