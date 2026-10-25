import { chmod, mkdtemp, readFile, symlink, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export async function githubReadFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'automaker-github-profile-'));
  const bin = path.join(root, 'bin');
  await mkdir(bin);
  const fixture = path.resolve(import.meta.dirname, '../fixtures/github-read-cli.mjs');
  await chmod(fixture, 0o755);
  await symlink(fixture, path.join(bin, 'gh'));
  const scenario = (mode: string, extra = {}) =>
    writeFile(path.join(root, 'scenario.json'), JSON.stringify({ mode, ...extra }));
  await scenario('normal');
  return {
    root,
    scenario,
    environment: {
      PATH: `${bin}${path.delimiter}${process.env.PATH}`,
      HOME: root,
      GH_REPO: 'unrelated/redirect',
      GH_TOKEN: 'fixture-profile-token',
    },
    calls: async () =>
      (await readFile(path.join(root, 'calls.jsonl'), 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line)),
    pids: async () =>
      JSON.parse(await readFile(path.join(root, 'pids.json'), 'utf8')) as {
        root: number;
        child: number;
      },
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}
