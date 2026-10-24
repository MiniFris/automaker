#!/usr/bin/env node
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
const root = process.env.HOME;
if (!root || !path.basename(root).startsWith('automaker-github-profile-'))
  throw new Error('Owned fixture profile required');
const scenario = JSON.parse(readFileSync(path.join(root, 'scenario.json'), 'utf8'));
const args = process.argv.slice(2);
let input = '';
for await (const chunk of process.stdin) input += chunk;
appendFileSync(
  path.join(root, 'calls.jsonl'),
  JSON.stringify({
    args,
    input,
    cwd: process.cwd(),
    overrideAbsent: process.env.GH_REPO === undefined,
    profileToken: process.env.GH_TOKEN === 'fixture-profile-token',
  }) + '\n'
);
if (['hold', 'orphan'].includes(scenario.mode)) {
  process.on('SIGTERM', () => {});
  const child = spawn(
    process.execPath,
    ['-e', "process.on('SIGTERM',()=>{});process.send('ready');setInterval(()=>{},1000)"],
    { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] }
  );
  child.once('message', () => {
    writeFileSync(
      path.join(root, 'pids.json'),
      JSON.stringify({ root: process.pid, child: child.pid })
    );
    if (scenario.mode === 'orphan') {
      process.stdout.write(JSON.stringify({ name: 'repo.v2', owner: { login: 'owned' } }));
      process.exit(0);
    }
  });
  setInterval(() => {}, 1000);
} else if (scenario.mode === 'rate') {
  process.stderr.write('HTTP 429 private-provider-credential');
  process.exitCode = 1;
} else if (scenario.mode === 'flood') {
  process.stdout.write('x'.repeat(11 * 1024 * 1024));
} else if (scenario.mode === 'malformed') process.stdout.write('{');
else if (scenario.mode === 'exit') {
  process.stderr.write('private-provider-credential');
  process.exitCode = 1;
} else if (args[0] === 'repo')
  process.stdout.write(
    JSON.stringify({ name: scenario.repo || 'repo.v2', owner: { login: 'owned' } })
  );
else if (args[0] === 'issue')
  process.stdout.write(
    JSON.stringify(
      args.includes('open')
        ? [
            {
              number: 12,
              title: 'Owned issue',
              state: 'OPEN',
              body: 'Fixture',
              labels: [],
              author: { login: 'fixture' },
              assignees: [],
            },
          ]
        : []
    )
  );
else if (args[0] === 'pr')
  process.stdout.write(
    JSON.stringify(
      args.includes('open')
        ? [
            {
              number: 24,
              title: 'Owned PR',
              state: 'OPEN',
              body: '',
              isDraft: false,
              labels: [],
              author: { login: 'fixture' },
            },
          ]
        : []
    )
  );
else if (args[0] === 'api') {
  if (scenario.mode === 'links-failed') {
    process.stderr.write('private-provider-credential');
    process.exitCode = 1;
  } else {
    const { variables } = JSON.parse(input);
    const repository = {};
    for (const name of Object.keys(variables).filter((key) => key.startsWith('number')))
      repository['issue' + name.slice(6)] = {
        timelineItems: {
          pageInfo: { hasNextPage: false },
          nodes: [
            {
              source: {
                number: 24,
                title: 'Linked PR',
                state: 'OPEN',
                url: 'https://github.com/owned/repo.v2/pull/24',
              },
            },
          ],
        },
      };
    process.stdout.write(JSON.stringify({ data: { repository } }));
  }
} else {
  process.exitCode = 2;
}
