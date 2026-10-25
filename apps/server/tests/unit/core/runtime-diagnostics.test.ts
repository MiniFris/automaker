import { expect, it } from 'vitest';
import { DevServerService } from '../../../src/services/dev-server-service.js';
import { TestRunnerService } from '../../../src/services/test-runner-service.js';

function processProbeTrap() {
  return Object.defineProperty({}, 'process', {
    get() {
      throw new Error('Diagnostics must not inspect or signal a process');
    },
  });
}
it('reports native dev records, accepted preflight and unknown cleanup without pruning/probing', () => {
  const service = new DevServerService({ dataDirectory: '/not-read' } as never);
  const retained = Object.assign(processProbeTrap(), { cleanupUnknown: true });
  const ordinary = Object.assign(processProbeTrap(), { cleanupUnknown: false });
  Object.assign(service, {
    runningServers: new Map([
      ['retained', retained],
      ['ordinary', ordinary],
    ]),
    acceptedStarts: new Set([Promise.resolve()]),
  });
  expect(service.runtimeDiagnostics()).toEqual({ active: 2, pending: 1, unknownCleanup: 1 });
  expect(service.runtimeDiagnostics()).toEqual({ active: 2, pending: 1, unknownCleanup: 1 });
});
it('excludes completed test history while retaining unknown cleanup and accepted starts', () => {
  const service = new TestRunnerService({} as never);
  const session = (status: string, cleanupUnknown = false) =>
    Object.assign(processProbeTrap(), { status, cleanupUnknown });
  Object.assign(service, {
    sessions: new Map([
      ['history', session('completed')],
      ['unknown', session('error', true)],
      ['active', session('running')],
      ['pending', session('pending')],
    ]),
    acceptedStarts: new Set([Promise.resolve()]),
  });
  expect(service.runtimeDiagnostics()).toEqual({ active: 3, pending: 1, unknownCleanup: 1 });
});
