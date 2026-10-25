import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { QueueDisplay } from '@/components/views/agent-view/input-area/queue-display';

vi.mock('@/lib/i18n', () => ({
  translate: (value: string) => value,
  useUiLocale: () => undefined,
  formatCount: (count: number) => String(count),
}));
afterEach(cleanup);

it('shows quarantine explicitly without automatically removing or resubmitting the interrupted request', () => {
  const remove = vi.fn(),
    clear = vi.fn();
  render(
    <QueueDisplay
      serverQueue={[{ id: 'paused', message: 'Retained request', deliveryStatus: 'interrupted' }]}
      onRemoveFromQueue={remove}
      onClearQueue={clear}
    />
  );
  expect(screen.getByRole('alert').textContent).toContain('outcome may be unknown');
  expect(screen.getByText('Paused')).toBeDefined();
  expect(remove).not.toHaveBeenCalled();
  expect(clear).not.toHaveBeenCalled();
  fireEvent.click(screen.getByTitle('Remove from queue'));
  expect(remove).toHaveBeenCalledWith('paused');
});
it('does not show a recovery warning for ordinary queued requests', () => {
  render(
    <QueueDisplay
      serverQueue={[{ id: 'ordinary', message: 'Next request' }]}
      onRemoveFromQueue={vi.fn()}
      onClearQueue={vi.fn()}
    />
  );
  expect(screen.queryByRole('alert')).toBeNull();
});
