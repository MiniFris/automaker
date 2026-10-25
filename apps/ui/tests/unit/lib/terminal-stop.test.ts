import { expect, it, vi } from 'vitest';
import {
  stopTerminalSession,
  stopTerminalTab,
  inspectTerminalSession,
} from '../../../src/lib/terminal-stop';

it('keeps session layout and identity until the accepted stop actually responds', async () => {
  let release!: (value: Response) => void;
  const request = vi.fn(
    () =>
      new Promise<Response>((resolve) => {
        release = resolve;
      })
  );
  const remove = vi.fn();
  const failed = vi.fn();
  const stopping = stopTerminalSession('owned', { request, remove, failed });
  await Promise.resolve();
  expect(remove).not.toHaveBeenCalled();
  release(new Response(JSON.stringify({ success: true }), { status: 200 }));
  expect(await stopping).toBe(true);
  expect(remove).toHaveBeenCalledWith('owned');
  expect(failed).not.toHaveBeenCalled();
});

it.each([503, 401, 500])(
  'retains layout, metadata and original identity after HTTP %i',
  async (status) => {
    const remove = vi.fn();
    const failed = vi.fn();
    expect(
      await stopTerminalSession('unknown', {
        request: async () =>
          new Response(JSON.stringify({ success: false, code: 'TERMINAL_CLEANUP_FAILED' }), {
            status,
          }),
        remove,
        failed,
      })
    ).toBe(false);
    expect(remove).not.toHaveBeenCalled();
    expect(failed).toHaveBeenCalledOnce();
  }
);

it('retains identity on network loss, malformed success or an explicit unsuccessful body', async () => {
  for (const request of [
    async (): Promise<Response> => {
      throw new Error('network');
    },
    async () => new Response('<html>not proof</html>'),
    async () => new Response(JSON.stringify({ success: false })),
  ]) {
    const remove = vi.fn();
    expect(await stopTerminalSession('owned', { request, remove, failed: vi.fn() })).toBe(false);
    expect(remove).not.toHaveBeenCalled();
  }
});

it('removes an explicitly missing session without recreating it', async () => {
  const remove = vi.fn();
  expect(
    await stopTerminalSession('gone', {
      request: async () => new Response('{}', { status: 404 }),
      remove,
      failed: vi.fn(),
    })
  ).toBe(true);
  expect(remove).toHaveBeenCalledWith('gone');
});

it('keeps a tab containing any failed stop, while removing only confirmed panels', async () => {
  const remove = vi.fn();
  const removeTab = vi.fn();
  const stop = (id: string) =>
    stopTerminalSession(id, {
      request: async () =>
        new Response(JSON.stringify({ success: id === 'closed' }), {
          status: id === 'closed' ? 200 : 503,
        }),
      remove,
      failed: vi.fn(),
    });
  await stopTerminalTab(['closed', 'unknown'], stop, removeTab);
  expect(remove).toHaveBeenCalledExactlyOnceWith('closed');
  expect(removeTab).not.toHaveBeenCalled();
  await stopTerminalTab(['closed'], stop, removeTab);
  expect(removeTab).toHaveBeenCalledOnce();
});

it('retains unknown saved identities across restore and discards only a confirmed missing one', async () => {
  for (const status of [200, 401, 503, 500])
    expect(await inspectTerminalSession(async () => new Response('{}', { status }))).toBe(
      'unknown'
    );
  expect(
    await inspectTerminalSession(async () => {
      throw new Error('offline');
    })
  ).toBe('unknown');
  expect(await inspectTerminalSession(async () => new Response('{}', { status: 404 }))).toBe(
    'missing'
  );
  expect(
    await inspectTerminalSession(
      async () => new Response(JSON.stringify({ success: true }), { status: 200 })
    )
  ).toBe('active');
});
