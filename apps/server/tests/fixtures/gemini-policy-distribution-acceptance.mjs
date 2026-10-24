// Offline acceptance of the actual pinned npm distribution's policy engine.
// CLI entrypoint runs only --version/--help with network blocked and owned HOME;
// policy decisions use the bundled engine without authentication/model clients.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const [packageRoot, root] = process.argv.slice(2);
assert.ok(packageRoot && root);
process.env.GEMINI_CLI_HOME = root;
process.env.HOME = root;
process.env.USERPROFILE = root;
const noNetwork = () => {
  throw new Error('Network is forbidden in Gemini policy acceptance.');
};
globalThis.fetch = noNetwork;
http.request = https.request = net.connect = net.createConnection = noNetwork;
const metadata = JSON.parse(await fs.readFile(path.join(packageRoot, 'package.json'), 'utf8'));
assert.equal(metadata.version, '0.65.0');
const bundle = path.join(packageRoot, 'bundle');
const guard = path.join(root, 'deny-network.mjs');
await fs.writeFile(
  guard,
  `import http from 'node:http'; import https from 'node:https'; import net from 'node:net';
const deny=()=>{throw Error('Network forbidden in owned Gemini CLI acceptance');};
const original=globalThis.fetch;
globalThis.fetch=(input,init)=>String(input).startsWith('data:')?original(input,init):Promise.reject(Error('Network forbidden in owned Gemini CLI acceptance'));
http.request=https.request=net.connect=net.createConnection=deny;`
);
const probeCli = async (flag) =>
  (
    await promisify(execFile)(
      process.execPath,
      ['--import', guard, path.join(bundle, 'gemini.js'), flag],
      {
        cwd: root,
        timeout: 10_000,
        maxBuffer: 65_536,
        env: {
          PATH: process.env.PATH,
          HOME: root,
          USERPROFILE: root,
          GEMINI_CLI_HOME: root,
          GEMINI_CLI_NO_RELAUNCH: '1',
          NO_COLOR: '1',
        },
      }
    )
  ).stdout;
assert.equal((await probeCli('--version')).trim(), '0.65.0');
const help = await probeCli('--help');
assert.ok(
  ['--admin-policy', '--extensions', '--approval-mode'].every((flag) => help.includes(flag))
);
const entry = await fs.readFile(path.join(bundle, 'gemini.js'), 'utf8');
let moduleFile;
for (const match of entry.matchAll(/import\s*["']\.\/(chunk-[^"']+\.js)["']/g)) {
  const file = path.join(bundle, match[1]);
  const source = await fs.readFile(file, 'utf8');
  if (source.includes('async function createPolicyEngineConfig(')) {
    moduleFile = file;
    break;
  }
}
assert.ok(
  moduleFile,
  'Pinned distribution core chunk must be found from its actual CLI entrypoint.'
);
const { createPolicyEngineConfig, PolicyEngine, ApprovalMode, Storage } = await import(
  pathToFileURL(moduleFile).href
);
const system = path.join(root, 'system');
await fs.mkdir(system);
const defaults = path.join(root, 'defaults');
await fs.mkdir(defaults);
Storage.getSystemPoliciesDir = () => system;
Storage.getUserPoliciesDir = () => path.join(root, 'empty-user-policy');
const configuration = () =>
  createPolicyEngineConfig(
    {
      adminPolicyPaths: [path.join(root, 'tools.toml')],
      policyPaths: [path.join(root, 'user.toml')],
    },
    ApprovalMode.DEFAULT,
    defaults,
    false
  );
const engine = new PolicyEngine(await configuration());
const check = async (name, expected, server, subagent) => {
  const result = await engine.check({ name, args: {} }, server, undefined, subagent, true);
  assert.equal(result.decision, expected, `${name}/${server ?? 'native'}/${subagent ?? 'main'}`);
};
await check('read_file', 'allow');
await check('write_file', 'deny');
await check('run_shell_command', 'deny');
await check('activate_skill', 'deny');
await check('delegate_to_agent', 'deny');
await check('read_file', 'deny', 'untrusted_mcp');
await check('run_shell_command', 'deny', undefined, 'codebase_investigator');
const denyAll = new PolicyEngine(
  await createPolicyEngineConfig(
    { adminPolicyPaths: [path.join(root, 'empty.toml')] },
    ApprovalMode.DEFAULT,
    defaults,
    false
  )
);
assert.equal(
  (await denyAll.check({ name: 'read_file', args: {} }, undefined, undefined, undefined, true))
    .decision,
  'deny'
);
await fs.writeFile(
  path.join(system, 'central.toml'),
  '[[rule]]\ntoolName="*"\ndecision="allow"\npriority=999\n'
);
const ignored = await configuration();
assert.ok(
  !ignored.rules.some((rule) => String(rule.source).includes('tools.toml')),
  'System TOML must demonstrate the ignored supplemental policy boundary.'
);
process.stdout.write(
  JSON.stringify({
    version: metadata.version,
    checks: 11,
    network: 0,
    authentication: 0,
    modelCalls: 0,
  }) + '\n'
);
