import { expect, it } from 'vitest';
import { installProcessExceptionHandlers } from '../../../src/core/lifecycle/process-exception-handlers.js';

it('installs and removes only its own production process exception listeners', () => {
  const rejection = process.listeners('unhandledRejection');
  const exception = process.listeners('uncaughtException');
  const remove = installProcessExceptionHandlers();
  try {
    expect(process.listeners('unhandledRejection')).toHaveLength(rejection.length + 1);
    expect(process.listeners('uncaughtException')).toHaveLength(exception.length + 1);
  } finally {
    remove();
    remove();
  }
  expect(process.listeners('unhandledRejection')).toEqual(rejection);
  expect(process.listeners('uncaughtException')).toEqual(exception);
});
