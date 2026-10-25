// Offline JSONL fixture. Never loads a vendor SDK or contacts a network endpoint.
const fs = require('node:fs');
const readline = require('node:readline');
const { createHash } = require('node:crypto');
const { spawn } = require('node:child_process');
const mode = process.env.FIXTURE_MODE || 'success';
const hash = (value) => (value ? createHash('sha256').update(value).digest('hex') : null);
const record = {
  pid: process.pid,
  cwd: process.cwd(),
  home: process.env.HOME,
  codexHome: process.env.CODEX_HOME,
  key: hash(process.env.OPENAI_API_KEY),
  alternate: hash(process.env.CODEX_API_KEY),
  omitted: hash(process.env.ANTHROPIC_API_KEY),
  methods: [],
};
const save = () => fs.writeFileSync(process.env.FIXTURE_CAPTURE, JSON.stringify(record));
save();
if (mode === 'descendant') {
  const descendant = spawn(
    process.execPath,
    ['-e', "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],
    {
      stdio: 'ignore',
      detached: false,
    }
  );
  record.descendant = descendant.pid;
  save();
}
if (['ignore-term', 'descendant', 'hang'].includes(mode)) process.on('SIGTERM', () => {});
else
  process.on('SIGTERM', () => setTimeout(() => process.exit(0), mode === 'slow-close' ? 100 : 0));
setInterval(() => {}, 1000);
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const message = JSON.parse(line);
  record.methods.push({ method: message.method, params: message.params });
  save();
  if (!message.id || mode === 'hang') return;
  if (mode === 'early-exit') process.exit(1);
  if (mode === 'malformed') {
    process.stderr.write('private-offline-rpc-detail');
    process.stdout.write('private-invalid-json\n');
    return;
  }
  if (mode === 'oversized') {
    process.stdout.write('x'.repeat(200000));
    return;
  }
  if (mode === 'approval') {
    process.stdout.write(
      JSON.stringify({ id: 80, method: 'item/commandExecution/requestApproval' }) + '\n'
    );
    return;
  }
  let result = {};
  if (message.method === 'model/list')
    result = {
      data: [
        {
          id: 'offline-model',
          model: 'offline-model',
          displayName: 'Модель',
          description: 'Offline fixture',
          supportedReasoningEfforts: [],
          defaultReasoningEffort: '',
          isDefault: true,
        },
      ],
      nextCursor: null,
    };
  if (message.method === 'account/read')
    result = { account: { type: 'chatgpt', planType: 'plus' }, requiresOpenaiAuth: true };
  if (message.method === 'account/rateLimits/read')
    result = { rateLimits: { primary: null, secondary: null, planType: 'plus' } };
  const response = Buffer.from(JSON.stringify({ id: message.id, result }) + '\n');
  if (mode === 'utf8') {
    for (const byte of response) process.stdout.write(Buffer.from([byte]));
  } else process.stdout.write(response);
});
