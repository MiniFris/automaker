import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parse } from 'yaml';

const base = parse(readFileSync(new URL('../../docker-compose.yml', import.meta.url), 'utf8'));

test('the ordinary production server persists project repositories independently of its writable layer', () => {
  assert.ok(base.services.server.volumes.includes('automaker-projects:/projects'));
  assert.equal(base.volumes['automaker-projects'].name, 'automaker-projects');
  assert.ok(base.services.server.volumes.includes('automaker-data:/data'));
});

test('project persistence does not require Docker socket access', () => {
  assert.equal(base.services.server.build.target, 'server');
  assert.ok(
    base.services.server.volumes.every((entry) => !JSON.stringify(entry).includes('docker.sock'))
  );
});
