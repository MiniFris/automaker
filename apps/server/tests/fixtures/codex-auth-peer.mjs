import readline from 'node:readline';
const mode = process.argv[2];
if (mode === 'ignore-term') {
  process.on('SIGTERM', () => {});
  setInterval(() => {}, 1000);
}
const lines = readline.createInterface({ input: process.stdin });
lines.on('line', (line) => {
  const message = JSON.parse(line);
  if (message.method === 'initialize') {
    if (mode === 'hang-init' || mode === 'ignore-term') return;
    if (mode === 'malformed') {
      process.stdout.write('not-json\n');
      return;
    }
    if (mode === 'flood') {
      process.stdout.write('x'.repeat(262145));
      return;
    }
    process.stdout.write(
      JSON.stringify({ id: message.id, result: { userAgent: 'offline-auth-peer' } }) + '\n'
    );
  } else if (message.method === 'getAuthStatus') {
    if (mode === 'hang-token') return;
    if (mode === 'unexpected-request') {
      process.stdout.write(
        JSON.stringify({ id: 99, method: 'item/commandExecution/requestApproval' }) + '\n'
      );
      return;
    }
    process.stderr.write('private-fixture-stderr\n');
    process.stdout.write(
      JSON.stringify({
        id: message.id,
        result: {
          authMethod: 'apikey',
          authToken:
            mode === 'metadata-leak' || message.params.includeToken
              ? 'sk-offline-token-fixture-123'
              : null,
          requiresOpenaiAuth: true,
        },
      }) + '\n'
    );
  } else if (message.method !== 'initialized') {
    process.stdout.write(
      JSON.stringify({ id: message.id, error: { message: 'Unexpected auth RPC method' } }) + '\n'
    );
  }
});
